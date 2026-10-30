import { ApiError, type Order, type ResellerApi } from './api';
import type { OrderRecord, OrderStore } from './store';

/**
 * Turns a paid Stripe Checkout Session into a wholesale order. Safe to call any number of
 * times, concurrently, from the Stripe webhook, the /order/pending poll and the admin retry:
 *
 *  - once the record has an eSimDistributor order it is never ordered again;
 *  - every POST /orders carries an Idempotency-Key (the Stripe session id), so two racing
 *    calls get the same order back from the API instead of buying two eSIMs;
 *  - only after a *definitive* rejection (e.g. 402 insufficient_balance — nothing was
 *    created) does the next attempt use a fresh key, so a retry after topping up works.
 */

export interface PaidSession {
  sessionId: string;
  sku: string;
  planName: string;
  email: string;
  amountCents: number;
}

export interface FulfilDeps {
  api: ResellerApi;
  store: OrderStore;
  /** true → the API sends its white-labelled eSIM email. */
  apiSendsEmail: boolean;
  /** Called once when an order first reaches `completed` (e.g. to send the branded link email). */
  onCompleted?: (rec: OrderRecord) => Promise<Partial<OrderRecord> | void>;
  log?: Pick<Console, 'info' | 'warn' | 'error'>;
}

export function newRecord(s: PaidSession): OrderRecord {
  const now = new Date().toISOString();
  return {
    sessionId: s.sessionId,
    sku: s.sku,
    planName: s.planName,
    email: s.email,
    amountCents: s.amountCents,
    state: 'pending',
    attempts: 0,
    idempotencyKey: s.sessionId,
    createdAt: now,
    updatedAt: now,
  };
}

export function applyOrder(rec: OrderRecord, order: Order): OrderRecord {
  const state: OrderRecord['state'] =
    order.status === 'completed' ? 'completed' : order.status === 'processing' ? 'processing' : 'failed';
  const next: OrderRecord = {
    ...rec,
    state,
    orderId: order.id,
    orderNumber: order.number,
    esims:
      order.esims && order.esims.length > 0
        ? order.esims.map((e) => ({
            iccid: e.iccid,
            planName: e.planName,
            lpa: e.lpa,
            smdpAddress: e.smdpAddress,
            matchingId: e.matchingId,
          }))
        : rec.esims,
  };
  if (state === 'failed') {
    next.failureCode = `order_${order.status}`;
    next.failureMessage = `eSimDistributor order ${order.number} is ${order.status}.`;
    // The order exists but failed upstream (and is refunded to the balance) — a retry must be a new order.
    next.idempotencyKey = `${rec.sessionId}:r${rec.attempts}`;
  } else {
    delete next.failureCode;
    delete next.failureMessage;
  }
  return next;
}

/** Records that already hold a live or finished order must not be re-ordered. */
export function hasOrder(rec: OrderRecord | null): boolean {
  return !!rec && !!rec.orderId && (rec.state === 'completed' || rec.state === 'processing');
}

async function finish(deps: FulfilDeps, before: OrderRecord['state'] | undefined, rec: OrderRecord): Promise<OrderRecord> {
  if (rec.state === 'completed' && before !== 'completed' && deps.onCompleted) {
    try {
      const patch = await deps.onCompleted(rec);
      if (patch) Object.assign(rec, patch);
    } catch (e) {
      (deps.log ?? console).error('[fulfil] onCompleted hook failed', e);
    }
  }
  await deps.store.save(rec);
  return rec;
}

export async function fulfilSession(session: PaidSession, deps: FulfilDeps): Promise<OrderRecord> {
  const log = deps.log ?? console;
  const existing = await deps.store.get(session.sessionId);
  if (existing && hasOrder(existing)) return existing;

  const rec: OrderRecord = existing ?? newRecord(session);
  const before = existing?.state;
  rec.attempts += 1;

  try {
    const order = await deps.api.createOrder(
      {
        items: [{ sku: rec.sku, quantity: 1 }],
        externalRef: rec.sessionId.slice(0, 100),
        customerEmail: rec.email,
        sendEmail: deps.apiSendsEmail,
      },
      rec.idempotencyKey,
    );
    const next = applyOrder(rec, order);
    log.info(`[fulfil] ${rec.sessionId} → order ${order.number} (${order.status}), attempt ${rec.attempts}`);
    return await finish(deps, before, next);
  } catch (e) {
    rec.state = 'failed';
    if (e instanceof ApiError) {
      rec.failureCode = e.code;
      rec.failureMessage = e.message;
      // Nothing was created upstream → a fresh key lets the next attempt actually run.
      // Ambiguous failures (5xx, 409, 429, network) keep the same key so a retry can never double-order.
      if (e.isDefinitiveRejection) rec.idempotencyKey = `${rec.sessionId}:r${rec.attempts}`;
    } else {
      rec.failureCode = 'network_error';
      rec.failureMessage = e instanceof Error ? e.message : String(e);
    }
    if (rec.failureCode === 'insufficient_balance') {
      log.error(
        `[fulfil] ACTION REQUIRED: eSimDistributor balance too low to fulfil paid Stripe session ${rec.sessionId} ` +
          `(${rec.sku}, customer ${rec.email}). Top up in the console — the order is retried automatically ` +
          `(cron every 10 minutes, or when the customer revisits their order page), or call POST /api/admin/retry. Turn on auto top-up to avoid this.`,
      );
    } else {
      log.error(`[fulfil] order for ${rec.sessionId} failed: ${rec.failureCode} ${rec.failureMessage}`);
    }
    await deps.store.save(rec);
    return rec;
  }
}

/** Retry back-off for failed records: 30s, 1m, 2m, … capped at 30 minutes. */
export function retryDue(rec: OrderRecord, now = Date.now()): boolean {
  if (rec.state !== 'failed') return false;
  const waitMs = Math.min(30_000 * 2 ** Math.max(0, rec.attempts - 1), 30 * 60_000);
  return now - Date.parse(rec.updatedAt) >= waitMs;
}

/** Polls the API for a `processing` order. */
export async function refreshProcessing(rec: OrderRecord, deps: FulfilDeps): Promise<OrderRecord> {
  if (rec.state !== 'processing' || !rec.orderId) return rec;
  const order = await deps.api.order(rec.orderId);
  if (!order || order.status === 'processing') return rec;
  return finish(deps, rec.state, applyOrder(rec, order));
}

/** Applies an order pushed by an eSimDistributor webhook. */
export async function applyWebhookOrder(order: Order, deps: FulfilDeps): Promise<OrderRecord | null> {
  const rec = await deps.store.byOrderId(order.id);
  if (!rec) return null;
  if (rec.state === 'completed' && order.status === 'completed') return rec;
  return finish(deps, rec.state, applyOrder(rec, order));
}

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type CreateOrderInput, type Order, type ResellerApi } from '../src/lib/api';
import { applyWebhookOrder, fulfilSession, refreshProcessing, retryDue, type FulfilDeps, type PaidSession } from '../src/lib/fulfil';
import { MemoryKV, OrderStore } from '../src/lib/store';

const session: PaidSession = {
  sessionId: 'cs_test_abc123',
  sku: 'ESA-FR-3GB-30D',
  planName: 'France 3GB 30 Days',
  email: 'traveller@x.com',
  amountCents: 699,
};

function order(over: Partial<Order> = {}): Order {
  return {
    id: '100234',
    number: '100234',
    status: 'completed',
    total: 3.15,
    currency: 'USD',
    createdAt: '2026-10-30T10:00:00Z',
    externalRef: session.sessionId,
    items: [{ sku: session.sku, name: session.planName, quantity: 1, unitPrice: 3.15 }],
    esims: [
      {
        iccid: '8985000000000000001',
        orderId: '100234',
        sku: session.sku,
        planName: session.planName,
        status: 'not_installed',
        lpa: 'LPA:1$rsp.example.com$ABCD-1234',
        smdpAddress: 'rsp.example.com',
        matchingId: 'ABCD-1234',
        qrCodeUrl: null,
        dataTotalMb: 3072,
        dataUsedMb: 0,
        expiresAt: null,
        activatedAt: null,
        customerEmail: session.email,
      },
    ],
    ...over,
  };
}

/** Fake API that mimics server-side idempotency: same key → same order, one order per key. */
function fakeApi() {
  const byKey = new Map<string, Order>();
  const behaviour: { next: (() => Order) | null } = { next: null };
  const createOrder = vi.fn(async (_input: CreateOrderInput, key: string) => {
    const existing = byKey.get(key);
    if (existing) return existing;
    const o = behaviour.next ? behaviour.next() : order();
    byKey.set(key, o);
    return o;
  });
  const api: ResellerApi = {
    mock: true,
    catalog: vi.fn(),
    destinations: vi.fn(),
    plan: vi.fn(),
    createOrder,
    order: vi.fn(async () => order()),
    qrPng: vi.fn(),
    resendEsimEmail: vi.fn(),
  };
  return { api, createOrder, behaviour, byKey };
}

const silent = { info: () => {}, warn: () => {}, error: vi.fn() };

describe('fulfilSession', () => {
  let kv: MemoryKV;
  let store: OrderStore;
  let fake: ReturnType<typeof fakeApi>;
  let deps: FulfilDeps;

  beforeEach(() => {
    kv = new MemoryKV();
    store = new OrderStore(kv);
    fake = fakeApi();
    silent.error.mockClear();
    deps = { api: fake.api, store, apiSendsEmail: true, log: silent };
  });

  it('places the order with the Stripe session id as Idempotency-Key and stores the result', async () => {
    const rec = await fulfilSession(session, deps);
    expect(fake.createOrder).toHaveBeenCalledOnce();
    const [input, key] = fake.createOrder.mock.calls[0]!;
    expect(key).toBe(session.sessionId);
    expect(input).toEqual({
      items: [{ sku: session.sku, quantity: 1 }],
      externalRef: session.sessionId,
      customerEmail: session.email,
      sendEmail: true,
    });
    expect(rec.state).toBe('completed');
    expect(rec.orderNumber).toBe('100234');
    expect(rec.esims?.[0]?.lpa).toBe('LPA:1$rsp.example.com$ABCD-1234');
    expect(await store.byOrderId('100234')).toMatchObject({ sessionId: session.sessionId });
    expect(await store.byOrderNumber('100234')).toMatchObject({ sessionId: session.sessionId });
  });

  it('is idempotent: a second webhook delivery does not order again', async () => {
    const a = await fulfilSession(session, deps);
    const b = await fulfilSession(session, deps);
    expect(fake.createOrder).toHaveBeenCalledOnce();
    expect(b.orderId).toBe(a.orderId);
  });

  it('concurrent deliveries reuse the same Idempotency-Key, so only one order exists', async () => {
    const results = await Promise.all([fulfilSession(session, deps), fulfilSession(session, deps), fulfilSession(session, deps)]);
    const keys = new Set(fake.createOrder.mock.calls.map((c) => c[1]));
    expect(keys).toEqual(new Set([session.sessionId]));
    expect(fake.byKey.size).toBe(1);
    expect(new Set(results.map((r) => r.orderId))).toEqual(new Set(['100234']));
  });

  it('on 402 insufficient balance stores a failed state, logs loudly, and retries later with a fresh key', async () => {
    fake.behaviour.next = () => {
      throw new ApiError(402, 'insufficient_balance', 'Balance 1.00 USD is below the order total 3.15 USD.');
    };
    const failed = await fulfilSession(session, deps);
    expect(failed.state).toBe('failed');
    expect(failed.failureCode).toBe('insufficient_balance');
    expect(silent.error).toHaveBeenCalledWith(expect.stringMatching(/ACTION REQUIRED/));
    expect(await store.failedSessionIds()).toEqual([session.sessionId]);
    // The rejected attempt created nothing upstream, so the next attempt may use a new key.
    expect(failed.idempotencyKey).toBe(`${session.sessionId}:r1`);

    // Reseller tops up → retry succeeds.
    fake.behaviour.next = null;
    const ok = await fulfilSession(session, deps);
    expect(ok.state).toBe('completed');
    expect(fake.createOrder.mock.calls.map((c) => c[1])).toEqual([session.sessionId, `${session.sessionId}:r1`]);
    expect(await store.failedSessionIds()).toEqual([]);
    expect(ok.attempts).toBe(2);
  });

  it('keeps the same key after an ambiguous failure (5xx / network) so a retry can never double-order', async () => {
    fake.createOrder.mockImplementationOnce(async () => {
      throw new ApiError(502, 'supplier_error', 'Upstream timeout');
    });
    const failed = await fulfilSession(session, deps);
    expect(failed.state).toBe('failed');
    expect(failed.idempotencyKey).toBe(session.sessionId);

    fake.createOrder.mockImplementationOnce(async () => {
      throw new TypeError('fetch failed');
    });
    const failed2 = await fulfilSession(session, deps);
    expect(failed2.failureCode).toBe('network_error');
    expect(failed2.idempotencyKey).toBe(session.sessionId);

    await fulfilSession(session, deps);
    expect(fake.createOrder.mock.calls.every((c) => c[1] === session.sessionId)).toBe(true);
  });

  it('records a processing order and completes it on refresh', async () => {
    fake.behaviour.next = () => order({ status: 'processing', esims: [] });
    const rec = await fulfilSession(session, deps);
    expect(rec.state).toBe('processing');
    // A second call must not re-order a processing order.
    await fulfilSession(session, deps);
    expect(fake.createOrder).toHaveBeenCalledOnce();

    const done = await refreshProcessing(rec, deps);
    expect(done.state).toBe('completed');
    expect(done.esims).toHaveLength(1);
  });

  it('applies an eSimDistributor order.completed webhook to the stored record', async () => {
    fake.behaviour.next = () => order({ status: 'processing', esims: [] });
    await fulfilSession(session, deps);
    const rec = await applyWebhookOrder(order(), deps);
    expect(rec?.state).toBe('completed');
    expect((await store.get(session.sessionId))?.state).toBe('completed');
    expect(await applyWebhookOrder(order({ id: 'unknown' }), deps)).toBeNull();
  });

  it('calls onCompleted exactly once, even across repeated deliveries', async () => {
    const onCompleted = vi.fn(async () => ({ linkEmailedAt: '2026-10-30T10:00:00Z' }));
    deps = { ...deps, apiSendsEmail: false, onCompleted };
    const rec = await fulfilSession(session, deps);
    await fulfilSession(session, deps);
    expect(onCompleted).toHaveBeenCalledOnce();
    expect(rec.linkEmailedAt).toBe('2026-10-30T10:00:00Z');
    expect(fake.createOrder.mock.calls[0]![0].sendEmail).toBe(false);
  });
});

describe('retryDue', () => {
  it('backs off exponentially after failures', () => {
    const base = { state: 'failed' as const, updatedAt: new Date(0).toISOString() };
    expect(retryDue({ ...base, attempts: 1 } as never, 29_000)).toBe(false);
    expect(retryDue({ ...base, attempts: 1 } as never, 30_000)).toBe(true);
    expect(retryDue({ ...base, attempts: 3 } as never, 119_000)).toBe(false);
    expect(retryDue({ ...base, attempts: 3 } as never, 120_000)).toBe(true);
    expect(retryDue({ ...base, attempts: 20 } as never, 30 * 60_000)).toBe(true);
    expect(retryDue({ ...base, state: 'completed', attempts: 1 } as never, 1e12)).toBe(false);
  });
});

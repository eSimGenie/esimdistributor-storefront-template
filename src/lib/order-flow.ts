import { fulfilSession, refreshProcessing, retryDue, type PaidSession } from './fulfil';
import type { Services } from './services';
import { isSessionPaid, retrieveCheckoutSession, sessionEmail, type CheckoutSession } from './stripe';
import type { OrderRecord } from './store';

/** Builds the fulfilment input from a Stripe session. Only server-set metadata is trusted. */
export function paidSessionFromStripe(s: CheckoutSession): PaidSession | null {
  const sku = s.metadata?.sku;
  const email = sessionEmail(s);
  if (!sku || !email) return null;
  return {
    sessionId: s.id,
    sku,
    planName: s.metadata.plan_name || sku,
    email,
    amountCents: s.amount_total ?? Number(s.metadata.unit_amount ?? 0),
  };
}

export function paidSessionFromRecord(r: OrderRecord): PaidSession {
  return { sessionId: r.sessionId, sku: r.sku, planName: r.planName, email: r.email, amountCents: r.amountCents };
}

export type PublicStatus =
  | { state: 'awaiting_payment' }
  | { state: 'pending' }
  | { state: 'processing' }
  | { state: 'delayed' }
  | { state: 'ready'; orderUrl: string }
  | { state: 'not_found' };

/**
 * Status for /order/pending. Also self-heals: if the Stripe webhook has not arrived (or was
 * misconfigured) the paid session is fulfilled here, failed orders are retried with back-off,
 * and `processing` orders are refreshed from the API.
 */
export async function checkoutStatus(services: Services, sessionId: string): Promise<PublicStatus> {
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(sessionId)) return { state: 'not_found' };
  const deps = services.fulfilDeps();
  let rec = await services.store.get(sessionId);

  if (!rec) {
    // Without Stripe (mock mode) every checkout writes its record before redirecting here.
    if (!services.env.STRIPE_SECRET_KEY) return { state: 'not_found' };
    let session: CheckoutSession;
    try {
      session = await retrieveCheckoutSession(services.env.STRIPE_SECRET_KEY, sessionId);
    } catch {
      return { state: 'not_found' };
    }
    if (!isSessionPaid(session)) return { state: 'awaiting_payment' };
    const paid = paidSessionFromStripe(session);
    if (!paid) return { state: 'pending' };
    rec = await fulfilSession(paid, deps);
  } else if (rec.state === 'failed' && retryDue(rec)) {
    rec = await fulfilSession(paidSessionFromRecord(rec), deps);
  } else if (rec.state === 'processing') {
    rec = await refreshProcessing(rec, deps).catch(() => rec!);
  }

  switch (rec.state) {
    case 'completed':
      return { state: 'ready', orderUrl: `/order/${encodeURIComponent(rec.orderId!)}?t=${await services.orderToken(rec.orderId!)}` };
    case 'processing':
      return { state: 'processing' };
    case 'failed':
      return { state: 'delayed' };
    default:
      return { state: 'pending' };
  }
}

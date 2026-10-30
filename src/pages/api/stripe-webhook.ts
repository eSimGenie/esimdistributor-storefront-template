import type { APIRoute } from 'astro';
import { getServices } from '../../lib/runtime';
import { verifyStripeSignature, isSessionPaid, type CheckoutSession, type StripeEvent } from '../../lib/stripe';
import { fulfilSession } from '../../lib/fulfil';
import { paidSessionFromStripe } from '../../lib/order-flow';
import { json } from '../../lib/http';

/**
 * Stripe webhook. Subscribe the endpoint to:
 *   checkout.session.completed, checkout.session.async_payment_succeeded
 * On a paid session the wholesale order is placed with Idempotency-Key = session id.
 * Always answers 200 once the signature is valid — failures are stored and retried
 * from our side (see README "Insufficient balance"), not by Stripe re-sending.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const services = getServices(locals);
  const raw = await request.text();
  const check = await verifyStripeSignature(raw, request.headers.get('Stripe-Signature'), services.env.STRIPE_WEBHOOK_SECRET ?? '');
  if (!check.ok) {
    console.warn('[stripe-webhook] rejected:', check.reason);
    return json({ error: check.reason }, { status: 400 });
  }

  const event = JSON.parse(raw) as StripeEvent;
  if (event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.async_payment_succeeded') {
    return json({ received: true, ignored: event.type });
  }

  const session = event.data.object as CheckoutSession;
  if (!isSessionPaid(session)) {
    // Delayed payment methods: wait for checkout.session.async_payment_succeeded.
    return json({ received: true, awaiting: 'payment' });
  }
  const paid = paidSessionFromStripe(session);
  if (!paid) {
    console.error(`[stripe-webhook] session ${session.id} has no sku metadata or email — not created by this storefront?`);
    return json({ received: true, ignored: 'not a storefront session' });
  }

  const rec = await fulfilSession(paid, services.fulfilDeps());
  return json({ received: true, state: rec.state });
};

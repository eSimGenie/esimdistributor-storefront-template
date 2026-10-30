import type { APIRoute } from 'astro';
import { getServices } from '../../lib/runtime';
import { getPlanFresh } from '../../lib/catalog';
import { createCheckoutSession } from '../../lib/stripe';
import { fulfilSession } from '../../lib/fulfil';
import { dataLabel, daysLabel } from '../../lib/format';
import { EMAIL_RE } from '../../lib/http';

/**
 * POST /api/checkout (form: sku, email?) → 303 to Stripe Checkout.
 * The price is recomputed here from the current wholesale price; nothing from the
 * browser except the SKU (and optional email) is used.
 */
export const POST: APIRoute = async ({ request, locals, url, redirect }) => {
  const services = getServices(locals);
  const form = await request.formData().catch(() => null);
  const sku = String(form?.get('sku') ?? '');
  const emailRaw = String(form?.get('email') ?? '').trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(sku)) return new Response('Invalid plan', { status: 400 });
  const email = emailRaw && EMAIL_RE.test(emailRaw) && emailRaw.length <= 254 ? emailRaw : undefined;

  const planUrl = `/plan/${encodeURIComponent(sku)}`;
  let plan;
  try {
    plan = await getPlanFresh(services.catalog, sku);
  } catch (e) {
    console.error('[checkout] catalog lookup failed', e);
    return redirect(`${planUrl}?error=checkout`, 303);
  }
  if (!plan) return redirect(`${planUrl}?error=unavailable`, 303);

  // Mock mode without Stripe: skip payment entirely so the full flow can be tried locally.
  if (!services.stripeConfigured) {
    if (!services.mock) {
      console.error('[checkout] STRIPE_SECRET_KEY is not set');
      return redirect(`${planUrl}?error=checkout`, 303);
    }
    const sessionId = `cs_mock_${crypto.randomUUID().replace(/-/g, '')}`;
    await fulfilSession(
      { sessionId, sku: plan.sku, planName: plan.name, email: email ?? 'traveller@example.com', amountCents: plan.priceCents },
      services.fulfilDeps(),
    );
    return redirect(`/order/pending?session=${sessionId}`, 303);
  }

  try {
    const session = await createCheckoutSession(services.env.STRIPE_SECRET_KEY!, {
      sku: plan.sku,
      productName: plan.name,
      description: `${dataLabel(plan)} · ${daysLabel(plan.durationDays)} · eSIM delivered instantly by email`,
      unitAmountCents: plan.priceCents,
      successUrl: `${url.origin}/order/pending?session={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${url.origin}${planUrl}`,
      customerEmail: email,
      imageUrl: plan.imageUrl,
    });
    if (!session.url) throw new Error('Stripe returned no checkout URL');
    return redirect(session.url, 303);
  } catch (e) {
    console.error('[checkout] Stripe session failed', e);
    return redirect(`${planUrl}?error=checkout`, 303);
  }
};

import { verifyTimestampedSignature, type SignatureResult } from './crypto';

/**
 * Minimal Stripe client using `fetch` against the REST API — no SDK, so nothing
 * Node-only ends up in the Worker bundle. We only need three calls.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export interface CheckoutSession {
  id: string;
  object: 'checkout.session';
  url: string | null;
  status: 'open' | 'complete' | 'expired' | null;
  payment_status: 'paid' | 'unpaid' | 'no_payment_required';
  amount_total: number | null;
  currency: string | null;
  customer_email: string | null;
  customer_details: { email: string | null; name?: string | null } | null;
  metadata: Record<string, string>;
  livemode: boolean;
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
  livemode: boolean;
}

export class StripeError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) {
    super(message);
    this.name = 'StripeError';
  }
}

type FormValue = string | number | boolean | null | undefined | FormObject | FormValue[];
interface FormObject {
  [key: string]: FormValue;
}

/** Stripe's bracket notation: `line_items[0][price_data][currency]=usd`. */
export function encodeForm(obj: FormObject, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}[${k}]` : k;
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) encodeForm(item, `${key}[${i}]`, out);
        else if (item !== undefined && item !== null) out.append(`${key}[${i}]`, String(item));
      });
    } else if (typeof v === 'object') {
      encodeForm(v, key, out);
    } else {
      out.append(key, String(v));
    }
  }
  return out;
}

async function stripeRequest<T>(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  body?: FormObject,
  fetchImpl: typeof fetch = fetch,
): Promise<T> {
  const res = await fetchImpl(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Stripe-Version': '2024-06-20',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body ? encodeForm(body).toString() : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: string } } & T;
  if (!res.ok) {
    throw new StripeError(json.error?.message ?? `Stripe HTTP ${res.status}`, res.status, json.error?.code);
  }
  return json;
}

export interface CreateSessionInput {
  sku: string;
  productName: string;
  description: string;
  unitAmountCents: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
  imageUrl?: string | null;
}

export function createCheckoutSession(
  secretKey: string,
  input: CreateSessionInput,
  fetchImpl?: typeof fetch,
): Promise<CheckoutSession> {
  return stripeRequest<CheckoutSession>(
    secretKey,
    'POST',
    '/checkout/sessions',
    {
      mode: 'payment',
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      customer_email: input.customerEmail,
      billing_address_collection: 'auto',
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'usd',
            unit_amount: input.unitAmountCents,
            product_data: {
              name: input.productName,
              description: input.description,
              images: input.imageUrl ? [input.imageUrl] : undefined,
            },
          },
        },
      ],
      // The sku and the price we charged travel with the payment so the webhook
      // never has to trust anything the browser sent.
      metadata: { sku: input.sku, plan_name: input.productName.slice(0, 450), unit_amount: input.unitAmountCents },
      payment_intent_data: { metadata: { sku: input.sku } },
    },
    fetchImpl,
  );
}

export function retrieveCheckoutSession(secretKey: string, id: string, fetchImpl?: typeof fetch): Promise<CheckoutSession> {
  if (!/^cs_[A-Za-z0-9_]+$/.test(id)) throw new StripeError('Invalid session id', 400);
  return stripeRequest<CheckoutSession>(secretKey, 'GET', `/checkout/sessions/${encodeURIComponent(id)}`, undefined, fetchImpl);
}

/** Verifies the `Stripe-Signature` header (scheme v1, 5 minute tolerance). */
export function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  webhookSecret: string,
  opts?: { toleranceSec?: number; nowSec?: number },
): Promise<SignatureResult> {
  return verifyTimestampedSignature(rawBody, header, webhookSecret, opts);
}

export function isSessionPaid(s: Pick<CheckoutSession, 'payment_status'>): boolean {
  return s.payment_status === 'paid' || s.payment_status === 'no_payment_required';
}

export function sessionEmail(s: CheckoutSession): string | null {
  return s.customer_details?.email ?? s.customer_email ?? null;
}

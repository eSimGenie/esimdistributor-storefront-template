import type { APIRoute } from 'astro';
import { getServices } from '../../lib/runtime';
import { verifyEsdSignature } from '../../lib/esd-signature';
import { applyWebhookOrder } from '../../lib/fulfil';
import type { Order } from '../../lib/api';
import { json } from '../../lib/http';

/**
 * Optional eSimDistributor webhook (console → Developer → Webhooks → URL /api/esd-webhook,
 * events order.completed + order.failed). Lets `processing` orders complete without polling.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const services = getServices(locals);
  const secret = services.env.ESD_WEBHOOK_SECRET;
  if (!secret) return json({ error: 'ESD_WEBHOOK_SECRET is not configured' }, { status: 501 });

  const raw = await request.text();
  const check = await verifyEsdSignature(raw, request.headers.get('X-ESD-Signature'), secret);
  if (!check.ok) {
    console.warn('[esd-webhook] rejected:', check.reason);
    return json({ error: check.reason }, { status: 401 });
  }

  const event = JSON.parse(raw) as { id: string; type: string; data?: { order?: Order } };
  if ((event.type === 'order.completed' || event.type === 'order.failed') && event.data?.order) {
    const rec = await applyWebhookOrder(event.data.order, services.fulfilDeps());
    return json({ received: true, matched: !!rec });
  }
  return json({ received: true });
};

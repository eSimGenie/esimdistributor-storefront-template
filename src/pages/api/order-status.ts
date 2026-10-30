import type { APIRoute } from 'astro';
import { getServices } from '../../lib/runtime';
import { checkoutStatus } from '../../lib/order-flow';
import { json } from '../../lib/http';

/** GET /api/order-status?session=cs_... — polled by /order/pending. */
export const GET: APIRoute = async ({ url, locals }) => {
  const services = getServices(locals);
  const status = await checkoutStatus(services, url.searchParams.get('session') ?? '');
  return json(status, { status: status.state === 'not_found' ? 404 : 200 });
};

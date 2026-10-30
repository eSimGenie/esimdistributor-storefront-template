import type { APIRoute } from 'astro';
import { getServices } from '../../../lib/runtime';
import { retryFailedOrders } from '../../../lib/retry';
import { timingSafeEqual } from '../../../lib/crypto';
import { json } from '../../../lib/http';

/**
 * POST /api/admin/retry  (Authorization: Bearer <ADMIN_TOKEN>)
 * Immediately retries every paid order that could not be fulfilled (e.g. right after topping up).
 *   curl -X POST https://shop.example.com/api/admin/retry -H "Authorization: Bearer $ADMIN_TOKEN"
 * The cron trigger does the same every 10 minutes with back-off. Disabled unless ADMIN_TOKEN is set.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const services = getServices(locals);
  const adminToken = services.env.ADMIN_TOKEN;
  if (!adminToken || adminToken.length < 16) return json({ error: 'ADMIN_TOKEN is not configured (16+ characters)' }, { status: 404 });
  const given = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(given, adminToken)) return json({ error: 'unauthorized' }, { status: 401 });

  const results = await retryFailedOrders(services, { onlyDue: false });
  return json({ retried: results.length, results });
};

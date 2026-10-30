import type { APIRoute } from 'astro';
import { getServices } from '../../../lib/runtime';

/**
 * GET /api/qr/<iccid>?o=<orderId>&t=<token>
 * Proxies the eSIM QR image from the API so the API key never reaches the browser.
 * Access needs the same signed token as the order page, and the eSIM must belong to that order.
 */
export const GET: APIRoute = async ({ params, url, locals }) => {
  const services = getServices(locals);
  const iccid = params.iccid ?? '';
  const orderId = url.searchParams.get('o') ?? '';
  if (!/^[0-9A-Fa-f]{10,22}$/.test(iccid) || !/^[A-Za-z0-9_-]{1,64}$/.test(orderId)) return new Response('Not found', { status: 404 });

  if (!(await services.verifyOrderToken(orderId, url.searchParams.get('t')))) return new Response('Forbidden', { status: 403 });

  const rec = await services.store.byOrderId(orderId);
  if (!rec?.esims?.some((e) => e.iccid === iccid)) return new Response('Not found', { status: 404 });

  const upstream = await services.api.qrPng(iccid).catch((e) => {
    console.error('[qr] upstream failed', e);
    return null;
  });
  if (!upstream) return new Response('QR temporarily unavailable', { status: 502 });
  return new Response(upstream.body, {
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') ?? 'image/png',
      'Cache-Control': 'private, max-age=3600',
      'Content-Disposition': `inline; filename="esim-${iccid}.png"`,
    },
  });
};

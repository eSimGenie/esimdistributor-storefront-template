import type { APIRoute } from 'astro';
import { getServices } from '../lib/runtime';
import { getDestinations } from '../lib/catalog';
import { destinationPath } from '../lib/format';

const STATIC = ['/', '/destinations', '/compatibility', '/install', '/contact', '/lookup', '/legal/terms', '/legal/privacy'];

export const GET: APIRoute = async ({ locals }) => {
  const services = getServices(locals);
  const base = services.config.websiteUrl;
  let paths = [...STATIC];
  try {
    const dests = await getDestinations(services.catalog);
    paths = paths.concat(dests.map((d) => destinationPath(d.code)));
  } catch (e) {
    console.error('[sitemap] catalog unavailable', e);
  }
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    paths.map((p) => `  <url><loc>${base}${p === '/' ? '/' : p}</loc></url>`).join('\n') +
    '\n</urlset>\n';
  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
  });
};

import type { APIRoute } from 'astro';
import { site } from '../lib/site';

export const GET: APIRoute = () =>
  new Response(
    ['User-agent: *', 'Disallow: /api/', 'Disallow: /order/', 'Disallow: /lookup', 'Allow: /', '', `Sitemap: ${site.websiteUrl}/sitemap.xml`, ''].join('\n'),
    { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } },
  );

import { defineMiddleware } from 'astro:middleware';

/**
 * 1. Edge HTML cache: public GET pages that set `Cache-Control: ... s-maxage=N` are stored in
 *    the Workers Cache API and served from there until they expire. The build id is part of
 *    the cache key, so every deploy starts with a fresh cache.
 *    (The Cache API is a no-op on *.workers.dev — use a custom domain in production.)
 * 2. Security headers on every response.
 */

declare const __BUILD_ID__: string;

const PRIVATE_PREFIXES = ['/api/', '/order/', '/lookup'];

function edgeCache(): Cache | null {
  return (globalThis as { caches?: { default?: Cache } }).caches?.default ?? null;
}

export const onRequest = defineMiddleware(async (context, next) => {
  const url = context.url;
  const isPrivate = PRIVATE_PREFIXES.some((p) => url.pathname.startsWith(p));
  const cache = context.request.method === 'GET' && !isPrivate && !import.meta.env.DEV ? edgeCache() : null;
  const cacheKey = cache ? new Request(`${url.origin}${url.pathname}${url.search}${url.search ? '&' : '?'}__b=${__BUILD_ID__}`) : null;

  if (cache && cacheKey) {
    const hit = await cache.match(cacheKey);
    if (hit) {
      const res = new Response(hit.body, hit);
      res.headers.set('X-Edge-Cache', 'HIT');
      return res;
    }
  }

  const rendered = await next();
  // Copy so headers are mutable even for Response.redirect() / proxied responses.
  const response = new Response(rendered.body, rendered);
  const headers = response.headers;
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('Referrer-Policy', isPrivate ? 'no-referrer' : 'strict-origin-when-cross-origin');
  if (url.protocol === 'https:') headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (isPrivate && !headers.has('Cache-Control')) headers.set('Cache-Control', 'private, no-store');

  if (cache && cacheKey && response.status === 200 && /s-maxage=\d+/.test(headers.get('Cache-Control') ?? '')) {
    const put = cache.put(cacheKey, response.clone()).catch((e) => console.warn('[edge-cache] put failed', e));
    const ctx = context.locals.runtime?.ctx;
    if (ctx) ctx.waitUntil(put);
    else await put;
    headers.set('X-Edge-Cache', 'MISS');
  }
  return response;
});

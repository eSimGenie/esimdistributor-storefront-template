/**
 * Stale-while-revalidate JSON cache on top of the Workers Cache API.
 * Falls back to an in-memory map where `caches.default` does not exist (Node, tests, `astro dev`).
 *
 * Cached values live only in the data centre's cache — they are never sent to browsers —
 * so it is fine for them to contain wholesale prices.
 */

export interface WaitUntil {
  waitUntil(promise: Promise<unknown>): void;
}

interface Entry {
  value: unknown;
  storedAt: number;
}

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

function edgeCache(): Cache | null {
  const c = (globalThis as { caches?: CacheStorage & { default?: Cache } }).caches;
  return c?.default ?? null;
}

const CACHE_ORIGIN = 'https://storefront-cache.internal';

async function readEntry(key: string): Promise<Entry | null> {
  const cache = edgeCache();
  if (!cache) return memory.get(key) ?? null;
  const res = await cache.match(`${CACHE_ORIGIN}/${encodeURIComponent(key)}`);
  if (!res) return null;
  const storedAt = Number(res.headers.get('x-stored-at') ?? 0);
  return { value: await res.json(), storedAt };
}

async function writeEntry(key: string, value: unknown, keepSec: number): Promise<void> {
  const storedAt = Date.now();
  const cache = edgeCache();
  if (!cache) {
    memory.set(key, { value, storedAt });
    return;
  }
  await cache.put(
    `${CACHE_ORIGIN}/${encodeURIComponent(key)}`,
    new Response(JSON.stringify(value), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': `public, max-age=${keepSec}`,
        'x-stored-at': String(storedAt),
      },
    }),
  );
}

export interface SwrOptions {
  /** Fresh for this many seconds. */
  ttlSec: number;
  /** After that, serve stale for up to this many more seconds while refreshing in the background. */
  staleSec: number;
  ctx?: WaitUntil;
}

export async function swrJson<T>(key: string, load: () => Promise<T>, opts: SwrOptions): Promise<T> {
  const keepSec = opts.ttlSec + opts.staleSec;
  const refresh = (): Promise<T> => {
    const existing = inflight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = load()
      .then(async (value) => {
        await writeEntry(key, value, keepSec).catch((e) => console.warn('[cache] write failed', key, e));
        return value;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  };

  let entry: Entry | null = null;
  try {
    entry = await readEntry(key);
  } catch (e) {
    console.warn('[cache] read failed', key, e);
  }
  if (entry) {
    const ageSec = (Date.now() - entry.storedAt) / 1000;
    if (ageSec < opts.ttlSec) return entry.value as T;
    if (ageSec < keepSec) {
      const bg = refresh().catch((e) => console.warn('[cache] background refresh failed', key, e));
      if (opts.ctx) opts.ctx.waitUntil(bg);
      return entry.value as T;
    }
  }
  return refresh();
}

/** Test helper. */
export function clearMemoryCache(): void {
  memory.clear();
  inflight.clear();
}

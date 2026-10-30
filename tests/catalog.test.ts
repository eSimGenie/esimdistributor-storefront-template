import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearMemoryCache, swrJson } from '../src/lib/cache';
import { getDestinations, getPlan, getPlansForDestination, toPublicPlan } from '../src/lib/catalog';
import { parseSiteConfig } from '../src/lib/config-schema';
import { MockResellerApi } from '../src/lib/mock-api';

const config = parseSiteConfig({
  brandName: 'Acme',
  supportEmail: 'help@acme.test',
  websiteUrl: 'https://shop.acme.test',
  legal: { companyName: 'Acme Ltd', address: 'Cork' },
  hiddenSkus: ['MOCK-FR-1GB-7D'],
  pricing: { overrides: { 'MOCK-FR-3GB-15D': 0.5 } },
});

describe('catalog', () => {
  beforeEach(() => {
    clearMemoryCache();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('never exposes wholesale prices', async () => {
    const api = new MockResellerApi();
    const plans = await getPlansForDestination({ api, config }, { type: 'country', code: 'FR' });
    expect(plans.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(plans);
    expect(serialized).not.toMatch(/wholesale/i);
    expect(serialized).not.toMatch(/suggestedRetail/i);
    const plan = await getPlan({ api, config }, 'MOCK-FR-5GB-30D');
    expect(plan).not.toHaveProperty('wholesalePrice');
  });

  it('hides hidden SKUs everywhere', async () => {
    const api = new MockResellerApi();
    const plans = await getPlansForDestination({ api, config }, { type: 'country', code: 'FR' });
    expect(plans.find((p) => p.sku === 'MOCK-FR-1GB-7D')).toBeUndefined();
    expect(await getPlan({ api, config }, 'MOCK-FR-1GB-7D')).toBeNull();
  });

  it('clamps an override below wholesale', async () => {
    const api = new MockResellerApi();
    const raw = (await api.plan('MOCK-FR-3GB-15D'))!;
    const pub = toPublicPlan(raw, config);
    expect(pub.priceCents).toBe(Math.round(raw.wholesalePrice * 100));
  });

  it('prices destinations and sorts them by name', async () => {
    const dests = await getDestinations({ api: new MockResellerApi(), config });
    expect(dests.map((d) => d.name)).toEqual([...dests.map((d) => d.name)].sort((a, b) => a.localeCompare(b)));
    for (const d of dests) expect(d.fromCents % 100).toBe(99);
  });

  it('caches catalog calls (stale-while-revalidate)', async () => {
    const load = vi.fn(async () => ({ n: load.mock.calls.length }));
    expect(await swrJson('k', load, { ttlSec: 3600, staleSec: 3600 })).toEqual({ n: 1 });
    expect(await swrJson('k', load, { ttlSec: 3600, staleSec: 3600 })).toEqual({ n: 1 });
    expect(load).toHaveBeenCalledOnce();

    // Expired but within the stale window: the old value is served while refreshing in the background.
    vi.useFakeTimers({ now: Date.now() + 3601_000 });
    const waits: Promise<unknown>[] = [];
    expect(await swrJson('k', load, { ttlSec: 3600, staleSec: 3600, ctx: { waitUntil: (p) => waits.push(p) } })).toEqual({ n: 1 });
    await Promise.all(waits);
    expect(load).toHaveBeenCalledTimes(2);
    expect(await swrJson('k', load, { ttlSec: 3600, staleSec: 3600 })).toEqual({ n: 2 });
    vi.useRealTimers();
  });
});

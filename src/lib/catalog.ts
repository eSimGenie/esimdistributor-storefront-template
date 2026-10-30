import type { CatalogItem, CoverageType, Destination, ResellerApi } from './api';
import { swrJson, type WaitUntil } from './cache';
import type { SiteConfig } from './config-schema';
import { computeSellingPrice } from './pricing';

/**
 * The browser-safe view of the catalog. Wholesale prices are dropped here and never
 * leave this module — pages only ever see `priceCents` (the selling price).
 */
export interface PublicPlan {
  sku: string;
  name: string;
  slug: string;
  coverage: { type: CoverageType; code: string; name: string; countries: string[] };
  dataType: 'fixed' | 'daily';
  dataGb: number | null;
  dailyDataGb: number | null;
  durationDays: number;
  speed: string | null;
  topUpSupported: boolean;
  priceCents: number;
  imageUrl: string | null;
  networks?: { country: string; operators: string[] }[];
}

export interface PublicDestination {
  type: CoverageType;
  code: string;
  name: string;
  planCount: number;
  /** Approximate "from" price (multiplier/rounding applied to the cheapest wholesale price). */
  fromCents: number;
}

const HOUR = 3600;
const CATALOG_CACHE = { ttlSec: HOUR, staleSec: 6 * HOUR };

export interface CatalogDeps {
  api: ResellerApi;
  config: SiteConfig;
  ctx?: WaitUntil;
}

export function toPublicPlan(item: CatalogItem, config: SiteConfig): PublicPlan {
  const { cents } = computeSellingPrice(item.sku, item.wholesalePrice, config.pricing);
  return {
    sku: item.sku,
    name: item.name,
    slug: item.slug,
    coverage: {
      type: item.coverage.type,
      code: item.coverage.code,
      name: item.coverage.name,
      countries: [...item.coverage.countries],
    },
    dataType: item.dataType,
    dataGb: item.dataGb,
    dailyDataGb: item.dailyDataGb,
    durationDays: item.durationDays,
    speed: item.speed,
    topUpSupported: item.topUpSupported,
    priceCents: cents,
    imageUrl: item.imageUrl,
    networks: item.networks?.map((n) => ({ country: n.country, operators: [...n.operators] })),
  };
}

const cacheKey = (config: SiteConfig, ...parts: string[]) => `${config.apiBaseUrl}|${config.pricing.mode}|${parts.join('|')}`;

export async function getDestinations({ api, config, ctx }: CatalogDeps): Promise<PublicDestination[]> {
  const raw = await swrJson<Destination[]>(cacheKey(config, 'destinations', String(api.mock)), () => api.destinations(), {
    ...CATALOG_CACHE,
    ctx,
  });
  return raw
    .filter((d) => d.planCount > 0)
    .map((d) => ({
      type: d.type,
      code: d.code,
      name: d.name,
      planCount: d.planCount,
      // No SKU here, so overrides cannot apply; the destination page shows exact prices.
      fromCents: computeSellingPrice('(from-price)', d.fromPrice, config.pricing, () => {}).cents,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findDestination(deps: CatalogDeps, code: string): Promise<PublicDestination | null> {
  const all = await getDestinations(deps);
  return all.find((d) => d.code.toLowerCase() === code.toLowerCase()) ?? null;
}

async function fetchAllPlans(api: ResellerApi, dest: Pick<Destination, 'type' | 'code'>): Promise<CatalogItem[]> {
  const items: CatalogItem[] = [];
  const filter = dest.type === 'country' ? { country: dest.code } : { region: dest.code };
  for (let page = 1; page <= 10; page++) {
    const res = await api.catalog({ ...filter, page, pageSize: 100, sort: 'price' });
    items.push(...res.items);
    if (items.length >= res.total || res.items.length === 0) break;
  }
  return items;
}

export async function getPlansForDestination(
  deps: CatalogDeps,
  dest: Pick<Destination, 'type' | 'code'>,
): Promise<PublicPlan[]> {
  const { api, config, ctx } = deps;
  const raw = await swrJson(cacheKey(config, 'plans', dest.type, dest.code, String(api.mock)), () => fetchAllPlans(api, dest), {
    ...CATALOG_CACHE,
    ctx,
  });
  const hidden = new Set(config.hiddenSkus);
  return raw
    .filter((i) => !hidden.has(i.sku))
    .map((i) => toPublicPlan(i, config))
    .sort((a, b) => (a.dataType === b.dataType ? a.priceCents - b.priceCents : a.dataType === 'fixed' ? -1 : 1));
}

/** Cached plan lookup for display. Checkout uses `getPlanFresh` instead. */
export async function getPlan(deps: CatalogDeps, sku: string): Promise<PublicPlan | null> {
  if (deps.config.hiddenSkus.includes(sku)) return null;
  const raw = await swrJson(cacheKey(deps.config, 'plan', sku, String(deps.api.mock)), () => deps.api.plan(sku), {
    ...CATALOG_CACHE,
    ctx: deps.ctx,
  });
  return raw ? toPublicPlan(raw, deps.config) : null;
}

/** Uncached — the price charged must be based on the current wholesale price. */
export async function getPlanFresh(deps: CatalogDeps, sku: string): Promise<PublicPlan | null> {
  if (deps.config.hiddenSkus.includes(sku)) return null;
  const raw = await deps.api.plan(sku);
  return raw ? toPublicPlan(raw, deps.config) : null;
}

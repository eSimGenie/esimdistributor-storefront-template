import {
  ApiError,
  type CatalogItem,
  type CatalogQuery,
  type CreateOrderInput,
  type Destination,
  type ESim,
  type Order,
  type Paged,
  type ResellerApi,
} from './api';

/**
 * In-memory stand-in for the Reseller API, used when MOCK_API=1 (or in `astro dev`
 * when no RESELLER_API_KEY is set). Lets the whole site — including checkout and the
 * order page — run without any keys.
 *
 * Test hooks in the customer email:
 *   `+nobalance` → the order fails with 402 insufficient_balance
 *   `+slow`      → the order stays `processing` for ~15 seconds
 */

interface MockDest {
  type: Destination['type'];
  code: string;
  name: string;
  countries: string[];
  /** Wholesale price per GB, roughly. */
  perGb: number;
}

const DESTS: MockDest[] = [
  { type: 'country', code: 'FR', name: 'France', countries: ['FR'], perGb: 0.9 },
  { type: 'country', code: 'ES', name: 'Spain', countries: ['ES'], perGb: 0.9 },
  { type: 'country', code: 'IT', name: 'Italy', countries: ['IT'], perGb: 0.95 },
  { type: 'country', code: 'GB', name: 'United Kingdom', countries: ['GB'], perGb: 1.0 },
  { type: 'country', code: 'US', name: 'United States', countries: ['US'], perGb: 1.4 },
  { type: 'country', code: 'JP', name: 'Japan', countries: ['JP'], perGb: 1.3 },
  { type: 'country', code: 'TH', name: 'Thailand', countries: ['TH'], perGb: 0.8 },
  { type: 'country', code: 'TR', name: 'Türkiye', countries: ['TR'], perGb: 1.6 },
  { type: 'country', code: 'MX', name: 'Mexico', countries: ['MX'], perGb: 1.7 },
  { type: 'country', code: 'AU', name: 'Australia', countries: ['AU'], perGb: 1.5 },
  {
    type: 'region',
    code: 'europe',
    name: 'Europe',
    countries: ['FR', 'ES', 'IT', 'DE', 'PT', 'NL', 'BE', 'AT', 'IE', 'GR', 'PL', 'SE', 'DK', 'FI', 'CZ', 'HU'],
    perGb: 1.2,
  },
  { type: 'region', code: 'asia', name: 'Asia', countries: ['JP', 'TH', 'SG', 'MY', 'VN', 'ID', 'KR', 'HK', 'TW'], perGb: 1.8 },
  { type: 'global', code: 'global', name: 'Global', countries: ['US', 'GB', 'FR', 'JP', 'AU', 'BR', 'ZA', 'IN', 'CA'], perGb: 3.5 },
];

const FIXED: [gb: number, days: number][] = [
  [1, 7],
  [3, 15],
  [5, 30],
  [10, 30],
  [20, 30],
];
const DAILY: [gbPerDay: number, days: number][] = [
  [1, 3],
  [1, 7],
  [2, 15],
];

const round2 = (n: number) => Math.round(n * 100) / 100;

function buildCatalog(): CatalogItem[] {
  const items: CatalogItem[] = [];
  for (const d of DESTS) {
    for (const [gb, days] of FIXED) {
      const wholesale = round2(Math.max(0.6, d.perGb * gb * (gb >= 10 ? 0.8 : 1)));
      items.push({
        sku: `MOCK-${d.code.toUpperCase()}-${gb}GB-${days}D`,
        name: `${d.name} ${gb}GB ${days} Days`,
        slug: `${d.name.toLowerCase().replace(/[^a-z]+/g, '-')}-${gb}gb-${days}-days`,
        coverage: { type: d.type, code: d.code, name: d.name, countries: d.countries },
        dataType: 'fixed',
        dataGb: gb,
        dailyDataGb: null,
        durationDays: days,
        speed: gb >= 5 ? '5G' : '4G/LTE',
        topUpSupported: true,
        wholesalePrice: wholesale,
        suggestedRetailPrice: round2(wholesale * 2),
        currency: 'USD',
        imageUrl: null,
      });
    }
    for (const [gbDay, days] of DAILY) {
      const wholesale = round2(d.perGb * gbDay * days * 0.7);
      items.push({
        sku: `MOCK-${d.code.toUpperCase()}-${gbDay}GBD-${days}D`,
        name: `${d.name} ${gbDay}GB/day ${days} Days`,
        slug: `${d.name.toLowerCase().replace(/[^a-z]+/g, '-')}-${gbDay}gb-day-${days}-days`,
        coverage: { type: d.type, code: d.code, name: d.name, countries: d.countries },
        dataType: 'daily',
        dataGb: null,
        dailyDataGb: gbDay,
        durationDays: days,
        speed: '4G/LTE',
        topUpSupported: false,
        wholesalePrice: wholesale,
        suggestedRetailPrice: round2(wholesale * 2),
        currency: 'USD',
        imageUrl: null,
      });
    }
  }
  return items;
}

const CATALOG = buildCatalog();

const OPERATORS: Record<string, string[]> = {
  FR: ['Orange', 'SFR'],
  ES: ['Movistar', 'Vodafone'],
  IT: ['TIM', 'WindTre'],
  GB: ['EE', 'Three'],
  US: ['T-Mobile', 'AT&T'],
  JP: ['SoftBank', 'KDDI'],
  TH: ['AIS', 'TrueMove H'],
  TR: ['Turkcell'],
  MX: ['Telcel', 'AT&T'],
  AU: ['Optus', 'Telstra'],
};

interface StoredOrder {
  order: Order;
  readyAt: number;
}

export class MockResellerApi implements ResellerApi {
  readonly mock = true;
  private readonly orders = new Map<string, StoredOrder>();
  private readonly byKey = new Map<string, string>();
  private seq = 100000;

  async catalog(query: CatalogQuery): Promise<Paged<CatalogItem>> {
    let items = CATALOG.filter((i) => {
      if (query.country && !(i.coverage.type === 'country' && i.coverage.code.toUpperCase() === query.country.toUpperCase())) return false;
      if (query.region && !(i.coverage.type !== 'country' && i.coverage.code.toLowerCase() === query.region.toLowerCase())) return false;
      if (query.type && i.dataType !== query.type) return false;
      if (query.q && !i.name.toLowerCase().includes(query.q.toLowerCase())) return false;
      return true;
    });
    if (query.sort === 'price') items = [...items].sort((a, b) => a.wholesalePrice - b.wholesalePrice);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 25, 100);
    return { items: items.slice((page - 1) * pageSize, page * pageSize), page, pageSize, total: items.length };
  }

  async destinations(): Promise<Destination[]> {
    return DESTS.map((d) => {
      const plans = CATALOG.filter((i) => i.coverage.code === d.code);
      return {
        type: d.type,
        code: d.code,
        name: d.name,
        planCount: plans.length,
        fromPrice: Math.min(...plans.map((p) => p.wholesalePrice)),
      };
    });
  }

  async plan(sku: string): Promise<CatalogItem | null> {
    const item = CATALOG.find((i) => i.sku === sku);
    if (!item) return null;
    return {
      ...item,
      networks: item.coverage.countries.map((c) => ({ country: c, operators: OPERATORS[c] ?? ['Local LTE partner'] })),
    };
  }

  async createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<Order> {
    const existing = this.byKey.get(idempotencyKey);
    if (existing) return this.snapshot(this.orders.get(existing)!);
    if (input.customerEmail.includes('+nobalance')) {
      throw new ApiError(402, 'insufficient_balance', 'Balance 0.00 USD is below the order total (mock).');
    }
    const first = input.items[0];
    if (!first) throw new ApiError(400, 'validation_error', 'items is empty');
    const item = CATALOG.find((i) => i.sku === first.sku);
    if (!item) throw new ApiError(422, 'plan_unavailable', `Unknown sku ${first.sku}`);
    const id = String(++this.seq);
    const iccid = `8999000000${id}0000`.slice(0, 19);
    const matchingId = `MOCK-${id}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const esim: ESim = {
      iccid,
      orderId: id,
      sku: item.sku,
      planName: item.name,
      status: 'not_installed',
      lpa: `LPA:1$rsp.mock.esimdistributor.test$${matchingId}`,
      smdpAddress: 'rsp.mock.esimdistributor.test',
      matchingId,
      qrCodeUrl: null,
      dataTotalMb: item.dataGb ? item.dataGb * 1024 : null,
      dataUsedMb: 0,
      expiresAt: null,
      activatedAt: null,
      customerEmail: input.customerEmail,
    };
    const order: Order = {
      id,
      number: id,
      status: 'completed',
      total: item.wholesalePrice,
      currency: 'USD',
      createdAt: new Date().toISOString(),
      externalRef: input.externalRef ?? null,
      items: [{ sku: item.sku, name: item.name, quantity: 1, unitPrice: item.wholesalePrice }],
      esims: [esim],
    };
    const stored = { order, readyAt: input.customerEmail.includes('+slow') ? Date.now() + 15_000 : 0 };
    this.orders.set(id, stored);
    this.byKey.set(idempotencyKey, id);
    return this.snapshot(stored);
  }

  private snapshot({ order, readyAt }: StoredOrder): Order {
    if (Date.now() >= readyAt) return structuredClone(order);
    return { ...structuredClone(order), status: 'processing', esims: [] };
  }

  async order(id: string): Promise<Order | null> {
    const stored = this.orders.get(id);
    return stored ? this.snapshot(stored) : null;
  }

  async qrPng(iccid: string): Promise<Response> {
    // Not a scannable code — mock mode only. The real API returns a PNG.
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 220 220" width="220" height="220">
<rect width="220" height="220" fill="#fff"/><rect x="10" y="10" width="200" height="200" fill="none" stroke="#111" stroke-width="8" stroke-dasharray="14 8"/>
<text x="110" y="105" font-family="sans-serif" font-size="22" text-anchor="middle" fill="#111">MOCK QR</text>
<text x="110" y="135" font-family="monospace" font-size="10" text-anchor="middle" fill="#555">${iccid.replace(/[^0-9]/g, '')}</text></svg>`;
    return new Response(svg, { headers: { 'Content-Type': 'image/svg+xml' } });
  }

  async resendEsimEmail(): Promise<void> {
    console.info('[mock-api] resend-email requested (no email is sent in mock mode)');
  }
}

let shared: MockResellerApi | undefined;
/** One instance per isolate so orders survive between requests in `astro dev`. */
export function sharedMockApi(): MockResellerApi {
  return (shared ??= new MockResellerApi());
}

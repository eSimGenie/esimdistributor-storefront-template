/**
 * eSimDistributor Reseller API v1 client (server-side only — it holds the API key).
 * Contract: https://api.esimdistributor.com — see docs "Reseller API v1".
 */

export type CoverageType = 'country' | 'region' | 'global';

export interface CatalogItem {
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
  wholesalePrice: number;
  suggestedRetailPrice?: number;
  currency: 'USD';
  imageUrl: string | null;
  networks?: { country: string; operators: string[] }[];
}

export interface Destination {
  type: CoverageType;
  code: string;
  name: string;
  planCount: number;
  /** Wholesale "from" price. */
  fromPrice: number;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

export type ESimStatus = 'not_installed' | 'installed' | 'active' | 'depleted' | 'expired' | 'cancelled';

export interface ESim {
  iccid: string;
  orderId: string;
  sku: string;
  planName: string;
  status: ESimStatus;
  lpa: string | null;
  smdpAddress: string | null;
  matchingId: string | null;
  qrCodeUrl: string | null;
  dataTotalMb: number | null;
  dataUsedMb: number | null;
  expiresAt: string | null;
  activatedAt: string | null;
  customerEmail: string | null;
}

export type OrderStatus = 'processing' | 'completed' | 'failed' | 'refunded';

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  total: number;
  currency: 'USD';
  createdAt: string;
  externalRef: string | null;
  items: { sku: string; name: string; quantity: number; unitPrice: number }[];
  esims?: ESim[];
}

export interface CreateOrderInput {
  items: { sku: string; quantity: number }[];
  externalRef?: string;
  customerEmail: string;
  sendEmail: boolean;
}

export interface CatalogQuery {
  q?: string;
  country?: string;
  region?: string;
  type?: 'fixed' | 'daily';
  sort?: 'price' | 'data' | 'days';
  page?: number;
  pageSize?: number;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  /** The request definitely did not create anything — safe to retry with a new idempotency key. */
  get isDefinitiveRejection(): boolean {
    return this.status >= 400 && this.status < 500 && this.status !== 409 && this.status !== 429;
  }
}

/** The surface the storefront uses. Implemented by the real HTTP client and by the mock. */
export interface ResellerApi {
  readonly mock: boolean;
  catalog(query: CatalogQuery): Promise<Paged<CatalogItem>>;
  destinations(): Promise<Destination[]>;
  plan(sku: string): Promise<CatalogItem | null>;
  createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<Order>;
  order(id: string): Promise<Order | null>;
  qrPng(iccid: string): Promise<Response>;
  resendEsimEmail(iccid: string, email?: string): Promise<void>;
}

export class HttpResellerApi implements ResellerApi {
  readonly mock = false;
  private readonly base: string;

  constructor(
    apiBaseUrl: string,
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
  ) {
    this.base = `${apiBaseUrl.replace(/\/+$/, '')}/api/v1/reseller`;
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('X-Api-Key', this.apiKey);
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
    if (init.body) headers.set('Content-Type', 'application/json');
    const res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    if (!res.ok) {
      let code = 'server_error';
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } };
        code = body.error?.code ?? code;
        message = body.error?.message ?? message;
      } catch {
        /* non-JSON error body */
      }
      throw new ApiError(res.status, code, message);
    }
    return res;
  }

  private async json<T>(path: string, init?: RequestInit): Promise<T> {
    return (await (await this.request(path, init)).json()) as T;
  }

  catalog(query: CatalogQuery): Promise<Paged<CatalogItem>> {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') params.set(k, String(v));
    return this.json(`/catalog?${params}`);
  }

  destinations(): Promise<Destination[]> {
    return this.json('/catalog/destinations');
  }

  async plan(sku: string): Promise<CatalogItem | null> {
    try {
      return await this.json<CatalogItem>(`/catalog/${encodeURIComponent(sku)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  createOrder(input: CreateOrderInput, idempotencyKey: string): Promise<Order> {
    return this.json('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey.slice(0, 100) },
      body: JSON.stringify(input),
    });
  }

  async order(id: string): Promise<Order | null> {
    try {
      return await this.json<Order>(`/orders/${encodeURIComponent(id)}`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }
  }

  qrPng(iccid: string): Promise<Response> {
    return this.request(`/esims/${encodeURIComponent(iccid)}/qr.png`, { headers: { Accept: 'image/png' } });
  }

  async resendEsimEmail(iccid: string, email?: string): Promise<void> {
    await this.request(`/esims/${encodeURIComponent(iccid)}/resend-email`, {
      method: 'POST',
      body: JSON.stringify(email ? { email } : {}),
    });
  }
}

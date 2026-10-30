/**
 * Order state in Workers KV (binding `ORDERS`).
 *
 * Keys:
 *   session:<stripeSessionId>  → OrderRecord (JSON)  — the source of truth
 *   order:<esdOrderId>         → stripeSessionId     — for /order/[id] and eSimDistributor webhooks
 *   num:<esdOrderNumber>       → stripeSessionId     — for /lookup
 *   failed:<stripeSessionId>   → ""                  — index of orders that need a retry
 *   rl:<bucket>                → counter             — simple rate limiting for /lookup
 */

export interface KVLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
  list(options: { prefix: string; limit?: number; cursor?: string }): Promise<{
    keys: { name: string }[];
    list_complete: boolean;
    cursor?: string;
  }>;
}

export interface StoredEsim {
  iccid: string;
  planName: string;
  lpa: string | null;
  smdpAddress: string | null;
  matchingId: string | null;
}

export type RecordState = 'pending' | 'processing' | 'completed' | 'failed';

export interface OrderRecord {
  sessionId: string;
  sku: string;
  planName: string;
  email: string;
  amountCents: number;
  state: RecordState;
  /** Number of POST /orders attempts. */
  attempts: number;
  /** Idempotency-Key for the next (or last ambiguous) attempt. Starts as the session id. */
  idempotencyKey: string;
  orderId?: string;
  orderNumber?: string;
  esims?: StoredEsim[];
  failureCode?: string;
  failureMessage?: string;
  /** When the branded "your eSIM is ready" email (Resend) was sent. */
  linkEmailedAt?: string;
  createdAt: string;
  updatedAt: string;
}

const ttl90d = 90 * 24 * 3600;

export class OrderStore {
  constructor(private readonly kv: KVLike) {}

  async get(sessionId: string): Promise<OrderRecord | null> {
    const raw = await this.kv.get(`session:${sessionId}`);
    return raw ? (JSON.parse(raw) as OrderRecord) : null;
  }

  async save(rec: OrderRecord): Promise<void> {
    rec.updatedAt = new Date().toISOString();
    await this.kv.put(`session:${rec.sessionId}`, JSON.stringify(rec));
    if (rec.orderId) await this.kv.put(`order:${rec.orderId}`, rec.sessionId);
    if (rec.orderNumber) await this.kv.put(`num:${rec.orderNumber}`, rec.sessionId);
    if (rec.state === 'failed') await this.kv.put(`failed:${rec.sessionId}`, '', { expirationTtl: ttl90d });
    else await this.kv.delete(`failed:${rec.sessionId}`);
  }

  async byOrderId(orderId: string): Promise<OrderRecord | null> {
    const sid = await this.kv.get(`order:${orderId}`);
    return sid ? this.get(sid) : null;
  }

  async byOrderNumber(num: string): Promise<OrderRecord | null> {
    const sid = await this.kv.get(`num:${num}`);
    return sid ? this.get(sid) : null;
  }

  async failedSessionIds(limit = 50): Promise<string[]> {
    const res = await this.kv.list({ prefix: 'failed:', limit });
    return res.keys.map((k) => k.name.slice('failed:'.length));
  }

  /** Fixed-window counter. Returns false when `max` is exceeded. KV is eventually consistent, so this is best-effort. */
  async rateLimit(bucket: string, max: number, windowSec = 600): Promise<boolean> {
    const key = `rl:${bucket}:${Math.floor(Date.now() / 1000 / windowSec)}`;
    const n = Number((await this.kv.get(key)) ?? 0) + 1;
    await this.kv.put(key, String(n), { expirationTtl: Math.max(60, windowSec * 2) });
    return n <= max;
  }
}

/** In-memory KV for tests and for `astro dev` without a KV binding. */
export class MemoryKV implements KVLike {
  readonly data = new Map<string, string>();
  async get(key: string) {
    return this.data.get(key) ?? null;
  }
  async put(key: string, value: string) {
    this.data.set(key, value);
  }
  async delete(key: string) {
    this.data.delete(key);
  }
  async list({ prefix, limit = 1000 }: { prefix: string; limit?: number }) {
    const keys = [...this.data.keys()].filter((k) => k.startsWith(prefix)).slice(0, limit).map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}

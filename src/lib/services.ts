import { HttpResellerApi, type ResellerApi } from './api';
import type { WaitUntil } from './cache';
import type { CatalogDeps } from './catalog';
import type { SiteConfig } from './config-schema';
import { hmacSha256Hex, signOrderToken, verifyOrderToken } from './crypto';
import { orderLinkEmail, sendEmail, type EmailSettings } from './email';
import type { FulfilDeps } from './fulfil';
import { sharedMockApi } from './mock-api';
import { MemoryKV, OrderStore, type KVLike, type OrderRecord } from './store';

/** Bindings and secrets. See wrangler.toml and .dev.vars.example. */
export interface Env {
  RESELLER_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PUBLISHABLE_KEY?: string;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
  ESD_WEBHOOK_SECRET?: string;
  ORDER_LINK_SECRET?: string;
  ADMIN_TOKEN?: string;
  MOCK_API?: string;
  ORDERS?: KVLike;
}

export interface Services {
  config: SiteConfig;
  env: Env;
  mock: boolean;
  api: ResellerApi;
  store: OrderStore;
  catalog: CatalogDeps;
  ctx?: WaitUntil;
  email: EmailSettings | null;
  /** Mock checkout (no Stripe) is only allowed in mock mode. */
  stripeConfigured: boolean;
  orderToken(orderId: string): Promise<string>;
  verifyOrderToken(orderId: string, token: string | null): Promise<boolean>;
  orderLink(orderId: string): Promise<string>;
  fulfilDeps(): FulfilDeps;
}

export class SetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SetupError';
  }
}

let devKv: MemoryKV | undefined;

export function createServices(config: SiteConfig, env: Env, opts: { dev: boolean; ctx?: WaitUntil }): Services {
  const mock = env.MOCK_API === '1' || env.MOCK_API === 'true' || (opts.dev && !env.RESELLER_API_KEY);

  let api: ResellerApi;
  if (mock) api = sharedMockApi();
  else if (env.RESELLER_API_KEY) api = new HttpResellerApi(config.apiBaseUrl, env.RESELLER_API_KEY);
  else throw new SetupError('RESELLER_API_KEY is not set. Run `wrangler secret put RESELLER_API_KEY` (see README).');

  let kv = env.ORDERS;
  if (!kv) {
    if (!opts.dev && !mock) throw new SetupError('The ORDERS KV namespace is not bound. Check wrangler.toml (see README).');
    kv = devKv ??= new MemoryKV();
  }
  const store = new OrderStore(kv);

  let linkSecretPromise: Promise<string> | undefined;
  const linkSecret = (): Promise<string> =>
    (linkSecretPromise ??= (async () => {
      if (env.ORDER_LINK_SECRET) return env.ORDER_LINK_SECRET;
      // Derived fallback: stable as long as the API key is not rotated (links would stop working then).
      if (env.RESELLER_API_KEY) return hmacSha256Hex(env.RESELLER_API_KEY, 'storefront-order-link-secret');
      if (mock) return 'mock-mode-order-link-secret';
      throw new SetupError('ORDER_LINK_SECRET is not set.');
    })());

  const email: EmailSettings | null =
    env.RESEND_API_KEY && env.EMAIL_FROM ? { resendApiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM } : null;

  const orderToken = async (orderId: string) => signOrderToken(await linkSecret(), orderId);
  const orderLink = async (orderId: string) =>
    `${config.websiteUrl}/order/${encodeURIComponent(orderId)}?t=${await orderToken(orderId)}`;

  const services: Services = {
    config,
    env,
    mock,
    api,
    store,
    ctx: opts.ctx,
    catalog: { api, config, ctx: opts.ctx },
    email,
    stripeConfigured: !!env.STRIPE_SECRET_KEY,
    orderToken,
    verifyOrderToken: async (orderId, token) => verifyOrderToken(await linkSecret(), orderId, token),
    orderLink,
    fulfilDeps: () => ({
      api,
      store,
      // With Resend we send our own branded email that links to the order page;
      // otherwise eSimDistributor's white-labelled email delivers the eSIM.
      apiSendsEmail: !email,
      onCompleted: email
        ? async (rec: OrderRecord) => {
            if (rec.linkEmailedAt || !rec.orderId || !rec.orderNumber) return;
            await sendOrderEmail(services, rec);
            return { linkEmailedAt: new Date().toISOString() };
          }
        : undefined,
    }),
  };
  return services;
}

export async function sendOrderEmail(services: Services, rec: OrderRecord): Promise<void> {
  if (!services.email || !rec.orderId || !rec.orderNumber) return;
  const msg = orderLinkEmail(services.config, {
    planName: rec.planName,
    orderNumber: rec.orderNumber,
    link: await services.orderLink(rec.orderId),
  });
  await sendEmail(services.email, { to: rec.email, replyTo: services.config.supportEmail, ...msg });
}

/**
 * Custom Worker entry point (wired up in astro.config.mjs → workerEntryPoint).
 * `fetch` is Astro as usual; `scheduled` runs on the cron in wrangler.toml and retries
 * paid orders that could not be fulfilled yet (e.g. balance was too low), so customers get
 * their eSIM automatically once the reseller tops up.
 */
import type { SSRManifest } from 'astro';
import { App } from 'astro/app';
import { handle } from '@astrojs/cloudflare/handler';
import { createServices, type Env } from './lib/services';
import { site } from './lib/site';
import { retryFailedOrders } from './lib/retry';

type HandlerRequest = Parameters<typeof handle>[2];
type HandlerEnv = Parameters<typeof handle>[3];
type Ctx = Parameters<typeof handle>[4];

export function createExports(manifest: SSRManifest) {
  const app = new App(manifest);
  return {
    default: {
      fetch(request: HandlerRequest, env: HandlerEnv, ctx: Ctx) {
        return handle(manifest, app, request, env, ctx);
      },
      async scheduled(_controller: unknown, env: Env, ctx: Ctx) {
        const services = createServices(site, env, { dev: false, ctx });
        const summary = await retryFailedOrders(services, { onlyDue: true });
        if (summary.length > 0) console.info('[cron] retried failed orders', JSON.stringify(summary));
      },
    },
  };
}

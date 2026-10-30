// @ts-check
import { readFileSync } from 'node:fs';
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import tailwindcss from '@tailwindcss/vite';

const siteConfig = JSON.parse(readFileSync(new URL('./site.config.json', import.meta.url), 'utf8'));

// workerd (used by the local platform proxy) has no Windows-on-ARM build. There the dev
// server falls back to reading .dev.vars directly and an in-memory KV (see src/lib/runtime.ts).
const platformProxySupported = !(process.platform === 'win32' && process.arch === 'arm64');

export default defineConfig({
  site: siteConfig.websiteUrl,
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: platformProxySupported },
    imageService: 'passthrough',
    // Adds a scheduled (cron) handler next to Astro's fetch handler — see src/worker.ts.
    workerEntryPoint: { path: 'src/worker.ts' },
    // Astro sessions are not used; point them at the existing KV so no extra binding is needed.
    sessionKVBindingName: 'ORDERS',
  }),
  trailingSlash: 'never',
  build: { inlineStylesheets: 'always' },
  security: { checkOrigin: true },
  vite: {
    plugins: [tailwindcss()],
    // Part of the edge HTML cache key (src/middleware.ts): a new deploy never serves old pages.
    define: { __BUILD_ID__: JSON.stringify(Date.now().toString(36)) },
  },
});

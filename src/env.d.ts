/// <reference types="astro/client" />

type CloudflareRuntime = import('@astrojs/cloudflare').Runtime<import('./lib/services').Env>;

declare namespace App {
  interface Locals extends Partial<CloudflareRuntime> {
    services?: import('./lib/services').Services;
  }
}

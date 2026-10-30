import { createServices, type Env, type Services } from './services';
import { site } from './site';

/**
 * Per-request access to bindings/secrets and the service objects built from them.
 * On Cloudflare (and in `astro dev` with the platform proxy) everything comes from
 * `locals.runtime.env`. When the platform proxy is unavailable in dev, `.dev.vars`
 * is read directly so local development still works.
 */

let devVars: Env | undefined;

function loadDevVars(): Env {
  if (devVars) return devVars;
  devVars = {};
  if (!import.meta.env.DEV) return devVars;
  try {
    // Only reached in `astro dev` (the branch is removed from production builds).
    const fs = (globalThis as { process?: { getBuiltinModule?: (m: string) => unknown } }).process?.getBuiltinModule?.(
      'node:fs',
    ) as { existsSync(p: string): boolean; readFileSync(p: string, enc: 'utf8'): string } | undefined;
    const text = fs?.existsSync('.dev.vars') ? fs.readFileSync('.dev.vars', 'utf8') : '';
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) (devVars as Record<string, string>)[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
    }
  } catch {
    /* ignore */
  }
  return devVars;
}

export function getServices(locals: App.Locals): Services {
  if (locals.services) return locals.services;
  const runtimeEnv = (locals.runtime?.env ?? {}) as Env;
  const env: Env = import.meta.env.DEV ? { ...loadDevVars(), ...runtimeEnv } : runtimeEnv;
  const services = createServices(site, env, { dev: import.meta.env.DEV, ctx: locals.runtime?.ctx });
  locals.services = services;
  return services;
}

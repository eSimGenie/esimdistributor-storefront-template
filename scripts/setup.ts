/**
 * npm run setup [-- --online] [-- --strict]
 *
 * Non-interactive pre-flight check: validates site.config.json, looks at wrangler.toml and
 * your local secrets (.dev.vars / environment) and prints exactly what is still missing.
 *   --online  also calls the eSimDistributor API with RESELLER_API_KEY to check the key works
 *   --strict  exit with code 1 when anything required is missing (for CI)
 */
import { existsSync, readFileSync } from 'node:fs';
import { ConfigError, parseSiteConfig, placeholderWarnings, type SiteConfig } from '../src/lib/config-schema';

const args = new Set(process.argv.slice(2));
const online = args.has('--online');
const strict = args.has('--strict');

const color = (c: number) => (s: string) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const green = color(32);
const yellow = color(33);
const red = color(31);
const bold = color(1);

const ok = (m: string) => console.log(`  ${green('✔')} ${m}`);
const warn = (m: string) => console.log(`  ${yellow('!')} ${m}`);
const fail = (m: string) => console.log(`  ${red('✘')} ${m}`);

let problems = 0;
let warnings = 0;

// ── 1. site.config.json ──────────────────────────────────────────────
console.log(bold('\nsite.config.json'));
let config: SiteConfig | null = null;
try {
  config = parseSiteConfig(JSON.parse(readFileSync('site.config.json', 'utf8')));
  ok(`valid — brand "${config.brandName}", pricing ${config.pricing.mode} (${config.pricing.mode === 'multiplier' ? `×${config.pricing.multiplier}` : `+$${config.pricing.fixedMarkup}`}, roundTo ${config.pricing.roundTo})`);
  for (const w of placeholderWarnings(config)) {
    warn(w);
    warnings++;
  }
  if (config.logoUrl === null) warn('logoUrl is not set — the brand name is shown as text');
} catch (e) {
  problems++;
  if (e instanceof ConfigError) e.issues.forEach((i) => fail(i));
  else fail(`cannot read site.config.json: ${(e as Error).message}`);
}

// ── 2. wrangler.toml ─────────────────────────────────────────────────
console.log(bold('\nwrangler.toml'));
const toml = existsSync('wrangler.toml') ? readFileSync('wrangler.toml', 'utf8') : '';
if (!toml) {
  fail('wrangler.toml not found');
  problems++;
} else {
  const name = /^name\s*=\s*"([^"]+)"/m.exec(toml)?.[1];
  ok(`worker name: ${name ?? '(none)'}`);
  if (/binding\s*=\s*"ORDERS"/.test(toml)) ok('KV binding ORDERS is declared');
  else {
    fail('KV binding ORDERS is missing ([[kv_namespaces]] binding = "ORDERS")');
    problems++;
  }
  if (/^\s*crons\s*=/m.test(toml)) ok('cron trigger for automatic order retries is set');
  else warn('no cron trigger — failed orders are only retried when customers revisit or via /api/admin/retry');
}

// ── 3. Secrets ───────────────────────────────────────────────────────
console.log(bold('\nSecrets (checked in .dev.vars and the environment — production secrets live in Cloudflare)'));
const local: Record<string, string> = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[2]) local[m[1]!] = m[2]!.replace(/^["']|["']$/g, '');
  }
} else {
  warn('.dev.vars not found (copy .dev.vars.example) — `npm run dev` will use mock mode');
}
const get = (k: string) => process.env[k] || local[k] || '';

interface SecretSpec {
  name: string;
  required: boolean;
  pattern?: RegExp;
  hint: string;
}
const secrets: SecretSpec[] = [
  { name: 'RESELLER_API_KEY', required: true, pattern: /^sk_(live|test)_/, hint: 'eSimDistributor console → Developer → API keys' },
  { name: 'STRIPE_SECRET_KEY', required: true, pattern: /^(sk|rk)_(live|test)_/, hint: 'Stripe dashboard → Developers → API keys' },
  { name: 'STRIPE_WEBHOOK_SECRET', required: true, pattern: /^whsec_/, hint: 'Stripe → Developers → Webhooks → endpoint /api/stripe-webhook → Signing secret' },
  { name: 'ORDER_LINK_SECRET', required: true, pattern: /^.{32,}$/, hint: 'any random string of 32+ characters, e.g. `openssl rand -hex 32`' },
  { name: 'ESD_WEBHOOK_SECRET', required: false, pattern: /^whsec_/, hint: 'optional: eSimDistributor webhook for /api/esd-webhook' },
  { name: 'RESEND_API_KEY', required: false, pattern: /^re_/, hint: 'optional: branded emails via Resend (needs EMAIL_FROM too)' },
  { name: 'EMAIL_FROM', required: false, pattern: /@/, hint: 'optional: e.g. "Acme Travel <esim@acme.example>"' },
  { name: 'ADMIN_TOKEN', required: false, pattern: /^.{16,}$/, hint: 'optional: enables POST /api/admin/retry' },
];
const missingRequired: string[] = [];
for (const s of secrets) {
  const v = get(s.name);
  if (!v) {
    if (s.required) {
      missingRequired.push(s.name);
      warn(`${s.name} not set locally — ${s.hint}`);
    } else {
      console.log(`  - ${s.name} not set (${s.hint})`);
    }
  } else if (s.pattern && !s.pattern.test(v)) {
    fail(`${s.name} looks wrong (expected ${s.pattern})`);
    problems++;
  } else {
    ok(`${s.name} set${/_test_/.test(v) ? yellow(' (test mode)') : ''}`);
  }
}
if (get('RESEND_API_KEY') && !get('EMAIL_FROM')) {
  fail('RESEND_API_KEY is set but EMAIL_FROM is not');
  problems++;
}
if (get('MOCK_API') === '1') warn('MOCK_API=1 — the demo catalog is used, no real orders are placed');

// ── 4. Optional online check ─────────────────────────────────────────
if (online && config) {
  console.log(bold('\nAPI connectivity'));
  const key = get('RESELLER_API_KEY');
  if (!key) warn('skipped — RESELLER_API_KEY not set');
  else {
    try {
      const res = await fetch(`${config.apiBaseUrl}/api/v1/reseller/catalog?pageSize=1`, { headers: { 'X-Api-Key': key, Accept: 'application/json' } });
      if (res.ok) {
        const body = (await res.json()) as { total?: number };
        ok(`API key works — ${body.total ?? '?'} plans in your catalog`);
      } else {
        fail(`API answered HTTP ${res.status} — check the key and apiBaseUrl`);
        problems++;
      }
    } catch (e) {
      fail(`cannot reach ${config.apiBaseUrl}: ${(e as Error).message}`);
      problems++;
    }
  }
}

// ── Summary ──────────────────────────────────────────────────────────
console.log(bold('\nNext steps'));
if (problems > 0) console.log(red(`  Fix the ${problems} problem(s) marked ✘ above.`));
console.log('  Production secrets are set in Cloudflare (not in files):');
for (const s of secrets.filter((x) => x.required)) console.log(`    npx wrangler secret put ${s.name}`);
if (config) {
  console.log(`  Stripe webhook endpoint:   ${config.websiteUrl}/api/stripe-webhook`);
  console.log('    events: checkout.session.completed, checkout.session.async_payment_succeeded');
  console.log(`  eSimDistributor webhook:   ${config.websiteUrl}/api/esd-webhook (optional; order.completed, order.failed)`);
}
console.log('  Keep auto top-up ON in the eSimDistributor console so paid orders never wait for balance.');
if (missingRequired.length === 0 && problems === 0) console.log(green('\n  Ready to deploy: npm run deploy\n'));
else console.log('');

process.exit(problems > 0 || (strict && (missingRequired.length > 0 || warnings > 0)) ? 1 : 0);

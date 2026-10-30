import { z } from 'zod';

/**
 * Schema for `site.config.json` — the only file a reseller normally edits.
 * Keep this in sync with `site.config.schema.json` (a test enforces that the keys match).
 * Nothing in here is secret: it is committed to the reseller's repository.
 */

const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, 'must be a 6-digit hex colour such as #0B5FFF');

const httpsUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//.test(u), 'must start with https:// (or http:// for local testing)');

/** Region / country codes and SKUs are used in URLs and cache keys, so keep them tame. */
const code = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'letters, digits, "-" and "_" only');

const price = z.number().positive().max(10_000).multipleOf(0.01, 'at most 2 decimals');

export const pricingSchema = z
  .object({
    /** `multiplier`: wholesale × multiplier. `fixed`: wholesale + fixedMarkup (USD). */
    mode: z.enum(['multiplier', 'fixed']).default('multiplier'),
    multiplier: z.number().min(1).max(20).default(2.0),
    fixedMarkup: z.number().min(0).max(1000).default(0),
    /** 0.99 → round up to the next X.99; 0.49 → next X.49 or X.99; null → round up to the cent. */
    roundTo: z.union([z.literal(0.99), z.literal(0.49), z.null()]).default(0.99),
    /** Exact selling price per SKU (USD). Still never below wholesale. */
    overrides: z.record(code, price).default({}),
  })
  .strict();

export const siteConfigSchema = z
  .object({
    $schema: z.string().optional(),
    brandName: z.string().min(1).max(60),
    tagline: z.string().max(140).default('Travel eSIMs for 190+ destinations. Instant delivery.'),
    logoUrl: z.union([httpsUrl, z.string().regex(/^\/[^/]/, 'must be an absolute URL or a /path')]).nullable().default(null),
    primaryColor: hexColor.default('#0B5FFF'),
    accentColor: hexColor.default('#FF7A00'),
    supportEmail: z.string().email(),
    /** Public URL of the storefront (used for canonical URLs, sitemap, Stripe redirects). */
    websiteUrl: httpsUrl,
    defaultCurrency: z.literal('USD').default('USD'),
    pricing: pricingSchema.default({}),
    /** Destination codes shown on the home page, e.g. ["FR", "JP", "US", "europe"]. */
    featuredDestinations: z.array(code).max(24).default([]),
    /** SKUs never shown or sold. */
    hiddenSkus: z.array(code).default([]),
    legal: z
      .object({
        companyName: z.string().min(1),
        address: z.string().min(1),
        /** Optional extra line such as a company or VAT number. */
        registration: z.string().nullable().default(null),
        /** ISO country of the governing law, shown in the terms. */
        jurisdiction: z.string().min(2).default('Ireland'),
      })
      .strict(),
    analytics: z
      .object({
        provider: z.enum(['plausible', 'ga4', 'cloudflare']),
        id: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/, 'unexpected characters'),
      })
      .strict()
      .nullable()
      .default(null),
    apiBaseUrl: httpsUrl.default('https://api.esimdistributor.com'),
  })
  .strict();

export type SiteConfigInput = z.input<typeof siteConfigSchema>;
export type SiteConfig = z.output<typeof siteConfigSchema>;
export type PricingConfig = z.output<typeof pricingSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`site.config.json is invalid:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/** Validates the raw JSON and returns the config with defaults applied. Throws ConfigError. */
export function parseSiteConfig(raw: unknown): SiteConfig {
  const result = siteConfigSchema.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    );
  }
  const cfg = result.data;
  cfg.websiteUrl = cfg.websiteUrl.replace(/\/+$/, '');
  cfg.apiBaseUrl = cfg.apiBaseUrl.replace(/\/+$/, '');
  return cfg;
}

/** Values that are syntactically valid but obviously still the template's placeholders. */
export function placeholderWarnings(cfg: SiteConfig): string[] {
  const warnings: string[] = [];
  const looksPlaceholder = (s: string) => /example\.(com|org|net)|example street|change[- ]?me|todo|your company/i.test(s);
  if (looksPlaceholder(cfg.supportEmail)) warnings.push(`supportEmail is still a placeholder (${cfg.supportEmail})`);
  if (looksPlaceholder(cfg.websiteUrl)) warnings.push(`websiteUrl is still a placeholder (${cfg.websiteUrl})`);
  if (looksPlaceholder(cfg.legal.companyName)) warnings.push('legal.companyName is still a placeholder');
  if (looksPlaceholder(cfg.legal.address)) warnings.push('legal.address is still a placeholder');
  if (cfg.brandName === 'Your Brand') warnings.push('brandName is still "Your Brand"');
  return warnings;
}

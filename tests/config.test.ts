import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseSiteConfig, placeholderWarnings, pricingSchema, siteConfigSchema } from '../src/lib/config-schema';

const shipped = JSON.parse(readFileSync(new URL('../site.config.json', import.meta.url), 'utf8'));
const jsonSchema = JSON.parse(readFileSync(new URL('../site.config.schema.json', import.meta.url), 'utf8'));

const minimal = {
  brandName: 'Acme Travel',
  supportEmail: 'help@acme.test',
  websiteUrl: 'https://shop.acme.test/',
  legal: { companyName: 'Acme Travel Ltd', address: '5 Main St, Cork' },
};

describe('site config validation', () => {
  it('accepts the shipped site.config.json', () => {
    expect(() => parseSiteConfig(shipped)).not.toThrow();
  });

  it('flags the shipped placeholders', () => {
    const w = placeholderWarnings(parseSiteConfig(shipped));
    expect(w.join('\n')).toMatch(/supportEmail/);
    expect(w.join('\n')).toMatch(/brandName/);
  });

  it('applies defaults and strips trailing slashes', () => {
    const cfg = parseSiteConfig(minimal);
    expect(cfg.websiteUrl).toBe('https://shop.acme.test');
    expect(cfg.apiBaseUrl).toBe('https://api.esimdistributor.com');
    expect(cfg.defaultCurrency).toBe('USD');
    expect(cfg.pricing).toEqual({ mode: 'multiplier', multiplier: 2, fixedMarkup: 0, roundTo: 0.99, overrides: {} });
    expect(cfg.analytics).toBeNull();
    expect(placeholderWarnings(cfg)).toEqual([]);
  });

  it.each([
    ['bad colour', { primaryColor: 'blue' }, 'primaryColor'],
    ['bad email', { supportEmail: 'nope' }, 'supportEmail'],
    ['non-USD currency', { defaultCurrency: 'EUR' }, 'defaultCurrency'],
    ['multiplier below 1', { pricing: { multiplier: 0.8 } }, 'pricing.multiplier'],
    ['unsupported roundTo', { pricing: { roundTo: 0.95 } }, 'pricing.roundTo'],
    ['negative override', { pricing: { overrides: { SKU1: -1 } } }, 'pricing.overrides.SKU1'],
    ['3-decimal override', { pricing: { overrides: { SKU1: 1.234 } } }, 'pricing.overrides.SKU1'],
    ['unknown key (typo)', { brandname: 'x' }, '(root)'],
    ['bad analytics provider', { analytics: { provider: 'matomo', id: 'x' } }, 'analytics.provider'],
    ['missing legal', { legal: undefined }, 'legal'],
  ])('rejects %s', (_name, patch, path) => {
    try {
      parseSiteConfig({ ...minimal, ...patch });
      expect.unreachable('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).issues.join('\n')).toContain(path);
    }
  });

  it('keeps the JSON Schema in sync with the zod schema', () => {
    expect(Object.keys(jsonSchema.properties).sort()).toEqual(Object.keys(siteConfigSchema.shape).sort());
    expect(Object.keys(jsonSchema.properties.pricing.properties).sort()).toEqual(Object.keys(pricingSchema.shape).sort());
    expect(Object.keys(jsonSchema.properties.legal.properties).sort()).toEqual(
      Object.keys(siteConfigSchema.shape.legal.shape).sort(),
    );
    expect([...jsonSchema.required].sort()).toEqual(['brandName', 'legal', 'supportEmail', 'websiteUrl']);
  });
});

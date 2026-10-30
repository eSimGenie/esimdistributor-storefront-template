import type { PricingConfig } from './config-schema';

/**
 * Selling-price calculation. All arithmetic is done in integer cents so that
 * 0.1 + 0.2 style float errors can never produce a price like 6.989999.
 */

export interface PriceResult {
  /** Selling price in cents (USD). */
  cents: number;
  /** True when the configured price was below wholesale and was raised to wholesale. */
  clamped: boolean;
  source: 'override' | 'multiplier' | 'fixed';
}

export type PriceWarn = (message: string) => void;

export const toCents = (amount: number): number => Math.round(amount * 100);
export const fromCents = (cents: number): number => cents / 100;

/** Rounds `cents` UP to the next price ending in .99 (0.99) or in .49/.99 (0.49). */
export function applyCharmRounding(cents: number, roundTo: 0.99 | 0.49 | null): number {
  if (roundTo === null) return cents;
  const step = roundTo === 0.99 ? 100 : 50;
  const ending = step - 1;
  let candidate = Math.floor(cents / step) * step + ending;
  if (candidate < cents) candidate += step;
  return candidate;
}

export function computeSellingPrice(
  sku: string,
  wholesalePrice: number,
  pricing: PricingConfig,
  warn: PriceWarn = (m) => console.warn(m),
): PriceResult {
  if (!Number.isFinite(wholesalePrice) || wholesalePrice < 0) {
    throw new Error(`Invalid wholesale price for ${sku}: ${wholesalePrice}`);
  }
  const wholesaleCents = toCents(wholesalePrice);
  let cents: number;
  let source: PriceResult['source'];

  const override = pricing.overrides[sku];
  if (override !== undefined) {
    // An explicit price is used as-is: the reseller chose it on purpose.
    cents = toCents(override);
    source = 'override';
  } else if (pricing.mode === 'fixed') {
    cents = applyCharmRounding(wholesaleCents + toCents(pricing.fixedMarkup), pricing.roundTo);
    source = 'fixed';
  } else {
    // Small epsilon so 3.15 × 2 = 630 cents, not 631 from 629.9999999.
    const raw = Math.ceil(wholesaleCents * pricing.multiplier - 1e-6);
    cents = applyCharmRounding(raw, pricing.roundTo);
    source = 'multiplier';
  }

  if (cents < wholesaleCents) {
    warn(
      `[pricing] ${sku}: configured price ${fromCents(cents).toFixed(2)} is below wholesale ` +
        `${fromCents(wholesaleCents).toFixed(2)} — selling at wholesale instead. Fix pricing.overrides in site.config.json.`,
    );
    return { cents: wholesaleCents, clamped: true, source };
  }
  return { cents, clamped: false, source };
}

export function formatUsd(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(fromCents(cents));
}

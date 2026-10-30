import { describe, expect, it, vi } from 'vitest';
import { pricingSchema } from '../src/lib/config-schema';
import { applyCharmRounding, computeSellingPrice, formatUsd } from '../src/lib/pricing';

const pricing = (p: Record<string, unknown> = {}) => pricingSchema.parse(p);

describe('applyCharmRounding', () => {
  it('rounds up to the next .99', () => {
    expect(applyCharmRounding(630, 0.99)).toBe(699);
    expect(applyCharmRounding(600, 0.99)).toBe(699);
    expect(applyCharmRounding(699, 0.99)).toBe(699);
    expect(applyCharmRounding(700, 0.99)).toBe(799);
    expect(applyCharmRounding(1, 0.99)).toBe(99);
  });

  it('rounds up to the next .49 or .99', () => {
    expect(applyCharmRounding(630, 0.49)).toBe(649);
    expect(applyCharmRounding(649, 0.49)).toBe(649);
    expect(applyCharmRounding(650, 0.49)).toBe(699);
    expect(applyCharmRounding(700, 0.49)).toBe(749);
  });

  it('leaves cents alone when null', () => {
    expect(applyCharmRounding(631, null)).toBe(631);
  });
});

describe('computeSellingPrice', () => {
  it('applies the multiplier without float drift', () => {
    // 3.15 × 2 = 6.30 exactly (naive float math gives 6.3000000000000007 → 631 cents)
    expect(computeSellingPrice('A', 3.15, pricing({ multiplier: 2, roundTo: null })).cents).toBe(630);
    expect(computeSellingPrice('A', 0.1 + 0.2, pricing({ multiplier: 3, roundTo: null })).cents).toBe(90);
  });

  it('rounds up fractional cents (never sells a fraction below the multiplier)', () => {
    expect(computeSellingPrice('A', 1.01, pricing({ multiplier: 1.5, roundTo: null })).cents).toBe(152); // 151.5 → 152
  });

  it('defaults to ×2 with .99 rounding', () => {
    const r = computeSellingPrice('A', 3.15, pricing());
    expect(r).toEqual({ cents: 699, clamped: false, source: 'multiplier' });
  });

  it('supports .49 rounding', () => {
    expect(computeSellingPrice('A', 3.15, pricing({ roundTo: 0.49 })).cents).toBe(649);
  });

  it('supports fixed markup mode', () => {
    const r = computeSellingPrice('A', 3.15, pricing({ mode: 'fixed', fixedMarkup: 2.5, roundTo: null }));
    expect(r).toEqual({ cents: 565, clamped: false, source: 'fixed' });
    expect(computeSellingPrice('A', 3.15, pricing({ mode: 'fixed', fixedMarkup: 2.5 })).cents).toBe(599);
  });

  it('uses overrides as-is (no rounding)', () => {
    const r = computeSellingPrice('ESA-FR-3GB-30D', 3.15, pricing({ overrides: { 'ESA-FR-3GB-30D': 5.55 } }));
    expect(r).toEqual({ cents: 555, clamped: false, source: 'override' });
  });

  it('only applies an override to its own sku', () => {
    expect(computeSellingPrice('OTHER', 3.15, pricing({ overrides: { 'ESA-FR-3GB-30D': 5.55 } })).cents).toBe(699);
  });

  it('clamps an override below wholesale to wholesale and logs', () => {
    const warn = vi.fn();
    const r = computeSellingPrice('ESA-FR-3GB-30D', 3.15, pricing({ overrides: { 'ESA-FR-3GB-30D': 1.99 } }), warn);
    expect(r).toEqual({ cents: 315, clamped: true, source: 'override' });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toMatch(/below wholesale/);
  });

  it('never goes below wholesale with multiplier 1 and no rounding', () => {
    const warn = vi.fn();
    expect(computeSellingPrice('A', 3.15, pricing({ multiplier: 1, roundTo: null }), warn)).toEqual({
      cents: 315,
      clamped: false,
      source: 'multiplier',
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it('rejects invalid wholesale prices', () => {
    expect(() => computeSellingPrice('A', Number.NaN, pricing())).toThrow();
    expect(() => computeSellingPrice('A', -1, pricing())).toThrow();
  });
});

describe('formatUsd', () => {
  it('formats cents as dollars', () => {
    expect(formatUsd(699)).toBe('$6.99');
    expect(formatUsd(123456)).toBe('$1,234.56');
  });
});

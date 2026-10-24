import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_BRAND_KEYS,
  enabledMethodBrands,
  gatewayProviderBrand,
  isPaymentBrandKey,
  paymentBrandPresentation,
  pendingPaymentBrandRequirements,
} from './payment-brand-registry';

describe('payment brand registry', () => {
  it('knows exactly the five required brands, each with Arabic and English names', () => {
    expect([...PAYMENT_BRAND_KEYS]).toEqual(['moyasar', 'mada', 'visa', 'mastercard', 'apple_pay']);
    for (const key of PAYMENT_BRAND_KEYS) {
      const brand = paymentBrandPresentation(key);
      expect(brand?.nameAr.length).toBeGreaterThan(0);
      expect(brand?.nameEn.length).toBeGreaterThan(0);
    }
  });

  it('never claims a logo without recorded provenance and an existing local file', () => {
    for (const key of PAYMENT_BRAND_KEYS) {
      const logo = paymentBrandPresentation(key)!.logo;
      if (logo.kind === 'official') {
        expect(logo.provenance.publisher).not.toBe('');
        expect(logo.provenance.source).toMatch(/^https:\/\//);
        expect(logo.src).toMatch(/^\/payment-brands\//);
        expect(existsSync(resolve(__dirname, '../../public', logo.src.slice(1)))).toBe(true);
      } else {
        expect(logo.requirement.length).toBeGreaterThan(20);
      }
    }
  });

  it('registers the Apple Pay mark as the official Apple artwork, unmodified, with recorded terms', () => {
    const logo = paymentBrandPresentation('apple_pay')!.logo;
    expect(logo.kind).toBe('official');
    if (logo.kind !== 'official') return;
    expect(logo.provenance.publisher).toBe('Apple Inc.');
    expect(logo.provenance.source).toBe('https://developer.apple.com/apple-pay/marketing/');
    expect(logo.provenance.terms).toMatch(/no recreation/);
    const svg = readFileSync(resolve(__dirname, '../../public', logo.src.slice(1)), 'utf8');
    // الأصل الرسمي حرفياً (Apple_Pay_Mark_RGB_041619.svg): لا سكربت ولا صورة مضمَّنة، والأبعاد من viewBox.
    expect(svg).not.toMatch(/<script|<image|<foreignObject/i);
    expect(svg).toMatch(/viewBox="0 0 165\.52107 105\.9651"/);
    expect(createHash('sha256').update(svg).digest('hex')).toBe('66baf110b86c1f1ae01a0e28985970d3827465e6aba6be54d5142a6d1eaa803c');
    expect(logo.width / logo.height).toBeCloseTo(165.52107 / 105.9651, 1);
  });

  it('keeps every unadopted brand pending with a specific blocker (never a substitute)', () => {
    expect(pendingPaymentBrandRequirements().map((entry) => entry.key).sort()).toEqual(['mada', 'mastercard', 'moyasar', 'visa']);
    for (const entry of pendingPaymentBrandRequirements()) expect(entry.requirement).toMatch(/^BLOCKED/);
  });

  it('lists every brand without an official asset as a pending requirement', () => {
    const pending = pendingPaymentBrandRequirements().map((entry) => entry.key);
    const official = PAYMENT_BRAND_KEYS.filter((key) => paymentBrandPresentation(key)!.logo.kind === 'official');
    expect([...pending, ...official].sort()).toEqual([...PAYMENT_BRAND_KEYS].sort());
  });

  it('resolves a gateway provider brand only for Moyasar', () => {
    expect(gatewayProviderBrand('moyasar')?.key).toBe('moyasar');
    for (const other of ['stripe', 'tap', 'paytabs', 'checkout', 'custom', 'mada', 'visa', null, undefined, '']) {
      expect(gatewayProviderBrand(other)).toBeNull();
    }
  });

  it('shows method brands only when explicitly supported and enabled, in registry order, without duplicates', () => {
    expect(enabledMethodBrands(null)).toEqual([]);
    expect(enabledMethodBrands([])).toEqual([]);
    expect(enabledMethodBrands(['unknown', 'moyasar'])).toEqual([]);
    expect(enabledMethodBrands(['visa', 'mada', 'visa']).map((brand) => brand.key)).toEqual(['mada', 'visa']);
  });

  it('type-guards brand keys', () => {
    expect(isPaymentBrandKey('mada')).toBe(true);
    expect(isPaymentBrandKey('amex')).toBe(false);
    expect(isPaymentBrandKey(3)).toBe(false);
  });
});

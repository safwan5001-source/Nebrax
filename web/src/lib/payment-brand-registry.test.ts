import { existsSync } from 'node:fs';
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

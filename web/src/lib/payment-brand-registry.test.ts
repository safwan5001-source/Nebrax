import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PAYMENT_BRAND_KEYS,
  brandsWithUnverifiedRights,
  enabledMethodBrands,
  gatewayProviderBrand,
  isPaymentBrandKey,
  paymentBrandPresentation,
} from './payment-brand-registry';

const PUBLIC = resolve(__dirname, '../../public');
const BRANDS_DIR = resolve(PUBLIC, 'payment-brands');
const sha = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');

describe('payment brand registry', () => {
  it('knows exactly the required brands, each with Arabic and English names', () => {
    expect([...PAYMENT_BRAND_KEYS]).toEqual(['moyasar', 'tap', 'mada', 'visa', 'mastercard', 'apple_pay']);
    for (const key of PAYMENT_BRAND_KEYS) {
      const brand = paymentBrandPresentation(key);
      expect(brand?.nameAr.length).toBeGreaterThan(0);
      expect(brand?.nameEn.length).toBeGreaterThan(0);
    }
  });

  it('registers every logo with full provenance, an existing local file and its recorded SHA-256 (unmodified)', () => {
    for (const key of PAYMENT_BRAND_KEYS) {
      const logo = paymentBrandPresentation(key)!.logo;
      const p = logo.provenance;
      expect(p.publisher).not.toBe('');
      expect(p.source).toMatch(/^https:\/\//);
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(['official_kit', 'publisher_site_asset', 'community_copy']).toContain(p.origin);
      expect(['granted', 'unverified']).toContain(p.rightsStatus);
      expect(p.rights.length).toBeGreaterThan(30);
      expect(logo.src).toMatch(/^\/payment-brands\/[a-z-]+\.svg$/);
      expect(existsSync(resolve(PUBLIC, logo.src.slice(1)))).toBe(true);
      expect(sha(resolve(PUBLIC, logo.src.slice(1)))).toBe(p.sha256);
      if (logo.dark) {
        expect(sha(resolve(PUBLIC, logo.dark.src.slice(1)))).toBe(logo.dark.sha256);
      }
    }
  });

  it('keeps every file in public/payment-brands registered and free of active/external content', () => {
    const registered = new Set(
      PAYMENT_BRAND_KEYS.flatMap((key) => {
        const logo = paymentBrandPresentation(key)!.logo;
        return [logo.src, ...(logo.dark ? [logo.dark.src] : [])].map((src) => src.split('/').pop()!);
      }),
    );
    const onDisk = readdirSync(BRANDS_DIR);
    expect([...onDisk].sort()).toEqual([...registered].sort());
    for (const file of onDisk) {
      const svg = readFileSync(resolve(BRANDS_DIR, file), 'utf8');
      expect(svg, file).toMatch(/<svg[\s>]/);
      expect(svg, file).not.toMatch(/<script|<foreignObject|<image|<use[\s>]|<!DOCTYPE|<!ENTITY|<style[^>]*@import|javascript:|\son[a-z]+\s*=|(?:xlink:)?href\s*=|url\(\s*['"]?https?:/i);
    }
  });

  it('records the rights status of each asset honestly (only Apple is an official kit with granted terms)', () => {
    expect(brandsWithUnverifiedRights()).toEqual(['moyasar', 'tap', 'mada', 'visa', 'mastercard']);
    const apple = paymentBrandPresentation('apple_pay')!.logo.provenance;
    expect(apple.origin).toBe('official_kit');
    expect(apple.rightsStatus).toBe('granted');
    expect(apple.source).toBe('https://developer.apple.com/apple-pay/marketing/');
    expect(apple.terms).toMatch(/no recreation/);
    for (const key of ['mada', 'visa', 'mastercard'] as const) {
      expect(paymentBrandPresentation(key)!.logo.provenance.origin).toBe('community_copy');
      expect(paymentBrandPresentation(key)!.logo.provenance.rights).toMatch(/MIT/);
    }
    for (const key of ['moyasar', 'tap'] as const) {
      expect(paymentBrandPresentation(key)!.logo.provenance.origin).toBe('publisher_site_asset');
    }
  });

  it('gives Moyasar an official dark variant and flags Tap (dark wordmark, no dark variant) for a light surface', () => {
    const moyasar = paymentBrandPresentation('moyasar')!.logo;
    expect(moyasar.dark?.src).toBe('/payment-brands/moyasar-dark.svg');
    expect(paymentBrandPresentation('tap')!.logo.needsLightSurface).toBe(true);
    expect(paymentBrandPresentation('tap')!.logo.dark).toBeUndefined();
  });

  it('keeps Apple Pay as the official unmodified mark with its terms', () => {
    const logo = paymentBrandPresentation('apple_pay')!.logo;
    const svg = readFileSync(resolve(PUBLIC, logo.src.slice(1)), 'utf8');
    expect(svg).toMatch(/viewBox="0 0 165\.52107 105\.9651"/);
    expect(logo.width / logo.height).toBeCloseTo(165.52107 / 105.9651, 1);
  });

  it('resolves a gateway provider brand only for the providers with a registered logo (Moyasar, Tap)', () => {
    expect(gatewayProviderBrand('moyasar')?.key).toBe('moyasar');
    expect(gatewayProviderBrand('tap')?.key).toBe('tap');
    for (const other of ['stripe', 'paytabs', 'checkout', 'custom', 'mada', 'visa', null, undefined, '']) {
      expect(gatewayProviderBrand(other)).toBeNull();
    }
  });

  it('shows method brands only when explicitly supported and enabled, in registry order, without duplicates', () => {
    expect(enabledMethodBrands(null)).toEqual([]);
    expect(enabledMethodBrands([])).toEqual([]);
    expect(enabledMethodBrands(['unknown', 'moyasar', 'tap'])).toEqual([]);
    expect(enabledMethodBrands(['visa', 'mada', 'visa']).map((brand) => brand.key)).toEqual(['mada', 'visa']);
  });

  it('type-guards brand keys', () => {
    expect(isPaymentBrandKey('mada')).toBe(true);
    expect(isPaymentBrandKey('tap')).toBe(true);
    expect(isPaymentBrandKey('amex')).toBe(false);
    expect(isPaymentBrandKey(3)).toBe(false);
  });
});

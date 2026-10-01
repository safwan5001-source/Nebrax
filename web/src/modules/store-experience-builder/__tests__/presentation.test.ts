import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig } from '../presentation/config';
import { fontPresetFamilyStack, FONT_PRESETS, presentationCssVars } from '../presentation/tokens';
import {
  BRANDING_PERSISTENCE_CAPABILITY,
  BUSINESS_VERIFICATION_CAPABILITY,
  CUSTOM_NAV_LINKS_CAPABILITY,
  CUSTOMIZER_PREVIEW_CAPABILITY,
  DRAFT_PERSISTENCE_CAPABILITY,
  HOMEPAGE_COMPOSITION_CAPABILITY,
  INFORMATIONAL_PAGES_CAPABILITY,
  PUBLISH_CAPABILITY,
  THEME_PERSISTENCE_CAPABILITY,
  VERSION_HISTORY_CAPABILITY,
} from '../presentation/capabilities';
import { buildWhatsAppUrl, sanitizeExternalUrl } from '../presentation/urls';

describe('web presentation contract', () => {
  it('fails closed to AWJ Modern defaults', () => {
    expect(normalizePresentationConfig()).toEqual(DEFAULT_PRESENTATION_CONFIG);
  });

  it('flips only the STORE-BACKEND-1 LIVE capabilities from §11', () => {
    expect(THEME_PERSISTENCE_CAPABILITY).toBe('live');
    expect(HOMEPAGE_COMPOSITION_CAPABILITY).toBe('live');
    expect(CUSTOM_NAV_LINKS_CAPABILITY).toBe('live');
    expect(DRAFT_PERSISTENCE_CAPABILITY).toBe('live');
    expect(CUSTOMIZER_PREVIEW_CAPABILITY).toBe('live');
    expect(PUBLISH_CAPABILITY).toBe('live');
    expect(BRANDING_PERSISTENCE_CAPABILITY).toBe('design_only');
    expect(BUSINESS_VERIFICATION_CAPABILITY).toBe('gated');
    expect(INFORMATIONAL_PAGES_CAPABILITY).toBe('gated');
    expect(VERSION_HISTORY_CAPABILITY).toBe('deferred');
  });

  it('accepts awj-market with its own default primary color, matching the storefront/PHP mirrors', () => {
    expect(normalizePresentationConfig({ themePreset: 'awj-market' })).toMatchObject({
      themePreset: 'awj-market',
      primaryColor: '#0f766e',
    });
  });

  it('a stale/unknown preset (including a bad awj-market variant) still fails closed to AWJ Modern', () => {
    expect(normalizePresentationConfig({ themePreset: 'awj-market-v0' })).toMatchObject({
      themePreset: 'awj-modern',
      primaryColor: '#12372a',
    });
  });

  it('rejects javascript URLs and unverified badges as authority', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    const config = normalizePresentationConfig({
      verification: { requestedVerifiedLabel: true, sourceUrl: 'javascript:alert(1)' },
    });
    expect(config.verification.requestedVerifiedLabel).toBe(false);
    expect(config.verification.sourceUrl).toBe('');
  });

  it('normalizes SBC authentication as opaque text and defaults visibility off', () => {
    expect(
      normalizePresentationConfig({
        sbc: { authentication_number: '  000123  ', seal_token: '  token=AbC +/  ', show_in_storefront: true },
      }).sbc,
    ).toEqual({ authentication_number: '000123', seal_token: 'token=AbC +/', show_in_storefront: true });
    expect(normalizePresentationConfig({}).sbc).toEqual({
      authentication_number: '',
      seal_token: '',
      show_in_storefront: false,
    });
  });

  it('builds a WhatsApp link without sending', () => {
    expect(buildWhatsAppUrl('966551234567', 'hello')).toBe(
      'https://wa.me/966551234567?text=hello',
    );
  });

  it('CONTRACT-2: legacy key-shaped sections migrate with id = key and default backfill', () => {
    const config = normalizePresentationConfig({
      homepage: { sections: [{ key: 'hero', visible: false }] },
    });
    const hero = config.homepage.sections.find((s) => s.type === 'hero');
    expect(hero).toMatchObject({ id: 'hero', visible: false });
    expect(config.homepage.sections).toHaveLength(10);
    expect(config.homepage.sections.every((s) => s.id === s.type)).toBe(true);
  });

  it('CONTRACT-2: v2 keeps multi-instance sections and treats absence as delete', () => {
    const config = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          { id: 'banner-a', type: 'banner', visible: true },
          { id: 'hero', type: 'hero', visible: true },
          { id: 'banner-b', type: 'banner', visible: false },
        ],
      },
    });
    expect(config.homepage.sections.map((s) => s.id)).toEqual([
      'banner-a',
      'hero',
      'banner-b',
    ]);

    const deleted = normalizePresentationConfig({
      version: 2,
      homepage: { sections: [{ id: 'hero', type: 'hero', visible: true }] },
    });
    expect(deleted.homepage.sections.map((s) => s.type)).toEqual(['hero']);
  });

  it('CONTRACT-2: round-trip normalization is stable with no id churn', () => {
    const once = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          { id: 'b1', type: 'banner', visible: true },
          { id: 'hero', type: 'hero', visible: true },
        ],
      },
    });
    const twice = normalizePresentationConfig(JSON.parse(JSON.stringify(once)));
    expect(twice.homepage.sections).toEqual(once.homepage.sections);
  });

  it('CONTRACT-2: unknown types and duplicate ids are dropped deterministically', () => {
    const config = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          { id: 'x', type: 'evil-type', visible: true },
          { id: 'hero', type: 'hero', visible: false },
          { id: 'hero', type: 'hero', visible: true },
        ],
      },
    });
    expect(config.homepage.sections).toEqual([
      { id: 'hero', type: 'hero', visible: false },
    ]);
  });

  it('CUST-H3-2: accepts the verified tajawal-geist preset and fails closed to cairo-geist for unknown values', () => {
    expect(normalizePresentationConfig({ fontPreset: 'tajawal-geist' }).fontPreset).toBe(
      'tajawal-geist',
    );
    expect(normalizePresentationConfig({ fontPreset: 'cairo-geist' }).fontPreset).toBe(
      'cairo-geist',
    );
    expect(normalizePresentationConfig({ fontPreset: 'helvetica-geist' }).fontPreset).toBe(
      'cairo-geist',
    );
    expect(normalizePresentationConfig({}).fontPreset).toBe('cairo-geist');
    expect(FONT_PRESETS.map((preset) => preset.id)).toEqual(['cairo-geist', 'tajawal-geist']);
  });

  it('CUST-H3-2: resolves the full font-family stack deterministically and fails closed to Cairo', () => {
    expect(fontPresetFamilyStack('cairo-geist')).toBe(
      'var(--font-geist), var(--font-cairo), system-ui, sans-serif',
    );
    expect(fontPresetFamilyStack('tajawal-geist')).toBe(
      'var(--font-geist-tajawal), var(--font-tajawal), system-ui, sans-serif',
    );
    expect(fontPresetFamilyStack('bogus-value' as never)).toBe(
      'var(--font-geist), var(--font-cairo), system-ui, sans-serif',
    );
  });

  it('CUST-H3-2-FIX-1: the tajawal-geist stack never references Cairo or the shared --font-geist, so Cairo cannot shadow Tajawal', () => {
    const stack = fontPresetFamilyStack('tajawal-geist');
    expect(stack).not.toContain('--font-cairo');
    // Must use the dedicated Tajawal-fallback Geist instance, not the
    // Cairo-fallback one — reusing --font-geist here would resolve Arabic
    // to Cairo via Geist's own baked-in fallback before Tajawal is reached.
    expect(stack).toContain('--font-geist-tajawal');
    expect(stack).not.toMatch(/var\(--font-geist\),/);
  });

  it('CUST-H3-2: presentationCssVars is unaffected by font preset — color/radius only', () => {
    const vars = presentationCssVars('#1e3a5f', 'subtle');
    expect(vars['--store-primary']).toBe('#1e3a5f');
    expect(vars['--store-radius']).toBe('0.5rem');
    expect(vars).not.toHaveProperty('--store-font-arabic');
  });

  it('keeps per-instance content without accepting offer or price fields', () => {
    const config = normalizePresentationConfig({
      version: 2,
      homepage: {
        sections: [
          {
            id: 'banner-a',
            type: 'banner',
            visible: true,
            content: {
              title: 'عرض',
              ctaHref: '/products',
              imageUrl: 'javascript:alert(1)',
            },
          },
          {
            id: 'offers-a',
            type: 'offers',
            visible: true,
            content: { discountPercent: 20 },
          },
        ],
      },
    });
    expect(config.homepage.sections[0].content).toMatchObject({
      title: 'عرض',
      ctaHref: '/products',
      imageUrl: null,
    });
    expect(config.homepage.sections[1].content).toBeUndefined();
  });
});

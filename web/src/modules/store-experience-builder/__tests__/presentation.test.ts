import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig } from '../presentation/config';
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

  it('rejects javascript URLs and unverified badges as authority', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    const config = normalizePresentationConfig({
      verification: { requestedVerifiedLabel: true, sourceUrl: 'javascript:alert(1)' },
    });
    expect(config.verification.requestedVerifiedLabel).toBe(true);
    expect(config.verification.sourceUrl).toBe('');
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
});

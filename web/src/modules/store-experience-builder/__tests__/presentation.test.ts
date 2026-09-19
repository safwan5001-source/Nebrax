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
});

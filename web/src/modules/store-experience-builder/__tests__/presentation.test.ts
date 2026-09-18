import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_CONFIG, normalizePresentationConfig } from '../presentation/config';
import { BUSINESS_VERIFICATION_CAPABILITY, PUBLISH_CAPABILITY, THEME_PERSISTENCE_CAPABILITY } from '../presentation/capabilities';
import { buildWhatsAppUrl, sanitizeExternalUrl } from '../presentation/urls';

describe('web presentation contract', () => {
  it('fails closed to AWJ Modern defaults', () => {
    expect(normalizePresentationConfig()).toEqual(DEFAULT_PRESENTATION_CONFIG);
    expect(THEME_PERSISTENCE_CAPABILITY).toBe('design_only');
    expect(PUBLISH_CAPABILITY).toBe('gated');
    expect(BUSINESS_VERIFICATION_CAPABILITY).toBe('gated');
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

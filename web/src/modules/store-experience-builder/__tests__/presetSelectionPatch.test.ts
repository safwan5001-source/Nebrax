import { describe, expect, it } from 'vitest';
import { DEFAULT_PRESENTATION_CONFIG, presetSelectionPatch } from '../presentation/config';
import { THEME_PRESETS } from '../presentation/tokens';

const market = THEME_PRESETS.find((preset) => preset.id === 'awj-market')!;
const navy = THEME_PRESETS.find((preset) => preset.id === 'navy')!;

describe('presetSelectionPatch — AWJ Market starting bundle (Master Spec §29)', () => {
  it('selecting AWJ Market from another preset applies the compact starting bundle once', () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG };
    const patch = presetSelectionPatch(config, market);

    expect(patch).toMatchObject({
      themePreset: 'awj-market',
      primaryColor: '#0f766e',
      density: 'compact',
      productCard: 'compact',
      header: { ...config.header, style: 'compact' },
    });
  });

  it('re-selecting AWJ Market while already active does not re-force compact settings', () => {
    const alreadyMarket = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: 'awj-market' as const,
      primaryColor: market.primary,
      density: 'comfortable' as const, // merchant switched back after the initial bundle
      productCard: 'standard' as const,
    };
    const patch = presetSelectionPatch(alreadyMarket, market);

    expect(patch).toEqual({ themePreset: 'awj-market', primaryColor: market.primary });
    expect(patch.density).toBeUndefined();
    expect(patch.productCard).toBeUndefined();
    expect(patch.header).toBeUndefined();
  });

  it('selecting a plain preset (no bundle) only changes theme + color, exactly as before', () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG };
    const patch = presetSelectionPatch(config, navy);

    expect(patch).toEqual({ themePreset: 'navy', primaryColor: navy.primary });
  });

  it('the bundle patch never touches unrelated merchant fields (it is a shallow partial)', () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      branding: { ...DEFAULT_PRESENTATION_CONFIG.branding, displayName: 'My Store' },
      footer: { ...DEFAULT_PRESENTATION_CONFIG.footer, tagline: 'Fresh daily' },
    };
    const patch = presetSelectionPatch(config, market);

    expect(patch).not.toHaveProperty('branding');
    expect(patch).not.toHaveProperty('footer');
    expect(patch).not.toHaveProperty('homepage');
  });
});

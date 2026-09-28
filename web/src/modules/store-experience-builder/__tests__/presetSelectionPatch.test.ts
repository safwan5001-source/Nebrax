import { describe, expect, it } from 'vitest';
import { matchPreset } from '../ControlPanels';
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

describe('matchPreset — a custom color keeps the active preset (Codex P1 finding on PR #1084)', () => {
  it('an unmatched hex keeps the current preset instead of resetting to awj-modern', () => {
    expect(matchPreset('#123456', 'awj-market')).toBe('awj-market');
    expect(matchPreset('#123456', 'navy')).toBe('navy');
  });

  it('a hex that matches a known swatch still switches to that preset', () => {
    expect(matchPreset(market.primary, 'navy')).toBe('awj-market');
    expect(matchPreset(navy.primary, 'awj-market')).toBe('navy');
  });

  it('matching is case-insensitive, exactly as before', () => {
    expect(matchPreset(market.primary.toUpperCase(), 'navy')).toBe('awj-market');
  });
});

describe('color input -> matchPreset -> presetSelectionPatch (Codex P2 finding on PR #1084)', () => {
  it('typing a hex that exactly matches Market applies the same starting bundle as clicking its swatch', () => {
    const config = { ...DEFAULT_PRESENTATION_CONFIG, themePreset: 'navy' as const };
    const matched = matchPreset(market.primary, config.themePreset);
    const patch = presetSelectionPatch(config, { id: matched, primary: market.primary });

    expect(patch).toMatchObject({
      themePreset: 'awj-market',
      density: 'compact',
      productCard: 'compact',
      header: { ...config.header, style: 'compact' },
    });
  });

  it('typing an unmatched hex while on Market keeps the bundle untouched (only the color changes)', () => {
    const config = {
      ...DEFAULT_PRESENTATION_CONFIG,
      themePreset: 'awj-market' as const,
      density: 'compact' as const,
      productCard: 'compact' as const,
    };
    const matched = matchPreset('#123456', config.themePreset);
    const patch = presetSelectionPatch(config, { id: matched, primary: '#123456' });

    expect(patch).toEqual({ themePreset: 'awj-market', primaryColor: '#123456' });
  });
});

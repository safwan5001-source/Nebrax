import { describe, expect, it } from 'vitest';
import { THEME_PRESETS } from '@/modules/store-experience-builder/presentation/tokens';
import { THEME_REGISTRY, availableThemes, isRuntimeBackedTheme } from './theme-registry';

describe('Theme Gallery registry', () => {
  it('keeps runtime-backed themes limited to registered presentation presets', () => {
    const runtimePresetIds = new Set(THEME_PRESETS.map((preset) => preset.id));

    for (const theme of THEME_REGISTRY) {
      if (theme.status === 'available') {
        expect(theme.presetId).not.toBeNull();
        expect(runtimePresetIds.has(theme.presetId!)).toBe(true);
        expect(isRuntimeBackedTheme(theme)).toBe(true);
      }
    }
  });

  it('does not expose planned themes as runtime presets', () => {
    const planned = THEME_REGISTRY.filter((theme) => theme.status === 'planned');

    // No planned entries remain: the floral theme shipped as AWJ Bloom (FLOWERS-H15).
    expect(planned).toEqual([]);
    expect(planned.every((theme) => theme.presetId === null)).toBe(true);
    expect(planned.every((theme) => !isRuntimeBackedTheme(theme))).toBe(true);
  });

  it('ships AWJ Modern, AWJ Market and AWJ Bloom as the available gallery themes', () => {
    expect(availableThemes().map((theme) => theme.id)).toEqual(['awj-modern', 'awj-market', 'awj-bloom']);
    expect(THEME_REGISTRY.find((theme) => theme.id === 'awj-modern')).toMatchObject({
      status: 'available',
      presetId: 'awj-modern',
    });
    expect(THEME_REGISTRY.find((theme) => theme.id === 'awj-market')).toMatchObject({
      status: 'available',
      presetId: 'awj-market',
    });
    expect(THEME_REGISTRY.find((theme) => theme.id === 'awj-bloom')).toMatchObject({
      status: 'available',
      presetId: 'awj-bloom',
      category: 'floral',
    });
  });
});

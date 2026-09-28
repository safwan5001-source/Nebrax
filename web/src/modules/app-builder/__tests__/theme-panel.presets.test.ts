import { describe, expect, it } from 'vitest';
import ar from '../../../messages/ar.json';
import en from '../../../messages/en.json';
import { THEME_PRESETS } from '../../store-experience-builder/presentation/tokens';

/**
 * Regression coverage for the Codex P2 finding on PR #1084: `theme-panel.tsx`
 * (App Builder) renders every entry of the shared `THEME_PRESETS` registry
 * and looks up `appBuilder.builder.theme.preset.<id>` for its label. Adding a
 * preset to the shared registry without adding this translation leaves the
 * App Builder's own Theme panel showing a missing-message fallback.
 */
describe('App Builder theme preset translations stay in sync with THEME_PRESETS', () => {
  it('every preset has an English and Arabic label', () => {
    const enPresets = en.appBuilder.builder.theme.preset as Record<string, string>;
    const arPresets = ar.appBuilder.builder.theme.preset as Record<string, string>;

    for (const preset of THEME_PRESETS) {
      expect(enPresets[preset.id], `en label for "${preset.id}"`).toBeTruthy();
      expect(arPresets[preset.id], `ar label for "${preset.id}"`).toBeTruthy();
    }
  });

  it('includes awj-market specifically', () => {
    expect(en.appBuilder.builder.theme.preset['awj-market']).toBe('AWJ Market');
    expect(ar.appBuilder.builder.theme.preset['awj-market']).toBeTruthy();
  });
});

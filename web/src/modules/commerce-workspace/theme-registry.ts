import { THEME_PRESETS, type ThemePresetId } from '@/modules/store-experience-builder/presentation/tokens';

export type ThemeRegistryStatus = 'available' | 'planned';

export type ThemeRegistryEntry = {
  id: string;
  presetId: ThemePresetId | null;
  nameKey: string;
  descriptionKey: string;
  status: ThemeRegistryStatus;
  official: boolean;
  category: 'general' | 'retail' | 'floral';
};

/**
 * Theme Gallery product registry.
 *
 * This is intentionally metadata only. Runtime-valid theme presets remain
 * controlled by the existing presentation allow-lists in web/storefront/PHP.
 * Planned entries MUST NOT expose a presetId until all runtime allow-lists are
 * updated atomically and the theme implementation is production-ready.
 */
export const THEME_REGISTRY: readonly ThemeRegistryEntry[] = [
  {
    id: 'awj-modern',
    presetId: 'awj-modern',
    nameKey: 'themeNameAwjModern',
    descriptionKey: 'themeDescriptionAwjModern',
    status: 'available',
    official: true,
    category: 'general',
  },
  {
    id: 'awj-market',
    presetId: null,
    nameKey: 'themeNameAwjMarket',
    descriptionKey: 'themeDescriptionAwjMarket',
    status: 'planned',
    official: true,
    category: 'retail',
  },
  {
    id: 'boutique-floral-01',
    presetId: null,
    nameKey: 'themeNameBoutiqueFloral',
    descriptionKey: 'themeDescriptionBoutiqueFloral',
    status: 'planned',
    official: true,
    category: 'floral',
  },
] as const;

const RUNTIME_PRESET_IDS = new Set<string>(THEME_PRESETS.map((preset) => preset.id));

export function isRuntimeBackedTheme(theme: ThemeRegistryEntry): theme is ThemeRegistryEntry & { presetId: ThemePresetId } {
  return theme.status === 'available' && theme.presetId !== null && RUNTIME_PRESET_IDS.has(theme.presetId);
}

export function availableThemes(): ThemeRegistryEntry[] {
  return THEME_REGISTRY.filter(isRuntimeBackedTheme);
}

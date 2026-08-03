import type { CSSProperties } from 'react';
import type { DocumentTheme, ThemeId, ThemeTokens } from '../types';

/**
 * ثيمات المستند — لون هوية + تباين + خلفية خفيفة. تُسقَط إلى متغيّرات CSS
 * (`--doc-brand*`) فتتكيّف كل القوالب تلقائياً دون تكرار.
 * الثيم الافتراضي `blue` يطابق لون هوية نبراس (#1E40AF).
 */
const THEME_TOKENS: Record<Exclude<ThemeId, 'custom'>, ThemeTokens> = {
  blue:   { brand: '#1e40af', brandContrast: '#ffffff', brandSoft: '#eef2ff' },
  green:  { brand: '#15803d', brandContrast: '#ffffff', brandSoft: '#ecfdf5' },
  orange: { brand: '#c2410c', brandContrast: '#ffffff', brandSoft: '#fff7ed' },
  purple: { brand: '#6d28d9', brandContrast: '#ffffff', brandSoft: '#f5f3ff' },
  gray:   { brand: '#374151', brandContrast: '#ffffff', brandSoft: '#f3f4f6' },
  black:  { brand: '#111827', brandContrast: '#ffffff', brandSoft: '#f3f4f6' },
};

export const DEFAULT_THEME: ThemeId = 'blue';

/** الثيمات القابلة للاختيار في الواجهة (عدا custom). */
export const THEME_IDS: ThemeId[] = ['blue', 'green', 'orange', 'purple', 'gray', 'black'];

/** لون الهوية لثيم (لعرض نقطة اللون في المنتقي). */
export function themeSwatch(id: ThemeId): string {
  return getTheme(id).tokens.brand;
}

export function getTheme(id: ThemeId, custom?: ThemeTokens): DocumentTheme {
  if (id === 'custom' && custom) return { id: 'custom', tokens: custom };
  const tokens = THEME_TOKENS[id as Exclude<ThemeId, 'custom'>] ?? THEME_TOKENS.blue;
  return { id, tokens };
}

/** متغيّرات CSS تُطبَّق على جذر المستند فتَرِثها الأقسام. */
export function themeCssVars(theme: DocumentTheme): CSSProperties {
  return {
    '--doc-brand': theme.tokens.brand,
    '--doc-brand-contrast': theme.tokens.brandContrast,
    '--doc-brand-soft': theme.tokens.brandSoft,
  } as CSSProperties;
}

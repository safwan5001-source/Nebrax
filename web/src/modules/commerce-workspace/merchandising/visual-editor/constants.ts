/**
 * AWJ-VD-H1 / VD-3 — literals kept out of TSX (the semantic-token drift ratchet scans `.tsx` for raw colours).
 */

import type { DesignContext } from '@/modules/store-experience-builder/presentation/section-design-resolve';

/**
 * `ColourField` wants a design context to resolve palette *roles*. The facet identity takes plain `#rrggbb` only
 * (`hexOnly`), so no role is ever resolved and these values are never drawn; they only satisfy the type.
 */
export const COLOUR_FIELD_CONTEXT = (dir: 'ltr' | 'rtl'): DesignContext => ({
  primaryColor: '#000000',
  accentColor: null,
  dir,
});

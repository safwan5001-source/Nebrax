/**
 * Shared fixtures for the facet visual editor tests: raw `GET facets` rows (the wire shape, run through the real
 * mapper so the tests exercise it too).
 */

import { type Facet, mapFacet } from '../client';

export const MEDIA_A = '0b9d6a3e-1f5c-4a8e-9a47-2c1d3e4f5a6b';
export const MEDIA_B = '7c1d3e4f-5a6b-4c8d-9e0f-1a2b3c4d5e6f';

export const PREVIEW_A = {
  thumb_160: 'https://signed.example/a-160.webp?sig=1',
  thumb_320: 'https://signed.example/a-320.webp?sig=1',
};

type Raw = Record<string, unknown>;

export function rawValue(over: Raw = {}): Raw {
  return {
    id: 'v2',
    slug: 'birthday',
    name: 'Birthday',
    name_en: 'Birthday EN',
    sort_order: 1,
    is_active: true,
    product_count: 2,
    visual: null,
    visual_version: null,
    visual_preview: null,
    ...over,
  };
}

export function rawFacet(over: Raw = {}): Raw {
  return {
    id: 'f1',
    key: 'occasion',
    system_key: 'occasion',
    name: 'Occasion',
    name_en: 'Occasion EN',
    sort_order: 0,
    is_active: true,
    visual: null,
    visual_version: null,
    visual_preview: null,
    values: [
      rawValue({ id: 'v1', slug: 'wedding', name: 'Wedding', name_en: null, sort_order: 0, product_count: 0 }),
      rawValue(),
      rawValue({ id: 'v3', slug: 'graduation', name: 'Graduation', name_en: null, sort_order: 2, product_count: 0 }),
    ],
    ...over,
  };
}

export function facetOf(over: Raw = {}): Facet {
  const facet = mapFacet(rawFacet(over));
  if (!facet) throw new Error('fixture facet did not map');
  return facet;
}

/**
 * MOBILE-PREVIEW-4 — the exact component/action identifier sets the shipped Flutter runtime
 * implements, mirroring `mobile/lib/schema/registry_identifiers.dart`'s `RuntimeCapabilities`.
 * Kept as a literal, tested-against-the-shared-fixture constant (not re-derived from
 * `canvas.tsx`'s `switch` at runtime) so `registry-identifiers.test.ts` can assert set equality
 * against `contracts/app-builder/registry-identifiers.v1.json` independently of how `canvas.tsx`
 * happens to be structured — the same reason `mobile/test/registry/component_registry_test.dart`
 * asserts `ComponentRegistry.builders.keys` against `RuntimeCapabilities.components.keys` rather
 * than inferring one from the other.
 */
export const KNOWN_COMPONENT_TYPES = [
  'Page',
  'Section',
  'Text',
  'Image',
  'ProductList',
  'ProductCard',
  'ProductDetail',
  'Price',
  'VariantSelector',
  'Quantity',
  'AddToCart',
  'CartList',
  'CartSummary',
  'Button',
  'NavigationTarget',
] as const;

/**
 * إضافات الجيل 1.2.0 (AD-02 / S11) — منفصلة عن القائمة أعلاه (الجيل 1.0.0 المجمَّد) كما في الخادم (`*_V120`) وDart (`*V120`)،
 * ويتحقق منها الاختبار مقابل أقسام `*_v120` من العقد المشترك نفسه.
 */
export const KNOWN_COMPONENT_TYPES_V120 = ['CategoryList'] as const;

export type KnownComponentType = (typeof KNOWN_COMPONENT_TYPES)[number] | (typeof KNOWN_COMPONENT_TYPES_V120)[number];

export const KNOWN_ACTION_TYPES = [
  'navigate',
  'openProduct',
  'addToCart',
  'updateCartQuantity',
  'removeCartItem',
  'refresh',
] as const;

export const KNOWN_ACTION_TYPES_V120 = ['openCategory', 'openSearch'] as const;

export type KnownActionType = (typeof KNOWN_ACTION_TYPES)[number] | (typeof KNOWN_ACTION_TYPES_V120)[number];

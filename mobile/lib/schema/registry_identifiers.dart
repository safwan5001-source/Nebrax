/// Fixed, versioned identifiers for the AWJ Mobile Runtime's Component and
/// Action Registries (horizon MR-04/MR-05).
///
/// This file only knows *identifiers and capability versions* — never how to
/// render a component or dispatch an action. That typed rendering/dispatch
/// layer is MOBILE-RUNTIME-3's Component + Action Registry. Keeping the
/// identifier allowlist here lets the schema parser/compatibility kernel
/// (MOBILE-RUNTIME-2) reject unknown/unsupported types on its own, without
/// depending on the rendering layer existing yet.
class RuntimeCapabilities {
  const RuntimeCapabilities._();

  /// Component type name -> capability version currently implemented by
  /// *this* runtime build. A version bump means a breaking contract change
  /// to that component (`RUNTIME_COMPATIBILITY_V1.md` §23) — never reuse a
  /// version number after changing a component's binding/event semantics.
  static const Map<String, int> components = {
    'Page': 1,
    'Section': 1,
    'Text': 1,
    'Image': 1,
    'ProductList': 1,
    'ProductCard': 1,
    'ProductDetail': 1,
    'Price': 1,
    'VariantSelector': 1,
    'Quantity': 1,
    'AddToCart': 1,
    'CartList': 1,
    'CartSummary': 1,
    'Button': 1,
    'NavigationTarget': 1,
  };

  /// Action type name -> capability version (horizon MR-05's minimal
  /// allowlist). Action contracts are stricter than component contracts —
  /// never reuse a version number after changing authorization, idempotency,
  /// input meaning, or side effects (`RUNTIME_COMPATIBILITY_V1.md` §24).
  static const Map<String, int> actions = {
    'navigate': 1,
    'openProduct': 1,
    'addToCart': 1,
    'updateCartQuantity': 1,
    'removeCartItem': 1,
    'refresh': 1,
  };
}

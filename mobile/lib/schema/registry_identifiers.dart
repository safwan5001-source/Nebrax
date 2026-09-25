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

  /// Native (non-renderable, non-dispatchable) capabilities this runtime
  /// build can prove — distinct from [components]/[actions] because a
  /// capability like push routing is never a schema component nor an
  /// action type, yet a schema may still need to assert it as a
  /// prerequisite (MR-15: "a remote Experience must never require a native
  /// capability before a supporting binary is safely available under the
  /// compatibility policy"). [CapabilityManifest.namedCapabilityVersion]
  /// checks this map exactly like the other two, so `requiredCapabilities`
  /// works identically whether it names a component, an action, or one of
  /// these.
  ///
  /// `push.notifications` (MOBILE-RUNTIME-8, horizon MR-09) is this
  /// runtime's notification-tap-to-navigation boundary (`lib/push/`) — it
  /// says nothing about which transport delivers a push, only that this
  /// build can safely route one that arrives.
  static const Map<String, int> nativeCapabilities = {
    'push.notifications': 1,
  };

  /// Data-resource identity space this runtime build actually consumes via a
  /// real `binding` resolution (`APP-BUILDER-13`/`17`, `ADR-01`) — mirrors
  /// `RuntimeCapabilities::DATA_RESOURCES` (PHP) in *identifier space* (same
  /// resource ids), not necessarily in *value* — see the staged-rollout note
  /// below, which this deliberately departs from the "flip both sides in the
  /// same task" default.
  ///
  /// **APP-BUILDER-17 slice 3b**: this build's own bundled Home/Cart
  /// schemas (`kHomeSchemaJson`/`kCartSchemaJson`) now declare real
  /// `binding`/`binding.collect` nodes, and `HomeScreen`/`CartScreen` now
  /// resolve them through the real `resolveNodeBindings` pipeline against a
  /// real `CommerceClient.fetchBindingResource()` call — this is what these
  /// two identifiers being non-empty proves *this build* can do.
  ///
  /// **`RuntimeCapabilities::DATA_RESOURCES` (PHP) deliberately stays empty**
  /// — this is a staged, owner-directed proof sequence
  /// (`docs/autonomous-engineering/CURRENT-STATE.md`'s slice 3b entry), not
  /// the flip described in the older comment this replaces. Safety
  /// reasoning, evidence-checked before this change:
  /// - PHP's constant governs what the *server* will let a tenant's
  ///   App-Builder-published Experience require. It staying empty means the
  ///   server still refuses to publish anything requiring `binding`/
  ///   `binding.collect` — no tenant, on any client version, can be served a
  ///   schema this capability space would need to render, regardless of
  ///   what any single mobile build declares.
  /// - No live fetch of a published Experience is wired into this build's
  ///   boot path yet (`resolveRealStartup()` — `APP-BUILDER-19` — is built
  ///   and tested but not called from `AwjRuntimeShell`/`HomeScreen`/
  ///   `CartScreen`). The only schema this build ever resolves is its own
  ///   bundled `kHomeSchemaJson`/`kCartSchemaJson` — the same artifact, same
  ///   commit, same release as this very manifest. There is no cross-version
  ///   remote-schema risk to this specific flip.
  /// - An older, already-installed build's own compiled-in `dataResources`
  ///   is fixed at *its* build time — a newer build declaring more here
  ///   cannot retroactively change what an older install accepts. This is
  ///   the same per-build capability divergence already established and
  ///   tested for `nativeCapabilities['push.notifications']` (MR-15:
  ///   "iOS/Android push rollout can diverge").
  /// - The full, original "flip both sides together" condition — a shipped,
  ///   verified mobile release *and* the live publish/fetch loop actually
  ///   wired in — remains the gate for the PHP-side flip and for
  ///   `APP-BUILDER-18`/`20`'s own promotion. This Dart-only step exists
  ///   specifically to *produce* that evidence, not to bypass it.
  static const Map<String, int> dataResources = {'commerce.products': 1, 'commerce.cart': 1};

  /// Schema-feature identity space (not a component, action, or native
  /// capability) this runtime build actually evaluates —
  /// `APP-BUILDER-16`/`17`, `ADR-01`. Mirrors
  /// `RuntimeCapabilities::SCHEMA_FEATURES` (PHP) in identifier space only —
  /// see [dataResources]'s doc comment for the full staged-rollout reasoning
  /// this shares exactly.
  ///
  /// **`'binding.collect'` is now proven and declared** — `CartList`'s
  /// bundled binding uses it and `CompatibilityResolver`/
  /// `resolveNodeBindings` resolve it for real (`APP-BUILDER-17` slice 3b).
  /// **`'visibility'` stays absent, deliberately**: neither bundled schema
  /// declares a `visibility` node (nothing to prove yet), and adding one
  /// merely to exercise the capability would be inventing a use case ahead
  /// of a real one — the same restraint already recorded when
  /// `evaluateVisibility`/`pruneInvisible` were built in slice 3. PHP's
  /// `RuntimeCapabilities::SCHEMA_FEATURES` stays empty for both keys, for
  /// the identical reasons documented on [dataResources].
  static const Map<String, int> schemaFeatures = {'binding.collect': 1};
}

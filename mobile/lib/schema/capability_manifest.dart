import 'registry_identifiers.dart';
import 'schema_version.dart';

/// A platform a capability manifest describes.
///
/// RUNTIME_COMPATIBILITY_V1.md §26: iOS and Android may temporarily support
/// different capability sets. Always construct one manifest per platform
/// build — never assume "the app" has a single shared capability set.
enum RuntimePlatform { ios, android }

/// What a specific runtime build can actually execute
/// (RUNTIME_COMPATIBILITY_V1.md §4's capability-manifest concept).
///
/// This models a runtime's *evidence*, not a schema's *requirements* —
/// [AppSchema] carries the latter. [CompatibilityResolver] compares the two.
class CapabilityManifest {
  final RuntimePlatform platform;
  final SchemaVersion runtimeVersion;
  final SchemaVersion minSupportedSchemaVersion;
  final SchemaVersion maxSupportedSchemaVersion;
  final Map<String, int> components;
  final Map<String, int> actions;
  final Map<String, int> nativeCapabilities;

  /// `APP-BUILDER-13`/`17` (`ADR-01`) — what this runtime build actually
  /// consumes from `DataResourceRegistry` via a real `binding` resolution.
  /// See `RuntimeCapabilities.dataResources`'s own doc comment for why this
  /// stays empty until slice 3.
  final Map<String, int> dataResources;

  /// `APP-BUILDER-16`/`17` (`ADR-01`) — schema features (e.g. `visibility`)
  /// this runtime build actually evaluates. See
  /// `RuntimeCapabilities.schemaFeatures`'s own doc comment for why this
  /// stays empty until slice 3.
  final Map<String, int> schemaFeatures;

  const CapabilityManifest({
    required this.platform,
    required this.runtimeVersion,
    required this.minSupportedSchemaVersion,
    required this.maxSupportedSchemaVersion,
    required this.components,
    required this.actions,
    this.nativeCapabilities = const {},
    this.dataResources = const {},
    this.schemaFeatures = const {},
  });

  /// This exact runtime build's manifest — the only constructor production
  /// code should use. Tests construct alternate manifests directly to
  /// simulate older/newer runtimes and iOS/Android capability divergence
  /// without needing two separate app builds.
  factory CapabilityManifest.current(RuntimePlatform platform) {
    return CapabilityManifest(
      platform: platform,
      runtimeVersion: const SchemaVersion(1, 0, 0),
      minSupportedSchemaVersion: const SchemaVersion(1, 0, 0),
      maxSupportedSchemaVersion: const SchemaVersion(1, 0, 0),
      components: RuntimeCapabilities.components,
      actions: RuntimeCapabilities.actions,
      nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
      dataResources: RuntimeCapabilities.dataResources,
      schemaFeatures: RuntimeCapabilities.schemaFeatures,
    );
  }

  int? componentVersion(String type) => components[type];

  int? actionVersion(String type) => actions[type];

  /// `APP-BUILDER-13`/`17` — mirrors [componentVersion]/[actionVersion] for
  /// the data-resource identity space.
  int? resourceVersion(String id) => dataResources[id];

  /// `APP-BUILDER-16`/`17` — mirrors [resourceVersion] for the schema-feature
  /// identity space (e.g. `'visibility'`).
  int? schemaFeatureVersion(String key) => schemaFeatures[key];

  /// A required-capability key (`AppSchema.requiredCapabilities`) may name
  /// either a component or an action identifier — the horizon's own example
  /// (`commerce.productGrid`, `commerce.cart.add`) illustrates a coarser
  /// dotted-namespace style, but RUNTIME_COMPATIBILITY_V1.md §4/§36
  /// explicitly leaves "exact capability-manifest format" and "semantic
  /// version vs integer capability versions" open. MOBILE-RUNTIME-2's V1
  /// choice: `requiredCapabilities` names the *same* component/action
  /// identifiers already used inside the component tree (never a second,
  /// unimplemented namespace) — a schema can declare it needs, say,
  /// `"addToCart": 1` document-wide as a defensive/explicit assertion,
  /// checked against the exact same registry a per-node action reference
  /// would be. A future task may introduce a distinct coarser capability
  /// namespace if a real need for one appears (e.g. bundling several
  /// components/actions behind one named feature flag) — do not assume one
  /// is required just because the horizon's illustrative example used
  /// dotted names.
  /// (`commerce.productGrid`, `commerce.cart.add`) does not distinguish the
  /// two namespaces syntactically, so this checks both. MOBILE-RUNTIME-8
  /// added the third namespace this doc comment anticipated
  /// ([nativeCapabilities]) once a real need — push routing — appeared;
  /// this also checks that map, in the same undistinguished style.
  /// `APP-BUILDER-17` slice 2 adds the fourth and fifth namespaces
  /// ([dataResources]/[schemaFeatures]) for the exact same reason — matches
  /// `CapabilityManifest::namedCapabilityVersion` (PHP) fallback order
  /// literally.
  int? namedCapabilityVersion(String key) =>
      actions[key] ?? components[key] ?? nativeCapabilities[key] ?? dataResources[key] ?? schemaFeatures[key];
}

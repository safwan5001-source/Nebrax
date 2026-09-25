import 'app_schema.dart';
import 'capability_manifest.dart';
import 'visibility_vocabulary.dart';

/// Why a schema was found incompatible with a runtime's capability manifest.
enum IncompatibilityReason {
  schemaVersionTooNew,
  schemaVersionTooOld,
  runtimeTooOld,
  missingRequiredCapability,
}

/// Records that an optional component (or a subtree rooted at one) was
/// safely omitted because the runtime does not support it or its action.
class FallbackNote {
  final String componentId;
  final String componentType;
  final String reason;

  const FallbackNote({required this.componentId, required this.componentType, required this.reason});
}

/// The result of resolving an [AppSchema] against a [CapabilityManifest].
sealed class CompatibilityResult {
  const CompatibilityResult();
}

/// The schema can be rendered by this runtime, possibly with some optional
/// components/subtrees safely omitted (listed in [fallbacks]).
///
/// [pages] is the pruned tree — callers must render *this*, not the
/// original [AppSchema.pages], so an omitted optional component can never
/// silently reappear.
class RenderableExperience extends CompatibilityResult {
  final AppSchema schema;
  final Map<String, SchemaComponent> pages;
  final List<FallbackNote> fallbacks;

  const RenderableExperience({required this.schema, required this.pages, required this.fallbacks});
}

/// The schema cannot be safely rendered at all by this runtime. Per
/// RUNTIME_COMPATIBILITY_V1.md §8 ("fail-closed rules") and the horizon's
/// compatibility contract, callers must show a controlled
/// incompatible/unavailable/update-required state — never guess, never
/// partially render, never silently downgrade a sensitive capability.
class IncompatibleExperience extends CompatibilityResult {
  final IncompatibilityReason reason;
  final String message;

  const IncompatibleExperience({required this.reason, required this.message});
}

/// Resolves whether/how a runtime with a given [CapabilityManifest] may
/// render a given [AppSchema], per RUNTIME_COMPATIBILITY_V1.md §3/§6/§8-9
/// and the horizon's own compatibility contract
/// (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §6).
///
/// This is a pure function: the same schema + the same manifest always
/// produce the same result. No network, no I/O, no side effects —
/// deliberately, so it is trivially unit-testable and so later tasks
/// (startup, rollback selection, preview) can all call the same one
/// authority instead of re-implementing the rule.
class CompatibilityResolver {
  const CompatibilityResolver();

  CompatibilityResult resolve(AppSchema schema, CapabilityManifest manifest) {
    if (schema.schemaVersion > manifest.maxSupportedSchemaVersion) {
      return IncompatibleExperience(
        reason: IncompatibilityReason.schemaVersionTooNew,
        message: 'schema ${schema.schemaVersion} is newer than this runtime supports '
            '(max ${manifest.maxSupportedSchemaVersion})',
      );
    }
    if (schema.schemaVersion < manifest.minSupportedSchemaVersion) {
      return IncompatibleExperience(
        reason: IncompatibilityReason.schemaVersionTooOld,
        message: 'schema ${schema.schemaVersion} is older than this runtime supports '
            '(min ${manifest.minSupportedSchemaVersion})',
      );
    }
    if (manifest.runtimeVersion < schema.minRuntimeVersion) {
      return IncompatibleExperience(
        reason: IncompatibilityReason.runtimeTooOld,
        message: 'runtime ${manifest.runtimeVersion} is older than schema requires '
            '(min ${schema.minRuntimeVersion})',
      );
    }
    for (final entry in schema.requiredCapabilities.entries) {
      final have = manifest.namedCapabilityVersion(entry.key);
      if (have == null || have < entry.value) {
        return IncompatibleExperience(
          reason: IncompatibilityReason.missingRequiredCapability,
          message: 'required capability "${entry.key}" v${entry.value} is not available '
              '(have: ${have ?? 'none'})',
        );
      }
    }

    final fallbacks = <FallbackNote>[];
    final resolvedPages = <String, SchemaComponent>{};
    for (final entry in schema.pages.entries) {
      final resolvedRoot = _resolveComponent(entry.value, manifest, fallbacks);
      if (resolvedRoot == null) {
        // A page's own root is never marked optional by the parser (root
        // must be type "Page", always in the current registry) — reaching
        // null here means a *required* descendant failed closed, which
        // must fail the whole document per the fail-closed rule, not just
        // silently drop one page.
        return IncompatibleExperience(
          reason: IncompatibilityReason.missingRequiredCapability,
          message: 'page "${entry.key}" contains a required, unsupported component or action',
        );
      }
      resolvedPages[entry.key] = resolvedRoot;
    }

    return RenderableExperience(
      schema: schema,
      pages: Map.unmodifiable(resolvedPages),
      fallbacks: List.unmodifiable(fallbacks),
    );
  }

  /// Returns the resolved (possibly fallback-pruned) node, or `null` when
  /// this exact node's component type or action is unsupported. The caller
  /// decides fail-vs-fallback using the *original* node's own `optional`
  /// flag — marking a component optional makes its entire subtree a single
  /// safely-omittable unit, matching how a real UI section works (dropping
  /// an optional section is safe even if something inside it happens to be
  /// individually marked required *relative to that section*).
  SchemaComponent? _resolveComponent(
    SchemaComponent node,
    CapabilityManifest manifest,
    List<FallbackNote> fallbacks,
  ) {
    final unsupportedHere = manifest.componentVersion(node.type) == null ||
        (node.action != null && manifest.actionVersion(node.action!.type) == null) ||
        (node.binding != null && !_bindingSupported(node.binding!, manifest)) ||
        (node.visibility != null && !_visibilitySupported(node.visibility!, manifest));
    if (unsupportedHere) return null;

    final resolvedChildren = <SchemaComponent>[];
    for (final child in node.children) {
      final resolvedChild = _resolveComponent(child, manifest, fallbacks);
      if (resolvedChild == null) {
        if (child.optional) {
          fallbacks.add(FallbackNote(
            componentId: child.id,
            componentType: child.type,
            reason: 'unsupported component/action, or an unsupported required '
                'descendant within this optional subtree',
          ));
          continue;
        }
        return null; // a required subtree failed closed -> this node fails closed too.
      }
      resolvedChildren.add(resolvedChild);
    }

    return node.withChildren(resolvedChildren);
  }

  /// `APP-BUILDER-17` slice 2 — capability gating only, mirroring
  /// `CompatibilityResolver::bindingSupported`'s (PHP) *capability* check.
  ///
  /// The fuller structural checks that PHP method also does — the resource
  /// exists in `DataResourceRegistry`, the component's own registry entry
  /// allows binding to it, `itemProps`/`query` name fields/params the
  /// resource actually exposes — depend on a real Data Resource Registry +
  /// Component Registry existing on this runtime. Neither exists in Dart
  /// yet, and since [CapabilityManifest.dataResources] stays empty until
  /// slice 3 (see its own doc comment), every one of those structural
  /// checks would be moot today regardless of their answer: this capability
  /// gate alone already makes every `binding` node "unsupported," exactly
  /// matching PHP's net effect while `RuntimeCapabilities.dataResources` is
  /// empty on both sides. Building the fuller check now would duplicate
  /// work slice 3 needs to do anyway when it adds those registries to wire
  /// the real `commerce/v1` consumption they exist to serve — port the
  /// fuller check here at that point, never flip
  /// `RuntimeCapabilities.dataResources` non-empty without it.
  bool _bindingSupported(SchemaBinding binding, CapabilityManifest manifest) {
    return manifest.resourceVersion(binding.resource) != null;
  }

  /// `APP-BUILDER-17` slice 2 — mirrors `CompatibilityResolver::visibilitySupported`
  /// (PHP) exactly: the capability gate first (`schemaFeatureVersion`,
  /// empty until slice 3), then full semantic validity of the condition
  /// tree regardless of the capability gate's answer — unlike
  /// [_bindingSupported], this one has no undone-registry dependency, so
  /// there is nothing to defer.
  bool _visibilitySupported(VisibilityNode visibility, CapabilityManifest manifest) {
    return manifest.schemaFeatureVersion('visibility') != null && _visibilityConditionValid(visibility);
  }

  /// Mirrors `CompatibilityResolver::visibilityConditionValid` (PHP)
  /// exactly: a group node is valid iff every branch is; a leaf node is
  /// valid iff its signal/operator are both in the closed vocabularies and
  /// its `value` presence/shape matches that operator's arity.
  bool _visibilityConditionValid(VisibilityNode condition) {
    if (condition.combinator != null) {
      return condition.branches.every(_visibilityConditionValid);
    }

    final signal = condition.signal;
    final operatorName = condition.operatorName;
    if (!VisibilitySignal.all.contains(signal) || !VisibilityOperator.all.contains(operatorName)) {
      return false;
    }

    if (VisibilityOperator.noValue.contains(operatorName)) {
      return !condition.hasValue;
    }
    if (VisibilityOperator.listValue.contains(operatorName)) {
      final value = condition.value;
      return condition.hasValue && value is List && value.isNotEmpty;
    }
    return condition.hasValue && condition.value is! List;
  }
}

/// Picks the newest schema in [candidates] that [manifest] can actually
/// render, per RUNTIME_COMPATIBILITY_V1.md §15 ("Experience rollback...
/// verify target Experience compatibility with currently supported
/// runtimes"). Returns `null` when no candidate is compatible — callers
/// must show a controlled unavailable/update-required state rather than
/// execute nothing or fall back to an unverified schema (MR-14), and must
/// never pick an [IncompatibleExperience] candidate merely because it is
/// the most recent one on the list.
AppSchema? selectRollbackTarget(
  List<AppSchema> candidates,
  CapabilityManifest manifest, {
  CompatibilityResolver resolver = const CompatibilityResolver(),
}) {
  AppSchema? best;
  for (final candidate in candidates) {
    final result = resolver.resolve(candidate, manifest);
    if (result is RenderableExperience) {
      if (best == null || candidate.schemaVersion > best.schemaVersion) {
        best = candidate;
      }
    }
  }
  return best;
}

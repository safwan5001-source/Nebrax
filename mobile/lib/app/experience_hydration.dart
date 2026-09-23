import '../schema/schema.dart';

/// Rebuilds [root] with the descendant node whose `id` is [targetId]
/// replaced by `transform(thatNode)` — used to inject live Commerce data
/// (a fetched product list's cards, a fetched cart's lines/summary) into a
/// schema-declared "slot" node, without touching [AppSchema]/
/// [CompatibilityResolver] (MOBILE-RUNTIME-2): the schema's own structure
/// and compatibility are resolved exactly as declared and published; only
/// after that does this purely local, purely structural tree walk fill in
/// a leaf's live content — the same kind of tree-rebuild
/// `CompatibilityResolver.resolve()` itself already does via
/// `SchemaComponent.withChildren()` for fallback-pruning, just applied for
/// data hydration instead.
///
/// Returns [root] unchanged if [targetId] is not found anywhere in the tree
/// (fail-safe — a page missing its expected data slot renders its declared
/// static content only, never throws).
SchemaComponent hydrateNode(
  SchemaComponent root,
  String targetId,
  SchemaComponent Function(SchemaComponent node) transform,
) {
  if (root.id == targetId) return transform(root);
  if (root.children.isEmpty) return root;
  return root.withChildren([
    for (final child in root.children) hydrateNode(child, targetId, transform),
  ]);
}

/// Returns a copy of [node] with `props[key]` set to [value] — the small
/// reconstruction every [hydrateNode] `transform` callback that only needs
/// to change one prop would otherwise repeat inline. Used by
/// `home_screen.dart`/`cart_screen.dart` to swap a schema-declared static
/// label's text for the current locale's `RuntimeStrings` value
/// (MOBILE-RUNTIME-6, MR-10), the same way data slots are hydrated.
SchemaComponent withProp(SchemaComponent node, String key, Object? value) {
  return SchemaComponent(
    type: node.type,
    id: node.id,
    optional: node.optional,
    props: {...node.props, key: value},
    children: node.children,
    action: node.action,
  );
}

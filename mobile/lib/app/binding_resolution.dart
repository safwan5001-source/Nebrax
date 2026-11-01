/// `APP-BUILDER-17` slice 3 — the "collection/template hydration" +
/// "visibility handling" stages of the mandated resolution pipeline
/// (Decision Gate approved, `docs/plans/app-builder/
/// AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md` §3.5):
///
///   `CompatibilityResolver` -> binding/resource resolution (fetch) ->
///   **this file** -> existing `ComponentRegistry` rendering -> existing
///   `decodeAction`/`AppActionDispatcher.dispatch`.
///
/// Everything here runs on a tree [CompatibilityResolver.resolve] already
/// approved (every `binding`/`visibility` node on it passed capability
/// gating) — this stage never re-checks capability/version support. Its own
/// job is narrower and purely mechanical: turn each `binding` node into its
/// final literal children (repeating a single authored item template once
/// per collected entry, or substituting `itemProps` onto a single bound
/// item), and let a `visibility` node's condition decide, against real
/// runtime signals, whether a node survives into the render tree at all.
/// By the time [resolveNodeBindings] returns, the tree is an ordinary,
/// fully-literal [SchemaComponent] tree — no node carries a `binding` or an
/// unresolved `$item.*` placeholder, exactly as an already-hydrated
/// `hydrateNode` slot looks today. `decodeAction`/`RuntimeActionHandler`
/// need zero changes: action-param substitution happens here, before an
/// action is ever dispatched.
///
/// Deliberately narrow, per the Decision Gate's own constraints:
/// - No arbitrary expressions, no eval: `$item.<field>` is recognized only
///   as an *exact* string value (never interpolated inside a larger
///   string), and `<field>` is a fixed dotted path the schema author wrote
///   at publish time — never a runtime- or merchant-supplied expression.
/// - No arbitrary object traversal: a dotted path only descends through
///   `Map` keys (mirrors `itemProps`'s own field-path convention exactly —
///   see `app_schema.dart`'s `SchemaBinding`); it can never index into a
///   `List`, and it can never reach outside the current item's own JSON
///   object.
/// - Fail-closed per-reference, not per-document: an unresolved segment (a
///   missing field, or a `collect`/`itemProps` target whose *runtime* value
///   does not match the shape `CompatibilityResolver` already validated its
///   *contract* to be) yields `null`/an empty repetition for that one
///   node — never a thrown exception, never a leaked raw `"$item..."`
///   string reaching a widget.
/// - Visibility is presentation-only: hiding a node here is never treated
///   as authorization, and never substitutes for it (server-side
///   authorization stays fully independent, per the Decision Gate's
///   Tenant-Isolation/authorization amendment).
///
/// **Deliberately deferred, matching the approved Slice 3 scope exactly:**
/// a template descendant's *own* `binding` (nested binding-within-a-template)
/// is preserved structurally but not evaluated by this pass — neither
/// Home's `ProductCard` template nor Cart's line template needs one, and
/// evaluating one would mean deciding a resource-fetch/ordering question no
/// evidence has asked for yet. Item-scoped visibility (`$item.*` inside a
/// visibility condition) is the same kind of deferral: `VisibilitySignal`'s
/// own doc comment already names it "a separate decision needing a new
/// contract," so this file never widens `VisibilitySignal` to reach into an
/// item on its own.
library;

import '../schema/schema.dart';

const _itemRefPrefix = r'$item.';

/// Reads a dotted field path off a raw JSON-shaped value, descending only
/// through `Map` keys. Returns `null` the moment a segment is missing, or
/// the current value is not a `Map` — fail-closed, never throws.
Object? readFieldPath(Object? value, String path) {
  Object? current = value;
  for (final segment in path.split('.')) {
    if (current is Map) {
      current = current[segment];
    } else {
      return null;
    }
  }
  return current;
}

bool _isItemRef(Object? value) => value is String && value.startsWith(_itemRefPrefix);

Object? _resolveItemRef(String ref, Object? item) {
  final path = ref.substring(_itemRefPrefix.length);
  if (path.isEmpty) return null;
  return readFieldPath(item, path);
}

Object? _substituteValue(Object? value, Object? item) {
  if (_isItemRef(value)) return _resolveItemRef(value as String, item);
  if (value is Map) {
    return {for (final entry in value.entries) entry.key: _substituteValue(entry.value, item)};
  }
  if (value is List) {
    return [for (final entry in value) _substituteValue(entry, item)];
  }
  return value;
}

/// Returns a copy of [props] with every exact `"$item.<field>"` string
/// value (at any nesting depth — a prop may itself be an object/array)
/// replaced by that field's value read off [item]. Any value that is not
/// itself (or does not contain) an item-ref string is returned unchanged.
Map<String, Object?> substituteItemRefsInProps(Map<String, Object?> props, Object? item) {
  return {for (final entry in props.entries) entry.key: _substituteValue(entry.value, item)};
}

/// Same substitution applied to an [ActionRef]'s `params` — the action's
/// `type` is never a `$item.*` reference (only *parameter values* resolve
/// per-item; which action fires is still fixed at authoring time).
ActionRef? substituteItemRefsInAction(ActionRef? action, Object? item) {
  if (action == null) return null;
  return ActionRef(type: action.type, params: substituteItemRefsInProps(action.params, item));
}

// ── AD-09 / S08b — `binding.query` يصل إلى الطلب ─────────────────────────────

/// الاستعلام الذي يُرسَل فعلاً لمورد: مفاتيح العقد فقط (`search`, `sort`,
/// `category_id`, `per_page`) بأشكال قيم آمنة. أي شيء آخر (مفتاح مجهول، `id`،
/// `page`، مرجع سياق `$route.*` لا مصدر له بعد، قيمة بشكل خاطئ) **يُسقَط ولا يُرسَل**
/// — الفشل المغلق: لا نمرّر نصاً حراً من التاجر إلى الخادم خارج العقد. الخادم
/// يعيد التحقق على أي حال. `per_page` يُقيَّد بـ1..100 (سقف الخادم).
Map<String, String> sanitizedBindingQuery(SchemaBinding binding) {
  final out = <String, String>{};
  final query = binding.query;

  final search = query['search'];
  if (search is String) {
    final trimmed = search.trim();
    if (trimmed.isNotEmpty) {
      out['search'] = trimmed.length > 120 ? trimmed.substring(0, 120) : trimmed;
    }
  }

  final sort = query['sort'];
  if (sort is String && RegExp(r'^-?[a-z_]{1,40}$').hasMatch(sort)) {
    out['sort'] = sort;
  }

  final category = query['category_id'];
  if (category is String &&
      RegExp(r'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$').hasMatch(category)) {
    out['category_id'] = category;
  }

  final perPage = query['per_page'];
  if (perPage is int) {
    out['per_page'] = (perPage < 1 ? 1 : (perPage > 100 ? 100 : perPage)).toString();
  }

  return out;
}

/// مفتاح البيانات لربطٍ ما: معرّف المورد وحده حين لا استعلام فعّال (يطابق سلوك
/// ما قبل S08b حرفياً)، وإلا `resource?k=v&…` بمفاتيح مرتَّبة (قانوني، لا يتأثر
/// بترتيب المفاتيح في المخطط).
String bindingDataKey(SchemaBinding binding) {
  final query = sanitizedBindingQuery(binding);
  if (query.isEmpty) return binding.resource;
  final keys = query.keys.toList()..sort();
  // القيم مرمَّزة: `search="a&sort=b"` لا يتطابق أبداً مع استعلامين منفصلين (فريد غير ملتبس).
  return '${binding.resource}?${keys.map((k) => '$k=${Uri.encodeQueryComponent(query[k]!)}').join('&')}';
}

/// طلب بيانات مميَّز لمورد: [resource] + [query] المنقّى + [key] القانوني.
class BindingRequest {
  final String resource;
  final Map<String, String> query;
  final String key;

  const BindingRequest({required this.resource, required this.query, required this.key});
}

/// كل الطلبات **المميَّزة** لـ[resource] تحت [root] (بعمق الشجرة)، بترتيب الظهور.
/// الشاشة تجلب كل طلب مرة واحدة وتمرّر الخريطة `key → data` إلى
/// [resolveNodeBindings].
List<BindingRequest> collectBindingRequests(SchemaComponent root, String resource) {
  final seen = <String, BindingRequest>{};
  void visit(SchemaComponent node) {
    final binding = node.binding;
    if (binding != null && binding.resource == resource) {
      final key = bindingDataKey(binding);
      seen.putIfAbsent(
        key,
        () => BindingRequest(resource: resource, query: sanitizedBindingQuery(binding), key: key),
      );
    }
    for (final child in node.children) {
      visit(child);
    }
  }

  visit(root);
  return seen.values.toList();
}

/// Resolves every `binding` node under (and including) [root] against
/// already-fetched raw resource data, producing an ordinary, fully-literal
/// [SchemaComponent] tree. [resourceData] maps a `binding.resource` id
/// (e.g. `commerce.products`) to the raw JSON payload
/// `CommerceClient.fetchBindingResource` already fetched for it — fetching
/// itself happens one level up (screen-owned), so a screen fetches each
/// distinct resource its schema's bindings need exactly once.
SchemaComponent resolveNodeBindings(SchemaComponent root, Map<String, Object?> resourceData) {
  final binding = root.binding;
  if (binding == null) {
    return root.withChildren([
      for (final child in root.children) resolveNodeBindings(child, resourceData),
    ]);
  }
  return _resolveBoundNode(root, binding, resourceData);
}

SchemaComponent _resolveBoundNode(
  SchemaComponent node,
  SchemaBinding binding,
  Map<String, Object?> resourceData,
) {
  // S08b: بيانات الاستعلام المحدّد أولاً، ثم المورد العاري (توافق مع المستدعين الأقدم).
  final resolvedResource = resourceData[bindingDataKey(binding)] ?? resourceData[binding.resource];

  // A `collect` binding always means "repeat" — that is its entire purpose,
  // already proven safe for this schema by `CompatibilityResolver` (the
  // target is a *contractually* `list`-typed field). If the *runtime* value
  // does not actually come back as a list (a defensive case only —
  // malformed/unexpected server data), this fails closed to zero items
  // rather than falling through to single-item `itemProps` semantics, which
  // would silently mix two different binding modes.
  if (binding.collect != null) {
    final target = readFieldPath(resolvedResource, binding.collect!);
    return _repeatTemplate(node, target is List ? target : const []);
  }

  // "collection is the resource result itself" (Home/`ProductList`): no
  // `collect` needed when the resource's own wire shape is already a list
  // (`commerce.products`/`commerce.categories` both return a raw JSON
  // array as `data`).
  if (resolvedResource is List) {
    return _repeatTemplate(node, resolvedResource);
  }

  // Single-item binding (e.g. a future `CartSummary`-style binding): the
  // resolved resource itself is "the item" — existing `itemProps`
  // semantics, unchanged and preserved per the Decision Gate's Amendment 2.
  final newProps = {...node.props};
  binding.itemProps.forEach((propKey, fieldPath) {
    newProps[propKey] = readFieldPath(resolvedResource, fieldPath);
  });
  return SchemaComponent(
    type: node.type,
    id: node.id,
    optional: node.optional,
    props: newProps,
    children: [for (final child in node.children) resolveNodeBindings(child, resourceData)],
    action: node.action,
    binding: null,
    visibility: node.visibility,
  );
}

/// Repeats [node]'s single authored child (its item template — which may be
/// a composite subtree) once per entry in [items], substituting `$item.*`
/// throughout each repeated instance's props/action params. Fails closed to
/// zero children (never throws) when [node] does not declare exactly one
/// template child — a `collect` binding with no authored template, or more
/// than one, has nothing well-defined to repeat.
///
/// Returns a plain [SchemaComponent] rather than `node.withChildren(...)`
/// deliberately: `withChildren` copies [SchemaComponent.binding] verbatim,
/// which would leave the resolved node still carrying its now-consumed
/// `binding` — breaking this pipeline's own "fully-literal, no node carries
/// a binding" contract.
SchemaComponent _repeatTemplate(SchemaComponent node, List<Object?> items) {
  final children = node.children.length == 1
      ? [
          for (var i = 0; i < items.length; i++) _instantiateTemplate(node.children.single, items[i], i),
        ]
      : const <SchemaComponent>[];
  return SchemaComponent(
    type: node.type,
    id: node.id,
    optional: node.optional,
    props: node.props,
    children: children,
    action: node.action,
    binding: null,
    visibility: node.visibility,
  );
}

SchemaComponent _instantiateTemplate(SchemaComponent template, Object? item, int index) {
  final itemId = (item is Map ? item['id'] : null);
  final instanceId = (itemId is String && itemId.isNotEmpty)
      ? '${template.id}-$itemId'
      : '${template.id}-$index';
  return SchemaComponent(
    type: template.type,
    id: instanceId,
    optional: template.optional,
    props: substituteItemRefsInProps(template.props, item),
    children: [for (final child in template.children) _instantiateTemplateDescendant(child, item)],
    action: substituteItemRefsInAction(template.action, item),
    // A template descendant's own `binding` is preserved structurally, not
    // evaluated — see this file's own doc comment ("deliberately deferred").
    binding: null,
    visibility: template.visibility,
  );
}

/// A descendant does not need its own id disambiguated across repeated
/// instances: `ComponentView` keys each node by `ValueKey(node.id)` among
/// *its own siblings* only (`registry/component_registry.dart`) — a
/// descendant several levels inside one repeated subtree is never a sibling
/// of the same-named descendant inside a different repeated subtree, so no
/// Flutter key collision occurs. Only the top-level repeated node
/// ([_instantiateTemplate]'s own id) sits among true siblings (the other
/// repeated instances) and needs disambiguating.
SchemaComponent _instantiateTemplateDescendant(SchemaComponent node, Object? item) {
  return SchemaComponent(
    type: node.type,
    id: node.id,
    optional: node.optional,
    props: substituteItemRefsInProps(node.props, item),
    children: [for (final child in node.children) _instantiateTemplateDescendant(child, item)],
    action: substituteItemRefsInAction(node.action, item),
    binding: null,
    visibility: node.visibility,
  );
}

/// Mirrors `CompatibilityResolver`'s own `_visibilityConditionValid`
/// semantics (already validated at compatibility-resolution time) to
/// actually decide a boolean outcome against real runtime [signals] —
/// `VisibilitySignal`'s closed vocabulary, resolved to whatever the caller
/// currently knows about cart/customer/product context. Not currently
/// invoked against any Home/Cart schema (neither declares a `visibility`
/// node this slice) — kept here as the pipeline's own documented stage
/// (per the Decision Gate's evidence-report shape), ready for the first
/// schema that actually needs it.
bool evaluateVisibility(VisibilityNode condition, Map<String, Object?> signals) {
  final combinator = condition.combinator;
  if (combinator != null) {
    return switch (combinator) {
      VisibilityCombinator.all => condition.branches.every((b) => evaluateVisibility(b, signals)),
      VisibilityCombinator.any => condition.branches.any((b) => evaluateVisibility(b, signals)),
    };
  }

  final actual = signals[condition.signal];
  final expected = condition.value;
  return switch (condition.operatorName) {
    VisibilityOperator.isTrue => actual == true,
    VisibilityOperator.isFalse => actual == false,
    VisibilityOperator.equals => actual == expected,
    VisibilityOperator.notEquals => actual != expected,
    VisibilityOperator.greaterThan => _compareOp(actual, expected, (c) => c > 0),
    VisibilityOperator.lessThan => _compareOp(actual, expected, (c) => c < 0),
    VisibilityOperator.greaterThanOrEqual => _compareOp(actual, expected, (c) => c >= 0),
    VisibilityOperator.lessThanOrEqual => _compareOp(actual, expected, (c) => c <= 0),
    VisibilityOperator.inList => expected is List && expected.contains(actual),
    _ => false, // unreachable once past CompatibilityResolver — fails closed (hidden) regardless.
  };
}

bool _compareOp(Object? a, Object? b, bool Function(int) test) {
  if (a is num && b is num) return test(a.compareTo(b));
  return false;
}

/// Removes every node whose own `visibility` condition evaluates to `false`
/// against [signals] (and, with it, that node's whole subtree) — visibility
/// is presentation-only, so unlike [CompatibilityResolver]'s
/// optional/required fallback rule, a hidden node is simply dropped
/// regardless of its `optional` flag. Not currently invoked against any
/// Home/Cart schema, for the same reason as [evaluateVisibility].
SchemaComponent? pruneInvisible(SchemaComponent node, Map<String, Object?> signals) {
  final visibility = node.visibility;
  if (visibility != null && !evaluateVisibility(visibility, signals)) return null;

  final children = <SchemaComponent>[];
  for (final child in node.children) {
    final kept = pruneInvisible(child, signals);
    if (kept != null) children.add(kept);
  }
  return node.withChildren(children);
}

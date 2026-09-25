import 'dart:convert';

import 'schema_version.dart';

/// Structural/parse-time limits. These exist to keep the schema "bounded in
/// complexity" (`AWJ_APP_BUILDER_PRODUCT_ARCHITECTURE_V1.md` §13A-D) and to
/// reject pathological/oversized input before it reaches any widget layer —
/// not because a real AWJ-authored Home/Product/Cart screen would ever need
/// this many nodes.
const int kMaxComponentTreeDepth = 32;
const int kMaxComponentNodeCount = 500;
const int kMaxPropsNestingDepth = 8;
const int kMaxPropsCollectionLength = 64;

/// `visibility` condition-tree limits (`ADR-01` §3.3, `APP-BUILDER-16`) —
/// mirrors `AppSchemaParser::MAX_CONDITION_DEPTH`/`MAX_CONDITION_BRANCHES`
/// exactly. Kept separate from the component-tree limits above: a condition
/// tree is a different shape (combinator/leaf, not renderable nodes) with
/// its own, much smaller bound.
const int kMaxConditionDepth = 4;
const int kMaxConditionBranches = 16;

/// A single structural/type/unknown-field problem found while parsing or
/// validating an App Schema document. [code] is a stable machine-readable
/// identifier (never a translated string) so callers/tests can assert on
/// failure *class* without string-matching a human message.
class SchemaFormatException implements Exception {
  final String code;
  final String message;

  const SchemaFormatException(this.code, this.message);

  @override
  String toString() => 'SchemaFormatException($code): $message';
}

/// A reference to an allowlisted runtime action (horizon MR-05), embedded on
/// the one component instance that triggers it. The schema describes intent
/// only — [RuntimeCapabilities.actions] (checked later, by the compatibility
/// resolver) decides whether this runtime build actually knows how to
/// dispatch it, and the Action Registry (MOBILE-RUNTIME-3) decides how.
class ActionRef {
  final String type;
  final Map<String, Object?> params;

  const ActionRef({required this.type, required this.params});

  static const _allowedKeys = {'type', 'params'};

  factory ActionRef._fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, _allowedKeys, context: 'action');
    final type = json['type'];
    if (type is! String || type.isEmpty) {
      throw const SchemaFormatException('invalid_type', 'action.type must be a non-empty string');
    }
    final paramsRaw = json['params'];
    if (paramsRaw != null && paramsRaw is! Map) {
      throw const SchemaFormatException('invalid_type', 'action.params must be an object');
    }
    final params = _validateJsonSafeMap(
      (paramsRaw as Map?)?.cast<String, Object?>(),
      context: 'action.params',
    );
    return ActionRef(type: type, params: params);
  }
}

/// A data-source binding on a component node (`ADR-01` §3.2,
/// `APP-BUILDER-14`). Mirrors `AppSchemaParser::validateBinding` exactly —
/// purely structural here (a JSON-safe object with a non-empty `resource`
/// string, an optional JSON-safe `query`, and an optional string:string
/// `itemProps`). Resource identity, field/query-key validity against the
/// real Data Resource Registry, and capability gating are the compatibility
/// resolver's job (`APP-BUILDER-17`), never this parser's — same split as
/// [ActionRef]'s type/params here versus the Action Registry elsewhere.
class SchemaBinding {
  final String resource;
  final Map<String, Object?> query;
  final Map<String, String> itemProps;

  /// `APP-BUILDER-17` slice 3 (Decision Gate approved) — a dotted field path
  /// (same convention as [itemProps]'s field paths) to a `LIST`-typed field
  /// on the resolved resource whose entries the node's single declared
  /// child (its item template) is repeated once per, substituting
  /// `$item.<field>` throughout. `null` means "no repetition" — the
  /// resolved resource (or, for a `SHAPE_LIST` resource, its own result
  /// set) is the binding's only target, exactly like today. Purely
  /// structural here (non-empty string); resource/field identity and
  /// `LIST`-type validity are `CompatibilityResolver`'s job, mirroring
  /// [resource]/[itemProps]'s own split exactly.
  final String? collect;

  const SchemaBinding({
    required this.resource,
    required this.query,
    required this.itemProps,
    this.collect,
  });

  static const _allowedKeys = {'resource', 'query', 'itemProps', 'collect'};

  factory SchemaBinding._fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, _allowedKeys, context: 'binding');

    final resource = json['resource'];
    if (resource is! String || resource.isEmpty) {
      throw const SchemaFormatException('missing_field', 'binding.resource must be a non-empty string');
    }

    final queryRaw = json['query'];
    var query = const <String, Object?>{};
    if (queryRaw != null) {
      if (queryRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'binding.query must be an object');
      }
      query = _validateJsonSafeMap(queryRaw.cast<String, Object?>(), context: 'binding.query');
    }

    final itemPropsRaw = json['itemProps'];
    final itemProps = <String, String>{};
    if (itemPropsRaw != null) {
      if (itemPropsRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'binding.itemProps must be an object');
      }
      itemPropsRaw.forEach((key, value) {
        if (key is! String || key.isEmpty || value is! String || value.isEmpty) {
          throw const SchemaFormatException(
            'invalid_type',
            'binding.itemProps entries must be non-empty string:string',
          );
        }
        itemProps[key] = value;
      });
    }

    final collectRaw = json['collect'];
    String? collect;
    if (collectRaw != null) {
      if (collectRaw is! String || collectRaw.isEmpty) {
        throw const SchemaFormatException('invalid_type', 'binding.collect must be a non-empty string');
      }
      collect = collectRaw;
    }

    return SchemaBinding(
      resource: resource,
      query: query,
      itemProps: Map.unmodifiable(itemProps),
      collect: collect,
    );
  }
}

/// Which of `visibility`'s two group shapes a non-leaf [VisibilityNode]
/// carries — `{all:[...]}` or `{any:[...]}`.
enum VisibilityCombinator { all, any }

/// A single node of a `visibility` condition tree (`ADR-01` §3.3,
/// `APP-BUILDER-16`). Mirrors `AppSchemaParser::validateVisibility` exactly:
/// a closed, typed three-shape union — a combinator group (`{all:[...]}`/
/// `{any:[...]}`) or a leaf (`{signal, operator, value?}`) — never an
/// expression, never arbitrary code. Represented as one flat class (matching
/// this file's existing style, e.g. [ActionRef]) rather than a class
/// hierarchy: [isLeaf] tells callers which fields are meaningful, and the
/// two private named constructors below (not subtyping) are what actually
/// keeps "exactly one of group-shape or leaf-shape" true.
class VisibilityNode {
  final VisibilityCombinator? combinator;
  final List<VisibilityNode> branches;
  final String? signal;
  final String? operatorName;
  final Object? value;

  /// Whether a `value` key was present at all — distinct from `value` being
  /// `null`, since `null` is itself a valid JSON-safe scalar value.
  final bool hasValue;

  const VisibilityNode._group({required this.combinator, required this.branches})
      : signal = null,
        operatorName = null,
        value = null,
        hasValue = false;

  const VisibilityNode._leaf({
    required this.signal,
    required this.operatorName,
    this.value,
    required this.hasValue,
  }) : combinator = null,
       branches = const [];

  bool get isLeaf => signal != null;

  static const _leafKeys = {'signal', 'operator', 'value'};

  factory VisibilityNode._fromJson(Map<String, Object?> json, int depth) {
    if (depth > kMaxConditionDepth) {
      throw const SchemaFormatException('too_deep', 'visibility nesting too deep');
    }

    final hasAll = json.containsKey('all');
    final hasAny = json.containsKey('any');
    if (hasAll || hasAny) {
      final key = hasAll ? 'all' : 'any';
      _rejectUnknownKeys(json, {key}, context: 'visibility');
      final branchesRaw = json[key];
      if (branchesRaw is! List || branchesRaw.isEmpty) {
        throw SchemaFormatException('invalid_type', 'visibility.$key must be a non-empty list');
      }
      if (branchesRaw.length > kMaxConditionBranches) {
        throw SchemaFormatException('too_many_nodes', 'visibility.$key has too many entries');
      }
      final branches = <VisibilityNode>[];
      for (final branch in branchesRaw) {
        if (branch is! Map) {
          throw SchemaFormatException('invalid_type', 'visibility.$key entries must be objects');
        }
        branches.add(VisibilityNode._fromJson(branch.cast<String, Object?>(), depth + 1));
      }
      return VisibilityNode._group(
        combinator: hasAll ? VisibilityCombinator.all : VisibilityCombinator.any,
        branches: List.unmodifiable(branches),
      );
    }

    if (json.containsKey('signal')) {
      _rejectUnknownKeys(json, _leafKeys, context: 'visibility');
      final signal = json['signal'];
      if (signal is! String || signal.isEmpty) {
        throw const SchemaFormatException('missing_field', 'visibility.signal must be a non-empty string');
      }
      final operatorValue = json['operator'];
      if (operatorValue is! String || operatorValue.isEmpty) {
        throw const SchemaFormatException('missing_field', 'visibility.operator must be a non-empty string');
      }
      final hasValue = json.containsKey('value');
      if (hasValue) {
        _validateVisibilityValue(json['value']);
      }
      return VisibilityNode._leaf(
        signal: signal,
        operatorName: operatorValue,
        value: hasValue ? json['value'] : null,
        hasValue: hasValue,
      );
    }

    throw const SchemaFormatException(
      'missing_field',
      'visibility must declare exactly one of: all, any, signal',
    );
  }
}

/// `value` must be a JSON-safe scalar, or a flat list of scalars (for
/// `in`) — never a nested object. Mirrors
/// `AppSchemaParser::validateVisibilityValue` exactly.
void _validateVisibilityValue(Object? value) {
  if (value == null || value is String || value is num || value is bool) {
    return;
  }
  if (value is List) {
    if (value.length > kMaxPropsCollectionLength) {
      throw const SchemaFormatException('too_many_nodes', 'visibility.value list too long');
    }
    for (final item in value) {
      if (!(item is String || item is num || item is bool)) {
        throw const SchemaFormatException('invalid_type', 'visibility.value list entries must be scalars');
      }
    }
    return;
  }
  throw const SchemaFormatException(
    'invalid_type',
    'visibility.value must be a scalar or a flat list of scalars',
  );
}

/// One node in an App Schema page's component tree (horizon MR-04's
/// "approved component instances" + "typed props/bindings", pending full
/// per-type prop schemas from MOBILE-RUNTIME-3).
///
/// [type] is checked against the fixed component-identifier allowlist by
/// [CompatibilityResolver], not here — this layer only enforces *shape*
/// (known keys, JSON-safe prop values, bounded size), not semantic identity.
class SchemaComponent {
  final String type;
  final String id;
  final bool optional;
  final Map<String, Object?> props;
  final List<SchemaComponent> children;
  final ActionRef? action;
  final SchemaBinding? binding;
  final VisibilityNode? visibility;

  const SchemaComponent({
    required this.type,
    required this.id,
    required this.optional,
    required this.props,
    required this.children,
    this.action,
    this.binding,
    this.visibility,
  });

  static const _allowedKeys = {
    'type', 'id', 'optional', 'props', 'children', 'action', 'binding', 'visibility',
  };

  factory SchemaComponent._fromJson(
    Map<String, Object?> json,
    _ParseBudget budget,
    int depth,
  ) {
    budget.consumeNode();
    if (depth > kMaxComponentTreeDepth) {
      throw SchemaFormatException(
        'too_deep',
        'component tree exceeds max depth ($kMaxComponentTreeDepth)',
      );
    }
    _rejectUnknownKeys(json, _allowedKeys, context: 'component');

    final type = json['type'];
    if (type is! String || type.isEmpty) {
      throw const SchemaFormatException('invalid_type', 'component.type must be a non-empty string');
    }
    final id = json['id'];
    if (id is! String || id.isEmpty) {
      throw const SchemaFormatException('missing_field', 'component.id is required');
    }
    final optionalRaw = json['optional'];
    if (optionalRaw != null && optionalRaw is! bool) {
      throw const SchemaFormatException('invalid_type', 'component.optional must be a boolean');
    }
    final propsRaw = json['props'];
    if (propsRaw != null && propsRaw is! Map) {
      throw const SchemaFormatException('invalid_type', 'component.props must be an object');
    }
    final props = _validateJsonSafeMap(
      (propsRaw as Map?)?.cast<String, Object?>(),
      context: 'component.props',
    );

    final childrenRaw = json['children'];
    final children = <SchemaComponent>[];
    if (childrenRaw != null) {
      if (childrenRaw is! List) {
        throw const SchemaFormatException('invalid_type', 'component.children must be a list');
      }
      for (final child in childrenRaw) {
        if (child is! Map) {
          throw const SchemaFormatException(
            'invalid_type',
            'component.children entries must be objects',
          );
        }
        children.add(SchemaComponent._fromJson(child.cast<String, Object?>(), budget, depth + 1));
      }
    }

    final actionRaw = json['action'];
    ActionRef? action;
    if (actionRaw != null) {
      if (actionRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'component.action must be an object');
      }
      action = ActionRef._fromJson(actionRaw.cast<String, Object?>());
    }

    final bindingRaw = json['binding'];
    SchemaBinding? binding;
    if (bindingRaw != null) {
      if (bindingRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'component.binding must be an object');
      }
      binding = SchemaBinding._fromJson(bindingRaw.cast<String, Object?>());
    }

    final visibilityRaw = json['visibility'];
    VisibilityNode? visibility;
    if (visibilityRaw != null) {
      if (visibilityRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'component.visibility must be an object');
      }
      visibility = VisibilityNode._fromJson(visibilityRaw.cast<String, Object?>(), 0);
    }

    return SchemaComponent(
      type: type,
      id: id,
      optional: optionalRaw as bool? ?? false,
      props: props,
      children: List.unmodifiable(children),
      action: action,
      binding: binding,
      visibility: visibility,
    );
  }

  /// Returns a copy with [children] replaced — used by
  /// [CompatibilityResolver] to rebuild a pruned (fallback-applied) tree
  /// without mutating the original parsed schema.
  SchemaComponent withChildren(List<SchemaComponent> newChildren) {
    return SchemaComponent(
      type: type,
      id: id,
      optional: optional,
      props: props,
      children: List.unmodifiable(newChildren),
      action: action,
      binding: binding,
      visibility: visibility,
    );
  }
}

/// Theme tokens (horizon MR-04's "theme tokens"). Values are plain strings
/// (hex colors, token references) — never expressions, never code.
class ThemeTokens {
  final Map<String, String> tokens;

  const ThemeTokens(this.tokens);

  static const _allowedKeys = {'tokens'};

  factory ThemeTokens._fromJson(Map<String, Object?>? json) {
    if (json == null) return const ThemeTokens({});
    _rejectUnknownKeys(json, _allowedKeys, context: 'theme');
    final tokensRaw = json['tokens'];
    if (tokensRaw == null) return const ThemeTokens({});
    if (tokensRaw is! Map) {
      throw const SchemaFormatException('invalid_type', 'theme.tokens must be an object');
    }
    final tokens = <String, String>{};
    tokensRaw.forEach((key, value) {
      if (key is! String || value is! String) {
        throw const SchemaFormatException(
          'invalid_type',
          'theme.tokens entries must be string:string',
        );
      }
      tokens[key] = value;
    });
    return ThemeTokens(Map.unmodifiable(tokens));
  }
}

/// Navigation metadata (horizon MR-04's "navigation"). Deliberately minimal
/// for MOBILE-RUNTIME-2 — [initialPageId] is the only concept needed to
/// validate a schema structurally; actual route dispatch is a later task.
class SchemaNavigation {
  final String initialPageId;

  const SchemaNavigation({required this.initialPageId});

  static const _allowedKeys = {'initialPageId'};

  factory SchemaNavigation._fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, _allowedKeys, context: 'navigation');
    final initial = json['initialPageId'];
    if (initial is! String || initial.isEmpty) {
      throw const SchemaFormatException('missing_field', 'navigation.initialPageId is required');
    }
    return SchemaNavigation(initialPageId: initial);
  }
}

/// A fully parsed and structurally validated AWJ App Schema document
/// (horizon MR-04). Parsing alone does **not** mean a runtime can render it
/// — pass this to [CompatibilityResolver] before rendering anything.
class AppSchema {
  final SchemaVersion schemaVersion;
  final SchemaVersion minRuntimeVersion;
  final Map<String, int> requiredCapabilities;
  final ThemeTokens theme;
  final SchemaNavigation navigation;
  final Map<String, SchemaComponent> pages;

  const AppSchema({
    required this.schemaVersion,
    required this.minRuntimeVersion,
    required this.requiredCapabilities,
    required this.theme,
    required this.navigation,
    required this.pages,
  });

  static const _allowedKeys = {
    'schemaVersion',
    'minRuntimeVersion',
    'requiredCapabilities',
    'theme',
    'navigation',
    'pages',
  };

  /// Parses and structurally validates [source] as an AWJ App Schema
  /// document. Always throws [SchemaFormatException] on any structural,
  /// type, or unknown-field problem (never a raw [FormatException]/[TypeError]
  /// escaping this layer), so every caller has exactly one exception type
  /// and a stable machine-readable `code` to branch on.
  factory AppSchema.parse(String source) {
    final Object? decoded;
    try {
      decoded = jsonDecode(source);
    } on FormatException catch (e) {
      throw SchemaFormatException('invalid_json', 'not valid JSON: ${e.message}');
    }
    if (decoded is! Map) {
      throw const SchemaFormatException('invalid_type', 'schema root must be a JSON object');
    }
    return AppSchema._fromJson(decoded.cast<String, Object?>());
  }

  factory AppSchema._fromJson(Map<String, Object?> json) {
    _rejectUnknownKeys(json, _allowedKeys, context: 'schema');

    final schemaVersionRaw = json['schemaVersion'];
    final minRuntimeRaw = json['minRuntimeVersion'];
    if (schemaVersionRaw is! String) {
      throw const SchemaFormatException('missing_field', 'schemaVersion is required');
    }
    if (minRuntimeRaw is! String) {
      throw const SchemaFormatException('missing_field', 'minRuntimeVersion is required');
    }
    final schemaVersion = SchemaVersion.tryParse(schemaVersionRaw);
    final minRuntimeVersion = SchemaVersion.tryParse(minRuntimeRaw);
    if (schemaVersion == null) {
      throw const SchemaFormatException('invalid_version', 'schemaVersion is not a valid x.y.z version');
    }
    if (minRuntimeVersion == null) {
      throw const SchemaFormatException(
        'invalid_version',
        'minRuntimeVersion is not a valid x.y.z version',
      );
    }

    final requiredCapsRaw = json['requiredCapabilities'];
    final requiredCapabilities = <String, int>{};
    if (requiredCapsRaw != null) {
      if (requiredCapsRaw is! Map) {
        throw const SchemaFormatException('invalid_type', 'requiredCapabilities must be an object');
      }
      requiredCapsRaw.forEach((key, value) {
        if (key is! String || value is! int || value < 1) {
          throw const SchemaFormatException(
            'invalid_type',
            'requiredCapabilities entries must be string:positive-int',
          );
        }
        requiredCapabilities[key] = value;
      });
    }

    final themeRaw = json['theme'];
    if (themeRaw != null && themeRaw is! Map) {
      throw const SchemaFormatException('invalid_type', 'theme must be an object');
    }
    final theme = ThemeTokens._fromJson((themeRaw as Map?)?.cast<String, Object?>());

    final navigationRaw = json['navigation'];
    if (navigationRaw is! Map) {
      throw const SchemaFormatException('missing_field', 'navigation is required');
    }
    final navigation = SchemaNavigation._fromJson(navigationRaw.cast<String, Object?>());

    final pagesRaw = json['pages'];
    if (pagesRaw is! Map || pagesRaw.isEmpty) {
      throw const SchemaFormatException('missing_field', 'pages must be a non-empty object');
    }
    final budget = _ParseBudget(maxNodes: kMaxComponentNodeCount);
    final pages = <String, SchemaComponent>{};
    pagesRaw.forEach((key, value) {
      if (key is! String) {
        throw const SchemaFormatException('invalid_type', 'page keys must be strings');
      }
      if (value is! Map) {
        throw SchemaFormatException('invalid_type', 'page "$key" must be an object');
      }
      final root = SchemaComponent._fromJson(value.cast<String, Object?>(), budget, 0);
      if (root.type != 'Page') {
        throw SchemaFormatException(
          'invalid_type',
          'page "$key" root component must have type "Page", got "${root.type}"',
        );
      }
      pages[key] = root;
    });

    if (!pages.containsKey(navigation.initialPageId)) {
      throw SchemaFormatException(
        'missing_field',
        'navigation.initialPageId "${navigation.initialPageId}" does not reference a declared page',
      );
    }

    return AppSchema(
      schemaVersion: schemaVersion,
      minRuntimeVersion: minRuntimeVersion,
      requiredCapabilities: Map.unmodifiable(requiredCapabilities),
      theme: theme,
      navigation: navigation,
      pages: Map.unmodifiable(pages),
    );
  }
}

class _ParseBudget {
  final int maxNodes;
  int _count = 0;

  _ParseBudget({required this.maxNodes});

  void consumeNode() {
    _count++;
    if (_count > maxNodes) {
      throw SchemaFormatException('too_many_nodes', 'component tree exceeds max node count ($maxNodes)');
    }
  }
}

void _rejectUnknownKeys(Map<Object?, Object?> json, Set<String> allowed, {required String context}) {
  for (final key in json.keys) {
    if (key is! String || !allowed.contains(key)) {
      throw SchemaFormatException('unknown_field', 'unknown field "$key" in $context');
    }
  }
}

/// Recursively validates that a decoded-JSON map contains only JSON-safe
/// scalar/collection values, within bounded size/depth. This is the layer
/// that makes "no arbitrary executable code ... no remote expressions with
/// general code semantics" (horizon MR-04) structurally true: a function,
/// class instance, or anything else non-JSON simply cannot survive
/// `jsonDecode` in the first place, and this walk additionally bounds size.
Map<String, Object?> _validateJsonSafeMap(Map<String, Object?>? raw, {required String context, int depth = 0}) {
  if (raw == null) return const {};
  if (depth > kMaxPropsNestingDepth) {
    throw SchemaFormatException('too_deep', '$context nesting too deep');
  }
  if (raw.length > kMaxPropsCollectionLength) {
    throw SchemaFormatException('too_many_nodes', '$context has too many entries');
  }
  final result = <String, Object?>{};
  raw.forEach((key, value) {
    result[key] = _validateJsonSafeValue(value, context: '$context.$key', depth: depth);
  });
  return Map.unmodifiable(result);
}

Object? _validateJsonSafeValue(Object? value, {required String context, int depth = 0}) {
  if (value == null || value is String || value is num || value is bool) {
    return value;
  }
  if (value is List) {
    if (depth > kMaxPropsNestingDepth) {
      throw SchemaFormatException('too_deep', '$context nesting too deep');
    }
    if (value.length > kMaxPropsCollectionLength) {
      throw SchemaFormatException('too_many_nodes', '$context list too long');
    }
    return List<Object?>.unmodifiable(
      value.map((v) => _validateJsonSafeValue(v, context: '$context[]', depth: depth + 1)),
    );
  }
  if (value is Map) {
    return _validateJsonSafeMap(value.cast<String, Object?>(), context: context, depth: depth + 1);
  }
  throw SchemaFormatException('invalid_type', '$context has an unsupported value type');
}

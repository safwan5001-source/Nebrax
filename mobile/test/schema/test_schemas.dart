import 'dart:convert';

/// Shared schema-JSON builders for the schema/compatibility test suites.
/// Kept as plain `Map`/`jsonEncode` builders (not fixed string literals) so
/// each test can mutate exactly the one field it is proving, rather than
/// maintaining N near-duplicate JSON documents.
Map<String, Object?> componentNode({
  required String type,
  required String id,
  bool optional = false,
  Map<String, Object?>? props,
  List<Map<String, Object?>>? children,
  Map<String, Object?>? action,
  Map<String, Object?>? binding,
  Map<String, Object?>? visibility,
}) {
  return {
    'type': type,
    'id': id,
    'optional': optional,
    'props': props,
    'children': children,
    'action': action,
    if (binding != null) 'binding': binding,
    if (visibility != null) 'visibility': visibility,
  };
}

Map<String, Object?> baseSchemaJson({
  String schemaVersion = '1.0.0',
  String minRuntimeVersion = '1.0.0',
  Map<String, int>? requiredCapabilities,
  Map<String, Object?>? pageOverride,
}) {
  return {
    'schemaVersion': schemaVersion,
    'minRuntimeVersion': minRuntimeVersion,
    'requiredCapabilities': requiredCapabilities,
    'theme': {
      'tokens': {'colorPrimary': '#0F6A5A'},
    },
    'navigation': {'initialPageId': 'home'},
    'pages': {
      'home': pageOverride ??
          componentNode(
            type: 'Page',
            id: 'home-root',
            children: [
              componentNode(
                type: 'Section',
                id: 'hero',
                children: [
                  componentNode(type: 'Text', id: 'title', props: {'text': 'أَوْج'}),
                ],
              ),
              componentNode(
                type: 'ProductList',
                id: 'featured',
                props: {'source': 'featured'},
              ),
            ],
          ),
    },
  };
}

String encodeSchema(Map<String, Object?> json) => jsonEncode(json);

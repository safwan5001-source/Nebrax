import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_schemas.dart';

void main() {
  group('AppSchema.parse — valid documents', () {
    test('parses a minimal valid schema', () {
      final schema = AppSchema.parse(encodeSchema(baseSchemaJson()));

      expect(schema.schemaVersion, const SchemaVersion(1, 0, 0));
      expect(schema.minRuntimeVersion, const SchemaVersion(1, 0, 0));
      expect(schema.navigation.initialPageId, 'home');
      expect(schema.theme.tokens['colorPrimary'], '#0F6A5A');
      expect(schema.pages.containsKey('home'), isTrue);
      expect(schema.pages['home']!.type, 'Page');
      expect(schema.pages['home']!.children, hasLength(2));
    });

    test('parses requiredCapabilities when present', () {
      final schema = AppSchema.parse(
        encodeSchema(baseSchemaJson(requiredCapabilities: {'commerce.productGrid': 2})),
      );
      expect(schema.requiredCapabilities['commerce.productGrid'], 2);
    });

    test('parses an action reference on a component', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'AddToCart',
              id: 'add-to-cart-btn',
              action: {
                'type': 'addToCart',
                'params': {'productId': 'p-1', 'quantity': 1},
              },
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final action = schema.pages['home']!.children.single.action;
      expect(action, isNotNull);
      expect(action!.type, 'addToCart');
      expect(action.params['productId'], 'p-1');
    });
  });

  group('AppSchema.parse — malformed/malicious negatives', () {
    void expectRejected(Map<String, Object?> json, String expectedCode) {
      expect(
        () => AppSchema.parse(encodeSchema(json)),
        throwsA(
          isA<SchemaFormatException>().having((e) => e.code, 'code', expectedCode),
        ),
      );
    }

    test('rejects invalid JSON', () {
      expect(
        () => AppSchema.parse('{not valid json'),
        throwsA(isA<SchemaFormatException>().having((e) => e.code, 'code', 'invalid_json')),
      );
    });

    test('rejects a non-object JSON root', () {
      expect(
        () => AppSchema.parse('[1, 2, 3]'),
        throwsA(isA<SchemaFormatException>().having((e) => e.code, 'code', 'invalid_type')),
      );
    });

    test('rejects an unknown top-level field (e.g. a smuggled tenant override)', () {
      final json = baseSchemaJson();
      json['tenantId'] = 'attacker-controlled-tenant';
      expectRejected(json, 'unknown_field');
    });

    test('rejects a missing schemaVersion', () {
      final json = baseSchemaJson();
      json.remove('schemaVersion');
      expectRejected(json, 'missing_field');
    });

    test('rejects an invalid schemaVersion format', () {
      final json = baseSchemaJson(schemaVersion: 'not-a-version');
      expectRejected(json, 'invalid_version');
    });

    test('rejects an unknown component field (e.g. a smuggled arbitrary URL)', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root'),
      );
      (json['pages'] as Map<String, Object?>)['home'] = <String, Object?>{
        ...(json['pages'] as Map<String, Object?>)['home'] as Map<String, Object?>,
        'httpUrl': 'https://evil.example/exfiltrate',
      };
      expectRejected(json, 'unknown_field');
    });

    test('rejects a component missing id', () {
      final json = baseSchemaJson(
        pageOverride: {'type': 'Page'},
      );
      expectRejected(json, 'missing_field');
    });

    test('rejects children that are not a list', () {
      final json = baseSchemaJson(
        pageOverride: {'type': 'Page', 'id': 'home-root', 'children': 'not-a-list'},
      );
      expectRejected(json, 'invalid_type');
    });

    test('rejects a non-"Page" root component', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Section', id: 'not-a-page-root'),
      );
      expectRejected(json, 'invalid_type');
    });

    test('rejects navigation.initialPageId referencing an undeclared page', () {
      final json = baseSchemaJson();
      (json['navigation'] as Map)['initialPageId'] = 'does-not-exist';
      expectRejected(json, 'missing_field');
    });

    test('rejects a component tree deeper than the max depth', () {
      Map<String, Object?> nested = componentNode(type: 'Text', id: 'leaf');
      for (var i = 0; i < kMaxComponentTreeDepth + 5; i++) {
        nested = componentNode(type: 'Section', id: 'n$i', children: [nested]);
      }
      final json = baseSchemaJson(pageOverride: {'type': 'Page', 'id': 'home-root', 'children': [nested]});
      expectRejected(json, 'too_deep');
    });

    test('rejects a component tree with too many nodes', () {
      final children = List.generate(
        kMaxComponentNodeCount + 5,
        (i) => componentNode(type: 'Text', id: 'leaf-$i'),
      );
      final json = baseSchemaJson(
        pageOverride: {'type': 'Page', 'id': 'home-root', 'children': children},
      );
      expectRejected(json, 'too_many_nodes');
    });

    test('rejects an action with an unknown field', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'AddToCart',
              id: 'btn',
              action: {
                'type': 'addToCart',
                'params': {},
                'code': 'return evil()',
              },
            ),
          ],
        ),
      );
      expectRejected(json, 'unknown_field');
    });

    test('rejects requiredCapabilities with a non-positive-int value', () {
      final json = baseSchemaJson();
      json['requiredCapabilities'] = {'commerce.cart.add': 0};
      expectRejected(json, 'invalid_type');
    });
  });
}

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'test_schemas.dart';

/// APP-BUILDER-17 (slice 1/3 — parser support only, no resolver/screen
/// changes yet, see `docs/autonomous-engineering/TASK-QUEUE.md`): mirrors
/// `AppSchemaParserTest.php`'s binding/visibility coverage on the Dart side,
/// proving `SchemaComponent`'s new `binding`/`visibility` fields parse (and
/// reject) exactly what the PHP-side `AppSchemaParser` does.
void main() {
  group('SchemaComponent.binding — valid documents', () {
    test('parses a component with a well formed binding', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'ProductList',
              id: 'featured',
              binding: {
                'resource': 'commerce.products',
                'query': {'search': 'shoes', 'sort': '-created_at'},
                'itemProps': {'title': 'name', 'amountMinor': 'price'},
              },
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final binding = schema.pages['home']!.children.single.binding;
      expect(binding, isNotNull);
      expect(binding!.resource, 'commerce.products');
      expect(binding.query['search'], 'shoes');
      expect(binding.itemProps['title'], 'name');
    });

    test('a binding with no query/itemProps parses with empty maps', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(type: 'ProductList', id: 'featured', binding: {'resource': 'commerce.products'}),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final binding = schema.pages['home']!.children.single.binding!;
      expect(binding.query, isEmpty);
      expect(binding.itemProps, isEmpty);
    });
  });

  group('SchemaComponent.binding — malformed negatives', () {
    void expectRejected(Map<String, Object?> json, String expectedCode) {
      expect(
        () => AppSchema.parse(encodeSchema(json)),
        throwsA(isA<SchemaFormatException>().having((e) => e.code, 'code', expectedCode)),
      );
    }

    test('rejects a binding with an unknown field', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'ProductList',
              id: 'featured',
              binding: {'resource': 'commerce.products', 'expression': 'evil()'},
            ),
          ],
        ),
      );
      expectRejected(json, 'unknown_field');
    });

    test('rejects a binding missing resource', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [componentNode(type: 'ProductList', id: 'featured', binding: {'query': {}})],
        ),
      );
      expectRejected(json, 'missing_field');
    });

    test('rejects a binding with a non-string itemProps value', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'ProductList',
              id: 'featured',
              binding: {
                'resource': 'commerce.products',
                'itemProps': {'title': 123},
              },
            ),
          ],
        ),
      );
      expectRejected(json, 'invalid_type');
    });
  });

  group('SchemaComponent.visibility — valid documents', () {
    test('parses a component with a simple visibility leaf', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'Text',
              id: 'promo',
              visibility: {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0},
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final visibility = schema.pages['home']!.children.single.visibility;
      expect(visibility, isNotNull);
      expect(visibility!.isLeaf, isTrue);
      expect(visibility.signal, 'cart.itemCount');
      expect(visibility.operatorName, 'gt');
      expect(visibility.hasValue, isTrue);
      expect(visibility.value, 0);
    });

    test('parses a component with a nested any/all visibility tree', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'Text',
              id: 'promo',
              visibility: {
                'all': [
                  {'signal': 'customer.isAuthenticated', 'operator': 'isTrue'},
                  {
                    'any': [
                      {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0},
                      {'signal': 'product.inStock', 'operator': 'isTrue'},
                    ],
                  },
                ],
              },
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final visibility = schema.pages['home']!.children.single.visibility!;
      expect(visibility.isLeaf, isFalse);
      expect(visibility.combinator, VisibilityCombinator.all);
      expect(visibility.branches, hasLength(2));
      expect(visibility.branches[0].isLeaf, isTrue);
      expect(visibility.branches[1].isLeaf, isFalse);
      expect(visibility.branches[1].combinator, VisibilityCombinator.any);
      expect(visibility.branches[1].branches, hasLength(2));
    });

    test('a leaf with no value has hasValue false', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(type: 'Text', id: 'promo', visibility: {'signal': 'customer.isAuthenticated', 'operator': 'isTrue'}),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      expect(schema.pages['home']!.children.single.visibility!.hasValue, isFalse);
    });
  });

  group('SchemaComponent.visibility — malformed negatives', () {
    void expectRejected(Map<String, Object?> json, String expectedCode) {
      expect(
        () => AppSchema.parse(encodeSchema(json)),
        throwsA(isA<SchemaFormatException>().having((e) => e.code, 'code', expectedCode)),
      );
    }

    test('rejects a visibility with an unknown field', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'Text',
              id: 'promo',
              visibility: {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0, 'code': 'evil()'},
            ),
          ],
        ),
      );
      expectRejected(json, 'unknown_field');
    });

    test('rejects a visibility declaring neither all, any, nor signal', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root', children: [
          componentNode(type: 'Text', id: 'promo', visibility: {'operator': 'gt', 'value': 0}),
        ]),
      );
      expectRejected(json, 'missing_field');
    });

    test('rejects a visibility.all that is an empty list', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root', children: [
          componentNode(type: 'Text', id: 'promo', visibility: {'all': []}),
        ]),
      );
      expectRejected(json, 'invalid_type');
    });

    test('rejects a visibility with a nested object as value', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root', children: [
          componentNode(
            type: 'Text',
            id: 'promo',
            visibility: {
              'signal': 'cart.itemCount',
              'operator': 'equals',
              'value': {'nested': true},
            },
          ),
        ]),
      );
      expectRejected(json, 'invalid_type');
    });

    test('rejects a visibility tree deeper than the max condition depth', () {
      Map<String, Object?> nested = {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0};
      for (var i = 0; i < kMaxConditionDepth + 2; i++) {
        nested = {'all': [nested]};
      }
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root', children: [
          componentNode(type: 'Text', id: 'promo', visibility: nested),
        ]),
      );
      expectRejected(json, 'too_deep');
    });

    test('rejects a visibility.any with too many branches', () {
      final branches = List.generate(
        kMaxConditionBranches + 5,
        (i) => {'signal': 'cart.itemCount', 'operator': 'equals', 'value': i},
      );
      final json = baseSchemaJson(
        pageOverride: componentNode(type: 'Page', id: 'home-root', children: [
          componentNode(type: 'Text', id: 'promo', visibility: {'any': branches}),
        ]),
      );
      expectRejected(json, 'too_many_nodes');
    });
  });

  group('SchemaComponent.withChildren', () {
    test('preserves binding and visibility on the copy', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'ProductList',
              id: 'featured',
              binding: {'resource': 'commerce.products'},
              visibility: {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0},
            ),
          ],
        ),
      );
      final schema = AppSchema.parse(encodeSchema(json));
      final node = schema.pages['home']!.children.single;
      final copy = node.withChildren([]);
      expect(copy.binding?.resource, 'commerce.products');
      expect(copy.visibility?.signal, 'cart.itemCount');
    });
  });
}

import 'package:awj_mobile_runtime/app/binding_resolution.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

/// [VisibilityNode] has no public constructor (by design — the only way to
/// build one is the parser, so a condition tree is always the same
/// structurally-validated shape `CompatibilityResolver` already checked).
/// Tests build one the same way production code does: parse a minimal
/// schema document carrying the desired `visibility` JSON, then read it
/// back off the parsed node.
VisibilityNode _visibilityOf(Map<String, Object?> visibilityJson) {
  final json = baseSchemaJson(
    pageOverride: componentNode(
      type: 'Page',
      id: 'root',
      children: [componentNode(type: 'Button', id: 'x', visibility: visibilityJson)],
    ),
  );
  final schema = AppSchema.parse(encodeSchema(json));
  return schema.pages['home']!.children.single.visibility!;
}

SchemaComponent _node({
  required String type,
  required String id,
  bool optional = false,
  Map<String, Object?> props = const {},
  List<SchemaComponent> children = const [],
  ActionRef? action,
  SchemaBinding? binding,
  VisibilityNode? visibility,
}) {
  return SchemaComponent(
    type: type,
    id: id,
    optional: optional,
    props: props,
    children: children,
    action: action,
    binding: binding,
    visibility: visibility,
  );
}

void main() {
  group('readFieldPath', () {
    test('reads a top-level field', () {
      expect(readFieldPath({'id': 'p1'}, 'id'), 'p1');
    });

    test('reads a nested dotted path through Map keys only', () {
      expect(
        readFieldPath({
          'category': {'name': 'مشروبات'},
        }, 'category.name'),
        'مشروبات',
      );
    });

    test('returns null when a segment is missing', () {
      expect(readFieldPath({'id': 'p1'}, 'name'), isNull);
    });

    test('returns null when the path descends into a non-Map value', () {
      expect(readFieldPath({'id': 'p1'}, 'id.nested'), isNull);
    });

    test('returns null for a null root value', () {
      expect(readFieldPath(null, 'id'), isNull);
    });
  });

  group('substituteItemRefsInProps', () {
    test('replaces an exact "\$item.<field>" string with the resolved value', () {
      final result = substituteItemRefsInProps({'title': r'$item.name'}, {'name': 'قهوة'});
      expect(result, {'title': 'قهوة'});
    });

    test('leaves a literal string containing but not starting with the item-ref prefix untouched', () {
      final result = substituteItemRefsInProps({'title': r'Price: $item.id'}, {'id': 'p1'});
      expect(result, {'title': r'Price: $item.id'});
    });

    test('leaves non-item-ref values (numbers, plain strings, null) untouched', () {
      final result = substituteItemRefsInProps({'min': 1, 'label': 'ثابت', 'x': null}, {'id': 'p1'});
      expect(result, {'min': 1, 'label': 'ثابت', 'x': null});
    });

    test('substitutes recursively inside nested Map/List prop values', () {
      final result = substituteItemRefsInProps({
        'nested': {
          'a': r'$item.id',
          'list': [r'$item.name', 'literal'],
        },
      }, {'id': 'p1', 'name': 'قهوة'});

      expect(result, {
        'nested': {
          'a': 'p1',
          'list': ['قهوة', 'literal'],
        },
      });
    });

    test('an out-of-contract (nonexistent) \$item.* field resolves to null, never throws', () {
      final result = substituteItemRefsInProps({'x': r'$item.not_a_real_field'}, {'id': 'p1'});
      expect(result, {'x': isNull});
    });

    test(r'a bare "$item." with no field name resolves to null', () {
      final result = substituteItemRefsInProps({'x': r'$item.'}, {'id': 'p1'});
      expect(result, {'x': isNull});
    });
  });

  group('substituteItemRefsInAction', () {
    test('resolves an item-ref action param before dispatch', () {
      final action = ActionRef(type: 'openProduct', params: {'productId': r'$item.id'});
      final resolved = substituteItemRefsInAction(action, {'id': 'p1'});

      expect(resolved!.type, 'openProduct');
      expect(resolved.params, {'productId': 'p1'});
    });

    test('returns null when given a null action', () {
      expect(substituteItemRefsInAction(null, {'id': 'p1'}), isNull);
    });

    test('leaves a literal (non-item-ref) param value untouched', () {
      final action = ActionRef(type: 'refresh', params: {'source': 'manual'});
      final resolved = substituteItemRefsInAction(action, {'id': 'p1'});
      expect(resolved!.params, {'source': 'manual'});
    });
  });

  group('resolveNodeBindings — Home shape (collection is the resource result itself)', () {
    test('ProductList repeats its single ProductCard template once per fetched product', () {
      final template = _node(
        type: 'ProductCard',
        id: 'card-template',
        optional: true,
        props: {'title': r'$item.name', 'amountMinor': r'$item.priceMinor'},
        action: ActionRef(type: 'openProduct', params: {'productId': r'$item.id'}),
      );
      final productList = _node(
        type: 'ProductList',
        id: 'slot.home.products',
        binding: const SchemaBinding(resource: 'commerce.products', query: {}, itemProps: {}),
        children: [template],
      );

      final resolved = resolveNodeBindings(productList, {
        'commerce.products': [
          {'id': 'p1', 'name': 'قهوة', 'priceMinor': 1500},
          {'id': 'p2', 'name': 'شاي', 'priceMinor': 1200},
        ],
      });

      expect(resolved.binding, isNull);
      expect(resolved.children, hasLength(2));

      final first = resolved.children[0];
      expect(first.id, 'card-template-p1');
      expect(first.props, {'title': 'قهوة', 'amountMinor': 1500});
      expect(first.action!.params, {'productId': 'p1'});

      final second = resolved.children[1];
      expect(second.id, 'card-template-p2');
      expect(second.props, {'title': 'شاي', 'amountMinor': 1200});
    });

    test('an empty fetched product list repeats to zero children, not an error', () {
      final productList = _node(
        type: 'ProductList',
        id: 'slot.home.products',
        binding: const SchemaBinding(resource: 'commerce.products', query: {}, itemProps: {}),
        children: [_node(type: 'ProductCard', id: 'card-template')],
      );

      final resolved = resolveNodeBindings(productList, {'commerce.products': const []});

      expect(resolved.children, isEmpty);
    });
  });

  group('resolveNodeBindings — Cart shape (binding.collect into a nested list field)', () {
    test('CartList repeats a composite Section template once per cart item, resolving descendants', () {
      final template = _node(
        type: 'Section',
        id: 'cart-line-template',
        optional: true,
        props: {'title': r'$item.productName'},
        children: [
          _node(
            type: 'Price',
            id: 'cart-line-template-price',
            optional: true,
            props: {'amountMinor': r'$item.lineTotalMinor'},
          ),
          _node(
            type: 'Quantity',
            id: 'cart-line-template-qty',
            optional: true,
            props: {'value': r'$item.quantity', 'min': 1, 'max': 99},
            action: ActionRef(
              type: 'updateCartQuantity',
              params: {'cartItemId': r'$item.id', 'quantity': r'$item.quantity'},
            ),
          ),
          _node(
            type: 'Button',
            id: 'cart-line-template-remove',
            optional: true,
            props: {'label': 'إزالة'},
            action: ActionRef(type: 'removeCartItem', params: {'cartItemId': r'$item.id'}),
          ),
        ],
      );
      final cartList = _node(
        type: 'CartList',
        id: 'slot.cart.items',
        binding: const SchemaBinding(resource: 'commerce.cart', query: {}, itemProps: {}, collect: 'items'),
        children: [template],
      );

      final resolved = resolveNodeBindings(cartList, {
        'commerce.cart': {
          'status': 'active',
          'items': [
            {'id': 'i1', 'productName': 'قهوة', 'lineTotalMinor': 3000, 'quantity': 2},
          ],
        },
      });

      expect(resolved.children, hasLength(1));
      final line = resolved.children.single;
      expect(line.id, 'cart-line-template-i1');
      expect(line.props, {'title': 'قهوة'});

      final price = line.children.firstWhere((c) => c.type == 'Price');
      expect(price.props, {'amountMinor': 3000});
      // Descendant ids are not disambiguated across repeated instances —
      // only the top-level repeated node's id is (see the file's own doc
      // comment on Flutter key scoping).
      expect(price.id, 'cart-line-template-price');

      final qty = line.children.firstWhere((c) => c.type == 'Quantity');
      expect(qty.props, {'value': 2, 'min': 1, 'max': 99});
      expect(qty.action!.params, {'cartItemId': 'i1', 'quantity': 2});

      final removeButton = line.children.firstWhere((c) => c.type == 'Button');
      expect(removeButton.action!.params, {'cartItemId': 'i1'});
    });

    test('a collect target whose runtime value is not actually a list fails closed to zero children', () {
      final cartList = _node(
        type: 'CartList',
        id: 'slot.cart.items',
        binding: const SchemaBinding(resource: 'commerce.cart', query: {}, itemProps: {}, collect: 'items'),
        children: [_node(type: 'Section', id: 'cart-line-template')],
      );

      final resolved = resolveNodeBindings(cartList, {
        'commerce.cart': {'status': 'active', 'items': 'not-a-list'},
      });

      expect(resolved.children, isEmpty);
    });

    test('a binding node with no single authored template child fails closed to zero children', () {
      final cartListNoTemplate = _node(
        type: 'CartList',
        id: 'slot.cart.items',
        binding: const SchemaBinding(resource: 'commerce.cart', query: {}, itemProps: {}, collect: 'items'),
        children: const [],
      );
      final cartListTwoTemplates = _node(
        type: 'CartList',
        id: 'slot.cart.items',
        binding: const SchemaBinding(resource: 'commerce.cart', query: {}, itemProps: {}, collect: 'items'),
        children: [_node(type: 'Section', id: 'a'), _node(type: 'Section', id: 'b')],
      );
      final resourceData = {
        'commerce.cart': {
          'items': [
            {'id': 'i1'},
          ],
        },
      };

      expect(resolveNodeBindings(cartListNoTemplate, resourceData).children, isEmpty);
      expect(resolveNodeBindings(cartListTwoTemplates, resourceData).children, isEmpty);
    });
  });

  group('resolveNodeBindings — single-item binding (existing itemProps semantics preserved)', () {
    test('a non-collect binding substitutes itemProps onto the node\'s own props without repetition', () {
      final summary = _node(
        type: 'CartSummary',
        id: 'slot.cart.summary',
        props: {'itemCount': 0},
        binding: const SchemaBinding(
          resource: 'commerce.cart',
          query: {},
          itemProps: {'subtotalAmountMinor': 'subtotal'},
        ),
      );

      final resolved = resolveNodeBindings(summary, {
        'commerce.cart': {'subtotal': 4500},
      });

      expect(resolved.binding, isNull);
      expect(resolved.props, {'itemCount': 0, 'subtotalAmountMinor': 4500});
      expect(resolved.children, isEmpty);
    });

    test('resolveNodeBindings recurses into unbound descendants', () {
      final root = _node(
        type: 'Page',
        id: 'root',
        children: [
          _node(
            type: 'ProductList',
            id: 'list',
            binding: const SchemaBinding(resource: 'commerce.products', query: {}, itemProps: {}),
            children: [_node(type: 'ProductCard', id: 'template', props: {'title': r'$item.name'})],
          ),
          _node(type: 'Text', id: 'static-label', props: {'text': 'ثابت'}),
        ],
      );

      final resolved = resolveNodeBindings(root, {
        'commerce.products': [
          {'id': 'p1', 'name': 'قهوة'},
        ],
      });

      expect(resolved.children[0].children.single.props, {'title': 'قهوة'});
      expect(resolved.children[1].props, {'text': 'ثابت'});
    });
  });

  group('CompatibilityResolver + resolveNodeBindings composed end-to-end', () {
    test('a collect binding approved by a manifest that declares the capability hydrates correctly', () {
      final json = '''
      {
        "schemaVersion": "1.0.0",
        "minRuntimeVersion": "1.0.0",
        "navigation": {"initialPageId": "cart"},
        "pages": {
          "cart": {
            "type": "Page",
            "id": "cart-root",
            "children": [
              {
                "type": "CartList",
                "id": "slot.cart.items",
                "binding": {"resource": "commerce.cart", "collect": "items"},
                "children": [
                  {"type": "Section", "id": "line-template", "props": {"title": "\$item.productName"}}
                ]
              }
            ]
          }
        }
      }
      ''';
      final schema = AppSchema.parse(json);
      final manifest = CapabilityManifest(
        platform: RuntimePlatform.ios,
        runtimeVersion: SchemaVersion.parse('1.0.0'),
        minSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
        maxSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
        components: RuntimeCapabilities.components,
        actions: RuntimeCapabilities.actions,
        nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
        dataResources: const {'commerce.cart': 1},
        schemaFeatures: const {'binding.collect': 1},
      );

      final result = const CompatibilityResolver().resolve(schema, manifest);
      expect(result, isA<RenderableExperience>());
      final page = (result as RenderableExperience).pages['cart']!;

      final hydrated = resolveNodeBindings(page, {
        'commerce.cart': {
          'items': [
            {'productName': 'قهوة'},
          ],
        },
      });

      final cartList = hydrated.children.single;
      expect(cartList.children.single.props, {'title': 'قهوة'});
    });
  });

  group('evaluateVisibility', () {
    test('isTrue/isFalse read the named signal directly', () {
      final isTrueCond = _visibilityOf({'signal': 'customer.isAuthenticated', 'operator': 'isTrue'});
      final isFalseCond = _visibilityOf({'signal': 'customer.isAuthenticated', 'operator': 'isFalse'});

      expect(evaluateVisibility(isTrueCond, {'customer.isAuthenticated': true}), isTrue);
      expect(evaluateVisibility(isTrueCond, {'customer.isAuthenticated': false}), isFalse);
      expect(evaluateVisibility(isFalseCond, {'customer.isAuthenticated': false}), isTrue);
    });

    test('equals/notEquals compare the signal to the leaf value', () {
      final eq = _visibilityOf({'signal': 'cart.itemCount', 'operator': 'equals', 'value': 3});
      expect(evaluateVisibility(eq, {'cart.itemCount': 3}), isTrue);
      expect(evaluateVisibility(eq, {'cart.itemCount': 4}), isFalse);
    });

    test('numeric comparison operators (gt/lt/gte/lte)', () {
      final gt = _visibilityOf({'signal': 'cart.itemCount', 'operator': 'gt', 'value': 2});
      expect(evaluateVisibility(gt, {'cart.itemCount': 3}), isTrue);
      expect(evaluateVisibility(gt, {'cart.itemCount': 2}), isFalse);
    });

    test('a numeric comparison against a non-comparable actual value fails closed (false)', () {
      final gt = _visibilityOf({'signal': 'cart.itemCount', 'operator': 'gt', 'value': 2});
      expect(evaluateVisibility(gt, {'cart.itemCount': 'not-a-number'}), isFalse);
    });

    test("inList checks membership in the leaf's value list", () {
      final inListCond = _visibilityOf({
        'signal': 'customer.isAuthenticated',
        'operator': 'in',
        'value': [true],
      });
      expect(evaluateVisibility(inListCond, {'customer.isAuthenticated': true}), isTrue);
      expect(evaluateVisibility(inListCond, {'customer.isAuthenticated': false}), isFalse);
    });

    test('a nested any/all group evaluates every branch', () {
      final group = _visibilityOf({
        'all': [
          {'signal': 'cart.itemCount', 'operator': 'gt', 'value': 0},
          {'signal': 'customer.isAuthenticated', 'operator': 'isTrue'},
        ],
      });
      expect(evaluateVisibility(group, {'cart.itemCount': 1, 'customer.isAuthenticated': true}), isTrue);
      expect(evaluateVisibility(group, {'cart.itemCount': 1, 'customer.isAuthenticated': false}), isFalse);
    });
  });

  group('pruneInvisible', () {
    test('drops a node (and its subtree) whose visibility evaluates false', () {
      final root = _node(
        type: 'Page',
        id: 'root',
        children: [
          _node(
            type: 'Button',
            id: 'hidden',
            visibility: _visibilityOf({'signal': 'customer.isAuthenticated', 'operator': 'isTrue'}),
            children: [_node(type: 'Text', id: 'hidden-child')],
          ),
          _node(type: 'Text', id: 'always-visible'),
        ],
      );

      final pruned = pruneInvisible(root, {'customer.isAuthenticated': false})!;

      expect(pruned.children, hasLength(1));
      expect(pruned.children.single.id, 'always-visible');
    });

    test('keeps a node with no visibility condition unaffected', () {
      final root = _node(type: 'Text', id: 'plain');
      expect(pruneInvisible(root, const {})!.id, 'plain');
    });
  });
}

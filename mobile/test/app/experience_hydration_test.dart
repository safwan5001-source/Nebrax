import 'package:awj_mobile_runtime/app/experience_hydration.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

SchemaComponent node({
  required String type,
  required String id,
  List<SchemaComponent> children = const [],
}) {
  return SchemaComponent(
    type: type,
    id: id,
    optional: false,
    props: const {},
    children: children,
  );
}

void main() {
  test('hydrateNode replaces the target descendant, leaving the rest of the tree untouched', () {
    final root = node(
      type: 'Page',
      id: 'root',
      children: [
        node(
          type: 'Section',
          id: 'hero',
          children: [node(type: 'Text', id: 'title')],
        ),
        node(type: 'ProductList', id: 'slot.products'),
      ],
    );

    final result = hydrateNode(
      root,
      'slot.products',
      (n) => n.withChildren([node(type: 'ProductCard', id: 'p1')]),
    );

    expect(result.id, 'root');
    expect(result.children[0].id, 'hero');
    expect(result.children[1].id, 'slot.products');
    expect(result.children[1].children, hasLength(1));
    expect(result.children[1].children.single.id, 'p1');
  });

  test('hydrateNode finds a deeply nested target', () {
    final root = node(
      type: 'Page',
      id: 'root',
      children: [
        node(
          type: 'Section',
          id: 'outer',
          children: [
            node(
              type: 'Section',
              id: 'inner',
              children: [node(type: 'CartList', id: 'slot.cart')],
            ),
          ],
        ),
      ],
    );

    final result = hydrateNode(
      root,
      'slot.cart',
      (n) => n.withChildren([node(type: 'Section', id: 'line-1')]),
    );

    final cartList = result.children.single.children.single.children.single;
    expect(cartList.id, 'slot.cart');
    expect(cartList.children.single.id, 'line-1');
  });

  test('hydrateNode leaves the tree unchanged when the target id is not found (fail-safe)', () {
    final root = node(
      type: 'Page',
      id: 'root',
      children: [node(type: 'Text', id: 'title')],
    );

    final result = hydrateNode(
      root,
      'does-not-exist',
      (n) => n.withChildren([node(type: 'Text', id: 'x')]),
    );

    expect(result.children.single.id, 'title');
    expect(result.children.single.children, isEmpty);
  });

  test('hydrateNode can replace the root node itself', () {
    final root = node(type: 'CartSummary', id: 'slot.summary');
    final result = hydrateNode(
      root,
      'slot.summary',
      (n) => SchemaComponent(
        type: n.type,
        id: n.id,
        optional: n.optional,
        props: const {'itemCount': 3},
        children: n.children,
      ),
    );
    expect(result.props['itemCount'], 3);
  });

  SchemaComponent withItemCount(SchemaComponent n, int count) => SchemaComponent(
    type: n.type,
    id: n.id,
    optional: n.optional,
    props: {'itemCount': count},
    children: n.children,
  );

  test(
    'hydrateNodesByType replaces a CartSummary node under an arbitrary, non-default id '
    '(RUNTIME-CORRECTNESS-3 — the generic type-keyed lookup a real Published Experience needs)',
    () {
      final root = node(
        type: 'Page',
        id: 'cart-root',
        children: [
          node(type: 'CartList', id: 'cart-items'),
          // A merchant-authored id, never the bundled Default schema's own
          // 'slot.cart.summary' — this is exactly the case id-keyed
          // hydrateNode cannot serve.
          node(type: 'CartSummary', id: 'merchant-authored-summary-node'),
        ],
      );

      final result = hydrateNodesByType(root, 'CartSummary', (n) => withItemCount(n, 3));

      expect(result.children[0].id, 'cart-items');
      expect(result.children[1].id, 'merchant-authored-summary-node');
      expect(result.children[1].props['itemCount'], 3);
    },
  );

  test('hydrateNodesByType finds a deeply nested target by type', () {
    final root = node(
      type: 'Page',
      id: 'root',
      children: [
        node(
          type: 'Section',
          id: 'outer',
          children: [
            node(
              type: 'Section',
              id: 'inner',
              children: [node(type: 'CartSummary', id: 'buried-summary')],
            ),
          ],
        ),
      ],
    );

    final result = hydrateNodesByType(root, 'CartSummary', (n) => withItemCount(n, 7));

    final summary = result.children.single.children.single.children.single;
    expect(summary.id, 'buried-summary');
    expect(summary.props['itemCount'], 7);
  });

  test(
    'hydrateNodesByType applies the transform to every matching node — deterministic, '
    'never a special-cased single id',
    () {
      final root = node(
        type: 'Page',
        id: 'root',
        children: [
          node(type: 'CartSummary', id: 'summary-a'),
          node(
            type: 'Section',
            id: 'wrapper',
            children: [node(type: 'CartSummary', id: 'summary-b')],
          ),
        ],
      );

      final result = hydrateNodesByType(root, 'CartSummary', (n) => withItemCount(n, 5));

      expect(result.children[0].props['itemCount'], 5);
      expect(result.children[1].children.single.props['itemCount'], 5);
    },
  );

  test('hydrateNodesByType leaves the tree unchanged when the type is not found (fail-safe)', () {
    final root = node(
      type: 'Page',
      id: 'root',
      children: [node(type: 'Text', id: 'title')],
    );

    final result = hydrateNodesByType(root, 'CartSummary', (n) => withItemCount(n, 1));

    expect(result.children.single.id, 'title');
    expect(result.children.single.children, isEmpty);
  });

  test('hydrateNodesByType can replace the root node itself', () {
    final root = node(type: 'CartSummary', id: 'any-id');
    final result = hydrateNodesByType(root, 'CartSummary', (n) => withItemCount(n, 9));
    expect(result.props['itemCount'], 9);
  });
}

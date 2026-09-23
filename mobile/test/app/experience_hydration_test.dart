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
}

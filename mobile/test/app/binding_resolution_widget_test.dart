import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/binding_resolution.dart';
import 'package:awj_mobile_runtime/registry/registry.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../actions/recording_action_handler.dart';

/// End-to-end proof that the `binding.collect` mechanism (`APP-BUILDER-17`
/// slice 3, Decision Gate approved) renders and dispatches correctly through
/// the *real* `ComponentRegistry`/`AppActionDispatcher` — the same widgets
/// and dispatch path the shipped app uses — for exactly the two shapes the
/// approved Slice 3 target names: Home's `ProductList` (collection is the
/// resource result itself) and Cart's `CartList` (`binding.collect =
/// "items"`, a composite per-line template).
///
/// Deliberately **not** wired through `HomeScreen`/`CartScreen` here: those
/// screens resolve their bundled schema against `CapabilityManifest.current()`,
/// whose `dataResources`/`schemaFeatures` stay empty by design this slice
/// (see `RuntimeCapabilities.dataResources`'s own doc comment) — the
/// "shipped/proven mobile-runtime condition" the Decision Gate's amendments
/// require before that capability flip is an operational milestone, not
/// something this task can attest to. This test instead proves the pipeline
/// itself end-to-end (`resolveNodeBindings` -> `ComponentView` -> real action
/// dispatch) using a manifest that *does* declare the capability, exactly
/// the same technique `compatibility_test.dart`'s `manifestOf` already uses
/// to simulate a not-yet-shipped runtime state.
SchemaComponent _node({
  required String type,
  required String id,
  bool optional = false,
  Map<String, Object?> props = const {},
  List<SchemaComponent> children = const [],
  ActionRef? action,
  SchemaBinding? binding,
}) {
  return SchemaComponent(
    type: type,
    id: id,
    optional: optional,
    props: props,
    children: children,
    action: action,
    binding: binding,
  );
}

void main() {
  group('Home widget/runtime behavior — ProductList via binding.resource', () {
    testWidgets('renders one ProductCard per fetched product and dispatches openProduct with its real id', (
      tester,
    ) async {
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

      final handler = RecordingActionHandler();
      final dispatcher = AppActionDispatcher(handler);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ComponentView(node: resolved, onAction: dispatcher.dispatch)),
        ),
      );

      expect(find.text('قهوة'), findsOneWidget);
      expect(find.text('شاي'), findsOneWidget);

      await tester.tap(find.text('قهوة'));
      await tester.pumpAndSettle();

      expect(handler.received, hasLength(1));
      expect((handler.received.single as OpenProductAction).productId, 'p1');
    });
  });

  group('Cart widget/runtime behavior — CartList via binding.collect', () {
    testWidgets('renders each cart line and resolves cartItemId from the item before dispatch', (tester) async {
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
            props: {'label': 'إزالة', 'style': 'secondary'},
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
          'items': [
            {'id': 'i1', 'productName': 'قهوة', 'lineTotalMinor': 3000, 'quantity': 2},
          ],
        },
      });

      final handler = RecordingActionHandler();
      final dispatcher = AppActionDispatcher(handler);
      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(body: ComponentView(node: resolved, onAction: dispatcher.dispatch)),
        ),
      );

      expect(find.text('قهوة'), findsOneWidget);
      expect(find.textContaining('30.00'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('quantity-increment')));
      await tester.pumpAndSettle();

      expect(handler.received, hasLength(1));
      final updated = handler.received.single as UpdateCartQuantityAction;
      expect(updated.cartItemId, 'i1');
      expect(updated.quantity, 3);

      await tester.tap(find.text('إزالة'));
      await tester.pumpAndSettle();

      expect(handler.received, hasLength(2));
      expect((handler.received.last as RemoveCartItemAction).cartItemId, 'i1');
    });
  });
}

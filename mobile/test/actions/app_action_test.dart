import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'recording_action_handler.dart';

ActionRef ref(String type, Map<String, Object?> params) => ActionRef(type: type, params: params);

void main() {
  group('decodeAction — valid', () {
    test('navigate', () {
      final action = decodeAction(ref('navigate', {'pageId': 'home'}));
      expect(action, isA<NavigateAction>());
      expect((action as NavigateAction).pageId, 'home');
    });

    test('openProduct', () {
      final action = decodeAction(ref('openProduct', {'productId': 'p-1'}));
      expect(action, isA<OpenProductAction>());
      expect((action as OpenProductAction).productId, 'p-1');
    });

    test('addToCart with defaults', () {
      final action = decodeAction(ref('addToCart', {'productId': 'p-1'}));
      expect(action, isA<AddToCartAction>());
      final a = action as AddToCartAction;
      expect(a.productId, 'p-1');
      expect(a.quantity, 1);
      expect(a.variantId, isNull);
    });

    test('addToCart with explicit variant and quantity', () {
      final action = decodeAction(
        ref('addToCart', {'productId': 'p-1', 'variantId': 'v-1', 'quantity': 3}),
      );
      final a = action as AddToCartAction;
      expect(a.variantId, 'v-1');
      expect(a.quantity, 3);
    });

    test('updateCartQuantity', () {
      final action = decodeAction(ref('updateCartQuantity', {'cartItemId': 'ci-1', 'quantity': 5}));
      final a = action as UpdateCartQuantityAction;
      expect(a.cartItemId, 'ci-1');
      expect(a.quantity, 5);
    });

    test('updateCartQuantity allows zero (removal-by-zero is the caller\'s policy, not decoded here)', () {
      final action = decodeAction(ref('updateCartQuantity', {'cartItemId': 'ci-1', 'quantity': 0}));
      expect(action, isA<UpdateCartQuantityAction>());
    });

    test('removeCartItem', () {
      final action = decodeAction(ref('removeCartItem', {'cartItemId': 'ci-1'}));
      expect(action, isA<RemoveCartItemAction>());
    });

    test('refresh ignores any params', () {
      final action = decodeAction(ref('refresh', {'unused': true}));
      expect(action, isA<RefreshAction>());
    });
  });

  group('decodeAction — malformed/unknown negatives (fail-safe null, never throws)', () {
    test('unknown action type', () {
      expect(decodeAction(ref('deleteAccount', {})), isNull);
    });

    test('navigate missing pageId', () {
      expect(decodeAction(ref('navigate', {})), isNull);
    });

    test('navigate with wrong-typed pageId', () {
      expect(decodeAction(ref('navigate', {'pageId': 42})), isNull);
    });

    test('addToCart missing productId', () {
      expect(decodeAction(ref('addToCart', {})), isNull);
    });

    test('addToCart with zero quantity', () {
      expect(decodeAction(ref('addToCart', {'productId': 'p-1', 'quantity': 0})), isNull);
    });

    test('addToCart with wrong-typed variantId', () {
      expect(decodeAction(ref('addToCart', {'productId': 'p-1', 'variantId': 42})), isNull);
    });

    test('updateCartQuantity with negative quantity', () {
      expect(decodeAction(ref('updateCartQuantity', {'cartItemId': 'ci-1', 'quantity': -1})), isNull);
    });

    test('updateCartQuantity missing cartItemId', () {
      expect(decodeAction(ref('updateCartQuantity', {'quantity': 1})), isNull);
    });

    test('removeCartItem missing cartItemId', () {
      expect(decodeAction(ref('removeCartItem', {})), isNull);
    });

    test('recognized type set matches RuntimeCapabilities.actions exactly', () {
      for (final type in RuntimeCapabilities.actions.keys) {
        // Each allowlisted type must be decodable given *some* valid params
        // shape — this loop only proves the switch has a non-default case
        // for it, using minimal plausible params per type.
        final params = switch (type) {
          'navigate' => {'pageId': 'x'},
          'openProduct' => {'productId': 'x'},
          'addToCart' => {'productId': 'x'},
          'updateCartQuantity' => {'cartItemId': 'x', 'quantity': 1},
          'removeCartItem' => {'cartItemId': 'x'},
          'refresh' => <String, Object?>{},
          _ => throw StateError('test does not know how to exercise action type "$type" — '
              'add a case above when RuntimeCapabilities.actions gains a new entry'),
        };
        expect(decodeAction(ref(type, params)), isNotNull, reason: 'type "$type" should decode');
      }
      // And nothing outside the allowlist should decode.
      expect(decodeAction(ref('notAnAllowlistedAction', {})), isNull);
    });
  });

  group('AppActionDispatcher', () {
    test('dispatches a decoded action to the matching handler method', () async {
      final handler = RecordingActionHandler();
      final dispatcher = AppActionDispatcher(handler);

      await dispatcher.dispatch(ref('navigate', {'pageId': 'cart'}));
      await dispatcher.dispatch(ref('addToCart', {'productId': 'p-1'}));

      expect(handler.received, hasLength(2));
      expect(handler.received[0], isA<NavigateAction>());
      expect(handler.received[1], isA<AddToCartAction>());
    });

    test('a malformed-but-known action type dispatches nothing (fail-safe)', () async {
      final handler = RecordingActionHandler();
      final dispatcher = AppActionDispatcher(handler);

      await dispatcher.dispatch(ref('addToCart', {})); // missing productId

      expect(handler.received, isEmpty);
    });

    test('NoopActionHandler never throws for any action', () async {
      const dispatcher = AppActionDispatcher(NoopActionHandler());
      await dispatcher.dispatch(ref('navigate', {'pageId': 'home'}));
      await dispatcher.dispatch(ref('refresh', {}));
      // Reaching here without an exception is the assertion.
    });
  });
}

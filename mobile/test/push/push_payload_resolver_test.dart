import 'package:awj_mobile_runtime/push/push_payload_resolver.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('resolvePushPayload — valid payloads', () {
    test('a navigate payload resolves to the matching navigate ActionRef', () {
      final action = resolvePushPayload({'type': 'navigate', 'pageId': 'cart'});
      expect(action?.type, 'navigate');
      expect(action?.params, {'pageId': 'cart'});
    });

    test('an openProduct payload resolves with that productId', () {
      final action = resolvePushPayload({'type': 'openProduct', 'productId': 'p1'});
      expect(action?.type, 'openProduct');
      expect(action?.params, {'productId': 'p1'});
    });

    test('extra unrelated data fields are ignored, never read', () {
      final action = resolvePushPayload({
        'type': 'openProduct',
        'productId': 'p1',
        'campaign': 'ramadan-2026',
        'token': 'leaked',
      });
      expect(action?.type, 'openProduct');
      expect(action?.params, {'productId': 'p1'});
    });
  });

  group(
    'resolvePushPayload — malformed/malicious negatives (fail-safe null, never throws)',
    () {
      test('an empty payload is rejected', () {
        expect(resolvePushPayload(const {}), isNull);
      });

      test('an unrecognized type is rejected', () {
        expect(resolvePushPayload({'type': 'checkout', 'pageId': 'home'}), isNull);
      });

      test('navigate with no pageId is rejected', () {
        expect(resolvePushPayload({'type': 'navigate'}), isNull);
      });

      test('navigate with an empty pageId is rejected', () {
        expect(resolvePushPayload({'type': 'navigate', 'pageId': ''}), isNull);
      });

      test('openProduct with no productId is rejected', () {
        expect(resolvePushPayload({'type': 'openProduct'}), isNull);
      });

      test('openProduct with an empty productId is rejected', () {
        expect(resolvePushPayload({'type': 'openProduct', 'productId': ''}), isNull);
      });

      test('an oversized productId is rejected', () {
        final oversized = 'p' * 500;
        expect(
          resolvePushPayload({'type': 'openProduct', 'productId': oversized}),
          isNull,
        );
      });
    },
  );

  group(
    'resolvePushPayload — cannot produce a destructive/sensitive action',
    () {
      test(
        'no payload can resolve to anything other than navigate/openProduct',
        () {
          // A structural guarantee, not just an empirical one — see this
          // function's own doc comment: there is no branch here that
          // constructs any other ActionRef type.
          const attempts = [
            {'type': 'addToCart', 'productId': 'p1'},
            {'type': 'updateCartQuantity', 'cartItemId': 'c1', 'quantity': '0'},
            {'type': 'removeCartItem', 'cartItemId': 'c1'},
          ];
          for (final data in attempts) {
            final action = resolvePushPayload(data);
            expect(
              action == null ||
                  action.type == 'navigate' ||
                  action.type == 'openProduct',
              isTrue,
            );
          }
        },
      );
    },
  );
}

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/runtime_action_handler.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

CommerceClient _client(FakeCommerceTransport transport) {
  return CommerceClient(
    config: CommerceConfig(
      baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
      storeBearerToken: 't',
    ),
    sessionStore: InMemorySecureSessionStore(),
    transport: transport,
  );
}

void main() {
  test(
    'onNavigate maps known pageIds and ignores unknown ones (fail-safe)',
    () async {
      final state = RuntimeState();
      final handler = RuntimeActionHandler(
        client: _client(
          FakeCommerceTransport.always(
            jsonResponse(200, {'data': {}, 'meta': successMeta()}),
          ),
        ),
        state: state,
        onError: (_) => fail('should not error'),
      );

      await handler.onNavigate(const NavigateAction('cart'));
      expect(state.page, RuntimePage.cart);

      await handler.onNavigate(const NavigateAction('home'));
      expect(state.page, RuntimePage.home);

      await handler.onNavigate(const NavigateAction('does-not-exist'));
      expect(state.page, RuntimePage.home); // unchanged
    },
  );

  test(
    'onOpenProduct navigates to the product page with the given id',
    () async {
      final state = RuntimeState();
      final handler = RuntimeActionHandler(
        client: _client(
          FakeCommerceTransport.always(
            jsonResponse(200, {'data': {}, 'meta': successMeta()}),
          ),
        ),
        state: state,
        onError: (_) => fail('should not error'),
      );

      await handler.onOpenProduct(const OpenProductAction('p1'));

      expect(state.page, RuntimePage.product);
      expect(state.selectedProductId, 'p1');
    },
  );

  test(
    'onAddToCart calls the Commerce API and marks the cart changed on success',
    () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(201, {
          'data': {
            'status': 'open',
            'items': [],
            'subtotal': money(amountMinor: 0),
            'currency': 'SAR',
            'has_unavailable_items': false,
          },
          'meta': successMeta(),
        }),
      );
      final state = RuntimeState();
      final handler = RuntimeActionHandler(
        client: _client(transport),
        state: state,
        onError: (_) => fail('should not error'),
      );

      await handler.onAddToCart(
        const AddToCartAction(productId: 'p1', quantity: 2),
      );

      expect(state.cartVersion, 1);
      final sent = transport.requests.single;
      expect(sent.uri.path, endsWith('/cart/items'));
      expect(sent.body, contains('"quantity":2'));
    },
  );

  test(
    'onAddToCart reports the server error and does not mark the cart changed',
    () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(422, errorEnvelope('validation_failed', 'out of stock')),
      );
      final state = RuntimeState();
      String? reportedError;
      final handler = RuntimeActionHandler(
        client: _client(transport),
        state: state,
        onError: (m) => reportedError = m,
      );

      await handler.onAddToCart(
        const AddToCartAction(productId: 'p1', quantity: 1),
      );

      expect(state.cartVersion, 0);
      expect(reportedError, 'out of stock');
    },
  );

  test('onUpdateCartQuantity and onRemoveCartItem mark the cart changed on success', () async {
    final cartResponse = jsonResponse(200, {
      'data': {
        'status': 'open',
        'items': [],
        'subtotal': money(amountMinor: 0),
        'currency': 'SAR',
        'has_unavailable_items': false,
      },
      'meta': successMeta(),
    });
    final state = RuntimeState();
    final handler = RuntimeActionHandler(
      client: _client(FakeCommerceTransport.always(cartResponse)),
      state: state,
      onError: (_) => fail('should not error'),
    );

    await handler.onUpdateCartQuantity(
      const UpdateCartQuantityAction(cartItemId: 'ci-1', quantity: 3),
    );
    expect(state.cartVersion, 1);

    await handler.onRemoveCartItem(const RemoveCartItemAction('ci-1'));
    expect(state.cartVersion, 2);
  });

  test(
    'onRefresh bumps refreshVersion without touching the Commerce API',
    () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {'data': {}, 'meta': successMeta()}),
      );
      final state = RuntimeState();
      final handler = RuntimeActionHandler(
        client: _client(transport),
        state: state,
        onError: (_) => fail('should not error'),
      );

      await handler.onRefresh(const RefreshAction());

      expect(state.refreshVersion, 1);
      expect(transport.requests, isEmpty);
    },
  );
}

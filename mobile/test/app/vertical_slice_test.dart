import 'dart:convert';

import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

/// A minimal stateful fake `/commerce/v1` server: just enough of
/// products/cart to drive the full Home -> Product -> Add to Cart -> Cart
/// -> Remove vertical slice (`AWJ_MOBILE_RUNTIME_PROOF_HORIZON_V1.md` §5)
/// end-to-end against real [CommerceClient] request/response shapes, with
/// no real socket.
class _FakeCommerceServer {
  final List<Map<String, Object?>> _cartItems = [];

  Future<CommerceHttpResponse> handle(CommerceHttpRequest request) async {
    final segments = request.uri.pathSegments;

    if (request.method == CommerceHttpMethod.get &&
        segments.last == 'products') {
      return jsonResponse(200, {
        'data': [
          {
            'id': 'p1',
            'name': 'تمر',
            'name_en': null,
            'description': null,
            'sku': null,
            'category': null,
            'price': money(amountMinor: 5000),
            'in_stock': true,
            'thumbnail_url': null,
            'is_variant_managed': false,
            'created_at': null,
            'updated_at': null,
          },
          {
            'id': 'p2',
            'name': 'تيشيرت',
            'name_en': null,
            'description': null,
            'sku': null,
            'category': null,
            'price': money(amountMinor: 6000),
            'in_stock': true,
            'thumbnail_url': null,
            'is_variant_managed': true,
            'created_at': null,
            'updated_at': null,
          },
        ],
        'meta': paginationMeta(total: 2),
      });
    }

    if (request.method == CommerceHttpMethod.get &&
        segments.contains('products') &&
        segments.last == 'p1') {
      return jsonResponse(200, {
        'data': {
          'id': 'p1',
          'name': 'تمر',
          'name_en': null,
          'description': 'تمر سكري فاخر',
          'sku': null,
          'category': null,
          'price': money(amountMinor: 5000),
          'in_stock': true,
          'thumbnail_url': null,
          'is_variant_managed': false,
          'created_at': null,
          'updated_at': null,
          'media': [],
        },
        'meta': successMeta(),
      });
    }

    if (request.method == CommerceHttpMethod.get && segments.last == 'cart') {
      return jsonResponse(200, {'data': _cartJson(), 'meta': successMeta()});
    }

    if (request.method == CommerceHttpMethod.post && segments.last == 'items') {
      final body = jsonDecode(request.body!) as Map<String, Object?>;
      _cartItems.add({
        'id': 'ci-${_cartItems.length + 1}',
        'product_id': body['product_id'],
        'product_variant_id': body['product_variant_id'],
        'variant_descriptor': null,
        'product_name': 'تمر',
        'unit_key': 'default',
        'unit_name': null,
        'quantity': body['quantity'],
        'unit_price': money(amountMinor: 5000),
        'line_total': money(amountMinor: 5000 * (body['quantity'] as int)),
        'available': true,
      });
      return jsonResponse(201, {'data': _cartJson(), 'meta': successMeta()});
    }

    if (request.method == CommerceHttpMethod.patch &&
        segments.contains('items')) {
      final itemId = segments.last;
      final body = jsonDecode(request.body!) as Map<String, Object?>;
      final index = _cartItems.indexWhere((item) => item['id'] == itemId);
      if (index == -1) {
        return jsonResponse(404, errorEnvelope('not_found', 'no such cart item'));
      }
      final quantity = body['quantity'] as int;
      _cartItems[index] = {
        ..._cartItems[index],
        'quantity': quantity,
        'line_total': money(amountMinor: 5000 * quantity),
      };
      return jsonResponse(200, {'data': _cartJson(), 'meta': successMeta()});
    }

    if (request.method == CommerceHttpMethod.delete &&
        segments.contains('items')) {
      final itemId = segments.last;
      _cartItems.removeWhere((item) => item['id'] == itemId);
      return jsonResponse(200, {'data': _cartJson(), 'meta': successMeta()});
    }

    return jsonResponse(
      404,
      errorEnvelope(
        'not_found',
        'no fake route for ${request.method} ${request.uri.path}',
      ),
    );
  }

  Map<String, Object?> _cartJson() {
    final subtotal = _cartItems.fold<int>(
      0,
      (sum, item) => sum + (item['line_total'] as Map)['amount_minor'] as int,
    );
    return {
      'status': _cartItems.isEmpty ? null : 'open',
      'items': _cartItems,
      'subtotal': money(amountMinor: subtotal),
      'currency': 'SAR',
      'has_unavailable_items': false,
    };
  }
}

void main() {
  testWidgets('Home -> Product -> Add to Cart -> Cart -> Remove', (
    tester,
  ) async {
    final server = _FakeCommerceServer();
    final client = CommerceClient(
      config: CommerceConfig(
        baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
        storeBearerToken: 't',
      ),
      sessionStore: InMemorySecureSessionStore(),
      transport: FakeCommerceTransport(server.handle),
    );

    await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
    await tester.pumpAndSettle();

    // Home: static shell from the bundled schema + live product list.
    expect(find.text('أَوْج'), findsOneWidget);
    expect(find.text('تمر'), findsOneWidget);
    expect(find.text('تيشيرت'), findsOneWidget);

    // Tap the first product card -> Product screen.
    await tester.tap(find.text('تمر').first);
    await tester.pumpAndSettle();

    expect(find.text('تمر سكري فاخر'), findsOneWidget);

    // Add to cart with the default quantity (1).
    await tester.tap(find.text('إضافة للسلة'));
    await tester.pumpAndSettle();

    // Back to Home, then to Cart.
    await tester.tap(find.text('الرئيسية'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('عرض السلة'));
    await tester.pumpAndSettle();

    expect(find.text('تمر'), findsOneWidget);
    expect(find.text('عنصر واحد'), findsOneWidget);
    expect(find.textContaining('50.00'), findsNWidgets(2)); // line price + summary subtotal

    // Increase the line's quantity -> proves `$item.id` resolves into the
    // real `updateCartQuantity` dispatch (schema binding action-param
    // resolution, APP-BUILDER-17 slice 3b) end-to-end: real widget tap ->
    // real action dispatch -> real PATCH request -> fake server update ->
    // real re-fetch -> re-render, both the line's own price and the
    // summary's subtotal reflecting the server's new total.
    await tester.tap(find.byKey(const ValueKey('quantity-increment')));
    await tester.pumpAndSettle();

    expect(find.textContaining('100.00'), findsNWidgets(2));

    // Remove the line -> cart empties.
    await tester.tap(find.text('إزالة'));
    await tester.pumpAndSettle();

    expect(find.text('لا عناصر'), findsOneWidget);
  });
}

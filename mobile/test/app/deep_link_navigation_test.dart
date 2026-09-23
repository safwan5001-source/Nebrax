import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/deeplink/deep_link_resolver.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

/// End-to-end proof that a validated Universal Link / App Link actually
/// drives this runtime's real navigation (MR-08's "product link" proof
/// bullet) — not just that [resolveDeepLinkUri] returns the right
/// [ActionRef] in isolation (`deep_link_resolver_test.dart`) or that
/// [DeepLinkController] calls its callback (`deep_link_channel_test.dart`).
/// This drives the full path: a simulated native platform-channel call ->
/// resolve -> `AppActionDispatcher.dispatch` -> `RuntimeActionHandler` ->
/// `RuntimeState` -> the real `ProductScreen` rendering that product's real
/// (fake-server-provided) data.
void main() {
  const channel = MethodChannel('awj/deep_links');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    final segments = request.uri.pathSegments;
    if (segments.contains('products') && segments.last == 'p1') {
      return jsonResponse(200, {
        'data': {
          'id': 'p1',
          'name': 'تمر سكري',
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
          'media': [],
        },
        'meta': successMeta(),
      });
    }
    if (segments.last == 'cart') {
      return jsonResponse(200, {
        'data': {
          'status': null,
          'items': [],
          'subtotal': money(amountMinor: 0),
          'currency': 'SAR',
          'has_unavailable_items': false,
        },
        'meta': successMeta(),
      });
    }
    return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
  }

  testWidgets(
    'a cold-start product link opens directly on that Product screen, '
    'skipping Home',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialLink') {
              return 'https://$kDeepLinkHost/product/p1';
            }
            return null;
          });

      final client = CommerceClient(
        config: CommerceConfig(
          baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
          storeBearerToken: 'test-token',
        ),
        sessionStore: InMemorySecureSessionStore(),
        transport: FakeCommerceTransport(handler),
      );

      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      expect(find.text('تمر سكري'), findsOneWidget);
    },
  );

  testWidgets(
    'a live (warm-start) cart link navigates away from Home to Cart',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final client = CommerceClient(
        config: CommerceConfig(
          baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
          storeBearerToken: 'test-token',
        ),
        sessionStore: InMemorySecureSessionStore(),
        transport: FakeCommerceTransport(handler),
      );

      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      // Home is showing (its own schema-declared "go to cart" link).
      expect(find.text('عرض السلة'), findsOneWidget);

      final data = const StandardMethodCodec().encodeMethodCall(
        MethodCall('onLink', 'https://$kDeepLinkHost/cart'),
      );
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(channel.name, data, (_) {});
      await tester.pumpAndSettle();

      // Cart's own schema-declared "continue shopping" link only exists on
      // the Cart screen — its presence proves navigation actually happened.
      expect(find.text('متابعة التسوق'), findsOneWidget);
    },
  );

  testWidgets(
    'a link that fails the allowlist is silently ignored — Home stays showing',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialLink') {
              return 'https://evil.example/product/p1';
            }
            return null;
          });

      final client = CommerceClient(
        config: CommerceConfig(
          baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
          storeBearerToken: 'test-token',
        ),
        sessionStore: InMemorySecureSessionStore(),
        transport: FakeCommerceTransport(handler),
      );

      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      expect(find.text('عرض السلة'), findsOneWidget);
      expect(find.text('تمر سكري'), findsNothing);
    },
  );
}

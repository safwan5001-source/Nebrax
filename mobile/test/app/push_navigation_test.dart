import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';

import '../commerce/fake_transport.dart';

/// End-to-end proof that a notification tap actually drives this runtime's
/// real navigation (MR-09's "one safe notification-to-navigation path") —
/// not just that [resolvePushPayload] returns the right `ActionRef` in
/// isolation (`push_payload_resolver_test.dart`) or that [PushController]
/// calls its callback against a fake adapter (`push_controller_test.dart`).
/// This drives the full path: a simulated native `awj/push` platform-channel
/// call -> [ChannelPushAdapter] -> resolve -> `AppActionDispatcher.dispatch`
/// -> `RuntimeActionHandler` -> `RuntimeState` -> the real `ProductScreen`/
/// `CartScreen` rendering real (fake-server-provided) data — the identical
/// shape `deep_link_navigation_test.dart` already proved for MR-08.
void main() {
  const channel = MethodChannel('awj/push');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    final segments = request.uri.pathSegments;
    // The AWJ Runtime Boot contract's `GET commerce/v1/experience` — see
    // `deep_link_navigation_test.dart`'s identical branch for why this is a
    // 404, not the generic `{data: []}` fallback below.
    if (segments.last == 'experience') {
      return jsonResponse(404, errorEnvelope('not_found', 'no published experience'));
    }
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

  CommerceClient buildClient() => CommerceClient(
    config: CommerceConfig(
      baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
      storeBearerToken: 'test-token',
    ),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport(handler),
  );

  testWidgets(
    'a cold-start (terminated-launch) product notification opens directly on '
    'that Product screen, skipping Home',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialMessage') {
              return {'type': 'openProduct', 'productId': 'p1'};
            }
            if (call.method == 'requestPermission') return 'granted';
            return null;
          });

      await tester.pumpWidget(AwjMobileRuntimeApp(client: buildClient(), experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();

      expect(find.text('تمر سكري'), findsOneWidget);
    },
  );

  testWidgets(
    'a live (warm-start, tapped-while-backgrounded) cart notification navigates '
    'away from Home to Cart',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'requestPermission') return 'granted';
            return null;
          });

      await tester.pumpWidget(AwjMobileRuntimeApp(client: buildClient(), experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();

      // Home is showing (its own schema-declared "go to cart" link).
      expect(find.text('عرض السلة'), findsOneWidget);

      final data = const StandardMethodCodec().encodeMethodCall(
        MethodCall('onMessageOpenedApp', {'type': 'navigate', 'pageId': 'cart'}),
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
    'a foreground-arrival message never navigates — Home stays showing until a tap',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'requestPermission') return 'granted';
            return null;
          });

      await tester.pumpWidget(AwjMobileRuntimeApp(client: buildClient(), experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();
      expect(find.text('عرض السلة'), findsOneWidget);

      final data = const StandardMethodCodec().encodeMethodCall(
        MethodCall('onForegroundMessage', {'type': 'openProduct', 'productId': 'p1'}),
      );
      await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(channel.name, data, (_) {});
      await tester.pumpAndSettle();

      expect(find.text('عرض السلة'), findsOneWidget);
      expect(find.text('تمر سكري'), findsNothing);
    },
  );

  testWidgets(
    'a notification payload that fails the allowlist is silently ignored — '
    'Home stays showing',
    (tester) async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialMessage') {
              return {'type': 'addToCart', 'productId': 'p1'};
            }
            if (call.method == 'requestPermission') return 'granted';
            return null;
          });

      await tester.pumpWidget(AwjMobileRuntimeApp(client: buildClient(), experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();

      expect(find.text('عرض السلة'), findsOneWidget);
      expect(find.text('تمر سكري'), findsNothing);
    },
  );
}

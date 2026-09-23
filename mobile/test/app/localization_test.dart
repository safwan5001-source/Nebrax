import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/app/runtime_strings.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import 'fake_commerce.dart';

/// MOBILE-RUNTIME-6 (MR-10 Localization, MR-11 Accessibility, Gate E)
/// coverage: the app-bar toggle actually flips locale/direction/strings
/// across the whole runtime, product names follow the Commerce API's
/// already-bilingual `name`/`name_en` pair (never a client-side
/// re-translation), interactive controls carry locale-aware semantics, and
/// the tree survives an accessibility-scale text size without throwing.
void main() {
  Future<CommerceHttpResponse> productHandler(
    CommerceHttpRequest request,
  ) async {
    final segments = request.uri.pathSegments;
    if (segments.last == 'products') {
      return jsonResponse(200, {
        'data': [
          {
            'id': 'p1',
            'name': 'تمر',
            'name_en': 'Dates',
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
        ],
        'meta': paginationMeta(total: 1),
      });
    }
    if (segments.contains('products') && segments.last == 'p1') {
      return jsonResponse(200, {
        'data': {
          'id': 'p1',
          'name': 'تمر',
          'name_en': 'Dates',
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
    if (request.method == CommerceHttpMethod.post && segments.last == 'items') {
      return jsonResponse(201, {
        'data': {
          'status': 'open',
          'items': [
            {
              'id': 'ci-1',
              'product_id': 'p1',
              'product_variant_id': null,
              'variant_descriptor': null,
              'product_name': 'تمر',
              'unit_key': 'default',
              'unit_name': null,
              'quantity': 1,
              'unit_price': money(amountMinor: 5000),
              'line_total': money(amountMinor: 5000),
              'available': true,
            },
          ],
          'subtotal': money(amountMinor: 5000),
          'currency': 'SAR',
          'has_unavailable_items': false,
        },
        'meta': successMeta(),
      });
    }
    return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
  }

  testWidgets(
    'the app-bar toggle switches direction, chrome strings, and product '
    'names between ar (default) and en',
    (tester) async {
      final client = buildFakeCommerceClient(handler: productHandler);
      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      // Arabic is the default (project-wide RTL-first rule).
      expect(find.text('تسوّق منتجاتك المفضّلة'), findsOneWidget);
      expect(find.text('عرض السلة'), findsOneWidget);
      expect(find.text('تمر'), findsOneWidget);
      final shellElement = tester.element(
        find.text('أَوْج — AWJ Mobile Runtime'),
      );
      expect(Directionality.of(shellElement), TextDirection.rtl);

      await tester.tap(find.byKey(const ValueKey('locale-toggle')));
      await tester.pumpAndSettle();

      // Flips to English/LTR and the server-provided `name_en` is now
      // shown instead of `name` — not a re-translation of it.
      expect(find.text('Shop your favorite products'), findsOneWidget);
      expect(find.text('View cart'), findsOneWidget);
      expect(find.text('Dates'), findsOneWidget);
      expect(find.text('تمر'), findsNothing);
      expect(Directionality.of(shellElement), TextDirection.ltr);

      await tester.tap(find.byKey(const ValueKey('locale-toggle')));
      await tester.pumpAndSettle();

      // Toggling back restores Arabic/RTL exactly.
      expect(find.text('تسوّق منتجاتك المفضّلة'), findsOneWidget);
      expect(Directionality.of(shellElement), TextDirection.rtl);
    },
  );

  testWidgets('switching locale re-points CommerceClient.setLocale so the next '
      'request carries the new Accept-Language', (tester) async {
    final transport = FakeCommerceTransport(productHandler);
    final client = CommerceClient(
      config: CommerceConfig(
        baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
        storeBearerToken: 'test-token',
      ),
      sessionStore: InMemorySecureSessionStore(),
      transport: transport,
    );
    await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
    await tester.pumpAndSettle();
    expect(transport.requests.last.headers['Accept-Language'], 'ar');

    await tester.tap(find.byKey(const ValueKey('locale-toggle')));
    await tester.pumpAndSettle();

    // Any subsequent Commerce call (here, opening the cart) now sends
    // the toggled locale.
    await tester.tap(find.text('View cart'));
    await tester.pumpAndSettle();
    expect(transport.requests.last.headers['Accept-Language'], 'en');
  });

  testWidgets(
    'quantity stepper controls expose locale-aware semantics tooltips',
    (tester) async {
      final handle = tester.ensureSemantics();

      final client = buildFakeCommerceClient(handler: productHandler);
      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      await tester.tap(find.text('تمر'));
      await tester.pumpAndSettle();

      // `IconButton.tooltip` (product_screen.dart's `_PurchasePanel`) feeds
      // the semantics tree directly — this is the VoiceOver/TalkBack smoke
      // proxy this test environment has no real device to run. Locating the
      // `Tooltip` by its (locale-aware) message is itself the assertion:
      // it only exists, under either locale's string, because the control
      // carries a real accessible name rather than an icon alone.
      final strings = RuntimeStrings.of(const Locale('ar'));
      expect(find.byTooltip(strings.quantityIncrease), findsOneWidget);
      expect(find.byTooltip(strings.quantityDecrease), findsOneWidget);

      handle.dispose();
    },
  );

  testWidgets(
    'Home -> Product -> Cart render without overflow/layout exceptions at '
    'an accessibility text scale',
    (tester) async {
      final client = buildFakeCommerceClient(handler: productHandler);
      await tester.pumpWidget(
        MediaQuery(
          data: const MediaQueryData(textScaler: TextScaler.linear(2.5)),
          child: AwjMobileRuntimeApp(client: client),
        ),
      );
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('تمر').first);
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('إضافة للسلة'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);

      await tester.tap(find.text('الرئيسية'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('عرض السلة'));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'quantity IconButtons meet the Material 48x48 minimum touch target and '
    'accept keyboard focus (focus/navigation sanity)',
    (tester) async {
      final client = buildFakeCommerceClient(handler: productHandler);
      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      await tester.tap(find.text('تمر'));
      await tester.pumpAndSettle();

      final increaseButton = find.byKey(
        const ValueKey('purchase-quantity-increment'),
      );
      final size = tester.getSize(increaseButton);
      expect(size.width, greaterThanOrEqualTo(48));
      expect(size.height, greaterThanOrEqualTo(48));

      // The `Icon` is a descendant of `IconButton`'s own internal `Focus`
      // widget, so its context (unlike the button's own) can look *up* to
      // find it — confirming the control is keyboard-focusable at all,
      // not just tap-reachable.
      final iconElement = tester.element(
        find.descendant(of: increaseButton, matching: find.byType(Icon)),
      );
      final focusNode = Focus.of(iconElement);
      focusNode.requestFocus();
      await tester.pump();
      expect(focusNode.hasFocus, isTrue);
    },
  );

  testWidgets(
    'the NavigationTarget chevron is direction-aware, never a fixed glyph '
    '(MR-11: no direction-only meaning)',
    (tester) async {
      final client = buildFakeCommerceClient(handler: productHandler);
      await tester.pumpWidget(AwjMobileRuntimeApp(client: client));
      await tester.pumpAndSettle();

      // Arabic/RTL: "forward" (toward the cart) reads as pointing left.
      expect(find.byIcon(Icons.chevron_left), findsOneWidget);
      expect(find.byIcon(Icons.chevron_right), findsNothing);

      await tester.tap(find.byKey(const ValueKey('locale-toggle')));
      await tester.pumpAndSettle();

      // English/LTR: the same "forward" meaning now points right.
      expect(find.byIcon(Icons.chevron_right), findsOneWidget);
      expect(find.byIcon(Icons.chevron_left), findsNothing);
    },
  );
}

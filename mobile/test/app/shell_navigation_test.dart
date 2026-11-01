import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/app/awj_runtime_shell.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

/// AD-04 / S09b — الغلاف على الجهاز: تبويبات سفلية، شريط علوي، شارة سلة. الجيل 1.1.0.
Map<String, Object?> _page(String marker) => componentNode(
  type: 'Page',
  id: '$marker-root',
  children: [componentNode(type: 'Text', id: '$marker-text', props: {'text': marker})],
);

String _experience({Map<String, Object?>? navigationExtra}) {
  final json = baseSchemaJson(pageOverride: _page('HOME_MARKER'));
  (json['pages'] as Map<String, Object?>)['shop'] = _page('SHOP_MARKER');
  (json['pages'] as Map<String, Object?>)['about'] = _page('ABOUT_MARKER');
  (json['pages'] as Map<String, Object?>)['cart'] = _page('CART_MARKER');
  json['navigation'] = {'initialPageId': 'home', ...?navigationExtra};
  return encodeSchema(json);
}

CommerceClient _client(String experienceJson, {int cartCount = 0}) {
  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    final last = request.uri.pathSegments.last;
    if (last == 'experience') {
      return jsonResponse(200, {
        'data': {
          'version': 1,
          'schema_version': '1',
          'published_at': '2026-09-25T00:00:00Z',
          'schema': jsonDecode(experienceJson),
        },
        'meta': successMeta(),
      });
    }
    if (last == 'cart') {
      return jsonResponse(200, {
        'data': {
          'status': null,
          'items': [
            for (var i = 0; i < cartCount; i++)
              {
                'id': 'i$i',
                'product_id': 'p$i',
                'product_variant_id': null,
                'variant_descriptor': null,
                'product_name': 'P$i',
                'unit_key': 'piece',
                'unit_name': 'piece',
                'quantity': 2,
                'unit_price': money(amountMinor: 100),
                'line_total': money(amountMinor: 200),
                'available': true,
              },
          ],
          'subtotal': money(amountMinor: 0),
          'currency': 'SAR',
          'has_unavailable_items': false,
        },
        'meta': successMeta(),
      });
    }
    if (last == 'products') return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
    return jsonResponse(404, errorEnvelope('not_found', 'no fake route'));
  }

  return CommerceClient(
    config: CommerceConfig(baseUrl: Uri.parse('https://api.example.com/commerce/v1'), storeBearerToken: 't'),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport(handler),
  );
}

Widget _shell(CommerceClient client) => MaterialApp(
  home: AwjRuntimeShell(
    client: client,
    experienceCache: InMemoryExperienceCache(),
    locale: const Locale('en'),
    onLocaleChanged: (_) {},
  ),
);

const _tabs = [
  {'pageId': 'home', 'title': 'Home', 'icon': 'home'},
  {'pageId': 'shop', 'title': 'Shop', 'icon': 'store'},
  {'pageId': 'about', 'title': 'About', 'icon': 'menu', 'hidden': true},
  {'pageId': 'cart', 'title': 'Cart', 'icon': 'cart'},
];

void main() {
  test('the runtime declares exactly what the server records for generation 1.1.0 (shared fixture)', () {
    final fixture = (jsonDecode(File('../contracts/app-builder/navigation-shell.v1.json').readAsStringSync()) as Map<String, Object?>)['generation_1_1_0']!
        as Map<String, Object?>;
    final m = CapabilityManifest.current(RuntimePlatform.android);
    expect(m.runtimeVersion.toString(), fixture['runtime']);
    expect(m.schemaFeatures, (fixture['schemaFeatures']! as Map).cast<String, int>());
    expect(m.dataResources, (fixture['dataResources']! as Map).cast<String, int>());
  });

  test('the runtime declares generation 1.1.0 with both shell features', () {
    final m = CapabilityManifest.current(RuntimePlatform.android);
    expect(m.runtimeVersion.toString(), '1.1.0');
    expect(m.schemaFeatureVersion(NavigationShell.featureTabs), 1);
    expect(m.schemaFeatureVersion(NavigationShell.featureAppBar), 1);
    expect(m.schemaFeatureVersion('binding.collect'), 1); // لا شيء مما سبق سقط
  });

  group('state: tab roots', () {
    test('selectRoot switches the root screen and clears the history; activeRoot follows', () {
      final state = RuntimeState()..declarePages(['shop', 'about']);
      expect(state.activeRootPageId, 'home');
      state.goToProduct('p1');
      expect(state.activeRootPageId, 'home'); // المنتج يتبع الجذر الذي جاء منه
      expect(state.selectRoot('shop'), isTrue);
      expect(state.page, RuntimePage.page);
      expect(state.activeRootPageId, 'shop');
      expect(state.canGoBack, isFalse);
      state.goToProduct('p2');
      expect(state.activeRootPageId, 'shop');
      expect(state.selectRoot('cart'), isTrue);
      expect(state.page, RuntimePage.cart);
      expect(state.activeRootPageId, 'cart');
      expect(state.selectRoot('home'), isTrue);
      expect(state.page, RuntimePage.home);
      expect(state.selectRoot('ghost'), isFalse);
    });
  });

  testWidgets('bottom tabs render only the visible ones, switch screens, and mark the active tab', (tester) async {
    await tester.pumpWidget(_shell(_client(_experience(navigationExtra: {'tabs': _tabs}))));
    await tester.pumpAndSettle();

    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Home')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Shop')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('Cart')), findsOneWidget);
    expect(find.descendant(of: find.byType(NavigationBar), matching: find.text('About')), findsNothing); // مخفي
    expect(find.text('HOME_MARKER'), findsOneWidget);
    expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 0);

    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Shop')));
    await tester.pumpAndSettle();
    expect(find.text('SHOP_MARKER'), findsOneWidget);
    expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 1);
    expect(find.byKey(const ValueKey('runtime-back')), findsNothing); // تبديل جذر لا يترك سجلاً

    await tester.tap(find.descendant(of: find.byType(NavigationBar), matching: find.text('Cart')));
    await tester.pumpAndSettle();
    expect(tester.widget<NavigationBar>(find.byType(NavigationBar)).selectedIndex, 2);
  });

  testWidgets('no shell keys => no bottom bar and the default title (unchanged behaviour)', (tester) async {
    await tester.pumpWidget(_shell(_client(_experience())));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsNothing);
    expect(find.text('أَوْج — AWJ Mobile Runtime'), findsOneWidget);
  });

  testWidgets('appBar.title replaces the default title; showCart adds a cart button with the live item count badge', (tester) async {
    await tester.pumpWidget(
      _shell(_client(_experience(navigationExtra: {'appBar': {'title': 'متجري', 'showCart': true}}), cartCount: 3)),
    );
    await tester.pumpAndSettle();

    expect(find.text('متجري'), findsOneWidget);
    expect(find.text('أَوْج — AWJ Mobile Runtime'), findsNothing);
    final cartButton = find.byKey(const ValueKey('appbar-cart'));
    expect(cartButton, findsOneWidget);
    expect(find.descendant(of: cartButton, matching: find.text('3')), findsOneWidget); // عدد العناصر الحيّ

    await tester.tap(cartButton);
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('runtime-back')), findsOneWidget); // السلة فُتحت فوق الرئيسية
  });

  testWidgets('showCart with an empty cart shows no badge number', (tester) async {
    await tester.pumpWidget(_shell(_client(_experience(navigationExtra: {'appBar': {'showCart': true}}))));
    await tester.pumpAndSettle();
    expect(find.byKey(const ValueKey('appbar-cart')), findsOneWidget);
    expect(find.descendant(of: find.byKey(const ValueKey('appbar-cart')), matching: find.byType(Text)), findsNothing);
  });
}

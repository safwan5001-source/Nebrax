import 'dart:async';

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/cart_screen.dart';
import 'package:awj_mobile_runtime/app/product_screen.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../actions/recording_action_handler.dart';
import '../commerce/fake_transport.dart';

/// S06a (مراجعة Codex) — زر الرجوع يفكّك الشاشة وطلبها ما زال في الطريق: لا `setState` بعد التفكيك، ولا يستبدل ردٌّ قديم الأحدث.
CommerceClient _client(Future<CommerceHttpResponse> Function(CommerceHttpRequest) handler) => CommerceClient(
  config: CommerceConfig(baseUrl: Uri.parse('https://api.example.com/commerce/v1'), storeBearerToken: 't'),
  sessionStore: InMemorySecureSessionStore(),
  transport: FakeCommerceTransport(handler),
);

Map<String, Object?> _product(String name) => {
  'id': 'p1',
  'name': name,
  'name_en': name,
  'description': null,
  'sku': null,
  'category': null,
  'price': money(),
  'in_stock': true,
  'thumbnail_url': null,
  'is_variant_managed': false,
  'created_at': null,
  'updated_at': null,
  'media': [],
};

void main() {
  testWidgets('ProductScreen disposed while its request is pending does not throw when the response arrives', (tester) async {
    final gate = Completer<void>();
    final client = _client((request) async {
      await gate.future;
      return jsonResponse(200, {'data': _product('P'), 'meta': successMeta()});
    });
    Widget host(bool show) => MaterialApp(
      home: Scaffold(
        body: show
            ? ProductScreen(
                productId: 'p1',
                client: client,
                dispatcher: AppActionDispatcher(RecordingActionHandler()),
                locale: const Locale('en'),
              )
            : const SizedBox(),
      ),
    );
    await tester.pumpWidget(host(true));
    await tester.pump();
    await tester.pumpWidget(host(false)); // الرجوع يفكّك الشاشة
    gate.complete();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });

  testWidgets('ProductScreen: an older response never overwrites the newer product', (tester) async {
    final gate = Completer<void>();
    var calls = 0;
    final client = _client((request) async {
      final id = request.uri.pathSegments.last;
      if (id == 'old') {
        await gate.future;
        return jsonResponse(200, {'data': _product('OLD_PRODUCT'), 'meta': successMeta()});
      }
      calls++;
      return jsonResponse(200, {'data': _product('NEW_PRODUCT'), 'meta': successMeta()});
    });
    Widget host(String id) => MaterialApp(
      home: Scaffold(
        body: ProductScreen(
          productId: id,
          client: client,
          dispatcher: AppActionDispatcher(RecordingActionHandler()),
          locale: const Locale('en'),
        ),
      ),
    );
    await tester.pumpWidget(host('old'));
    await tester.pump();
    await tester.pumpWidget(host('new'));
    await tester.pumpAndSettle();
    expect(find.text('NEW_PRODUCT'), findsWidgets);
    gate.complete();
    await tester.pumpAndSettle();
    expect(find.text('NEW_PRODUCT'), findsWidgets);
    expect(find.text('OLD_PRODUCT'), findsNothing);
    expect(calls, greaterThan(0));
  });

  testWidgets('CartScreen disposed while its request is pending does not throw when the response arrives', (tester) async {
    final gate = Completer<void>();
    final client = _client((request) async {
      await gate.future;
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
    });
    final state = RuntimeState();
    Widget host(bool show) => MaterialApp(
      home: Scaffold(
        body: show
            ? CartScreen(
                client: client,
                state: state,
                dispatcher: AppActionDispatcher(RecordingActionHandler()),
                locale: const Locale('en'),
              )
            : const SizedBox(),
      ),
    );
    await tester.pumpWidget(host(true));
    await tester.pump();
    await tester.pumpWidget(host(false));
    gate.complete();
    await tester.pumpAndSettle();
    expect(tester.takeException(), isNull);
  });
}

import 'dart:async';

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/category_screen.dart';
import 'package:awj_mobile_runtime/app/home_screen.dart';
import 'package:awj_mobile_runtime/app/runtime_action_handler.dart';
import 'package:awj_mobile_runtime/app/runtime_schema.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/app/search_screen.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../actions/recording_action_handler.dart';
import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';
import 'fake_commerce.dart';

/// AD-02 / S11b — التصنيفات والبحث على الجهاز (الجيل 1.2.0): الإجراءان، حالة التنقل، `CategoryList` المربوط،
/// وشاشتا التصنيف والبحث (حالات التحميل/الفراغ/الخطأ/الترقيم/ردّ قديم).
Map<String, Object?> _product(String id, String name) => {
  'id': id,
  'name': name,
  'name_en': name,
  'description': null,
  'sku': null,
  'category': null,
  'price': money(amountMinor: 2500),
  'in_stock': true,
  'thumbnail_url': null,
  'is_variant_managed': false,
  'created_at': null,
  'updated_at': null,
};

Widget _host(Widget body) => MaterialApp(home: Scaffold(body: body));

void main() {
  group('actions', () {
    test('openCategory needs a non-empty string categoryId', () {
      expect(decodeAction(const ActionRef(type: 'openCategory', params: {'categoryId': 'c1'})), isA<OpenCategoryAction>());
      expect(decodeAction(const ActionRef(type: 'openCategory', params: {})), isNull);
      expect(decodeAction(const ActionRef(type: 'openCategory', params: {'categoryId': ''})), isNull);
      expect(decodeAction(const ActionRef(type: 'openCategory', params: {'categoryId': 7})), isNull);
    });

    test('openSearch takes no params and is always valid', () {
      expect(decodeAction(const ActionRef(type: 'openSearch', params: {})), isA<OpenSearchAction>());
    });

    test('the dispatcher routes both to the handler', () async {
      final handler = RecordingActionHandler();
      final dispatcher = AppActionDispatcher(handler);
      await dispatcher.dispatch(const ActionRef(type: 'openCategory', params: {'categoryId': 'c1'}));
      await dispatcher.dispatch(const ActionRef(type: 'openSearch', params: {}));
      expect(handler.received.map((a) => a.runtimeType), [OpenCategoryAction, OpenSearchAction]);
    });
  });

  group('RuntimeState', () {
    test('category and search push history and back restores the previous screen and selection', () {
      final state = RuntimeState();
      state.goToCategory('c1');
      expect(state.page, RuntimePage.category);
      expect(state.selectedCategoryId, 'c1');
      state.goToProduct('p1');
      expect(state.page, RuntimePage.product);
      state.goBack();
      expect(state.page, RuntimePage.category);
      expect(state.selectedCategoryId, 'c1');
      state.goBack();
      expect(state.page, RuntimePage.home);

      // تصنيف داخل تصنيف: الرجوع يستعيد **معرّف** التصنيف السابق لا الأحدث.
      state.goToCategory('c1');
      state.goToCategory('c2');
      expect(state.selectedCategoryId, 'c2');
      state.goBack();
      expect(state.selectedCategoryId, 'c1');
      state.goHome();

      state.goToSearch();
      expect(state.page, RuntimePage.search);
      expect(state.activeRootPageId, 'home', reason: 'البحث تفصيلة تتبع الجذر الذي جاءت منه');
      state.goHome();
      expect(state.selectedCategoryId, isNull);
    });

    test('the real action handler opens the category and the search', () async {
      final state = RuntimeState();
      final handler = RuntimeActionHandler(client: buildFakeCommerceClient(), state: state, onError: (_) {});
      await handler.onOpenCategory(const OpenCategoryAction('c9'));
      expect((state.page, state.selectedCategoryId), (RuntimePage.category, 'c9'));
      await handler.onOpenSearch(const OpenSearchAction());
      expect(state.page, RuntimePage.search);
    });
  });

  group('CategoryList bound to commerce.categories', () {
    testWidgets('renders one template per category and a tap dispatches openCategory with that category id', (tester) async {
      final seen = <Uri>[];
      final client = buildFakeCommerceClient(
        handler: (request) async {
          seen.add(request.uri);
          if (request.uri.path.endsWith('/categories')) {
            return jsonResponse(200, {
              'data': [
                {'id': 'cat-1', 'name': 'أحذية', 'description': null, 'color': null, 'parent_id': null},
                {'id': 'cat-2', 'name': 'حقائب', 'description': null, 'color': null, 'parent_id': null},
              ],
              'meta': successMeta(),
            });
          }
          return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
        },
      );
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(
              type: 'CategoryList',
              id: 'cats',
              props: {'layout': 'vertical'},
              binding: {'resource': 'commerce.categories', 'itemProps': <String, String>{}},
              children: [
                componentNode(
                  type: 'Button',
                  id: 'cat-btn',
                  props: {'label': r'$item.name'},
                  action: {'type': 'openCategory', 'params': {'categoryId': r'$item.id'}},
                ),
              ],
            ),
          ],
        ),
      );
      final result = resolveRuntimeSchema(encodeSchema(json), CapabilityManifest.current(RuntimePlatform.android));
      expect(result, isA<RenderableExperience>(), reason: 'الجيل 1.2.0 يرندر CategoryList');

      final handler = RecordingActionHandler();
      await tester.pumpWidget(
        _host(
          HomeScreen(
            client: client,
            state: RuntimeState(),
            dispatcher: AppActionDispatcher(handler),
            locale: const Locale('ar'),
            experience: result as RenderableExperience,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(seen.where((u) => u.path.endsWith('/categories')), hasLength(1));
      expect(find.text('أحذية'), findsOneWidget);
      expect(find.text('حقائب'), findsOneWidget);

      await tester.tap(find.text('حقائب'));
      await tester.pump();
      expect((handler.received.single as OpenCategoryAction).categoryId, 'cat-2');
    });

    test('an older generation refuses a schema with CategoryList (no silent drop)', () {
      final json = baseSchemaJson(
        pageOverride: componentNode(
          type: 'Page',
          id: 'home-root',
          children: [
            componentNode(type: 'CategoryList', id: 'cats', children: const []),
          ],
        ),
      );
      final older = CapabilityManifest.generation(RuntimePlatform.android, '1.1.0')!;
      expect(resolveRuntimeSchema(encodeSchema(json), older), isA<IncompatibleExperience>());
    });
  });

  group('CategoryScreen', () {
    testWidgets('requests the category products, shows the title and the product cards', (tester) async {
      final seen = <Uri>[];
      final client = buildFakeCommerceClient(
        handler: (request) async {
          seen.add(request.uri);
          if (request.uri.path.endsWith('/categories/cat-1')) {
            return jsonResponse(200, {
              'data': {'id': 'cat-1', 'name': 'أحذية', 'description': null, 'color': null, 'parent_id': null, 'children': [], 'ancestors': []},
              'meta': successMeta(),
            });
          }
          return jsonResponse(200, {'data': [_product('p1', 'حذاء رياضي')], 'meta': paginationMeta(perPage: 24, total: 1)});
        },
      );
      await tester.pumpWidget(
        _host(CategoryScreen(categoryId: 'cat-1', client: client, dispatcher: AppActionDispatcher(RecordingActionHandler()), locale: const Locale('ar'))),
      );
      await tester.pumpAndSettle();

      final products = seen.firstWhere((u) => u.path.endsWith('/products'));
      expect(products.queryParameters['category_id'], 'cat-1');
      expect(products.queryParameters['per_page'], '24');
      expect(find.text('أحذية'), findsOneWidget);
      expect(find.text('حذاء رياضي'), findsOneWidget);
    });

    testWidgets('a product tap dispatches openProduct', (tester) async {
      final client = buildFakeCommerceClient(
        handler: (request) async => request.uri.path.contains('/categories/')
            ? jsonResponse(404, errorEnvelope('not_found', 'x'))
            : jsonResponse(200, {'data': [_product('p1', 'حذاء')], 'meta': paginationMeta()}),
      );
      final handler = RecordingActionHandler();
      await tester.pumpWidget(_host(CategoryScreen(categoryId: 'c', client: client, dispatcher: AppActionDispatcher(handler), locale: const Locale('ar'))));
      await tester.pumpAndSettle();
      await tester.tap(find.text('حذاء'));
      await tester.pump();
      expect((handler.received.single as OpenProductAction).productId, 'p1');
    });

    testWidgets('an empty category shows the empty state; a failure shows retry that recovers', (tester) async {
      var fail = true;
      final client = buildFakeCommerceClient(
        handler: (request) async {
          if (request.uri.path.contains('/categories/')) return jsonResponse(404, errorEnvelope('not_found', 'x'));
          if (fail) return jsonResponse(500, errorEnvelope('server_error', 'تعذّر'));
          return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
        },
      );
      await tester.pumpWidget(_host(CategoryScreen(categoryId: 'c', client: client, dispatcher: AppActionDispatcher(RecordingActionHandler()), locale: const Locale('en'))));
      await tester.pumpAndSettle();
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.text('There are no products in this category'), findsOneWidget);
    });

    testWidgets('"Show more" appears only when the server says there is more and appends the next page', (tester) async {
      final pages = <String?>[];
      final client = buildFakeCommerceClient(
        handler: (request) async {
          if (request.uri.path.contains('/categories/')) return jsonResponse(404, errorEnvelope('not_found', 'x'));
          final page = request.uri.queryParameters['page'];
          pages.add(page);
          return page == '2'
              ? jsonResponse(200, {'data': [_product('p2', 'منتج ثانٍ')], 'meta': paginationMeta(page: 2, perPage: 24, total: 2, lastPage: 2)})
              : jsonResponse(200, {'data': [_product('p1', 'منتج أول')], 'meta': paginationMeta(page: 1, perPage: 24, total: 2, lastPage: 2, hasMore: true)});
        },
      );
      await tester.pumpWidget(_host(CategoryScreen(categoryId: 'c', client: client, dispatcher: AppActionDispatcher(RecordingActionHandler()), locale: const Locale('en'))));
      await tester.pumpAndSettle();
      expect(find.text('Show more'), findsOneWidget);

      await tester.tap(find.text('Show more'));
      await tester.pumpAndSettle();
      expect(pages, ['1', '2']);
      expect(find.text('منتج أول'), findsOneWidget);
      expect(find.text('منتج ثانٍ'), findsOneWidget);
      expect(find.text('Show more'), findsNothing);
    });

    testWidgets('disposed while loading does not throw when the response arrives', (tester) async {
      final gate = Completer<void>();
      final client = buildFakeCommerceClient(
        handler: (request) async {
          await gate.future;
          return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
        },
      );
      await tester.pumpWidget(_host(CategoryScreen(categoryId: 'c', client: client, dispatcher: AppActionDispatcher(RecordingActionHandler()), locale: const Locale('en'))));
      await tester.pump();
      await tester.pumpWidget(_host(const SizedBox()));
      gate.complete();
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  });

  group('SearchScreen', () {
    CommerceClient clientFor(List<Uri> seen, {Future<CommerceHttpResponse> Function(CommerceHttpRequest)? override}) =>
        buildFakeCommerceClient(
          handler: override ??
              (request) async {
                seen.add(request.uri);
                final q = request.uri.queryParameters['search'] ?? '';
                return jsonResponse(200, {
                  'data': q == 'zzz' ? [] : [_product('p-$q', 'نتيجة $q')],
                  'meta': paginationMeta(),
                });
              },
        );

    Future<void> pump(WidgetTester tester, CommerceClient client, [RecordingActionHandler? handler]) => tester.pumpWidget(
      _host(SearchScreen(client: client, dispatcher: AppActionDispatcher(handler ?? RecordingActionHandler()), locale: const Locale('en'))),
    );

    testWidgets('idle prompt; fewer than two characters never sends a request', (tester) async {
      final seen = <Uri>[];
      await pump(tester, clientFor(seen));
      expect(find.text('Type at least two characters to search the store'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'a');
      await tester.pump(const Duration(milliseconds: 600));
      expect(seen, isEmpty);
    });

    testWidgets('typing is debounced into one request with the trimmed search text', (tester) async {
      final seen = <Uri>[];
      await pump(tester, clientFor(seen));

      await tester.enterText(find.byType(TextField), 'sh');
      await tester.pump(const Duration(milliseconds: 100));
      await tester.enterText(find.byType(TextField), '  shoes ');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();

      expect(seen, hasLength(1), reason: 'الضغطات المتتالية تُدمج في طلب واحد');
      expect(seen.single.queryParameters['search'], 'shoes');
      expect(find.text('نتيجة shoes'), findsOneWidget);
    });

    testWidgets('the search text is capped at 120 characters', (tester) async {
      final seen = <Uri>[];
      await pump(tester, clientFor(seen));
      await tester.enterText(find.byType(TextField), 'x' * 300);
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(seen.single.queryParameters['search']!.length, 120);
    });

    testWidgets('no match shows the empty state; a result tap dispatches openProduct', (tester) async {
      final seen = <Uri>[];
      final handler = RecordingActionHandler();
      await pump(tester, clientFor(seen), handler);

      await tester.enterText(find.byType(TextField), 'zzz');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.text('No matching products'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'bag');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      await tester.tap(find.text('نتيجة bag'));
      await tester.pump();
      expect((handler.received.single as OpenProductAction).productId, 'p-bag');
    });

    testWidgets('an older slow response never overwrites the newer search', (tester) async {
      final slow = Completer<void>();
      final client = buildFakeCommerceClient(
        handler: (request) async {
          final q = request.uri.queryParameters['search'];
          if (q == 'old') await slow.future;
          return jsonResponse(200, {'data': [_product('p-$q', 'نتيجة $q')], 'meta': paginationMeta()});
        },
      );
      await pump(tester, client);

      await tester.enterText(find.byType(TextField), 'old');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.enterText(find.byType(TextField), 'new');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      slow.complete();
      await tester.pumpAndSettle();

      expect(find.text('نتيجة new'), findsOneWidget);
      expect(find.text('نتيجة old'), findsNothing);
    });

    testWidgets('a failure shows retry; clearing the text returns to the prompt and cancels in-flight work', (tester) async {
      var fail = true;
      final client = buildFakeCommerceClient(
        handler: (request) async => fail
            ? jsonResponse(500, errorEnvelope('server_error', 'تعذّر'))
            : jsonResponse(200, {'data': [_product('p1', 'ok')], 'meta': paginationMeta()}),
      );
      await pump(tester, client);

      await tester.enterText(find.byType(TextField), 'abc');
      await tester.pump(const Duration(milliseconds: 400));
      await tester.pumpAndSettle();
      expect(find.text('إعادة المحاولة'), findsOneWidget);

      fail = false;
      await tester.tap(find.text('إعادة المحاولة'));
      await tester.pumpAndSettle();
      expect(find.text('ok'), findsOneWidget);

      await tester.enterText(find.byType(TextField), '');
      await tester.pump();
      expect(find.text('Type at least two characters to search the store'), findsOneWidget);
    });

    testWidgets('disposing with a pending debounce timer or request does not throw', (tester) async {
      final seen = <Uri>[];
      await pump(tester, clientFor(seen));
      await tester.enterText(find.byType(TextField), 'abc');
      await tester.pumpWidget(_host(const SizedBox()));
      await tester.pump(const Duration(seconds: 1));
      expect(tester.takeException(), isNull);
      expect(seen, isEmpty, reason: 'المؤقت أُلغي مع التفكيك');
    });
  });
}

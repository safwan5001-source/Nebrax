import 'dart:async';

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/home_screen.dart';
import 'package:awj_mobile_runtime/app/runtime_schema.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../actions/recording_action_handler.dart';
import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';
import 'fake_commerce.dart';

Map<String, Object?> _list(String id, Map<String, Object?> query) => componentNode(
  type: 'ProductList',
  id: id,
  binding: {'resource': 'commerce.products', 'query': query, 'itemProps': <String, String>{}},
  children: [
    componentNode(type: 'Text', id: '$id-t', props: {'text': r'$item.name'}),
  ],
);

RenderableExperience _experience(List<Map<String, Object?>> lists) {
  final json = baseSchemaJson(
    pageOverride: componentNode(type: 'Page', id: 'home-root', children: lists),
  );
  final result = resolveRuntimeSchemaForTest(encodeSchema(json));
  return result as RenderableExperience;
}

CompatibilityResult resolveRuntimeSchemaForTest(String json) =>
    resolveRuntimeSchema(json, CapabilityManifest.current(RuntimePlatform.android));

void main() {
  testWidgets('each distinct binding query becomes its own request and lists render their own data', (tester) async {
    final seen = <Uri>[];
    final client = buildFakeCommerceClient(
      handler: (request) async {
        seen.add(request.uri);
        final sort = request.uri.queryParameters['sort'];
        final name = sort == '-popularity' ? 'Hot' : (sort == '-created_at' ? 'Fresh' : 'Plain');
        return jsonResponse(200, {
          'data': [
            {'id': 'p-$name', 'name': name, 'name_en': name},
          ],
          'meta': paginationMeta(),
        });
      },
    );

    final experience = _experience([
      _list('top', {'sort': '-popularity', 'per_page': 6}),
      _list('new', {'sort': '-created_at'}),
      _list('dup', {'sort': '-popularity', 'per_page': 6}),
      _list('plain', const {}),
    ]);

    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: HomeScreen(
            client: client,
            state: RuntimeState(),
            dispatcher: AppActionDispatcher(RecordingActionHandler()),
            locale: const Locale('en'),
            experience: experience,
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    final productCalls = seen.where((u) => u.path.endsWith('/products')).toList();
    // 3 طلبات مميَّزة: popularity(+per_page)، created_at، والعاري — التكرار يُجلب مرة واحدة.
    expect(productCalls, hasLength(3));
    final sorts = productCalls.map((u) => u.queryParameters['sort']).toSet();
    expect(sorts, {'-popularity', '-created_at', null});
    final top = productCalls.firstWhere((u) => u.queryParameters['sort'] == '-popularity');
    expect(top.queryParameters['per_page'], '6');

    expect(find.text('Hot'), findsNWidgets(2)); // top + dup
    expect(find.text('Fresh'), findsOneWidget);
    expect(find.text('Plain'), findsOneWidget);
  });

  testWidgets('when the live experience arrives after mount, products are refetched with its queries and a stale load never wins', (
    tester,
  ) async {
    final seen = <Uri>[];
    final client = buildFakeCommerceClient(
      handler: (request) async {
        seen.add(request.uri);
        final sort = request.uri.queryParameters['sort'];
        final name = sort == '-popularity' ? 'Hot' : 'Plain';
        return jsonResponse(200, {
          'data': [
            {'id': 'p-$name', 'name': name, 'name_en': name},
          ],
          'meta': paginationMeta(),
        });
      },
    );
    final state = RuntimeState();
    final dispatcher = AppActionDispatcher(RecordingActionHandler());
    final experience = _experience([
      _list('top', {'sort': '-popularity'}),
    ]);

    Widget host(RenderableExperience? e) => MaterialApp(
      home: Scaffold(
        body: HomeScreen(
          client: client,
          state: state,
          dispatcher: dispatcher,
          locale: const Locale('en'),
          experience: e,
        ),
      ),
    );

    // يُركَّب أولاً بلا تجربة (الإقلاع ما زال يحل) ثم تصل التجربة الحيّة.
    await tester.pumpWidget(host(null));
    await tester.pumpAndSettle();
    expect(seen.where((u) => u.queryParameters.containsKey('sort')), isEmpty);

    await tester.pumpWidget(host(experience));
    await tester.pumpAndSettle();

    expect(seen.where((u) => u.queryParameters['sort'] == '-popularity'), isNotEmpty);
    expect(find.text('Hot'), findsOneWidget);
  });

  testWidgets('an older in-flight load finishing late never overwrites the newer experience results', (tester) async {
    final slowBare = Completer<void>();
    final client = buildFakeCommerceClient(
      handler: (request) async {
        final sort = request.uri.queryParameters['sort'];
        if (sort == null) await slowBare.future; // الطلب العاري (التجربة المضمَّنة) بطيء
        final name = sort == '-popularity' ? 'Hot' : 'STALE';
        return jsonResponse(200, {
          'data': [
            {'id': 'p-$name', 'name': name, 'name_en': name},
          ],
          'meta': paginationMeta(),
        });
      },
    );
    final state = RuntimeState();
    final dispatcher = AppActionDispatcher(RecordingActionHandler());
    final experience = _experience([
      _list('top', {'sort': '-popularity'}),
    ]);
    Widget host(RenderableExperience? e) => MaterialApp(
      home: Scaffold(
        body: HomeScreen(client: client, state: state, dispatcher: dispatcher, locale: const Locale('en'), experience: e),
      ),
    );

    await tester.pumpWidget(host(null)); // تحميل عارٍ عالق
    await tester.pump();
    await tester.pumpWidget(host(experience)); // وصلت التجربة الحيّة
    await tester.pumpAndSettle();
    expect(find.text('Hot'), findsOneWidget);

    slowBare.complete(); // يصل القديم متأخراً
    await tester.pumpAndSettle();
    expect(find.text('Hot'), findsOneWidget);
    expect(find.text('STALE'), findsNothing);
  });
}

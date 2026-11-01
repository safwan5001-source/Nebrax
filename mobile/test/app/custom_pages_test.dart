import 'dart:convert';

import 'package:awj_mobile_runtime/app/awj_runtime_shell.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

/// S06a — صفحات مخصّصة: `navigate` لأي صفحة معلنة، البدء من `initialPageId`، والرجوع.
String _experience({String initialPageId = 'home', bool withGoAbout = true}) {
  final json = baseSchemaJson(
    pageOverride: componentNode(
      type: 'Page',
      id: 'home-root',
      children: [
        componentNode(type: 'Text', id: 'home-marker', props: {'text': 'HOME_MARKER'}),
        if (withGoAbout)
          componentNode(
            type: 'Button',
            id: 'go-about',
            props: {'label': 'GO_ABOUT'},
            action: {
              'type': 'navigate',
              'params': {'pageId': 'about'},
            },
          ),
        componentNode(
          type: 'Button',
          id: 'go-ghost',
          props: {'label': 'GO_GHOST'},
          action: {
            'type': 'navigate',
            'params': {'pageId': 'ghost'},
          },
        ),
      ],
    ),
  );
  (json['navigation'] as Map<String, Object?>)['initialPageId'] = initialPageId;
  (json['pages'] as Map<String, Object?>)['about'] = componentNode(
    type: 'Page',
    id: 'about-root',
    children: [
      componentNode(type: 'Text', id: 'about-marker', props: {'text': 'ABOUT_MARKER'}),
      componentNode(
        type: 'ProductList',
        id: 'about-list',
        binding: {
          'resource': 'commerce.products',
          'query': {'sort': '-popularity'},
          'itemProps': <String, String>{},
        },
        children: [
          componentNode(type: 'Text', id: 'about-item', props: {'text': r'$item.name'}),
        ],
      ),
    ],
  );
  return encodeSchema(json);
}

CommerceClient _client(String experienceJson, List<Uri> seen) {
  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    seen.add(request.uri);
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
    if (last == 'products') {
      return jsonResponse(200, {
        'data': [
          {'id': 'p1', 'name': 'SORTED_ITEM', 'name_en': 'SORTED_ITEM'},
        ],
        'meta': paginationMeta(),
      });
    }
    if (last == 'cart') {
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

void main() {
  testWidgets('navigate opens a declared custom page; its bound list fetches with its query; back returns home', (tester) async {
    final seen = <Uri>[];
    await tester.pumpWidget(_shell(_client(_experience(), seen)));
    await tester.pumpAndSettle();
    expect(find.text('HOME_MARKER'), findsOneWidget);
    expect(find.byKey(const ValueKey('runtime-back')), findsNothing);

    await tester.tap(find.text('GO_ABOUT'));
    await tester.pumpAndSettle();
    expect(find.text('ABOUT_MARKER'), findsOneWidget);
    expect(find.text('HOME_MARKER'), findsNothing);
    expect(find.text('SORTED_ITEM'), findsOneWidget);
    expect(seen.where((u) => u.path.endsWith('/products') && u.queryParameters['sort'] == '-popularity'), isNotEmpty);

    await tester.tap(find.byKey(const ValueKey('runtime-back')));
    await tester.pumpAndSettle();
    expect(find.text('HOME_MARKER'), findsOneWidget);
    expect(find.text('ABOUT_MARKER'), findsNothing);
  });

  testWidgets('navigate to an undeclared page is a safe no-op', (tester) async {
    await tester.pumpWidget(_shell(_client(_experience(), [])));
    await tester.pumpAndSettle();
    await tester.tap(find.text('GO_GHOST'));
    await tester.pumpAndSettle();
    expect(find.text('HOME_MARKER'), findsOneWidget);
    expect(find.byKey(const ValueKey('runtime-back')), findsNothing);
  });

  testWidgets('the app starts on navigation.initialPageId when it is a declared custom page, with no back detour', (
    tester,
  ) async {
    await tester.pumpWidget(_shell(_client(_experience(initialPageId: 'about'), [])));
    await tester.pumpAndSettle();
    expect(find.text('ABOUT_MARKER'), findsOneWidget);
    expect(find.text('HOME_MARKER'), findsNothing);
    expect(find.byKey(const ValueKey('runtime-back')), findsNothing);
  });
}

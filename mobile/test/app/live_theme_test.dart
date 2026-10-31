import 'dart:convert';

import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

/// AD-03 / THM-01 (S04a) — لون التاجر يصل إلى التطبيق الحقيقي: الثيم يُشتق من **التجربة الحيّة المنشورة**
/// (أو آخر نسخة سليمة)، لا من المخطط المضمَّن وحده. الوصول إلى `Theme.of(...)` عبر شاشة الصدفة الفعلية.
const _brand = Color(0xFF0F6A5A);

Color _primaryFor(Color seed) => ThemeData(colorSchemeSeed: seed, useMaterial3: true).colorScheme.primary;

String _experience(Map<String, String> tokens) {
  final json = baseSchemaJson();
  json['theme'] = {'tokens': tokens};
  return encodeSchema(json);
}

CommerceClient _client(Future<CommerceHttpResponse> Function() experience) {
  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    final last = request.uri.pathSegments.last;
    if (last == 'experience') return experience();
    if (last == 'products') return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
    if (last == 'cart') {
      return jsonResponse(200, {
        'data': {'status': null, 'items': [], 'subtotal': money(amountMinor: 0), 'currency': 'SAR', 'has_unavailable_items': false},
        'meta': successMeta(),
      });
    }
    return jsonResponse(404, errorEnvelope('not_found', 'no fake route for ${request.uri.path}'));
  }

  return CommerceClient(
    config: CommerceConfig(baseUrl: Uri.parse('https://api.example.com/commerce/v1'), storeBearerToken: 't'),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport(handler),
  );
}

Future<Color> _bootAndReadPrimary(WidgetTester tester, Future<CommerceHttpResponse> Function() experience, {ExperienceCache? cache}) async {
  await tester.pumpWidget(AwjMobileRuntimeApp(client: _client(experience), experienceCache: cache ?? InMemoryExperienceCache()));
  await tester.pumpAndSettle();
  return Theme.of(tester.element(find.text('أَوْج — AWJ Mobile Runtime'))).colorScheme.primary;
}

Future<CommerceHttpResponse> _published(String schemaJson) async => jsonResponse(200, {
      'data': {'version': 1, 'schema_version': '1', 'published_at': '2026-09-25T00:00:00Z', 'schema': jsonDecode(schemaJson)},
      'meta': successMeta(),
    });

void main() {
  const merchant = Color(0xFF1E3A5F);

  testWidgets('a published experience\'s colorPrimary themes the real app (not the bundled schema)', (tester) async {
    final primary = await _bootAndReadPrimary(tester, () => _published(_experience({'colorPrimary': '#1E3A5F'})));
    expect(primary, _primaryFor(merchant));
    expect(primary, isNot(_primaryFor(_brand)));
  });

  testWidgets('a published experience that still carries the legacy primaryColor themes the app too (CPT-04)', (tester) async {
    final primary = await _bootAndReadPrimary(tester, () => _published(_experience({'primaryColor': '#1E3A5F'})));
    expect(primary, _primaryFor(merchant));
  });

  testWidgets('a published experience without a color token keeps the brand default', (tester) async {
    final primary = await _bootAndReadPrimary(tester, () => _published(_experience({})));
    expect(primary, _primaryFor(_brand));
  });

  testWidgets('no published experience (404) → Default AWJ Experience → the bundled brand color', (tester) async {
    final primary = await _bootAndReadPrimary(
      tester,
      () async => jsonResponse(404, errorEnvelope('not_found', 'لا توجد تجربة منشورة لهذا المستأجر.')),
    );
    expect(primary, _primaryFor(_brand));
  });

  testWidgets('the theme is applied from the last-known-good experience when the network fails', (tester) async {
    final cache = InMemoryExperienceCache();
    // إقلاع أول ناجح يملأ الذاكرة المحلية…
    await _bootAndReadPrimary(tester, () => _published(_experience({'colorPrimary': '#1E3A5F'})), cache: cache);
    await tester.pumpWidget(const SizedBox());
    // …ثم إقلاع بلا شبكة يستعمل آخر نسخة سليمة بثيمها.
    final primary = await _bootAndReadPrimary(tester, () async => throw const CommerceTransportException('offline', attempts: 3), cache: cache);
    expect(primary, _primaryFor(merchant));
  });
}

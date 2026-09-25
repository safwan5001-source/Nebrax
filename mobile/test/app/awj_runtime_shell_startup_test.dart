import 'dart:convert';

import 'package:awj_mobile_runtime/app/awj_runtime_shell.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

/// Proves the AWJ Runtime Boot contract's four branches are actually wired
/// into the real [AwjRuntimeShell] boot path (`resolveRealStartup` ->
/// `resolveStartup` -> Home/Cart), not only exercised in isolation by
/// `test/startup/*.dart`'s pure decision-function tests. Each test's fake
/// `commerce/v1` server answers `GET .../experience` deliberately
/// differently, and the shell's own rendered output — not a unit-level
/// return value — is what each assertion checks.
///
/// A schema with a `home` page containing exactly one uniquely-labelled
/// `Text` node (never the bundled Default AWJ Experience's own strings) is
/// the signal used throughout: if `AwjRuntimeShell` silently kept using the
/// old bundled-schema startup path (this task's own explicit failure mode
/// to guard against), this marker would never appear.
String _homeExperienceJson(String markerText) => encodeSchema(
  baseSchemaJson(
    pageOverride: componentNode(
      type: 'Page',
      id: 'home-root',
      children: [
        componentNode(
          type: 'Section',
          id: 'hero',
          children: [componentNode(type: 'Text', id: 'marker', props: {'text': markerText})],
        ),
      ],
    ),
  ),
);

CommerceClient _client(Future<CommerceHttpResponse> Function(CommerceHttpRequest) experienceHandler) {
  Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
    final segments = request.uri.pathSegments;
    if (segments.last == 'experience') return experienceHandler(request);
    if (segments.last == 'products') {
      return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
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
    return jsonResponse(404, errorEnvelope('not_found', 'no fake route for ${request.uri.path}'));
  }

  return CommerceClient(
    config: CommerceConfig(baseUrl: Uri.parse('https://api.example.com/commerce/v1'), storeBearerToken: 't'),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport(handler),
  );
}

/// Always takes an explicit [experienceCache] (never the shell's own
/// production default, [FileExperienceCache]) — `path_provider`'s platform
/// channel has no host to answer it under `flutter_test`, so relying on the
/// production default here would hang the test instead of failing it.
Widget _shell(CommerceClient client, {required ExperienceCache experienceCache}) {
  return MaterialApp(
    home: AwjRuntimeShell(
      client: client,
      experienceCache: experienceCache,
      locale: const Locale('ar'),
      onLocaleChanged: (_) {},
    ),
  );
}

void main() {
  const bundledTagline = 'تسوّق منتجاتك المفضّلة'; // RuntimeStrings.tagline (ar) — the Default AWJ Experience's own hydrated text.

  testWidgets('A — a Published Experience is fetched, resolved, and actually rendered', (tester) async {
    const marker = 'PUBLISHED_EXPERIENCE_MARKER';
    final client = _client((request) async {
      return jsonResponse(200, {
        'data': {
          'version': 1,
          'schema_version': '1',
          'published_at': '2026-09-25T00:00:00Z',
          'schema': jsonDecode(_homeExperienceJson(marker)),
        },
        'meta': successMeta(),
      });
    });

    await tester.pumpWidget(_shell(client, experienceCache: InMemoryExperienceCache()));
    await tester.pumpAndSettle();

    expect(find.text(marker), findsOneWidget);
    // Proves the shell did not silently fall back to (or stay on) the
    // bundled Default AWJ Experience while a Published one was available.
    expect(find.text(bundledTagline), findsNothing);
  });

  testWidgets('B — no Published Experience (404) renders the Default AWJ Experience, not an error', (
    tester,
  ) async {
    final client = _client((request) async {
      return jsonResponse(404, errorEnvelope('not_found', 'لا توجد تجربة منشورة لهذا المستأجر.'));
    });

    await tester.pumpWidget(_shell(client, experienceCache: InMemoryExperienceCache()));
    await tester.pumpAndSettle();

    expect(find.text(bundledTagline), findsOneWidget);
    expect(find.text('إعادة المحاولة'), findsNothing);
  });

  testWidgets('C — a transient fetch failure with an intact last-known-good cache renders the cached Experience', (
    tester,
  ) async {
    const marker = 'LAST_KNOWN_GOOD_MARKER';
    final cache = InMemoryExperienceCache();
    await cache.write(CachedExperience.capture(_homeExperienceJson(marker), cachedAt: DateTime.utc(2026, 9, 24)));

    final client = _client((request) async {
      return jsonResponse(500, errorEnvelope('internal_error', 'temporary outage'));
    });

    await tester.pumpWidget(_shell(client, experienceCache: cache));
    await tester.pumpAndSettle();

    expect(find.text(marker), findsOneWidget);
    expect(find.text(bundledTagline), findsNothing);
  });

  testWidgets('D — a transient fetch failure with no cache renders ControlledUnavailable, never Home/Cart', (
    tester,
  ) async {
    final client = _client((request) async {
      return jsonResponse(500, errorEnvelope('internal_error', 'temporary outage'));
    });

    await tester.pumpWidget(_shell(client, experienceCache: InMemoryExperienceCache()));
    await tester.pumpAndSettle();

    expect(find.text('إعادة المحاولة'), findsOneWidget);
    expect(find.text(bundledTagline), findsNothing);
    expect(find.text('عرض السلة'), findsNothing);
  });
}

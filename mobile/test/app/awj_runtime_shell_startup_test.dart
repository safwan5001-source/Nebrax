import 'dart:convert';
import 'dart:io';

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

  group('E — LIVE-PREVIEW-7 integrated-proof fixture', () {
    // Relative to this package's root — `mobile-ci.yml` runs `flutter test` with
    // `working-directory: mobile`, matching `binding_visibility_conformance_test.dart`'s own
    // established convention for reading a file shared with the PHP/TypeScript suites.
    const fixturePath = '../contracts/app-builder/integrated-proof-schema.v1.json';

    Map<String, Object?> loadIntegratedProofFixture() {
      final file = File(fixturePath);
      if (!file.existsSync()) {
        throw StateError(
          'Shared LIVE-PREVIEW-7 fixture not found at "$fixturePath" (resolved from '
          '${Directory.current.path}). `flutter test` must be run from the `mobile/` directory.',
        );
      }
      return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
    }

    /// A real fake `commerce/v1` server: `/experience` answers with the exact document
    /// `tests/Feature/AppBuilderPreviewToRuntimeIntegratedProofTest.php` proves Draft ->
    /// Validate -> Publish -> `GET commerce/v1/experience` round-trips byte-identically;
    /// `/products`/`/cart` answer with real-shaped data (the same field names
    /// `DataResourceRegistry.php`/`web/.../sample-resource-data.ts` document) so the fixture's
    /// `$item.name`/`$item.price.amount_minor`/`$item.product_name`/
    /// `$item.line_total.amount_minor` references actually resolve to real values, not just
    /// structurally parse.
    // Built directly (not via this file's own `_client` helper): `_client` only forwards
    // `/experience` requests to its callback and hardcodes empty `/products`/`/cart`
    // responses internally — this fixture needs real-shaped data on all three routes for its
    // bindings to actually hydrate, not just parse structurally.
    CommerceClient integratedProofClient() {
      final fixture = loadIntegratedProofFixture();
      Future<CommerceHttpResponse> handler(CommerceHttpRequest request) async {
        final segments = request.uri.pathSegments;
        if (segments.last == 'experience') {
          return jsonResponse(200, {
            'data': {
              'version': 1,
              'schema_version': '1.0.0',
              'published_at': '2026-09-25T00:00:00Z',
              'schema': fixture,
            },
            'meta': successMeta(),
          });
        }
        if (segments.last == 'products') {
          return jsonResponse(200, {
            'data': [
              {'id': 'p-1', 'name': 'LIVE_PREVIEW_7_PRODUCT_NAME', 'price': money(amountMinor: 12345)},
            ],
            'meta': paginationMeta(),
          });
        }
        if (segments.last == 'cart') {
          return jsonResponse(200, {
            'data': {
              'status': 'active',
              'items': [
                {
                  'id': 'ci-1',
                  'product_id': 'p-1',
                  'product_variant_id': null,
                  'variant_descriptor': null,
                  'product_name': 'LIVE_PREVIEW_7_CART_LINE_PRODUCT_NAME',
                  'unit_key': 'unit',
                  'unit_name': 'piece',
                  'quantity': 1,
                  'unit_price': money(amountMinor: 12345),
                  'line_total': money(amountMinor: 12345),
                  'available': true,
                },
              ],
              'subtotal': money(amountMinor: 12345),
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

    testWidgets(
      'the fixture is fetched, resolved compatible, and actually rendered — Home binds real products',
      (tester) async {
        await tester.pumpWidget(_shell(integratedProofClient(), experienceCache: InMemoryExperienceCache()));
        await tester.pumpAndSettle();

        // Proves fetch (real HTTP-shaped JSON) -> resolveRealStartup -> UseFreshExperience ->
        // CompatibilityResolver (Dart) accepted this exact document, and AwjRuntimeShell
        // actually rendered it — never silently kept showing the bundled Default AWJ
        // Experience while a Published one was available.
        expect(find.text('LIVE_PREVIEW_7_INTEGRATED_PROOF_MARKER'), findsOneWidget);
        expect(find.text(bundledTagline), findsNothing);

        // Proves the ProductList's `binding: {resource: "commerce.products"}` (no `collect` —
        // the real, working grammar: commerce.products' own wire shape is already a list, so
        // binding_resolution.dart's List-resource branch repeats the ProductCard template)
        // actually hydrated `$item.name`/`$item.price.amount_minor` against the real fetched
        // product, not just parsed structurally.
        expect(find.text('LIVE_PREVIEW_7_PRODUCT_NAME'), findsOneWidget);
        expect(find.textContaining('123.45'), findsOneWidget);
      },
    );

    testWidgets('navigating to Cart hydrates the real binding.collect line template', (tester) async {
      await tester.pumpWidget(_shell(integratedProofClient(), experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();

      await tester.tap(find.text('View cart'));
      await tester.pumpAndSettle();

      // Proves CartList's `binding: {resource: "commerce.cart", collect: "items"}` actually
      // repeated the authored Section/Price line template once per real fetched cart item,
      // resolving `$item.product_name`/`$item.line_total.amount_minor` — the same
      // `binding.collect` + `$item.*` grammar LIVE-PREVIEW-2/3 proved in Preview, now proven
      // against the real runtime's own resolver on this exact fixture.
      expect(find.text('LIVE_PREVIEW_7_CART_LINE_PRODUCT_NAME'), findsOneWidget);
    });
  });
}

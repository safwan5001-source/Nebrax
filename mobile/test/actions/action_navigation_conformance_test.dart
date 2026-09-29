/// MOBILE-PREVIEW-4 (`AWJ_APP_BUILDER_REAL_MOBILE_PREVIEW_HORIZON.md`)
/// conformance suite.
///
/// Loads the single canonical fixture at
/// `contracts/app-builder/action-navigation-conformance.v1.json` (relative to
/// this package's root — matches `mobile-ci.yml`'s `working-directory: mobile`)
/// and asserts this repository's real `decodeAction`
/// (`actions/app_action.dart` — the source of truth) reproduces every case's
/// `decode` result exactly, and that for every `navigate` case, the real
/// `RuntimeActionHandler.onNavigate` actually changes (or, for an unsupported
/// pageId, leaves unchanged) `RuntimeState.page` exactly as the fixture's
/// `previewOutcome.kind` says.
///
/// `web/src/modules/app-builder/action-semantics.test.ts` asserts the *same*
/// fixture file against the TypeScript port Browser Preview uses. Whenever
/// either implementation's behavior changes without the shared fixture being
/// updated to match, that side's own conformance test fails here or there.
library;

import 'dart:convert';
import 'dart:io';

import 'package:awj_mobile_runtime/actions/actions.dart';
import 'package:awj_mobile_runtime/app/runtime_action_handler.dart';
import 'package:awj_mobile_runtime/app/runtime_state.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

const _fixturePath = '../contracts/app-builder/action-navigation-conformance.v1.json';

Map<String, Object?> _loadFixture() {
  final file = File(_fixturePath);
  if (!file.existsSync()) {
    throw StateError(
      'Shared conformance fixture not found at "$_fixturePath" (resolved from '
      '${Directory.current.path}). `flutter test` must be run from the `mobile/` '
      'directory — matches `mobile-ci.yml`\'s `working-directory: mobile`.',
    );
  }
  return jsonDecode(file.readAsStringSync()) as Map<String, Object?>;
}

CommerceClient _client() {
  return CommerceClient(
    config: CommerceConfig(baseUrl: Uri.parse('https://api.example.com/commerce/v1'), storeBearerToken: 't'),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport.always(jsonResponse(200, {'data': {}, 'meta': successMeta()})),
  );
}

/// Asserts `decoded` (the real `decodeAction` result) matches the fixture
/// case's `decode` field (`null`, or a `{kind, ...fields}` map).
void _expectDecodeMatches(AppAction? decoded, Object? expected) {
  if (expected == null) {
    expect(decoded, isNull);
    return;
  }
  final expectedMap = expected as Map<String, Object?>;
  switch (expectedMap['kind']) {
    case 'NavigateAction':
      expect(decoded, isA<NavigateAction>());
      expect((decoded as NavigateAction).pageId, expectedMap['pageId']);
    case 'OpenProductAction':
      expect(decoded, isA<OpenProductAction>());
      expect((decoded as OpenProductAction).productId, expectedMap['productId']);
    case 'AddToCartAction':
      expect(decoded, isA<AddToCartAction>());
      final a = decoded as AddToCartAction;
      expect(a.productId, expectedMap['productId']);
      expect(a.variantId, expectedMap['variantId']);
      expect(a.quantity, expectedMap['quantity']);
    case 'UpdateCartQuantityAction':
      expect(decoded, isA<UpdateCartQuantityAction>());
      final a = decoded as UpdateCartQuantityAction;
      expect(a.cartItemId, expectedMap['cartItemId']);
      expect(a.quantity, expectedMap['quantity']);
    case 'RemoveCartItemAction':
      expect(decoded, isA<RemoveCartItemAction>());
      expect((decoded as RemoveCartItemAction).cartItemId, expectedMap['cartItemId']);
    case 'RefreshAction':
      expect(decoded, isA<RefreshAction>());
    default:
      fail('fixture case has an unrecognized expected decode kind: ${expectedMap['kind']}');
  }
}

void main() {
  final fixture = _loadFixture();
  final cases = (fixture['cases'] as List).cast<Map<String, Object?>>();

  test('loads a non-empty shared fixture', () {
    expect(cases, isNotEmpty);
  });

  group('decodeAction conformance (vs. contracts/app-builder/action-navigation-conformance.v1.json)', () {
    for (final testCase in cases) {
      test(testCase['id'], () {
        final actionJson = testCase['action'] as Map<String, Object?>;
        final ref = ActionRef(
          type: actionJson['type'] as String,
          params: (actionJson['params'] as Map<String, Object?>?) ?? const {},
        );
        _expectDecodeMatches(decodeAction(ref), testCase['decode']);
      });
    }
  });

  group('navigate-support conformance (real RuntimeActionHandler.onNavigate)', () {
    for (final testCase in cases) {
      final outcome = testCase['previewOutcome'] as Map<String, Object?>;
      if (outcome['kind'] != 'navigate' && outcome['kind'] != 'navigate-unsupported') continue;

      test('${testCase['id']} — RuntimeState.page matches previewOutcome', () async {
        final state = RuntimeState();
        final handler = RuntimeActionHandler(
          client: _client(),
          state: state,
          onError: (_) => fail('should not error'),
        );
        final actionJson = testCase['action'] as Map<String, Object?>;
        final pageId = (actionJson['params'] as Map<String, Object?>)['pageId'] as String;

        await handler.onNavigate(NavigateAction(pageId));

        if (outcome['kind'] == 'navigate') {
          final expectedPage = outcome['pageId'] == 'home' ? RuntimePage.home : RuntimePage.cart;
          expect(
            state.page,
            expectedPage,
            reason: 'fixture says this pageId is a real, wired navigation target',
          );
        } else {
          expect(
            state.page,
            RuntimePage.home,
            reason: 'fixture says this pageId is unsupported — RuntimeState starts at home and '
                'onNavigate\'s default branch must leave it unchanged',
          );
        }
      });
    }
  });
}

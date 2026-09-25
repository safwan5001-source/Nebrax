import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';

import '../commerce/fake_transport.dart';
import 'fake_commerce.dart';

void main() {
  testWidgets(
    'MR-16: resuming from background re-fetches Home data via the existing refresh pipeline',
    (tester) async {
      var productListCalls = 0;
      final client = buildFakeCommerceClient(
        handler: (request) async {
          if (request.method == CommerceHttpMethod.get &&
              request.uri.pathSegments.last == 'products') {
            productListCalls++;
          }
          // The AWJ Runtime Boot contract's `GET commerce/v1/experience` —
          // see `deep_link_navigation_test.dart`'s identical branch for why
          // this is a 404, not the generic `{data: []}` fallback below.
          if (request.uri.pathSegments.last == 'experience') {
            return jsonResponse(404, errorEnvelope('not_found', 'no published experience'));
          }
          return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
        },
      );

      await tester.pumpWidget(AwjMobileRuntimeApp(client: client, experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();
      expect(productListCalls, 1, reason: 'cold start loads Home once');

      // Backgrounding must not, by itself, trigger a refetch.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.paused);
      await tester.pump();
      expect(productListCalls, 1, reason: 'going to background does not refetch');

      // The real device sequence passes back through `inactive` on the way
      // to `resumed` — the refresh must still fire exactly once.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pumpAndSettle();

      expect(productListCalls, 2, reason: 'resuming from background refreshes once');

      // A further `resumed` callback with no intervening `paused` (e.g. a
      // spurious duplicate lifecycle event) must not refresh again.
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();
      expect(productListCalls, 2, reason: 'a duplicate resumed event is not a new background cycle');
    },
  );

  testWidgets(
    'a plain inactive <-> resumed flicker (e.g. a transient system dialog) never refetches',
    (tester) async {
      var productListCalls = 0;
      final client = buildFakeCommerceClient(
        handler: (request) async {
          if (request.method == CommerceHttpMethod.get &&
              request.uri.pathSegments.last == 'products') {
            productListCalls++;
          }
          if (request.uri.pathSegments.last == 'experience') {
            return jsonResponse(404, errorEnvelope('not_found', 'no published experience'));
          }
          return jsonResponse(200, {'data': [], 'meta': paginationMeta()});
        },
      );

      await tester.pumpWidget(AwjMobileRuntimeApp(client: client, experienceCache: InMemoryExperienceCache()));
      await tester.pumpAndSettle();
      expect(productListCalls, 1);

      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.inactive);
      tester.binding.handleAppLifecycleStateChanged(AppLifecycleState.resumed);
      await tester.pump();

      expect(productListCalls, 1, reason: 'never actually backgrounded (paused), so no refresh');
    },
  );
}

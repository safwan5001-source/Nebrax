import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:awj_mobile_runtime/app.dart';
import 'package:awj_mobile_runtime/app/runtime_schema.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';

import 'app/fake_commerce.dart';

void main() {
  testWidgets('AwjMobileRuntimeApp boots to the runtime shell screen', (
    tester,
  ) async {
    await tester.pumpWidget(
      AwjMobileRuntimeApp(client: buildFakeCommerceClient(), experienceCache: InMemoryExperienceCache()),
    );
    await tester.pumpAndSettle();

    expect(find.text('أَوْج — AWJ Mobile Runtime'), findsOneWidget);
  });

  testWidgets('AwjMobileRuntimeApp defaults to RTL text direction', (
    tester,
  ) async {
    await tester.pumpWidget(
      AwjMobileRuntimeApp(client: buildFakeCommerceClient(), experienceCache: InMemoryExperienceCache()),
    );
    await tester.pumpAndSettle();

    final shellElement = tester.element(
      find.text('أَوْج — AWJ Mobile Runtime'),
    );
    expect(Directionality.of(shellElement), TextDirection.rtl);
  });

  testWidgets(
    'AwjMobileRuntimeApp seeds its Material theme from the bundled schema\'s theme.tokens.colorPrimary '
    '(APP-BUILDER-22 — the token used to be parsed but never read)',
    (tester) async {
      await tester.pumpWidget(
        AwjMobileRuntimeApp(client: buildFakeCommerceClient(), experienceCache: InMemoryExperienceCache()),
      );
      await tester.pumpAndSettle();

      final shellElement = tester.element(
        find.text('أَوْج — AWJ Mobile Runtime'),
      );
      final expectedSeed = themeSeedColorFromSchema(kHomeSchemaJson);
      expect(
        Theme.of(shellElement).colorScheme.primary,
        ThemeData(colorSchemeSeed: expectedSeed, useMaterial3: true)
            .colorScheme
            .primary,
      );
    },
  );
}

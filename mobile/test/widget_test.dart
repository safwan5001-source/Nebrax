import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:awj_mobile_runtime/app.dart';

void main() {
  testWidgets('AwjMobileRuntimeApp boots to the runtime shell screen', (tester) async {
    await tester.pumpWidget(const AwjMobileRuntimeApp());
    await tester.pumpAndSettle();

    expect(find.text('نبراس — AWJ Mobile Runtime'), findsOneWidget);
  });

  testWidgets('AwjMobileRuntimeApp defaults to RTL text direction', (tester) async {
    await tester.pumpWidget(const AwjMobileRuntimeApp());
    await tester.pumpAndSettle();

    final shellElement = tester.element(find.text('نبراس — AWJ Mobile Runtime'));
    expect(Directionality.of(shellElement), TextDirection.rtl);
  });
}

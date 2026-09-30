import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

/// MOBILE-PREVIEW-7 — end-to-end proof that a scanned deep link actually
/// drives the device preview entry point (`AwjDevicePreviewApp`): a
/// simulated native platform-channel call -> [resolvePreviewExchangeReferenceFromUri]
/// -> [PreviewExchangeClient.exchange] -> handing off to the real,
/// unmodified [PreviewRuntimeView] MOBILE-PREVIEW-6 already ships. Mirrors
/// `app/deep_link_navigation_test.dart`'s own platform-channel simulation
/// shape exactly.
void main() {
  const channel = MethodChannel('awj/deep_links');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Uri baseUrl() => Uri.parse('https://preview.invalid/preview/v1');

  testWidgets('shows the waiting-for-link state before any link arrives', (tester) async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => null);

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: FakeCommerceTransport.always(
        jsonResponse(201, {'token': '1|unused', 'session': {}}),
      )),
    ));
    await tester.pumpAndSettle();

    expect(find.text('امسح رمز الاستجابة السريعة من لوحة تحكّم المتجر لبدء المعاينة.'), findsOneWidget);
    expect(find.byType(PreviewRuntimeView), findsNothing);
  });

  testWidgets('a cold-start valid link exchanges and hands off to the real preview runtime, unmodified', (tester) async {
    final transport = FakeCommerceTransport.always(
      jsonResponse(201, {'token': '1|real-bearer', 'session': {'id': 'ps-1'}}),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'getInitialLink') {
            return 'https://$kPreviewDeepLinkHost/preview/scannedOnceReference';
          }
          return null;
        });

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: transport),
    ));
    await tester.pumpAndSettle();

    // نفس عنصر واجهة المعاينة الحقيقي تماماً — لا نسخة موازية.
    expect(find.byType(PreviewRuntimeView), findsOneWidget);
    expect(transport.requests.single.uri.path, endsWith('/exchange'));
  });

  testWidgets('a warm-start link with the wrong host is silently ignored — stays waiting', (tester) async {
    final transport = FakeCommerceTransport.always(
      jsonResponse(201, {'token': '1|unused', 'session': {}}),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => null);

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: transport),
    ));
    await tester.pumpAndSettle();

    final data = const StandardMethodCodec().encodeMethodCall(
      MethodCall('onLink', 'https://evil.example/preview/whatever'),
    );
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(channel.name, data, (_) {});
    await tester.pumpAndSettle();

    expect(find.text('امسح رمز الاستجابة السريعة من لوحة تحكّم المتجر لبدء المعاينة.'), findsOneWidget);
    expect(transport.requests, isEmpty);
  });

  testWidgets('an expired/consumed/unknown reference shows the controlled invalid state, never the runtime', (tester) async {
    final transport = FakeCommerceTransport.always(
      jsonResponse(401, {'error': {'code': 'unauthenticated', 'message': 'هذا الرمز لم يعد صالحاً.'}}),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'getInitialLink') {
            return 'https://$kPreviewDeepLinkHost/preview/alreadyUsed';
          }
          return null;
        });

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: transport),
    ));
    await tester.pumpAndSettle();

    expect(find.text('هذا الرمز لم يعد صالحاً. اطلب رمزاً جديداً من لوحة التحكّم وأعد المسح.'), findsOneWidget);
    expect(find.byType(PreviewRuntimeView), findsNothing);
  });

  testWidgets('a transport/protocol failure shows the controlled unavailable state, never a crash', (tester) async {
    final transport = FakeCommerceTransport.always(
      jsonResponse(500, {'error': {'code': 'internal_error', 'message': 'خطأ'}}),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'getInitialLink') {
            return 'https://$kPreviewDeepLinkHost/preview/serverDown';
          }
          return null;
        });

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: transport),
    ));
    await tester.pumpAndSettle();

    expect(find.text('تعذّر الاتصال بخدمة المعاينة حالياً.'), findsOneWidget);
    expect(find.byType(PreviewRuntimeView), findsNothing);
  });

  testWidgets('a second link delivered after a successful exchange never re-triggers a second exchange', (tester) async {
    final transport = FakeCommerceTransport.always(
      jsonResponse(201, {'token': '1|real-bearer', 'session': {'id': 'ps-1'}}),
    );
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async {
          if (call.method == 'getInitialLink') {
            return 'https://$kPreviewDeepLinkHost/preview/firstScan';
          }
          return null;
        });

    await tester.pumpWidget(AwjDevicePreviewApp(
      baseUrl: baseUrl(),
      exchangeClient: PreviewExchangeClient(baseUrl: baseUrl(), transport: transport),
    ));
    await tester.pumpAndSettle();
    expect(find.byType(PreviewRuntimeView), findsOneWidget);

    final data = const StandardMethodCodec().encodeMethodCall(
      MethodCall('onLink', 'https://$kPreviewDeepLinkHost/preview/secondScanIgnored'),
    );
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(channel.name, data, (_) {});
    await tester.pumpAndSettle();

    // لا استهلاك ثانٍ إطلاقاً — الحالة الجاهزة نهائية لعمر هذه الجلسة.
    expect(transport.requests, hasLength(1));
    expect(find.byType(PreviewRuntimeView), findsOneWidget);
  });
}

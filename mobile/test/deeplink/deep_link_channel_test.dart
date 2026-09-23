import 'package:awj_mobile_runtime/deeplink/deep_link_channel.dart';
import 'package:awj_mobile_runtime/deeplink/deep_link_resolver.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// [DeepLinkController] wraps the one native-facing platform channel this
/// runtime uses for incoming links. Its actual native counterparts
/// (`MainActivity.kt`/`AppDelegate.swift`) run real Kotlin/Swift this
/// repository's CI cannot execute — what *is* fully verifiable headlessly is
/// the Dart-side contract: a cold-start link is read once via
/// `getInitialLink`, a live link arrives via an `onLink` call, both are
/// resolved through the exact same [resolveDeepLinkUri] allowlist, and
/// neither ever throws when the native side sends nothing (or doesn't exist
/// at all, e.g. a fresh test host with no mock registered).
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('awj/deep_links');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Future<void> simulateIncomingLink(String rawLink) async {
    final data = const StandardMethodCodec().encodeMethodCall(
      MethodCall('onLink', rawLink),
    );
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(channel.name, data, (_) {});
  }

  test(
    'a cold-start link from getInitialLink is resolved and dispatched once',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialLink') {
              return 'https://$kDeepLinkHost/product/p1';
            }
            return null;
          });

      final dispatched = <ActionRef>[];
      await DeepLinkController(onAction: dispatched.add).start();

      expect(dispatched, hasLength(1));
      expect(dispatched.single.type, 'openProduct');
      expect(dispatched.single.params, {'productId': 'p1'});
    },
  );

  test('no cold-start link (native returns null) dispatches nothing', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => null);

    final dispatched = <ActionRef>[];
    await DeepLinkController(onAction: dispatched.add).start();

    expect(dispatched, isEmpty);
  });

  test(
    'an invalid cold-start link (fails the allowlist) dispatches nothing',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(
            channel,
            (call) async => 'https://evil.example/product/p1',
          );

      final dispatched = <ActionRef>[];
      await DeepLinkController(onAction: dispatched.add).start();

      expect(dispatched, isEmpty);
    },
  );

  test(
    'no native side registered at all (MissingPluginException) never throws',
    () async {
      // No setMockMethodCallHandler call at all for this test — the channel
      // has no handler, exactly like a test host or an unconfigured platform.
      final dispatched = <ActionRef>[];
      await expectLater(
        DeepLinkController(onAction: dispatched.add).start(),
        completes,
      );
      expect(dispatched, isEmpty);
    },
  );

  test('a live (warm-start) onLink call is resolved and dispatched', () async {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, (call) async => null);

    final dispatched = <ActionRef>[];
    await DeepLinkController(onAction: dispatched.add).start();
    expect(dispatched, isEmpty);

    await simulateIncomingLink('https://$kDeepLinkHost/cart');

    expect(dispatched, hasLength(1));
    expect(dispatched.single.type, 'navigate');
    expect(dispatched.single.params, {'pageId': 'cart'});
  });

  test(
    'a live onLink call that fails the allowlist dispatches nothing',
    () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final dispatched = <ActionRef>[];
      await DeepLinkController(onAction: dispatched.add).start();

      await simulateIncomingLink('https://evil.example/product/p1');

      expect(dispatched, isEmpty);
    },
  );
}

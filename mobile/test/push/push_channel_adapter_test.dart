import 'package:awj_mobile_runtime/push/push_adapter.dart';
import 'package:awj_mobile_runtime/push/push_channel_adapter.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';

/// [ChannelPushAdapter] wraps the one native-facing platform channel this
/// runtime uses for push (`awj/push`). Its actual native counterparts
/// (`MainActivity.kt`/`AppDelegate.swift`) run real Kotlin/Swift this
/// repository's CI cannot execute — what *is* fully verifiable headlessly is
/// the Dart-side contract this test file proves: `requestPermission` maps
/// every native string reply to the right [PushPermissionStatus],
/// `getToken`/`getInitialMessage` round-trip (or fail safely to `null`),
/// and `onForegroundMessage`/`onMessageOpenedApp` decode a native-sent
/// payload defensively — never throwing when the native side sends nothing,
/// something malformed, or doesn't exist at all.
void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  const channel = MethodChannel('awj/push');

  tearDown(() {
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(channel, null);
  });

  Future<void> simulateNativeCall(String method, Object? arguments) async {
    final data = const StandardMethodCodec().encodeMethodCall(
      MethodCall(method, arguments),
    );
    await TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .handlePlatformMessage(channel.name, data, (_) {});
  }

  group('requestPermission', () {
    for (final entry in {
      'granted': PushPermissionStatus.granted,
      'denied': PushPermissionStatus.denied,
      'provisional': PushPermissionStatus.provisional,
    }.entries) {
      test('a native "${entry.key}" reply maps to ${entry.value}', () async {
        TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
            .setMockMethodCallHandler(channel, (call) async {
              if (call.method == 'requestPermission') return entry.key;
              return null;
            });

        final adapter = ChannelPushAdapter();
        await adapter.initialize();
        expect(await adapter.requestPermission(), entry.value);
        adapter.dispose();
      });
    }

    test('an unrecognized native reply falls back to notDetermined', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => 'something-new');

      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      expect(await adapter.requestPermission(), PushPermissionStatus.notDetermined);
      adapter.dispose();
    });

    test('no native side registered never throws, reports notDetermined', () async {
      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      await expectLater(
        adapter.requestPermission(),
        completion(PushPermissionStatus.notDetermined),
      );
      adapter.dispose();
    });
  });

  group('getToken / getInitialMessage', () {
    test('getToken returns the native string as-is', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getToken') return 'opaque-token-123';
            return null;
          });

      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      expect(await adapter.getToken(), 'opaque-token-123');
      adapter.dispose();
    });

    test('getToken with no native side registered returns null, never throws', () async {
      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      await expectLater(adapter.getToken(), completion(isNull));
      adapter.dispose();
    });

    test('getInitialMessage decodes a native Map into a PushMessage', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialMessage') {
              return {'type': 'openProduct', 'productId': 'p1'};
            }
            return null;
          });

      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      final message = await adapter.getInitialMessage();
      expect(message?.data, {'type': 'openProduct', 'productId': 'p1'});
      adapter.dispose();
    });

    test('getInitialMessage with no launching message returns null', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      expect(await adapter.getInitialMessage(), isNull);
      adapter.dispose();
    });

    test('a non-string value inside the native Map is dropped, never crashes', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async {
            if (call.method == 'getInitialMessage') {
              return {'type': 'openProduct', 'productId': 'p1', 'retryCount': 3};
            }
            return null;
          });

      final adapter = ChannelPushAdapter();
      await adapter.initialize();
      final message = await adapter.getInitialMessage();
      expect(message?.data, {'type': 'openProduct', 'productId': 'p1'});
      adapter.dispose();
    });
  });

  group('onForegroundMessage / onMessageOpenedApp', () {
    test('a live onForegroundMessage call is decoded onto the stream', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final adapter = ChannelPushAdapter();
      await adapter.initialize();

      final received = <Map<String, String>>[];
      final sub = adapter.onForegroundMessage.listen((m) => received.add(m.data));

      await simulateNativeCall('onForegroundMessage', {'type': 'navigate', 'pageId': 'cart'});

      expect(received, [
        {'type': 'navigate', 'pageId': 'cart'},
      ]);
      await sub.cancel();
      adapter.dispose();
    });

    test('a live onMessageOpenedApp call is decoded onto its own stream', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final adapter = ChannelPushAdapter();
      await adapter.initialize();

      final received = <Map<String, String>>[];
      final sub = adapter.onMessageOpenedApp.listen((m) => received.add(m.data));

      await simulateNativeCall('onMessageOpenedApp', {'type': 'openProduct', 'productId': 'p1'});

      expect(received, [
        {'type': 'openProduct', 'productId': 'p1'},
      ]);
      await sub.cancel();
      adapter.dispose();
    });

    test('a malformed (non-Map) native call is silently dropped', () async {
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(channel, (call) async => null);

      final adapter = ChannelPushAdapter();
      await adapter.initialize();

      final received = <Map<String, String>>[];
      final sub = adapter.onForegroundMessage.listen((m) => received.add(m.data));

      await simulateNativeCall('onForegroundMessage', 'not-a-map');

      expect(received, isEmpty);
      await sub.cancel();
      adapter.dispose();
    });
  });
}

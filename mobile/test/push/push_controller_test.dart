import 'package:awj_mobile_runtime/push/push_adapter.dart';
import 'package:awj_mobile_runtime/push/push_controller.dart';
import 'package:awj_mobile_runtime/push/push_message.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_push_adapter.dart';

void main() {
  test('start() initializes and requests permission exactly once', () async {
    final adapter = FakePushAdapter();
    await PushController(adapter: adapter, onAction: (_) {}).start();

    expect(adapter.initializeCalled, isTrue);
    expect(adapter.requestPermissionCallCount, 1);
    adapter.dispose();
  });

  test('lastPermissionStatus reflects the adapter\'s reported status', () async {
    final adapter = FakePushAdapter()..permissionToReturn = PushPermissionStatus.denied;
    final controller = PushController(adapter: adapter, onAction: (_) {});

    expect(controller.lastPermissionStatus, isNull);
    await controller.start();
    expect(controller.lastPermissionStatus, PushPermissionStatus.denied);
    adapter.dispose();
  });

  test(
    'a cold-start message from getInitialMessage is resolved and dispatched once',
    () async {
      final adapter = FakePushAdapter()
        ..initialMessage = const PushMessage({'type': 'openProduct', 'productId': 'p1'});

      final dispatched = <ActionRef>[];
      await PushController(adapter: adapter, onAction: dispatched.add).start();

      expect(dispatched, hasLength(1));
      expect(dispatched.single.type, 'openProduct');
      expect(dispatched.single.params, {'productId': 'p1'});
      adapter.dispose();
    },
  );

  test('no cold-start message dispatches nothing', () async {
    final adapter = FakePushAdapter();
    final dispatched = <ActionRef>[];
    await PushController(adapter: adapter, onAction: dispatched.add).start();

    expect(dispatched, isEmpty);
    adapter.dispose();
  });

  test(
    'a cold-start message that fails the payload allowlist dispatches nothing',
    () async {
      final adapter = FakePushAdapter()
        ..initialMessage = const PushMessage({'type': 'addToCart', 'productId': 'p1'});

      final dispatched = <ActionRef>[];
      await PushController(adapter: adapter, onAction: dispatched.add).start();

      expect(dispatched, isEmpty);
      adapter.dispose();
    },
  );

  test('a live (warm-start) onMessageOpenedApp event is resolved and dispatched', () async {
    final adapter = FakePushAdapter();
    final dispatched = <ActionRef>[];
    await PushController(adapter: adapter, onAction: dispatched.add).start();
    expect(dispatched, isEmpty);

    adapter.emitMessageOpenedApp(const PushMessage({'type': 'navigate', 'pageId': 'cart'}));
    await Future<void>.delayed(Duration.zero);

    expect(dispatched, hasLength(1));
    expect(dispatched.single.type, 'navigate');
    expect(dispatched.single.params, {'pageId': 'cart'});
    adapter.dispose();
  });

  test(
    'a foreground message never dispatches navigation — arrival is not a command',
    () async {
      final adapter = FakePushAdapter();
      final dispatched = <ActionRef>[];
      await PushController(adapter: adapter, onAction: dispatched.add).start();

      adapter.emitForegroundMessage(const PushMessage({'type': 'openProduct', 'productId': 'p1'}));
      await Future<void>.delayed(Duration.zero);

      expect(dispatched, isEmpty);
      adapter.dispose();
    },
  );
}

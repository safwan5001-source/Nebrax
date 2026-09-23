import 'dart:async';

import 'package:awj_mobile_runtime/push/push_adapter.dart';
import 'package:awj_mobile_runtime/push/push_message.dart';

/// A [PushAdapter] test double — lets [PushController]'s own lifecycle
/// logic be tested in isolation from any platform channel, exactly like
/// `recording_action_handler.dart` isolates [AppActionDispatcher] tests
/// from a real [ActionHandler].
class FakePushAdapter implements PushAdapter {
  final _openedAppController = StreamController<PushMessage>.broadcast();
  final _foregroundController = StreamController<PushMessage>.broadcast();

  PushMessage? initialMessage;
  PushPermissionStatus permissionToReturn = PushPermissionStatus.granted;
  String? token;

  bool initializeCalled = false;
  int requestPermissionCallCount = 0;

  @override
  Future<void> initialize() async {
    initializeCalled = true;
  }

  @override
  Future<PushPermissionStatus> requestPermission() async {
    requestPermissionCallCount++;
    return permissionToReturn;
  }

  @override
  Future<String?> getToken() async => token;

  @override
  Future<PushMessage?> getInitialMessage() async => initialMessage;

  @override
  Stream<PushMessage> get onMessageOpenedApp => _openedAppController.stream;

  @override
  Stream<PushMessage> get onForegroundMessage => _foregroundController.stream;

  void emitMessageOpenedApp(PushMessage message) => _openedAppController.add(message);

  void emitForegroundMessage(PushMessage message) => _foregroundController.add(message);

  void dispose() {
    _openedAppController.close();
    _foregroundController.close();
  }
}

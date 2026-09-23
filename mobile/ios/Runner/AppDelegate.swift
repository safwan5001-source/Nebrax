import Flutter
import UIKit
import UserNotifications

/// Also wires the `awj/push` platform channel (MOBILE-RUNTIME-8, horizon
/// MR-09): the one native-facing entry point `push_channel_adapter.dart`'s
/// `ChannelPushAdapter` talks to. `requestPermission` is real, standard
/// `UNUserNotificationCenter` authorization — no push transport SDK
/// required for that step, since asking the user for permission and
/// actually receiving a push are separate concerns. `getToken` and
/// `getInitialMessage` deliberately return `nil`: no push transport SDK
/// (Firebase or otherwise) is linked in this horizon (see
/// `push_channel_adapter.dart`'s own doc comment for why) — structurally
/// ready, intentionally inert until a concrete provider is chosen, which
/// this horizon's own rules (MR-09, MR-19, §10 Decision Gates) require
/// Safwan's explicit approval for, not something wired here on this task's
/// own initiative.
@main
@objc class AppDelegate: FlutterAppDelegate, FlutterImplicitEngineDelegate {
  private let pushChannelName = "awj/push"
  private var pushChannel: FlutterMethodChannel?

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  func didInitializeImplicitFlutterEngine(_ engineBridge: FlutterImplicitEngineBridge) {
    GeneratedPluginRegistrant.register(with: engineBridge.pluginRegistry)

    guard let registrar = engineBridge.pluginRegistry.registrar(forPlugin: "AwjPushChannel") else {
      return
    }
    let channel = FlutterMethodChannel(name: pushChannelName, binaryMessenger: registrar.messenger())
    channel.setMethodCallHandler { call, result in
      switch call.method {
      case "requestPermission":
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) {
          granted, _ in
          DispatchQueue.main.async {
            result(granted ? "granted" : "denied")
          }
        }
      case "getToken", "getInitialMessage":
        result(nil)
      default:
        result(FlutterMethodNotImplemented)
      }
    }
    pushChannel = channel
  }
}

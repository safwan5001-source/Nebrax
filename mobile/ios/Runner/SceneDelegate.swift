import Flutter
import UIKit

/// Forwards an incoming iOS Universal Link to Dart (MOBILE-RUNTIME-7,
/// horizon MR-08) over the same `awj/deep_links` platform channel
/// `MainActivity.kt` uses on Android — `deep_link_channel.dart`'s
/// `DeepLinkController` is the one place either platform's raw URL string
/// is validated/allowlisted; nothing here does that itself.
///
/// This app uses Flutter's multi-window `FlutterSceneDelegate` (see
/// `Info.plist`'s `UIApplicationSceneManifest`), so Universal Link handling
/// belongs on `UIWindowSceneDelegate`'s own `scene(_:continue:)` — not
/// `UIApplicationDelegate`'s equivalent method, which scene-based apps do
/// not receive for this purpose. `pendingLink` covers a cold start (the
/// link that launched the app, delivered via `connectionOptions` before
/// Dart's own `getInitialLink` call arrives) as well as a warm start (this
/// scene already running, delivered live via `onLink`) — both funnel
/// through the identical Dart-side `resolveDeepLinkUri` allowlist.
class SceneDelegate: FlutterSceneDelegate {
  private let deepLinkChannelName = "awj/deep_links"
  private var deepLinkChannel: FlutterMethodChannel?
  private var pendingLink: String?

  override func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    super.scene(scene, willConnectTo: session, options: connectionOptions)

    if let messenger = (window?.rootViewController as? FlutterViewController)?.binaryMessenger {
      let channel = FlutterMethodChannel(name: deepLinkChannelName, binaryMessenger: messenger)
      channel.setMethodCallHandler { [weak self] call, result in
        if call.method == "getInitialLink" {
          result(self?.pendingLink)
        } else {
          result(FlutterMethodNotImplemented)
        }
      }
      deepLinkChannel = channel
    }

    if let userActivity = connectionOptions.userActivities.first(where: {
      $0.activityType == NSUserActivityTypeBrowsingWeb
    }), let url = userActivity.webpageURL {
      pendingLink = url.absoluteString
    }
  }

  override func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    super.scene(scene, continue: userActivity)
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
      let url = userActivity.webpageURL
    else { return }
    pendingLink = url.absoluteString
    deepLinkChannel?.invokeMethod("onLink", arguments: url.absoluteString)
  }
}

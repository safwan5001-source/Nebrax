package com.example.awjmobileruntimeproof

import android.content.Intent
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel

/**
 * Forwards an incoming Android App Link to Dart (MOBILE-RUNTIME-7, horizon
 * MR-08) over the one platform channel `deep_link_channel.dart` listens on.
 * This activity does no validation itself — it only ever hands the raw URI
 * string across; every host/path allowlist check happens Dart-side in
 * `resolveDeepLinkUri`, never trusted here.
 *
 * `android:launchMode="singleTop"` (already set in AndroidManifest.xml,
 * pre-dating this task) is what makes [onNewIntent] fire for a warm-start
 * link instead of spawning a second Activity instance; a cold-start link is
 * read once from [getIntent] via the channel's own `getInitialLink` method,
 * since [onNewIntent] is never called for an Activity's own initial launch.
 */
class MainActivity : FlutterActivity() {
    private val deepLinkChannelName = "awj/deep_links"
    private var deepLinkChannel: MethodChannel? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        val channel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, deepLinkChannelName)
        channel.setMethodCallHandler { call, result ->
            if (call.method == "getInitialLink") {
                result.success(intent?.dataString)
            } else {
                result.notImplemented()
            }
        }
        deepLinkChannel = channel
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { link -> deepLinkChannel?.invokeMethod("onLink", link) }
    }
}

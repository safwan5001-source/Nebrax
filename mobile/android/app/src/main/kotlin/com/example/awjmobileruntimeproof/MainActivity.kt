package com.example.awjmobileruntimeproof

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
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
 *
 * Also wires the `awj/push` platform channel (MOBILE-RUNTIME-8, horizon
 * MR-09): the one native-facing entry point `push_channel_adapter.dart`'s
 * `ChannelPushAdapter` talks to. `requestPermission` is real, standard
 * runtime-permission handling for `POST_NOTIFICATIONS` (required starting
 * API 33/Tiramisu; older Android never prompts at all, so this reports
 * `granted` immediately below that level) — no push transport SDK required
 * for that step, since asking for permission and actually receiving a push
 * are separate concerns. `getToken` and `getInitialMessage` deliberately
 * return `null`: no push transport SDK (Firebase or otherwise) is linked in
 * this horizon (see `push_channel_adapter.dart`'s own doc comment for why)
 * — structurally ready, intentionally inert until a concrete provider is
 * chosen, which this horizon's own rules (MR-09, MR-19, §10 Decision Gates)
 * require Safwan's explicit approval for, not something wired here on this
 * task's own initiative.
 */
class MainActivity : FlutterActivity() {
    private val deepLinkChannelName = "awj/deep_links"
    private var deepLinkChannel: MethodChannel? = null

    private val pushChannelName = "awj/push"
    private var pendingPermissionResult: MethodChannel.Result? = null

    companion object {
        private const val NOTIFICATION_PERMISSION_REQUEST_CODE = 9401
    }

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

        val pushChannel = MethodChannel(flutterEngine.dartExecutor.binaryMessenger, pushChannelName)
        pushChannel.setMethodCallHandler { call, result ->
            when (call.method) {
                "requestPermission" -> requestNotificationPermission(result)
                "getToken", "getInitialMessage" -> result.success(null)
                else -> result.notImplemented()
            }
        }
    }

    private fun requestNotificationPermission(result: MethodChannel.Result) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            // No runtime prompt exists below API 33 — notifications are
            // implicitly allowed unless the user disables them in Settings.
            result.success("granted")
            return
        }
        val already = ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
        if (already == PackageManager.PERMISSION_GRANTED) {
            result.success("granted")
            return
        }
        pendingPermissionResult = result
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            NOTIFICATION_PERMISSION_REQUEST_CODE,
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray,
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != NOTIFICATION_PERMISSION_REQUEST_CODE) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        pendingPermissionResult?.success(if (granted) "granted" else "denied")
        pendingPermissionResult = null
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        intent.dataString?.let { link -> deepLinkChannel?.invokeMethod("onLink", link) }
    }
}

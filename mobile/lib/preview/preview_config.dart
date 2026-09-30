/// Deployment-time configuration for [PreviewClient] — the `/preview/v1`
/// base URL and the raw `PreviewSession` bearer credential.
///
/// This credential is structurally unrelated to [CommerceConfig]'s store
/// bearer (MOBILE-PREVIEW-5 §5.1/§2.5): it authenticates as a
/// `PreviewSession`, never as the tenant's `ApiClient`, and it is never read
/// from or merged with `CommerceConfig`. A build with preview mode disabled
/// (the default — see [PreviewConfig.enabled]) never even attempts to parse
/// these defines, matching this runtime's existing "explicit dev/preview
/// entry path" posture (`runtime_config.dart`'s own doc comment on
/// `COMMERCE_STORE_BEARER_TOKEN`).
///
/// How a real preview session token reaches a real device in MP-6 is
/// deliberately narrow and explicitly **not** the QR/deep-link exchange
/// (MOBILE-PREVIEW-7's scope): a merchant issues a session from the web
/// Builder, copies the raw bearer it returns once, and a developer/tester
/// passes it to this build via `--dart-define=PREVIEW_SESSION_TOKEN=...` —
/// a safe, explicit, developer-only entry path, never a production runtime
/// default.
class PreviewConfig {
  /// The `/preview/v1` base URL, e.g. `https://api.example.com/preview/v1`.
  final Uri baseUrl;

  /// The raw `PreviewSession` bearer token returned once by
  /// `POST /api/app-builder/apps/{id}/preview-sessions`.
  final String sessionToken;

  const PreviewConfig({required this.baseUrl, required this.sessionToken});

  /// Whether this build was launched with an actual preview session token —
  /// `false` for every ordinary (non-preview) build, including every
  /// production build, since [sessionToken] then stays empty. The one place
  /// that decides whether the app boots into Preview mode at all.
  bool get enabled => sessionToken.isNotEmpty;
}

/// Builds this runtime's [PreviewConfig] from compile-time configuration
/// (`--dart-define`), mirroring [CommerceConfig]'s own construction in
/// `runtime_config.dart`. Both defines default to empty, so an ordinary
/// build (no defines passed) always resolves [PreviewConfig.enabled] to
/// `false` and never touches this surface.
PreviewConfig buildRuntimePreviewConfig() {
  const baseUrl = String.fromEnvironment(
    'PREVIEW_BASE_URL',
    defaultValue: 'https://commerce.invalid/preview/v1',
  );
  const sessionToken = String.fromEnvironment('PREVIEW_SESSION_TOKEN', defaultValue: '');
  return PreviewConfig(baseUrl: Uri.parse(baseUrl), sessionToken: sessionToken);
}

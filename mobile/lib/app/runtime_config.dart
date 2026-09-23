import '../commerce/commerce.dart';

/// Builds this runtime's [CommerceConfig] from compile-time configuration
/// (`--dart-define`).
///
/// No real AWJ Commerce tenant/deployment exists for this proof horizon —
/// `COMMERCE_BASE_URL`/`COMMERCE_STORE_BEARER_TOKEN` default to an obviously
/// non-functional placeholder so an unconfigured build fails closed (a
/// network/auth error surfaced through the exact same error-handling path
/// every screen already has, proving that path works) rather than silently
/// pointing at a real service. No production tenant credential is embedded
/// here or anywhere in this repository. How a shipped app is provisioned
/// with its own tenant's store bearer key is a distribution decision
/// outside this runtime proof — see `commerce_config.dart`'s own doc
/// comment (MOBILE-RUNTIME-4) and this task's implementation report.
CommerceConfig buildRuntimeCommerceConfig() {
  const baseUrl = String.fromEnvironment(
    'COMMERCE_BASE_URL',
    defaultValue: 'https://commerce.invalid/commerce/v1',
  );
  const storeBearerToken = String.fromEnvironment(
    'COMMERCE_STORE_BEARER_TOKEN',
    defaultValue: 'unconfigured-proof-placeholder',
  );
  return CommerceConfig(
    baseUrl: Uri.parse(baseUrl),
    storeBearerToken: storeBearerToken,
  );
}

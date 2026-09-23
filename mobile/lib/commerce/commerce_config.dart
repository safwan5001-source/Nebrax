/// Deployment-time configuration for [CommerceClient] — the `/commerce/v1`
/// base URL and the tenant's own store bearer key
/// (`docs/openapi/commerce-api-v1.yaml`'s `storeBearer` security scheme).
///
/// The store bearer key resolves the tenant and its `mobile` `SalesChannel`;
/// it is **not** an end-customer secret (that is [SecureSessionStore]'s
/// job — see `secure_session_store.dart`). It is still sensitive (a leaked
/// key grants read-tier catalog access to that tenant's channel), so this
/// runtime never hardcodes or logs it. How a shipped app is provisioned with
/// its tenant's key — build-time `--dart-define`, a signed remote-config
/// fetch, or something else — is a distribution decision outside a
/// non-production runtime proof; this class only carries the value once
/// something else has already obtained it.
class CommerceConfig {
  /// The `/commerce/v1` base URL, e.g. `https://api.example.com/commerce/v1`.
  /// No trailing slash.
  final Uri baseUrl;

  /// The tenant's store bearer key, sent as `Authorization: Bearer <key>`.
  final String storeBearerToken;

  const CommerceConfig({required this.baseUrl, required this.storeBearerToken});
}

/// AWJ Mobile Runtime — Commerce OpenAPI client + secure session boundary
/// (MOBILE-RUNTIME-4).
///
/// Typed client for `docs/openapi/commerce-api-v1.yaml`'s `/commerce/v1`
/// surface, scoped to Home/Product/Cart (MOBILE-RUNTIME-5's vertical slice)
/// plus customer authentication. Server remains authority for commerce/
/// tenant/security (MR-03); customer/cart session material lives behind a
/// platform-secure-storage abstraction (MR-07), never in this runtime's App
/// Schema, logs, or analytics.
library;

export 'commerce_client.dart';
export 'commerce_config.dart';
export 'commerce_error.dart';
export 'commerce_models.dart';
export 'commerce_transport.dart';
export 'resilient_transport.dart';
export 'secure_session_store.dart';

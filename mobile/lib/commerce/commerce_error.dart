/// The `error.code` enum from `docs/openapi/commerce-api-v1.yaml`'s `Error`
/// schema. [unknown] is deliberately not part of that wire enum — it is this
/// client's own fallback for a code a future server version might add, so
/// parsing an error envelope never throws on an unrecognized value (same
/// fail-safe posture as [decodeAction]/`CompatibilityResolver` elsewhere in
/// this runtime).
enum CommerceErrorCode {
  internalError,
  badRequest,
  notFound,
  methodNotAllowed,
  validationFailed,
  unauthenticated,
  forbidden,
  tenantContextRequired,
  clientInactive,
  insufficientScope,
  rateLimited,
  idempotencyKeyRequired,
  invalidIdempotencyKey,
  idempotencyConflict,
  idempotencyInProgress,
  reviewRequired,
  cartMerged,
  unknown;

  static const Map<String, CommerceErrorCode> _wire = {
    'internal_error': CommerceErrorCode.internalError,
    'bad_request': CommerceErrorCode.badRequest,
    'not_found': CommerceErrorCode.notFound,
    'method_not_allowed': CommerceErrorCode.methodNotAllowed,
    'validation_failed': CommerceErrorCode.validationFailed,
    'unauthenticated': CommerceErrorCode.unauthenticated,
    'forbidden': CommerceErrorCode.forbidden,
    'tenant_context_required': CommerceErrorCode.tenantContextRequired,
    'client_inactive': CommerceErrorCode.clientInactive,
    'insufficient_scope': CommerceErrorCode.insufficientScope,
    'rate_limited': CommerceErrorCode.rateLimited,
    'idempotency_key_required': CommerceErrorCode.idempotencyKeyRequired,
    'invalid_idempotency_key': CommerceErrorCode.invalidIdempotencyKey,
    'idempotency_conflict': CommerceErrorCode.idempotencyConflict,
    'idempotency_in_progress': CommerceErrorCode.idempotencyInProgress,
    'review_required': CommerceErrorCode.reviewRequired,
    'cart_merged': CommerceErrorCode.cartMerged,
  };

  static CommerceErrorCode fromWire(String value) =>
      _wire[value] ?? CommerceErrorCode.unknown;
}

/// The Commerce API's own `{ "error": { "code", "message" }, "meta": {
/// "request_id" } }` envelope, thrown for any non-2xx response.
///
/// [message] is the server's own (English, developer-facing) message — never
/// shown to an end user as-is; a UI layer maps [code] to a localized string
/// the same way it would map an [IncompatibilityReason].
class CommerceApiException implements Exception {
  final int statusCode;
  final CommerceErrorCode code;
  final String message;
  final String? requestId;

  const CommerceApiException({
    required this.statusCode,
    required this.code,
    required this.message,
    this.requestId,
  });

  @override
  String toString() =>
      'CommerceApiException($statusCode, ${code.name}): $message';
}

/// The response body was not the documented `Error`-envelope JSON (a proxy
/// error page, an empty body, a transport failure surfaced as a body, etc.).
/// Kept distinct from [CommerceApiException] so a caller can tell "the
/// server told us something went wrong" apart from "we don't know what
/// happened".
class CommerceProtocolException implements Exception {
  final int? statusCode;
  final String message;

  const CommerceProtocolException(this.message, {this.statusCode});

  @override
  String toString() => 'CommerceProtocolException($statusCode): $message';
}

/// Every attempt a [ResilientCommerceTransport] (`resilient_transport.dart`)
/// made for one request failed — timed out or raised a transport-level
/// error on every try. Distinct from [CommerceProtocolException] (the
/// server answered with something unexpected) and [CommerceApiException]
/// (the server answered with a documented error): this means the request
/// never got a usable response at all (MR-16 — "request timeout/
/// cancellation", "interrupted/slow network").
class CommerceTransportException implements Exception {
  final String message;
  final int attempts;
  final Object? cause;

  const CommerceTransportException(this.message, {required this.attempts, this.cause});

  @override
  String toString() => 'CommerceTransportException($attempts attempt(s)): $message';
}

/// A customer-tier call ([CommerceClient.getMe],
/// [CommerceClient.logoutCustomer]) was attempted with no customer session
/// present in [SecureSessionStore]. Thrown client-side, before any network
/// call — this surface always requires `X-Customer-Token`
/// (`docs/openapi/commerce-api-v1.yaml`'s `CustomerToken` parameter), so
/// there is no useful request to send without one.
class MissingCustomerSessionException implements Exception {
  const MissingCustomerSessionException();

  @override
  String toString() =>
      'MissingCustomerSessionException: no customer session is stored';
}

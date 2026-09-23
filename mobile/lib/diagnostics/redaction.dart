/// Key-name fragments treated as sensitive regardless of case or exact
/// spelling — any field whose name *contains* one of these is never emitted
/// as-is, only as the literal string `'[redacted]'`. Matching by fragment
/// (not exact key) deliberately over-redacts rather than risk a near-miss
/// (`customerToken`, `cart_token`, `Authorization`) slipping through MR-17's
/// "never log raw customer tokens, cart/order secret references,
/// credentials, PII payloads or secure-storage contents".
const List<String> kSensitiveDiagnosticKeyFragments = [
  'token',
  'bearer',
  'authorization',
  'password',
  'secret',
  'credential',
  'session',
  'cookie',
  'apikey',
  'api_key',
  'otp',
  'ssn',
  'card',
  'cvv',
];

/// A value shaped like a bearer/opaque token embedded inside an otherwise
/// innocuous string (e.g. an HTTP header dump, an exception message copied
/// from a real HTTP client) — redacted even when it arrives under a
/// key name [isSensitiveDiagnosticKey] would not itself flag. Mirrors the
/// "smuggled field" adversarial-input posture MOBILE-RUNTIME-2's schema
/// parser already established for a disguised `tenantId`.
final RegExp _bearerTokenPattern = RegExp(
  r'Bearer\s+[A-Za-z0-9\-_.~+/=]{8,}',
  caseSensitive: false,
);

bool isSensitiveDiagnosticKey(String key) {
  final lower = key.toLowerCase();
  return kSensitiveDiagnosticKeyFragments.any(lower.contains);
}

/// Redacts a free-text string for known sensitive patterns. Does not (and
/// cannot) catch every possible secret shape — this is defense in depth
/// alongside [redactDiagnosticFields]'s key-based redaction, not a
/// substitute for never putting a secret into a diagnostic message in the
/// first place.
String redactSensitivePatterns(String input) {
  return input.replaceAll(_bearerTokenPattern, 'Bearer [redacted]');
}

/// Recursively redacts a free-form field map before it may ever reach a log
/// or diagnostic event: any key matching [isSensitiveDiagnosticKey] is
/// replaced wholesale with `'[redacted]'` regardless of its value's shape;
/// every remaining string value (at any nesting depth, including inside
/// nested maps/lists) is still scanned by [redactSensitivePatterns].
///
/// This is the only path [DiagnosticEvent] accepts caller-supplied `extra`
/// data through — there is no constructor or field that stores raw,
/// unredacted caller data.
Map<String, Object?> redactDiagnosticFields(Map<String, Object?> fields) {
  return {
    for (final entry in fields.entries)
      entry.key: isSensitiveDiagnosticKey(entry.key)
          ? '[redacted]'
          : redactDiagnosticValue(entry.value),
  };
}

Object? redactDiagnosticValue(Object? value) {
  if (value is String) return redactSensitivePatterns(value);
  if (value is Map) {
    return {
      for (final entry in value.entries)
        entry.key.toString(): isSensitiveDiagnosticKey(entry.key.toString())
            ? '[redacted]'
            : redactDiagnosticValue(entry.value),
    };
  }
  if (value is List) return value.map(redactDiagnosticValue).toList();
  return value;
}

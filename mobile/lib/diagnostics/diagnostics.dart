/// AWJ Mobile Runtime — diagnostic context + redaction (MOBILE-RUNTIME-10,
/// horizon MR-17).
///
/// Pure Dart, no Flutter dependency, no crash/telemetry vendor wired in
/// (none is authorized by this horizon). Defines the structured, typed
/// diagnostic fields MR-17 requires and a redaction path that makes it
/// structurally difficult to attach a token, credential, or PII payload to
/// an emitted diagnostic — see `diagnostic_context.dart` and
/// `redaction.dart` for the full reasoning.
library;

export 'diagnostic_context.dart';
export 'redaction.dart';

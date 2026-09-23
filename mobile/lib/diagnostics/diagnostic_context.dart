import '../schema/schema.dart';
import '../startup/startup.dart';
import 'redaction.dart';

/// A stable, non-sensitive, machine-readable summary of *why* a runtime
/// boot/render did not proceed normally (MR-17: "capability/compatibility
/// failure class"). One value per [IncompatibilityReason] and
/// [UnavailableReason] — see [diagnosticFailureClassForCompatibility] and
/// [diagnosticFailureClassForStartup] — plus [none] for a normal, no-failure
/// event.
enum DiagnosticFailureClass {
  none,
  schemaVersionTooNew,
  schemaVersionTooOld,
  runtimeTooOld,
  missingRequiredCapability,
  fetchFailedNoCache,
  fetchFailedCacheCorrupted,
  fetchFailedCacheIncompatible,
  fetchFailedCacheUnparseable,
  freshIncompatibleNoCache,
}

DiagnosticFailureClass diagnosticFailureClassForCompatibility(IncompatibilityReason reason) {
  return switch (reason) {
    IncompatibilityReason.schemaVersionTooNew => DiagnosticFailureClass.schemaVersionTooNew,
    IncompatibilityReason.schemaVersionTooOld => DiagnosticFailureClass.schemaVersionTooOld,
    IncompatibilityReason.runtimeTooOld => DiagnosticFailureClass.runtimeTooOld,
    IncompatibilityReason.missingRequiredCapability =>
      DiagnosticFailureClass.missingRequiredCapability,
  };
}

DiagnosticFailureClass diagnosticFailureClassForStartup(UnavailableReason reason) {
  return switch (reason) {
    UnavailableReason.fetchFailedNoCache => DiagnosticFailureClass.fetchFailedNoCache,
    UnavailableReason.fetchFailedCacheCorrupted => DiagnosticFailureClass.fetchFailedCacheCorrupted,
    UnavailableReason.fetchFailedCacheIncompatible =>
      DiagnosticFailureClass.fetchFailedCacheIncompatible,
    UnavailableReason.fetchFailedCacheUnparseable =>
      DiagnosticFailureClass.fetchFailedCacheUnparseable,
    UnavailableReason.freshIncompatibleNoCache => DiagnosticFailureClass.freshIncompatibleNoCache,
  };
}

/// The fixed, typed diagnostic fields MR-17 requires at minimum:
/// runtime/build version, schema/Experience version, capability/
/// compatibility failure class, platform, and a non-sensitive correlation
/// identifier when available.
///
/// Deliberately a closed set of typed fields, not a free-form map — the
/// same "structurally incapable" posture `last_known_good.dart`'s
/// [CachedExperience] already established for MR-14: there is no
/// constructor parameter through which a token, cart/order reference, or
/// other secret could be attached to *this* type. A caller that has
/// genuinely unstructured extra context uses [DiagnosticEvent.extra]
/// instead, which is redacted on the way in ([redactDiagnosticFields]) —
/// never this type.
class DiagnosticContext {
  final String runtimeVersion;
  final String? experienceVersion;
  final DiagnosticFailureClass failureClass;
  final RuntimePlatform platform;
  final String? correlationId;

  const DiagnosticContext({
    required this.runtimeVersion,
    this.experienceVersion,
    this.failureClass = DiagnosticFailureClass.none,
    required this.platform,
    this.correlationId,
  });

  Map<String, Object?> toFields() => {
    'runtimeVersion': runtimeVersion,
    'experienceVersion': experienceVersion,
    'failureClass': failureClass.name,
    'platform': platform.name,
    'correlationId': correlationId,
  };
}

/// A single diagnostic occurrence: a [context] plus a free-text message and
/// optional extra fields — both redacted *before* this object exists, so
/// there is no path to read an un-redacted [message]/[extra] back out of a
/// constructed [DiagnosticEvent].
///
/// This is the only sink this runtime's diagnostics are meant to be written
/// through. No crash/telemetry vendor is wired to it — MR-17/this horizon
/// does not authorize adopting one; `toFields()` is a structured map a
/// future, explicitly-approved sink can serialize however it needs.
class DiagnosticEvent {
  final DiagnosticContext context;
  final String message;
  final Map<String, Object?> extra;

  DiagnosticEvent._({required this.context, required this.message, required this.extra});

  factory DiagnosticEvent({
    required DiagnosticContext context,
    required String rawMessage,
    Map<String, Object?> rawExtra = const {},
  }) {
    return DiagnosticEvent._(
      context: context,
      message: redactSensitivePatterns(rawMessage),
      extra: redactDiagnosticFields(rawExtra),
    );
  }

  Map<String, Object?> toFields() => {
    ...context.toFields(),
    'message': message,
    if (extra.isNotEmpty) 'extra': extra,
  };
}

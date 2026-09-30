/// The outcome of one `GET preview/v1/experience` attempt
/// (`docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §5.15,
/// §7's negative-test matrix) — MOBILE-PREVIEW-6.
sealed class PreviewFetchOutcome {
  const PreviewFetchOutcome();
}

/// A fetch that produced a schema snapshot the runtime may attempt to
/// render (compatibility is still resolved by [resolvePreviewStartup], not
/// decided here). [draftChanged] is advisory only (§5.5) — it never blocks
/// rendering and never substitutes different content.
class PreviewFetchSucceeded extends PreviewFetchOutcome {
  final String rawSchemaJson;
  final int? draftRevision;
  final bool draftChanged;
  final DateTime? expiresAt;

  const PreviewFetchSucceeded({
    required this.rawSchemaJson,
    this.draftRevision,
    this.draftChanged = false,
    this.expiresAt,
  });
}

/// Expired, revoked, or unknown/malformed — the server deliberately returns
/// the exact same generic response for all three (§5.15: "no wording that
/// would let a client fingerprint the cause"), so this runtime must not try
/// to guess or display a more specific reason either.
class PreviewFetchUnauthorized extends PreviewFetchOutcome {
  const PreviewFetchUnauthorized();
}

/// The fetch never reached a usable answer at all — network/transport
/// failure, malformed response body, or a non-2xx/401 HTTP status this
/// client does not otherwise recognize. [reason] is a stable,
/// non-sensitive machine-readable code, exactly like
/// `ExperienceFetchFailed.reason` in `startup/last_known_good.dart` — never
/// a raw exception message or URL.
class PreviewFetchUnavailable extends PreviewFetchOutcome {
  final String reason;
  const PreviewFetchUnavailable(this.reason);
}

/// Outcome of [PreviewExchangeClient.exchange] — a closed, exhaustive set
/// mirroring [PreviewFetchOutcome]'s own shape (MOBILE-PREVIEW-6). §5.15:
/// expired/revoked/consumed/unknown all collapse into [PreviewExchangeInvalid]
/// — this client structurally cannot distinguish them, matching exactly
/// what the backend's generic 401 already refuses to reveal.
sealed class PreviewExchangeOutcome {
  const PreviewExchangeOutcome();
}

/// The exchange succeeded — [sessionToken] is a real, working `PreviewSession`
/// bearer, indistinguishable in shape or capability from one issued directly
/// (MOBILE-PREVIEW-6's own flow). Never placed back into any URI.
final class PreviewExchangeSucceeded extends PreviewExchangeOutcome {
  final String sessionToken;

  const PreviewExchangeSucceeded({required this.sessionToken});
}

/// The reference was rejected — malformed, unknown, expired, or already
/// consumed. No further detail is ever available to this client by design.
final class PreviewExchangeInvalid extends PreviewExchangeOutcome {
  const PreviewExchangeInvalid();
}

/// Transport/protocol failure unrelated to the reference's own validity
/// (network error, unexpected status code, malformed response body).
final class PreviewExchangeUnavailable extends PreviewExchangeOutcome {
  final String reason;

  const PreviewExchangeUnavailable(this.reason);
}

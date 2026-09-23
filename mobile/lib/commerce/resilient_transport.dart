import 'dart:async';

import 'commerce_error.dart';
import 'commerce_transport.dart';

/// Wraps a [CommerceTransport] with a per-request [timeout] and a bounded
/// number of retries — MR-16's "interrupted/slow network", "request
/// timeout/cancellation", and "safe retry behavior" for the one real
/// network boundary this runtime has (`IoCommerceTransport`).
///
/// **Only safe (idempotent) requests are ever retried.** [CommerceHttpMethod
/// .get] is retried up to [maxAttempts] times; every other method
/// (`post`/`patch`/`delete` — `addToCart`, `updateCartQuantity`, checkout,
/// auth) gets exactly one attempt, full stop. This is the whole of MR-16's
/// "no duplicate side effects caused by blind retries" and "must respect
/// existing Commerce idempotency semantics and must not invent new
/// financial/order-guarantee client-side" — a client-side retry loop is
/// itself a new guarantee if it ever re-sends a mutating request the server
/// may already have applied, so this class structurally cannot do that
/// rather than relying on every call site remembering not to.
///
/// A decorator around [CommerceTransport], not a change to [CommerceClient]
/// or any call site — [CommerceClient]'s default constructor is the only
/// place this is wired in (see its own doc comment), so every existing
/// test that injects a fake transport is entirely unaffected.
class ResilientCommerceTransport implements CommerceTransport {
  final CommerceTransport _inner;
  final Duration timeout;
  final int maxAttempts;
  final Duration Function(int attemptIndex) backoff;

  ResilientCommerceTransport(
    this._inner, {
    this.timeout = const Duration(seconds: 15),
    this.maxAttempts = 3,
    Duration Function(int attemptIndex)? backoff,
  }) : backoff = backoff ?? _defaultBackoff,
       assert(maxAttempts >= 1, 'maxAttempts must be at least 1');

  static Duration _defaultBackoff(int attemptIndex) =>
      Duration(milliseconds: 200 * (1 << attemptIndex));

  static bool _isSafeToRetry(CommerceHttpMethod method) => method == CommerceHttpMethod.get;

  @override
  Future<CommerceHttpResponse> send(CommerceHttpRequest request) async {
    final attempts = _isSafeToRetry(request.method) ? maxAttempts : 1;
    Object? lastError;

    for (var attempt = 0; attempt < attempts; attempt++) {
      try {
        return await _inner.send(request).timeout(timeout);
      } on Object catch (error) {
        lastError = error;
        final isLastAttempt = attempt == attempts - 1;
        if (isLastAttempt) break;
        await Future.delayed(backoff(attempt));
      }
    }

    throw CommerceTransportException(
      'request to ${request.uri} failed after every attempt',
      attempts: attempts,
      cause: lastError,
    );
  }
}

import 'dart:convert';

import '../commerce/commerce_error.dart' show CommerceTransportException;
import '../commerce/commerce_transport.dart';
import '../commerce/resilient_transport.dart';
import 'preview_exchange_outcome.dart';

/// Typed client for `POST /preview/v1/exchange` (MOBILE-PREVIEW-7) — the
/// **only** network call this runtime ever makes with no bearer of any kind
/// attached, because the device holds nothing yet but the one-time
/// reference from the QR/deep link. Sends `{reference}` in the request
/// **body**, never a query string or header value that could leak into a
/// proxy/access log the way a URL parameter would (§5.10, RFC 6750 §5).
///
/// Reuses [CommerceTransport]/[IoCommerceTransport]/[ResilientCommerceTransport]
/// unmodified — exactly like [PreviewClient] already does; this is real
/// reuse of generic HTTP plumbing, not a parallel transport.
class PreviewExchangeClient {
  /// The `/preview/v1` base URL — the same value a device preview build
  /// would otherwise need for [PreviewConfig.baseUrl].
  final Uri baseUrl;
  final CommerceTransport _transport;

  PreviewExchangeClient({required this.baseUrl, CommerceTransport? transport})
    : _transport = transport ?? ResilientCommerceTransport(IoCommerceTransport());

  Future<PreviewExchangeOutcome> exchange(String reference) async {
    final CommerceHttpResponse response;
    try {
      final basePathSegments = baseUrl.pathSegments.where((s) => s.isNotEmpty);
      response = await _transport.send(
        CommerceHttpRequest(
          method: CommerceHttpMethod.post,
          uri: baseUrl.replace(pathSegments: [...basePathSegments, 'exchange']),
          headers: {'Content-Type': 'application/json', 'Accept': 'application/json'},
          body: jsonEncode({'reference': reference}),
        ),
      );
    } on CommerceTransportException {
      return const PreviewExchangeUnavailable('transport_error');
    } catch (_) {
      return const PreviewExchangeUnavailable('unknown_error');
    }

    final Object? decoded;
    try {
      decoded = response.body.isEmpty ? <String, Object?>{} : jsonDecode(response.body);
    } catch (_) {
      return const PreviewExchangeUnavailable('protocol_error');
    }
    if (decoded is! Map) {
      return const PreviewExchangeUnavailable('protocol_error');
    }
    final envelope = decoded.cast<String, Object?>();

    // §5.15: malformed/unknown/expired/consumed are structurally
    // indistinguishable — this client neither receives nor infers which.
    if (response.statusCode == 401) {
      return const PreviewExchangeInvalid();
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return PreviewExchangeUnavailable('http_${response.statusCode}');
    }

    final bearer = envelope['token'];
    if (bearer is! String || bearer.isEmpty) {
      return const PreviewExchangeUnavailable('protocol_error');
    }

    return PreviewExchangeSucceeded(sessionToken: bearer);
  }
}

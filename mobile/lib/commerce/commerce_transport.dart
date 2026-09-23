import 'dart:convert';
import 'dart:io';

/// HTTP methods used by `/commerce/v1` (per `docs/openapi/commerce-api-v1.yaml`).
enum CommerceHttpMethod { get, post, patch, delete }

/// A fully-formed outbound request. [CommerceClient] builds these; a
/// [CommerceTransport] only knows how to send bytes over the wire — it has
/// no opinion on envelopes, auth headers, or session tokens.
class CommerceHttpRequest {
  final CommerceHttpMethod method;
  final Uri uri;
  final Map<String, String> headers;
  final String? body;

  const CommerceHttpRequest({
    required this.method,
    required this.uri,
    required this.headers,
    this.body,
  });
}

class CommerceHttpResponse {
  final int statusCode;
  final Map<String, String> headers;
  final String body;

  const CommerceHttpResponse({
    required this.statusCode,
    required this.headers,
    required this.body,
  });
}

/// Transport boundary between [CommerceClient] and the network. Kept as an
/// interface — rather than [CommerceClient] calling `dart:io` directly — so
/// `flutter test` (no real sockets, and this repository's CI has no network
/// path to any Commerce deployment) can exercise the client's auth/session/
/// error-mapping logic against a scripted fake transport
/// (`test/commerce/fake_transport.dart`), the same pattern already used for
/// `ActionHandler`/`ComponentBuilder` in MOBILE-RUNTIME-3.
abstract interface class CommerceTransport {
  Future<CommerceHttpResponse> send(CommerceHttpRequest request);
}

/// The real transport, built on `dart:io`'s [HttpClient]. Mobile (Android/
/// iOS) is this workspace's only target (MR-02) — `dart:io` is always
/// available there, so this avoids adding an HTTP package (`http`, `dio`, …)
/// purely to move JSON over HTTPS, per MR-19's "whether a narrower
/// first-party/framework implementation is reasonable" test. If a future
/// task adds web as a target, this transport (and only this one file) would
/// need a `dart:io`-free alternative.
class IoCommerceTransport implements CommerceTransport {
  final HttpClient _client;

  IoCommerceTransport({HttpClient? client}) : _client = client ?? HttpClient();

  @override
  Future<CommerceHttpResponse> send(CommerceHttpRequest request) async {
    final HttpClientRequest ioRequest;
    switch (request.method) {
      case CommerceHttpMethod.get:
        ioRequest = await _client.getUrl(request.uri);
      case CommerceHttpMethod.post:
        ioRequest = await _client.postUrl(request.uri);
      case CommerceHttpMethod.patch:
        ioRequest = await _client.patchUrl(request.uri);
      case CommerceHttpMethod.delete:
        ioRequest = await _client.deleteUrl(request.uri);
    }
    request.headers.forEach(ioRequest.headers.set);
    if (request.body != null) {
      ioRequest.write(request.body);
    }
    final ioResponse = await ioRequest.close();
    final responseBody = await ioResponse.transform(utf8.decoder).join();
    final responseHeaders = <String, String>{};
    ioResponse.headers.forEach((name, values) {
      if (values.isNotEmpty) responseHeaders[name] = values.first;
    });
    return CommerceHttpResponse(
      statusCode: ioResponse.statusCode,
      headers: responseHeaders,
      body: responseBody,
    );
  }

  void close() => _client.close(force: true);
}

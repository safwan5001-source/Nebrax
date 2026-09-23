import 'package:awj_mobile_runtime/commerce/commerce.dart';

import '../commerce/fake_transport.dart';

/// A [CommerceClient] backed by a scriptable [FakeCommerceTransport] and an
/// [InMemorySecureSessionStore] — no real socket, no platform channel, safe
/// for every app-level widget test in this suite. [handler] defaults to an
/// empty-but-valid products page, since most app-level tests only care
/// about screen wiring, not catalog content.
CommerceClient buildFakeCommerceClient({
  Future<CommerceHttpResponse> Function(CommerceHttpRequest request)? handler,
}) {
  return CommerceClient(
    config: CommerceConfig(
      baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
      storeBearerToken: 'test-token',
    ),
    sessionStore: InMemorySecureSessionStore(),
    transport: FakeCommerceTransport(
      handler ??
          (request) async =>
              jsonResponse(200, {'data': [], 'meta': paginationMeta()}),
    ),
  );
}

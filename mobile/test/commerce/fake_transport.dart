import 'dart:convert';

import 'package:awj_mobile_runtime/commerce/commerce.dart';

/// A scriptable [CommerceTransport] test double — no real socket, ever.
/// Records every outbound [CommerceHttpRequest] (so tests can assert on
/// headers/method/uri/body) and answers with whatever [handler] returns.
class FakeCommerceTransport implements CommerceTransport {
  final List<CommerceHttpRequest> requests = [];
  final Future<CommerceHttpResponse> Function(CommerceHttpRequest request)
  handler;

  FakeCommerceTransport(this.handler);

  /// Convenience for a transport that always returns the same response,
  /// regardless of what is sent.
  factory FakeCommerceTransport.always(CommerceHttpResponse response) {
    return FakeCommerceTransport((_) async => response);
  }

  @override
  Future<CommerceHttpResponse> send(CommerceHttpRequest request) async {
    requests.add(request);
    return handler(request);
  }
}

CommerceHttpResponse jsonResponse(
  int statusCode,
  Map<String, Object?> body, {
  Map<String, String> headers = const {},
}) {
  return CommerceHttpResponse(
    statusCode: statusCode,
    headers: headers,
    body: jsonEncode(body),
  );
}

Map<String, Object?> successMeta({String requestId = 'req-1'}) => {
  'request_id': requestId,
};

Map<String, Object?> paginationMeta({
  int page = 1,
  int perPage = 20,
  int total = 0,
  int lastPage = 1,
  bool hasMore = false,
}) => {
  'request_id': 'req-1',
  'pagination': {
    'page': page,
    'per_page': perPage,
    'total': total,
    'last_page': lastPage,
    'has_more': hasMore,
  },
};

Map<String, Object?> money({int amountMinor = 1000, String currency = 'SAR'}) =>
    {'amount_minor': amountMinor, 'currency': currency};

Map<String, Object?> errorEnvelope(
  String code,
  String message, {
  String requestId = 'req-1',
}) => {
  'error': {'code': code, 'message': message},
  'meta': {'request_id': requestId},
};

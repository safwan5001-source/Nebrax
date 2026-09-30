import 'dart:convert';

import 'package:awj_mobile_runtime/commerce/commerce.dart' show CommerceHttpResponse;
import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

void main() {
  group('PreviewExchangeClient.exchange', () {
    test('sends the reference in the request body — never a query string, never a bearer header', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(201, {'token': '1|real-preview-bearer', 'session': {}}),
      );
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      await client.exchange('one-time-reference');

      final request = transport.requests.single;
      expect(request.uri.queryParameters, isEmpty);
      expect(request.uri.toString(), isNot(contains('one-time-reference')));
      expect(request.headers.containsKey('Authorization'), isFalse);
      expect(jsonDecode(request.body!), {'reference': 'one-time-reference'});
      expect(request.uri.path, endsWith('/exchange'));
    });

    test('a successful exchange -> PreviewExchangeSucceeded carrying the real bearer', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(201, {'token': '5|the-real-session-bearer', 'session': {'id': 'ps-1'}}),
      );
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      final outcome = await client.exchange('ref');

      expect(outcome, isA<PreviewExchangeSucceeded>());
      expect((outcome as PreviewExchangeSucceeded).sessionToken, '5|the-real-session-bearer');
    });

    test('401 -> PreviewExchangeInvalid regardless of the error body', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(401, {
          'error': {'code': 'unauthenticated', 'message': 'هذا الرمز لم يعد صالحاً.'},
        }),
      );
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      final outcome = await client.exchange('expired-or-consumed-or-unknown');

      expect(outcome, isA<PreviewExchangeInvalid>());
    });

    test('a non-2xx/401 status -> PreviewExchangeUnavailable, never treated as success', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(500, {'error': {'code': 'internal_error', 'message': 'خطأ'}}),
      );
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      final outcome = await client.exchange('ref');

      expect(outcome, isA<PreviewExchangeUnavailable>());
    });

    test('a malformed (non-JSON) body -> PreviewExchangeUnavailable, never a crash', () async {
      final transport = FakeCommerceTransport.always(
        const CommerceHttpResponse(statusCode: 201, headers: {}, body: 'not json at all'),
      );
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      final outcome = await client.exchange('ref');

      expect(outcome, isA<PreviewExchangeUnavailable>());
    });

    test('a 2xx body missing a usable token -> PreviewExchangeUnavailable, never a fabricated session', () async {
      final transport = FakeCommerceTransport.always(jsonResponse(201, {'session': {}}));
      final client = PreviewExchangeClient(
        baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
        transport: transport,
      );

      final outcome = await client.exchange('ref');

      expect(outcome, isA<PreviewExchangeUnavailable>());
    });
  });
}

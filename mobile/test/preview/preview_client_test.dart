import 'package:awj_mobile_runtime/commerce/commerce.dart' show CommerceHttpResponse;
import 'package:awj_mobile_runtime/preview/preview.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';

PreviewConfig _config() => PreviewConfig(
  baseUrl: Uri.parse('https://preview.invalid/preview/v1'),
  sessionToken: 'raw-preview-bearer',
);

void main() {
  group('PreviewClient.fetchExperience', () {
    test('sends the bearer in Authorization, never a query string', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {
            'schema': {'schemaVersion': '1.0.0'},
            'source': 'draft',
          },
          'meta': successMeta(),
        }),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      await client.fetchExperience();

      final request = transport.requests.single;
      expect(request.headers['Authorization'], 'Bearer raw-preview-bearer');
      expect(request.uri.queryParameters, isEmpty);
      expect(request.uri.path, endsWith('/experience'));
    });

    test('200 with a schema -> PreviewFetchSucceeded carrying the raw schema bytes', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {
            'schema': {'schemaVersion': '1.0.0', 'marker': 'x1'},
            'source': 'draft',
            'draft_revision': 3,
            'draft_changed': true,
            'expires_at': '2026-09-29T12:15:00+00:00',
          },
          'meta': successMeta(),
        }),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      final outcome = await client.fetchExperience();

      expect(outcome, isA<PreviewFetchSucceeded>());
      final succeeded = outcome as PreviewFetchSucceeded;
      expect(succeeded.rawSchemaJson, contains('"marker":"x1"'));
      expect(succeeded.draftRevision, 3);
      expect(succeeded.draftChanged, isTrue);
      expect(succeeded.expiresAt, DateTime.parse('2026-09-29T12:15:00+00:00'));
    });

    test('401 -> PreviewFetchUnauthorized regardless of the error body', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(401, {
          'error': {'code': 'unauthenticated', 'message': 'هذه المعاينة لم تعد متاحة.'},
          'meta': successMeta(),
        }),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      final outcome = await client.fetchExperience();

      expect(outcome, isA<PreviewFetchUnauthorized>());
    });

    test('a non-2xx/401 status -> PreviewFetchUnavailable, never treated as success', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(500, {
          'error': {'code': 'internal_error', 'message': 'خطأ'},
        }),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      final outcome = await client.fetchExperience();

      expect(outcome, isA<PreviewFetchUnavailable>());
    });

    test('a malformed (non-JSON-object) body -> PreviewFetchUnavailable', () async {
      final transport = FakeCommerceTransport.always(
        const CommerceHttpResponse(statusCode: 200, headers: {}, body: 'not json at all'),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      final outcome = await client.fetchExperience();

      expect(outcome, isA<PreviewFetchUnavailable>());
    });

    test('a 200 body missing data.schema -> PreviewFetchUnavailable, never a crash', () async {
      final transport = FakeCommerceTransport.always(
        jsonResponse(200, {
          'data': {'source': 'draft'},
          'meta': successMeta(),
        }),
      );
      final client = PreviewClient(config: _config(), transport: transport);

      final outcome = await client.fetchExperience();

      expect(outcome, isA<PreviewFetchUnavailable>());
    });
  });
}

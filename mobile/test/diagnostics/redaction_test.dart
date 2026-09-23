import 'package:awj_mobile_runtime/diagnostics/diagnostics.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('isSensitiveDiagnosticKey', () {
    for (final key in [
      'token',
      'Token',
      'customerToken',
      'cart_token',
      'sessionToken',
      'Authorization',
      'bearer',
      'password',
      'secret',
      'apiKey',
      'api_key',
      'credential',
      'cookie',
      'otp',
      'ssn',
      'cardNumber',
      'cvv',
    ]) {
      test('flags "$key" as sensitive', () {
        expect(isSensitiveDiagnosticKey(key), isTrue);
      });
    }

    for (final key in ['runtimeVersion', 'platform', 'failureClass', 'correlationId', 'productId']) {
      test('does not flag "$key" as sensitive', () {
        expect(isSensitiveDiagnosticKey(key), isFalse);
      });
    }
  });

  group('redactSensitivePatterns', () {
    test('masks a bearer-token-shaped value embedded in free text', () {
      const raw = 'request failed, header was Authorization: Bearer abcDEF123.token-value_here';
      final redacted = redactSensitivePatterns(raw);

      expect(redacted, isNot(contains('abcDEF123')));
      expect(redacted, contains('Bearer [redacted]'));
    });

    test('leaves ordinary text untouched', () {
      const raw = 'product p1 not found';
      expect(redactSensitivePatterns(raw), raw);
    });
  });

  group('redactDiagnosticFields — key-based redaction', () {
    test('a field whose key names a secret is wholly replaced regardless of value', () {
      final result = redactDiagnosticFields({
        'customerToken': 'abc123-genuinely-secret-value',
        'note': 'ok',
      });

      expect(result['customerToken'], '[redacted]');
      expect(result['note'], 'ok');
    });

    test(
      'a secret smuggled under an innocuous key name is still caught by pattern '
      'redaction of its string value (defense in depth, not just key-name matching)',
      () {
        final result = redactDiagnosticFields({
          'debugInfo': 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret.value',
        });

        expect(result['debugInfo'], isNot(contains('eyJhbGciOiJIUzI1NiJ9')));
      },
    );

    test('redaction recurses into nested maps', () {
      final result = redactDiagnosticFields({
        'request': {
          'headers': {'Authorization': 'Bearer some-real-token-value'},
          'path': '/commerce/v1/products',
        },
      });

      final request = result['request'] as Map;
      final headers = request['headers'] as Map;
      expect(headers['Authorization'], '[redacted]');
      expect(request['path'], '/commerce/v1/products');
    });

    test('redaction recurses into lists of maps', () {
      final result = redactDiagnosticFields({
        'events': [
          {'sessionToken': 'super-secret'},
          {'code': 'ok'},
        ],
      });

      final events = result['events'] as List;
      expect((events[0] as Map)['sessionToken'], '[redacted]');
      expect((events[1] as Map)['code'], 'ok');
    });

    test('non-string, non-collection values pass through unchanged', () {
      final result = redactDiagnosticFields({'retryCount': 3, 'succeeded': false});

      expect(result['retryCount'], 3);
      expect(result['succeeded'], false);
    });
  });
}

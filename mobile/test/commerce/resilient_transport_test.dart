import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:flutter_test/flutter_test.dart';

import 'fake_transport.dart';

CommerceHttpRequest _get({String path = 'products'}) => CommerceHttpRequest(
  method: CommerceHttpMethod.get,
  uri: Uri.parse('https://commerce.invalid/commerce/v1/$path'),
  headers: const {},
);

CommerceHttpRequest _post({String path = 'cart'}) => CommerceHttpRequest(
  method: CommerceHttpMethod.post,
  uri: Uri.parse('https://commerce.invalid/commerce/v1/$path'),
  headers: const {},
);

void main() {
  group('ResilientCommerceTransport — happy path', () {
    test('a GET that succeeds on the first try is sent exactly once', () async {
      final inner = FakeCommerceTransport.always(jsonResponse(200, const {'ok': true}));
      final resilient = ResilientCommerceTransport(
        inner,
        backoff: (_) => Duration.zero,
      );

      final response = await resilient.send(_get());

      expect(response.statusCode, 200);
      expect(inner.requests, hasLength(1));
    });
  });

  group('ResilientCommerceTransport — safe retry on GET', () {
    test('a GET that fails twice then succeeds is retried and eventually returns', () async {
      var attempt = 0;
      final inner = FakeCommerceTransport((request) async {
        attempt++;
        if (attempt < 3) {
          throw Exception('simulated transient network failure');
        }
        return jsonResponse(200, const {'ok': true});
      });
      final resilient = ResilientCommerceTransport(
        inner,
        maxAttempts: 3,
        backoff: (_) => Duration.zero,
      );

      final response = await resilient.send(_get());

      expect(response.statusCode, 200);
      expect(attempt, 3);
      expect(inner.requests, hasLength(3));
    });

    test('a GET that never succeeds exhausts maxAttempts then throws CommerceTransportException', () async {
      final inner = FakeCommerceTransport((request) async {
        throw Exception('simulated persistent network failure');
      });
      final resilient = ResilientCommerceTransport(
        inner,
        maxAttempts: 3,
        backoff: (_) => Duration.zero,
      );

      await expectLater(
        resilient.send(_get()),
        throwsA(isA<CommerceTransportException>()),
      );
      expect(inner.requests, hasLength(3));
    });

    test(
      'a GET that never responds within the timeout is retried, never left hanging forever',
      () async {
        var attempt = 0;
        final inner = FakeCommerceTransport((request) async {
          attempt++;
          if (attempt < 2) {
            // Simulate a hang far longer than the configured timeout.
            await Future.delayed(const Duration(seconds: 30));
          }
          return jsonResponse(200, const {'ok': true});
        });
        final resilient = ResilientCommerceTransport(
          inner,
          timeout: const Duration(milliseconds: 20),
          maxAttempts: 2,
          backoff: (_) => Duration.zero,
        );

        final response = await resilient.send(_get());

        expect(response.statusCode, 200);
        expect(attempt, 2);
      },
    );
  });

  group('ResilientCommerceTransport — never retries a mutating request (MR-16)', () {
    test(
      'a POST that fails is sent exactly once, never retried — '
      'a blind retry could duplicate a cart mutation server-side',
      () async {
        var attempt = 0;
        final inner = FakeCommerceTransport((request) async {
          attempt++;
          throw Exception('simulated transient network failure');
        });
        final resilient = ResilientCommerceTransport(
          inner,
          maxAttempts: 3, // even with retries allowed for GET, POST ignores this.
          backoff: (_) => Duration.zero,
        );

        await expectLater(
          resilient.send(_post()),
          throwsA(isA<CommerceTransportException>()),
        );
        expect(attempt, 1);
        expect(inner.requests, hasLength(1));
      },
    );

    test('a POST that times out is not retried either', () async {
      final inner = FakeCommerceTransport((request) async {
        await Future.delayed(const Duration(seconds: 30));
        return jsonResponse(200, const {'ok': true});
      });
      final resilient = ResilientCommerceTransport(
        inner,
        timeout: const Duration(milliseconds: 20),
        maxAttempts: 3,
        backoff: (_) => Duration.zero,
      );

      await expectLater(
        resilient.send(_post()),
        throwsA(isA<CommerceTransportException>()),
      );
      expect(inner.requests, hasLength(1));
    });
  });

  group('ResilientCommerceTransport — CommerceTransportException shape', () {
    test('reports the number of attempts actually made and preserves the cause', () async {
      final originalError = Exception('root cause');
      final inner = FakeCommerceTransport((request) async => throw originalError);
      final resilient = ResilientCommerceTransport(
        inner,
        maxAttempts: 2,
        backoff: (_) => Duration.zero,
      );

      try {
        await resilient.send(_get());
        fail('expected CommerceTransportException');
      } on CommerceTransportException catch (e) {
        expect(e.attempts, 2);
        expect(e.cause, originalError);
      }
    });
  });
}

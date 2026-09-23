import 'package:awj_mobile_runtime/diagnostics/diagnostics.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  group('DiagnosticFailureClass mapping', () {
    test('every IncompatibilityReason maps to a distinct DiagnosticFailureClass', () {
      final mapped = IncompatibilityReason.values
          .map(diagnosticFailureClassForCompatibility)
          .toSet();
      expect(mapped.length, IncompatibilityReason.values.length);
    });

    test('every UnavailableReason maps to a distinct DiagnosticFailureClass', () {
      final mapped = UnavailableReason.values.map(diagnosticFailureClassForStartup).toSet();
      expect(mapped.length, UnavailableReason.values.length);
    });
  });

  group('DiagnosticContext.toFields', () {
    test('carries exactly the fixed MR-17 field set, nothing more', () {
      const context = DiagnosticContext(
        runtimeVersion: '1.0.0',
        experienceVersion: '1.0.0',
        failureClass: DiagnosticFailureClass.schemaVersionTooNew,
        platform: RuntimePlatform.android,
        correlationId: 'corr-123',
      );

      expect(context.toFields(), {
        'runtimeVersion': '1.0.0',
        'experienceVersion': '1.0.0',
        'failureClass': 'schemaVersionTooNew',
        'platform': 'android',
        'correlationId': 'corr-123',
      });
    });

    test('optional fields default sensibly for a normal, no-failure event', () {
      const context = DiagnosticContext(runtimeVersion: '1.0.0', platform: RuntimePlatform.ios);

      expect(context.failureClass, DiagnosticFailureClass.none);
      expect(context.experienceVersion, isNull);
      expect(context.correlationId, isNull);
    });
  });

  group('DiagnosticEvent — redaction on construction', () {
    const context = DiagnosticContext(
      runtimeVersion: '1.0.0',
      platform: RuntimePlatform.ios,
      failureClass: DiagnosticFailureClass.fetchFailedNoCache,
    );

    test('a raw message containing a bearer token never survives into the built event', () {
      final event = DiagnosticEvent(
        context: context,
        rawMessage:
            'commerce request failed: Authorization: Bearer sk_live_totally_real_secret_value',
      );

      expect(event.message, isNot(contains('sk_live_totally_real_secret_value')));
      expect(event.toFields().toString(), isNot(contains('sk_live_totally_real_secret_value')));
    });

    test('raw extra fields keyed by a secret name never survive into the built event', () {
      final event = DiagnosticEvent(
        context: context,
        rawMessage: 'cart mutation failed',
        rawExtra: {'cartToken': 'do-not-leak-me', 'itemCount': 2},
      );

      final fields = event.toFields();
      expect(fields.toString(), isNot(contains('do-not-leak-me')));
      expect((fields['extra'] as Map)['itemCount'], 2);
    });

    test(
      'toFields merges context + message + extra into one flat, log-ready structure',
      () {
        final event = DiagnosticEvent(
          context: context,
          rawMessage: 'no compatible cached experience',
          rawExtra: {'attempt': 1},
        );

        final fields = event.toFields();
        expect(fields['runtimeVersion'], '1.0.0');
        expect(fields['platform'], 'ios');
        expect(fields['failureClass'], 'fetchFailedNoCache');
        expect(fields['message'], 'no compatible cached experience');
        expect(fields['extra'], {'attempt': 1});
      },
    );

    test('an event with no extra fields omits the "extra" key entirely (no empty-map noise)', () {
      final event = DiagnosticEvent(context: context, rawMessage: 'ok');
      expect(event.toFields().containsKey('extra'), isFalse);
    });
  });
}

import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter_test/flutter_test.dart';

import '../schema/test_schemas.dart';

CapabilityManifest _manifestOf({
  String minSchema = '1.0.0',
  String maxSchema = '1.0.0',
}) {
  return CapabilityManifest(
    platform: RuntimePlatform.ios,
    runtimeVersion: SchemaVersion.parse('1.0.0'),
    minSupportedSchemaVersion: SchemaVersion.parse(minSchema),
    maxSupportedSchemaVersion: SchemaVersion.parse(maxSchema),
    components: RuntimeCapabilities.components,
    actions: RuntimeCapabilities.actions,
    nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
  );
}

void main() {
  final compatibleJson = encodeSchema(baseSchemaJson(schemaVersion: '1.0.0'));
  final incompatibleJson = encodeSchema(baseSchemaJson(schemaVersion: '9.0.0'));
  final now = DateTime.utc(2026, 9, 23, 12, 0, 0);

  group('resolveStartup — AWJ Runtime Boot contract: no Published Experience', () {
    test('ExperienceFetchNotPublished -> UseDefaultExperience, with no cache', () {
      final decision = resolveStartup(
        fetch: const ExperienceFetchNotPublished(),
        cached: null,
        manifest: _manifestOf(),
      );

      expect(decision, isA<UseDefaultExperience>());
    });

    test(
      'ExperienceFetchNotPublished -> UseDefaultExperience even when a compatible last-known-good '
      'cache exists — never a fetch failure, never routed through last-known-good',
      () {
        final cached = CachedExperience.capture(compatibleJson, cachedAt: now);

        final decision = resolveStartup(
          fetch: const ExperienceFetchNotPublished(),
          cached: cached,
          manifest: _manifestOf(),
        );

        expect(decision, isA<UseDefaultExperience>());
      },
    );
  });

  group('resolveStartup — fresh fetch', () {
    test('fetch succeeded + compatible -> UseFreshExperience, no cache needed', () {
      final decision = resolveStartup(
        fetch: ExperienceFetchSucceeded(compatibleJson),
        cached: null,
        manifest: _manifestOf(),
      );

      expect(decision, isA<UseFreshExperience>());
    });

    test('fetch succeeded but malformed bytes falls back exactly like a failed fetch', () {
      final decision = resolveStartup(
        fetch: const ExperienceFetchSucceeded('{not valid json'),
        cached: null,
        manifest: _manifestOf(),
      );

      expect(decision, isA<ControlledUnavailable>());
      expect(
        (decision as ControlledUnavailable).reason,
        UnavailableReason.fetchFailedNoCache,
      );
    });
  });

  group('resolveStartup — MR-14 fixture: no-network startup with compatible last-known-good', () {
    test('fetch failed + intact + compatible cache -> UseLastKnownGood', () {
      final cached = CachedExperience.capture(compatibleJson, cachedAt: now);

      final decision = resolveStartup(
        fetch: const ExperienceFetchFailed('no_network'),
        cached: cached,
        manifest: _manifestOf(),
      );

      expect(decision, isA<UseLastKnownGood>());
      final good = decision as UseLastKnownGood;
      expect(good.cachedAt, now);
      expect(good.revalidateWhenOnline, isTrue);
      expect(good.experience.pages['home'], isNotNull);
    });
  });

  group(
    'resolveStartup — MR-14 fixture: no-network startup without a compatible last-known-good',
    () {
      test('fetch failed + no cache at all -> ControlledUnavailable(fetchFailedNoCache)', () {
        final decision = resolveStartup(
          fetch: const ExperienceFetchFailed('timeout'),
          cached: null,
          manifest: _manifestOf(),
        );

        expect(decision, isA<ControlledUnavailable>());
        expect(
          (decision as ControlledUnavailable).reason,
          UnavailableReason.fetchFailedNoCache,
        );
      });

      test(
        'fetch failed + cache exists but is incompatible with the current manifest -> '
        'ControlledUnavailable(fetchFailedCacheIncompatible), never rendered',
        () {
          // A runtime that no longer/not-yet supports schema 1.0.0 (e.g. a
          // rollback to a narrower supported range) must not render a stale
          // cache it can no longer safely interpret, even though the cache
          // itself is perfectly intact.
          final cached = CachedExperience.capture(compatibleJson, cachedAt: now);

          final decision = resolveStartup(
            fetch: const ExperienceFetchFailed('no_network'),
            cached: cached,
            manifest: _manifestOf(minSchema: '2.0.0', maxSchema: '3.0.0'),
          );

          expect(decision, isA<ControlledUnavailable>());
          expect(
            (decision as ControlledUnavailable).reason,
            UnavailableReason.fetchFailedCacheIncompatible,
          );
        },
      );

      test(
        'fetch failed + cache bytes were altered after caching -> '
        'ControlledUnavailable(fetchFailedCacheCorrupted), never rendered — '
        'MR-14 "its integrity ... metadata are preserved"',
        () {
          final captured = CachedExperience.capture(compatibleJson, cachedAt: now);
          final tampered = CachedExperience(
            rawJson: incompatibleJson, // bytes changed after capture...
            integrityDigest: captured.integrityDigest, // ...but the digest was not recomputed.
            cachedAt: now,
          );

          final decision = resolveStartup(
            fetch: const ExperienceFetchFailed('no_network'),
            cached: tampered,
            manifest: _manifestOf(),
          );

          expect(decision, isA<ControlledUnavailable>());
          expect(
            (decision as ControlledUnavailable).reason,
            UnavailableReason.fetchFailedCacheCorrupted,
          );
        },
      );

      test(
        'fetch failed + cache contains bytes that no longer parse as a schema at all -> '
        'ControlledUnavailable(fetchFailedCacheUnparseable), never rendered',
        () {
          const garbage = '{"schemaVersion": "1.0.0"'; // truncated, but a valid-looking digest.
          final cached = CachedExperience.capture(garbage, cachedAt: now);

          final decision = resolveStartup(
            fetch: const ExperienceFetchFailed('no_network'),
            cached: cached,
            manifest: _manifestOf(),
          );

          expect(decision, isA<ControlledUnavailable>());
          expect(
            (decision as ControlledUnavailable).reason,
            UnavailableReason.fetchFailedCacheUnparseable,
          );
        },
      );
    },
  );

  group('resolveStartup — fresh fetch succeeded but is itself incompatible', () {
    test('incompatible fresh fetch + a compatible cache -> falls back to UseLastKnownGood', () {
      final cached = CachedExperience.capture(compatibleJson, cachedAt: now);

      final decision = resolveStartup(
        fetch: ExperienceFetchSucceeded(incompatibleJson),
        cached: cached,
        manifest: _manifestOf(),
      );

      expect(decision, isA<UseLastKnownGood>());
    });

    test('incompatible fresh fetch + no cache -> ControlledUnavailable(freshIncompatibleNoCache)', () {
      final decision = resolveStartup(
        fetch: ExperienceFetchSucceeded(incompatibleJson),
        cached: null,
        manifest: _manifestOf(),
      );

      expect(decision, isA<ControlledUnavailable>());
      expect(
        (decision as ControlledUnavailable).reason,
        UnavailableReason.freshIncompatibleNoCache,
      );
    });

    test(
      'incompatible fresh fetch + a cache that is itself incompatible -> the more specific '
      'fetchFailedCacheIncompatible reason is preserved, not overwritten with "no cache"',
      () {
        final incompatibleCache = CachedExperience.capture(compatibleJson, cachedAt: now);

        final decision = resolveStartup(
          fetch: ExperienceFetchSucceeded(incompatibleJson),
          cached: incompatibleCache,
          manifest: _manifestOf(minSchema: '2.0.0', maxSchema: '3.0.0'),
        );

        expect(decision, isA<ControlledUnavailable>());
        expect(
          (decision as ControlledUnavailable).reason,
          UnavailableReason.fetchFailedCacheIncompatible,
        );
      },
    );
  });

  group('CachedExperience.capture', () {
    test('two captures of identical bytes produce the same digest (deterministic)', () {
      final a = CachedExperience.capture(compatibleJson, cachedAt: now);
      final b = CachedExperience.capture(compatibleJson, cachedAt: now);

      expect(a.integrityDigest, b.integrityDigest);
    });

    test('captures of different bytes produce different digests', () {
      final a = CachedExperience.capture(compatibleJson, cachedAt: now);
      final b = CachedExperience.capture(incompatibleJson, cachedAt: now);

      expect(a.integrityDigest, isNot(b.integrityDigest));
    });
  });
}

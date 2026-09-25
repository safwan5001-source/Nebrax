import 'package:awj_mobile_runtime/commerce/commerce.dart';
import 'package:awj_mobile_runtime/schema/schema.dart';
import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter_test/flutter_test.dart';

import '../commerce/fake_transport.dart';
import '../schema/test_schemas.dart';

CommerceConfig _config() => CommerceConfig(
  baseUrl: Uri.parse('https://api.example.com/commerce/v1'),
  storeBearerToken: 'store-secret-key',
);

CapabilityManifest _manifest() {
  return CapabilityManifest(
    platform: RuntimePlatform.ios,
    runtimeVersion: SchemaVersion.parse('1.0.0'),
    minSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    maxSupportedSchemaVersion: SchemaVersion.parse('1.0.0'),
    components: RuntimeCapabilities.components,
    actions: RuntimeCapabilities.actions,
    nativeCapabilities: RuntimeCapabilities.nativeCapabilities,
  );
}

CommerceClient _clientWithSchema(Map<String, Object?> schemaJson, {int status = 200}) {
  final transport = FakeCommerceTransport.always(
    jsonResponse(status, {
      'data': {'version': 1, 'schema_version': '1', 'published_at': '2026-09-25T00:00:00Z', 'schema': schemaJson},
      'meta': successMeta(),
    }),
  );
  return CommerceClient(config: _config(), sessionStore: InMemorySecureSessionStore(), transport: transport);
}

CommerceClient _failingClient(int statusCode, String code) {
  final transport = FakeCommerceTransport.always(
    jsonResponse(statusCode, errorEnvelope(code, 'error')),
  );
  return CommerceClient(config: _config(), sessionStore: InMemorySecureSessionStore(), transport: transport);
}

void main() {
  final now = DateTime.utc(2026, 9, 25, 12, 0, 0);
  final compatibleSchema = baseSchemaJson(schemaVersion: '1.0.0');
  final compatibleJson = encodeSchema(compatibleSchema);

  group('resolveRealStartup — fresh fetch succeeds', () {
    test('fetch succeeds and is compatible -> UseFreshExperience, and the cache is written', () async {
      final client = _clientWithSchema(compatibleSchema);
      final cache = InMemoryExperienceCache();

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      expect(decision, isA<UseFreshExperience>());
      final cached = await cache.read();
      expect(cached, isNotNull);
      expect(cached!.rawJson, compatibleJson);
    });

    test('a second successful fetch overwrites the previously cached entry', () async {
      final cache = InMemoryExperienceCache();
      await cache.write(CachedExperience.capture('{"stale":true}', cachedAt: now.subtract(const Duration(days: 1))));

      final client = _clientWithSchema(compatibleSchema);
      await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      final cached = await cache.read();
      expect(cached!.rawJson, compatibleJson);
    });
  });

  group('resolveRealStartup — no Published Experience (AWJ Runtime Boot contract)', () {
    test('a 404 (never published) renders the Default AWJ Experience even when a last-known-good cache exists, and the cache is left untouched', () async {
      final cachedEntry = CachedExperience.capture(compatibleJson, cachedAt: now);
      final cache = InMemoryExperienceCache();
      await cache.write(cachedEntry);
      final client = _failingClient(404, 'not_found');

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      // No Published Experience is never a fetch failure and is never routed
      // through last-known-good — see this task's AWJ Runtime Boot contract.
      expect(decision, isA<UseDefaultExperience>());
      final stillCached = await cache.read();
      expect(stillCached!.cachedAt, now);
      expect(stillCached.rawJson, compatibleJson);
    });

    test('a 404 (never published) with no cache at all also renders the Default AWJ Experience, not ControlledUnavailable', () async {
      final cache = InMemoryExperienceCache();
      final client = _failingClient(404, 'not_found');

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      expect(decision, isA<UseDefaultExperience>());
      expect(await cache.read(), isNull);
    });
  });

  group('resolveRealStartup — fresh fetch fails, cache present', () {
    test('a 500 (genuine server error, not a 404) falls back to a compatible cache as UseLastKnownGood', () async {
      final cachedEntry = CachedExperience.capture(compatibleJson, cachedAt: now);
      final cache = InMemoryExperienceCache();
      await cache.write(cachedEntry);
      final client = _failingClient(500, 'internal_error');

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      // Unlike a 404, this is a genuine transient failure — the 404/
      // no-published case must never be conflated with any other fetch
      // failure, and vice versa.
      expect(decision, isA<UseLastKnownGood>());
      expect((decision as UseLastKnownGood).cachedAt, now);
    });

    test('a transport failure (no network) with no cache -> ControlledUnavailable(fetchFailedNoCache)', () async {
      final transport = FakeCommerceTransport(
        (_) async => throw const CommerceTransportException('no network', attempts: 3),
      );
      final client = CommerceClient(config: _config(), sessionStore: InMemorySecureSessionStore(), transport: transport);
      final cache = InMemoryExperienceCache();

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      expect(decision, isA<ControlledUnavailable>());
      expect((decision as ControlledUnavailable).reason, UnavailableReason.fetchFailedNoCache);
      expect(await cache.read(), isNull);
    });
  });

  group('resolveRealStartup — fresh fetch succeeds but is incompatible', () {
    test('an incompatible fresh schema with a compatible cache falls back to UseLastKnownGood, and does not overwrite the cache', () async {
      final incompatibleSchema = baseSchemaJson(schemaVersion: '9.0.0');
      final cachedEntry = CachedExperience.capture(compatibleJson, cachedAt: now);
      final cache = InMemoryExperienceCache();
      await cache.write(cachedEntry);
      final client = _clientWithSchema(incompatibleSchema);

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      expect(decision, isA<UseLastKnownGood>());
      final stillCached = await cache.read();
      expect(stillCached!.rawJson, compatibleJson);
    });

    test('an incompatible fresh schema with no cache -> ControlledUnavailable(freshIncompatibleNoCache)', () async {
      final incompatibleSchema = baseSchemaJson(schemaVersion: '9.0.0');
      final cache = InMemoryExperienceCache();
      final client = _clientWithSchema(incompatibleSchema);

      final decision = await resolveRealStartup(client: client, cache: cache, manifest: _manifest());

      expect(decision, isA<ControlledUnavailable>());
      expect((decision as ControlledUnavailable).reason, UnavailableReason.freshIncompatibleNoCache);
      expect(await cache.read(), isNull);
    });
  });

  group('resolveRealStartup — a broken cache never crashes startup', () {
    test('a cache whose read() throws is treated as no cache, not an uncaught exception', () async {
      final client = _clientWithSchema(compatibleSchema);

      final decision = await resolveRealStartup(client: client, cache: _ThrowingExperienceCache(), manifest: _manifest());

      expect(decision, isA<UseFreshExperience>());
    });

    test('a cache whose write() throws still returns the fresh decision', () async {
      final client = _clientWithSchema(compatibleSchema);

      final decision = await resolveRealStartup(
        client: client,
        cache: _ThrowingExperienceCache(failReadToo: false),
        manifest: _manifest(),
      );

      expect(decision, isA<UseFreshExperience>());
    });
  });
}

/// A test double whose `read`/`write` always throw, proving
/// `resolveRealStartup` never lets a broken platform cache crash startup.
class _ThrowingExperienceCache implements ExperienceCache {
  final bool failReadToo;

  _ThrowingExperienceCache({this.failReadToo = true});

  @override
  Future<CachedExperience?> read() async {
    if (failReadToo) throw StateError('cache read failed');
    return null;
  }

  @override
  Future<void> write(CachedExperience experience) async => throw StateError('cache write failed');

  @override
  Future<void> clear() async => throw StateError('cache clear failed');
}

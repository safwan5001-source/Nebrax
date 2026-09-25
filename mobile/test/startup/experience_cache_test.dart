import 'dart:io';

import 'package:awj_mobile_runtime/startup/startup.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final now = DateTime.utc(2026, 9, 25, 12, 0, 0);

  group('InMemoryExperienceCache', () {
    test('read returns null until something is written', () async {
      final cache = InMemoryExperienceCache();
      expect(await cache.read(), isNull);

      final entry = CachedExperience.capture('{"a":1}', cachedAt: now);
      await cache.write(entry);

      final read = await cache.read();
      expect(read!.rawJson, '{"a":1}');
      expect(read.integrityDigest, entry.integrityDigest);
      expect(read.cachedAt, now);
    });

    test('clear removes a written entry', () async {
      final cache = InMemoryExperienceCache();
      await cache.write(CachedExperience.capture('{}', cachedAt: now));

      await cache.clear();

      expect(await cache.read(), isNull);
    });
  });

  group('FileExperienceCache', () {
    late Directory tempDir;
    late FileExperienceCache cache;

    setUp(() async {
      tempDir = await Directory.systemTemp.createTemp('experience_cache_test_');
      cache = FileExperienceCache(directory: () async => tempDir);
    });

    tearDown(() async {
      if (await tempDir.exists()) await tempDir.delete(recursive: true);
    });

    test('read returns null when no file has ever been written', () async {
      expect(await cache.read(), isNull);
    });

    test('write then read round-trips rawJson/integrityDigest/cachedAt exactly', () async {
      final entry = CachedExperience.capture('{"pages":{"home":{}}}', cachedAt: now);

      await cache.write(entry);
      final read = await cache.read();

      expect(read, isNotNull);
      expect(read!.rawJson, entry.rawJson);
      expect(read.integrityDigest, entry.integrityDigest);
      expect(read.cachedAt, now);
    });

    test('a second write overwrites the first', () async {
      await cache.write(CachedExperience.capture('{"v":1}', cachedAt: now));
      await cache.write(CachedExperience.capture('{"v":2}', cachedAt: now.add(const Duration(days: 1))));

      final read = await cache.read();

      expect(read!.rawJson, '{"v":2}');
    });

    test('clear deletes the file; a subsequent read is null, not an error', () async {
      await cache.write(CachedExperience.capture('{}', cachedAt: now));

      await cache.clear();

      expect(await cache.read(), isNull);
    });

    test('clear on an already-empty cache is a safe no-op', () async {
      await cache.clear();
      expect(await cache.read(), isNull);
    });

    test('a file that is not valid JSON reads as null rather than throwing', () async {
      final file = File('${tempDir.path}/awj_last_known_good_experience.json');
      await file.writeAsString('{not valid json');

      expect(await cache.read(), isNull);
    });

    test('a file missing an expected field reads as null rather than throwing', () async {
      final file = File('${tempDir.path}/awj_last_known_good_experience.json');
      await file.writeAsString('{"rawJson": "{}"}');

      expect(await cache.read(), isNull);
    });
  });
}

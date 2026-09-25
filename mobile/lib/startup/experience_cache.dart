import 'dart:convert';
import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'last_known_good.dart';

/// On-device persistence for MR-14's "last-known-good" [CachedExperience] —
/// the real I/O half `last_known_good.dart` itself deliberately never
/// performs (it is a pure decision function; see its own doc comment).
/// `experience_fetcher.dart` is the only code that reads/writes this.
///
/// Kept as an interface for the same reason `SecureSessionStore`
/// (`commerce/secure_session_store.dart`) and `CommerceTransport`
/// (`commerce/commerce_transport.dart`) are: `flutter test` has no real
/// filesystem sandbox to exercise, so production code and tests need
/// different implementations behind one contract.
///
/// Deliberately **not** `SecureSessionStore`/`flutter_secure_storage`-backed:
/// a cached Experience is not a secret (MR-14 — "it contains no customer
/// secrets"), and a full App Schema document (potentially many pages/
/// components) is a poor fit for a platform Keychain/
/// EncryptedSharedPreferences entry, whose reliable per-item size is far
/// smaller than ordinary file storage. `path_provider` is the narrowest
/// first-party addition for "the app's own sandboxed writable directory" —
/// there is no `dart:io`-only equivalent on iOS/Android (MR-19's "narrower
/// first-party" test, the same reasoning that already justified
/// `flutter_secure_storage` for MR-07).
abstract interface class ExperienceCache {
  Future<CachedExperience?> read();
  Future<void> write(CachedExperience experience);
  Future<void> clear();
}

/// Pure-Dart, in-memory [ExperienceCache] for tests. Never used for a real
/// device — mirrors `InMemorySecureSessionStore`'s exact same role.
class InMemoryExperienceCache implements ExperienceCache {
  CachedExperience? _entry;

  @override
  Future<CachedExperience?> read() async => _entry;

  @override
  Future<void> write(CachedExperience experience) async => _entry = experience;

  @override
  Future<void> clear() async => _entry = null;
}

/// Real [ExperienceCache], backed by a single JSON file in the app's own
/// application-support directory (`path_provider`'s
/// [getApplicationSupportDirectory] — internal runtime state, not
/// documents/downloads, which are user- or backup-visible).
class FileExperienceCache implements ExperienceCache {
  static const _fileName = 'awj_last_known_good_experience.json';

  final Future<Directory> Function() _directory;

  const FileExperienceCache({
    Future<Directory> Function() directory = getApplicationSupportDirectory,
  }) : _directory = directory;

  Future<File> _file() async {
    final dir = await _directory();
    return File('${dir.path}/$_fileName');
  }

  @override
  Future<CachedExperience?> read() async {
    final file = await _file();
    if (!await file.exists()) return null;

    // A wrapper-level parse failure (truncated write from a crash mid-write,
    // or external tampering with this file's own shape — distinct from
    // `resolveStartup`'s own integrity-digest check on the *content* it
    // wraps) is treated the same as "no cache exists". The only practical
    // difference from the more specific `fetchFailedCacheCorrupted` is a
    // diagnostic message (`UnavailableReason`'s own doc: "for diagnostics...
    // and for the screen layer to choose an appropriate message") — both are
    // terminal, non-rendering outcomes either way, so this stays the
    // simpler of two correct mappings rather than fabricating a poisoned
    // [CachedExperience] just to route through the other one.
    try {
      final raw = jsonDecode(await file.readAsString());
      if (raw is! Map) return null;
      final decoded = raw.cast<String, Object?>();

      final rawJson = decoded['rawJson'];
      final integrityDigest = decoded['integrityDigest'];
      final cachedAtIso = decoded['cachedAt'];
      if (rawJson is! String || integrityDigest is! String || cachedAtIso is! String) {
        return null;
      }
      final cachedAt = DateTime.tryParse(cachedAtIso);
      if (cachedAt == null) return null;

      return CachedExperience(rawJson: rawJson, integrityDigest: integrityDigest, cachedAt: cachedAt);
    } on FormatException {
      return null;
    } on IOException {
      return null;
    }
  }

  @override
  Future<void> write(CachedExperience experience) async {
    final file = await _file();
    await file.writeAsString(
      jsonEncode({
        'rawJson': experience.rawJson,
        'integrityDigest': experience.integrityDigest,
        'cachedAt': experience.cachedAt.toIso8601String(),
      }),
    );
  }

  @override
  Future<void> clear() async {
    final file = await _file();
    if (await file.exists()) await file.delete();
  }
}

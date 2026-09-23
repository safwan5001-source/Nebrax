import 'dart:convert';

/// A small first-party 64-bit FNV-1a hash over UTF-8 bytes, rendered as a
/// fixed-width lowercase hex string.
///
/// This exists only to let [CachedExperience] (`last_known_good.dart`)
/// detect that a cached Published Experience's bytes were altered after
/// caching (MR-14: "its integrity ... metadata are preserved") — it is a
/// tamper/corruption *detector*, not a cryptographic authenticity guarantee
/// (this proof has no signing key to verify against). A full hashing
/// package (`crypto`) was deliberately not added for this narrow need, per
/// MR-19's "whether a narrower first-party/framework implementation is
/// reasonable" test — the same reasoning `schema_version.dart` already
/// recorded for its own first-party SemVer-lite comparator.
String computeIntegrityDigest(String content) {
  const int fnvPrime = 0x100000001b3;
  const int fnvOffsetBasis = 0xcbf29ce484222325;
  const int mask64 = 0xFFFFFFFFFFFFFFFF;

  var hash = fnvOffsetBasis;
  for (final byte in utf8.encode(content)) {
    hash = (hash ^ byte) & mask64;
    hash = (hash * fnvPrime) & mask64;
  }
  return hash.toRadixString(16).padLeft(16, '0');
}

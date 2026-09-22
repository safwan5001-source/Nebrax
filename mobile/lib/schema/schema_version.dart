/// Minimal SemVer-lite comparator (`major.minor.patch`, numeric only).
///
/// A full semver package was deliberately not added for MOBILE-RUNTIME-2:
/// this kernel only ever compares AWJ-owned schema/runtime version strings
/// of a fixed `x.y.z` shape (never pre-release/build-metadata suffixes), so
/// a narrow first-party comparator avoids a new dependency for a problem
/// this bounded (horizon MR-19: "whether a narrower first-party/framework
/// implementation is reasonable").
class SchemaVersion implements Comparable<SchemaVersion> {
  final int major;
  final int minor;
  final int patch;

  const SchemaVersion(this.major, this.minor, this.patch);

  static SchemaVersion? tryParse(String value) {
    final parts = value.trim().split('.');
    if (parts.length != 3) return null;
    final nums = <int>[];
    for (final part in parts) {
      final n = int.tryParse(part);
      if (n == null || n < 0) return null;
      nums.add(n);
    }
    return SchemaVersion(nums[0], nums[1], nums[2]);
  }

  static SchemaVersion parse(String value) {
    final version = tryParse(value);
    if (version == null) {
      throw FormatException('Invalid version string "$value" (expected "x.y.z")');
    }
    return version;
  }

  @override
  int compareTo(SchemaVersion other) {
    if (major != other.major) return major.compareTo(other.major);
    if (minor != other.minor) return minor.compareTo(other.minor);
    return patch.compareTo(other.patch);
  }

  bool operator <(SchemaVersion other) => compareTo(other) < 0;
  bool operator <=(SchemaVersion other) => compareTo(other) <= 0;
  bool operator >(SchemaVersion other) => compareTo(other) > 0;
  bool operator >=(SchemaVersion other) => compareTo(other) >= 0;

  @override
  bool operator ==(Object other) => other is SchemaVersion && compareTo(other) == 0;

  @override
  int get hashCode => Object.hash(major, minor, patch);

  @override
  String toString() => '$major.$minor.$patch';
}

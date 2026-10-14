// Runtime configuration for the preview host.
//
// Nothing here has a default for the two signing inputs: a placeholder would
// produce an association file that *looks* valid but silently fails platform
// verification. Missing or malformed values are reported as `errors` and the
// association routes (and server startup) fail closed.

export const ANDROID_PACKAGE_NAME = 'com.example.awjmobileruntimeproof';
export const IOS_BUNDLE_ID = 'com.example.awjMobileRuntimeProof';

// SHA-256 certificate fingerprint: 32 bytes as colon-separated hex pairs.
const FINGERPRINT_RE = /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/;
// Apple Developer Team ID: 10 alphanumeric characters.
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;

export function parseFingerprints(raw) {
  const errors = [];
  const items = (raw ?? '')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((f) => f.toUpperCase());
  const unique = [...new Set(items)];
  if (unique.length === 0) {
    errors.push('ANDROID_APP_LINK_SHA256_FINGERPRINTS is required (one or more SHA-256 fingerprints, comma-separated)');
    return { fingerprints: null, errors };
  }
  // Report only the position of a bad entry, never its value.
  unique.forEach((f, i) => {
    if (!FINGERPRINT_RE.test(f)) {
      errors.push(`ANDROID_APP_LINK_SHA256_FINGERPRINTS entry #${i + 1} is not a SHA-256 fingerprint (expected 32 colon-separated hex bytes)`);
    }
  });
  return errors.length ? { fingerprints: null, errors } : { fingerprints: unique, errors };
}

export function parseTeamId(raw) {
  const value = (raw ?? '').trim().toUpperCase();
  if (!value) return { teamId: null, errors: ['APPLE_TEAM_ID is required (10-character Apple Developer Team ID)'] };
  if (!TEAM_ID_RE.test(value)) {
    return { teamId: null, errors: ['APPLE_TEAM_ID is malformed (expected 10 alphanumeric characters)'] };
  }
  return { teamId: value, errors: [] };
}

export function loadConfig(env = process.env) {
  const android = parseFingerprints(env.ANDROID_APP_LINK_SHA256_FINGERPRINTS);
  const apple = parseTeamId(env.APPLE_TEAM_ID);
  const port = Number.parseInt(env.PORT ?? '3000', 10);
  const errors = [...android.errors, ...apple.errors];
  if (!Number.isInteger(port) || port < 0 || port > 65535) errors.push('PORT is invalid');
  return {
    port,
    androidFingerprints: android.fingerprints,
    appleTeamId: apple.teamId,
    errors,
  };
}

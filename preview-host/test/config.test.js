import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { FP_A, FP_B, TEAM } from './helpers.js';

test('missing Android fingerprint disables Android only (notice, not fatal)', () => {
  const c = loadConfig({ APPLE_TEAM_ID: TEAM });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.appleTeamId, TEAM);
  assert.deepEqual(c.errors, []);
  assert.ok(c.notices.some((e) => e.includes('ANDROID_APP_LINK_SHA256_FINGERPRINTS')));
});

test('missing Apple Team ID disables Apple only (notice, not fatal)', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A });
  assert.equal(c.appleTeamId, null);
  assert.deepEqual(c.androidFingerprints, [FP_A]);
  assert.deepEqual(c.errors, []);
  assert.ok(c.notices.some((e) => e.includes('APPLE_TEAM_ID')));
});

test('both missing: both disabled, nothing fatal', () => {
  const c = loadConfig({});
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.appleTeamId, null);
  assert.deepEqual(c.errors, []);
  assert.equal(c.notices.length, 2);
});

test('empty-string variables (as set by a platform UI) count as missing', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: '  ', APPLE_TEAM_ID: '' });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.appleTeamId, null);
  assert.deepEqual(c.errors, []);
});

test('invalid PORT is the process-level error', () => {
  for (const PORT of ['abc', '-1', '70000']) {
    const c = loadConfig({ PORT, ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: TEAM });
    assert.deepEqual(c.errors, ['PORT is invalid'], PORT);
  }
});

test('malformed values are rejected and never echoed in notices', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: 'not-a-fingerprint', APPLE_TEAM_ID: 'short' });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.appleTeamId, null);
  assert.deepEqual(c.errors, []);
  const text = c.notices.join('\n');
  assert.ok(!text.includes('not-a-fingerprint'));
  assert.ok(!text.includes('short'));
});

test('multiple fingerprints: comma/whitespace separated, normalised, de-duplicated', () => {
  const c = loadConfig({
    ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A.toLowerCase()}, ${FP_B}\n${FP_A}`,
    APPLE_TEAM_ID: TEAM.toLowerCase(),
  });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.notices, []);
  assert.deepEqual(c.androidFingerprints, [FP_A, FP_B]);
  assert.equal(c.appleTeamId, TEAM);
});

test('one bad entry among good ones fails the whole list', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A},XX`, APPLE_TEAM_ID: TEAM });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.notices.length, 1);
  assert.deepEqual(c.errors, []);
});

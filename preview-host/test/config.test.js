import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';
import { FP_A, FP_B, TEAM } from './helpers.js';

test('missing Android fingerprint is a configuration error', () => {
  const c = loadConfig({ APPLE_TEAM_ID: TEAM });
  assert.equal(c.androidFingerprints, null);
  assert.ok(c.errors.some((e) => e.includes('ANDROID_APP_LINK_SHA256_FINGERPRINTS')));
});

test('missing Apple Team ID is a configuration error', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A });
  assert.equal(c.appleTeamId, null);
  assert.ok(c.errors.some((e) => e.includes('APPLE_TEAM_ID')));
});

test('malformed values are rejected and never echoed in errors', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: 'not-a-fingerprint', APPLE_TEAM_ID: 'short' });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.appleTeamId, null);
  const text = c.errors.join('\n');
  assert.ok(!text.includes('not-a-fingerprint'));
  assert.ok(!text.includes('short'));
});

test('multiple fingerprints: comma/whitespace separated, normalised, de-duplicated', () => {
  const c = loadConfig({
    ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A.toLowerCase()}, ${FP_B}\n${FP_A}`,
    APPLE_TEAM_ID: TEAM.toLowerCase(),
  });
  assert.deepEqual(c.errors, []);
  assert.deepEqual(c.androidFingerprints, [FP_A, FP_B]);
  assert.equal(c.appleTeamId, TEAM);
});

test('one bad entry among good ones fails the whole list', () => {
  const c = loadConfig({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A},XX`, APPLE_TEAM_ID: TEAM });
  assert.equal(c.androidFingerprints, null);
  assert.equal(c.errors.length, 1);
});

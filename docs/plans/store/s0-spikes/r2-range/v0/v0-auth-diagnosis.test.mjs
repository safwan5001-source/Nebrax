import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { classify, toMarkdown } from './v0-auth-diagnosis.mjs';

const fmt = (o = {}) => ({ s3_endpoint_present: true, s3_key_present: true, s3_secret_present: true, s3_bucket_present: true, key_is_32_hex: true, secret_is_64_hex: true, key_has_whitespace: false, secret_has_whitespace: false, bucket_has_whitespace: false, endpoint_shape_ok: true, bucket_name_shape_ok: true, key_secret_differ: true, ...o });
const call = (name, awsCode = null, status = awsCode ? 403 : 200) => ({ name, ok: !awsCode, status, awsCode });
const base = (over = {}) => ({ format: fmt(), calls: [call('control-bad-secret', 'SignatureDoesNotMatch'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual'), call('list-prefix/virtual'), call('head-bucket/path'), call('list-prefix/path'), ...(over.calls ?? [])], ...over, ...(over.format ? { format: fmt(over.format) } : {}) });
const withReal = (code) => ({ calls: [call('control-bad-secret', 'SignatureDoesNotMatch'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual', code), call('list-prefix/virtual', code), call('head-bucket/path', code), call('list-prefix/path', code)] });

test('the observed incident: key id recognised (signature control), every real call AccessDenied → no permission on this bucket (authorisation, not signing)', () => {
  const r = classify({ format: fmt(), ...withReal('AccessDenied') });
  assert.equal(r.verdict, 'no_permission_on_bucket');
  assert.match(r.correctiveStep, /THIS bucket/);
  assert.equal(r.credentialsUsable, false);
});

test('a wrong secret is told apart from a wrong permission: real calls report SignatureDoesNotMatch', () => {
  assert.equal(classify({ format: fmt(), ...withReal('SignatureDoesNotMatch') }).verdict, 'secret_mismatch');
});

test('a key id R2 does not recognise (bad-secret control behaves like an unknown key) is told apart from a permission problem', () => {
  const r = classify({ format: fmt(), calls: [call('control-bad-secret', 'AccessDenied'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual', 'AccessDenied'), call('list-prefix/virtual', 'AccessDenied')] });
  assert.equal(r.verdict, 'key_id_not_recognised');
});

test('NoSuchBucket points at the bucket name / account / jurisdiction', () => {
  assert.equal(classify({ format: fmt(), ...withReal('NoSuchBucket') }).verdict, 'bucket_not_found');
});

test('read works, PutObject denied → a read-only token', () => {
  const r = classify({ format: fmt(), calls: [call('control-bad-secret', 'SignatureDoesNotMatch'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual'), call('list-prefix/virtual'), call('put', 'AccessDenied')] });
  assert.equal(r.verdict, 'token_cannot_write');
  assert.match(r.correctiveStep, /Object Read & Write/);
});

test('everything works → credentials_ok (the earlier failure is not an auth problem)', () => {
  const r = classify({ format: fmt(), calls: [call('control-bad-secret', 'SignatureDoesNotMatch'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual'), call('list-prefix/virtual'), call('head-bucket/path'), call('list-prefix/path'), call('put'), call('head'), call('delete'), call('head-after-delete', 'NotFound', 404)] });
  assert.equal(r.verdict, 'credentials_ok');
  assert.equal(r.credentialsUsable, true);
});

test('addressing-style specific success is reported as such', () => {
  const r = classify({ format: fmt(), calls: [call('control-bad-secret', 'SignatureDoesNotMatch'), call('control-unknown-key', 'AccessDenied'), call('head-bucket/virtual'), call('list-prefix/virtual'), call('head-bucket/path', 'AccessDenied'), call('list-prefix/path', 'AccessDenied'), call('put'), call('delete'), call('head-after-delete', 'NotFound', 404)] });
  assert.equal(r.verdict, 'addressing_style_specific');
});

test('missing settings and whitespace are caught before any inference', () => {
  assert.equal(classify({ format: fmt({ s3_secret_present: false }), calls: [] }).verdict, 'config_missing');
  assert.equal(classify({ format: fmt({ key_has_whitespace: true }), calls: [] }).verdict, 'whitespace_in_secret');
});

test('shape oddities are surfaced as facts without printing any value', () => {
  const r = classify({ format: fmt({ secret_is_64_hex: false }), ...withReal('AccessDenied') });
  assert.ok(r.facts.some((x) => /credential shape unusual/.test(x)));
  assert.doesNotMatch(toMarkdown(r, fmt()), /X-Amz|AWS4|https?:\/\//);
});

test('the PHP script, run against an unreachable endpoint with dummy values, prints only booleans / status / codes and never the values', { skip: !existsSync(process.env.V0_AUTOLOAD ?? '/home/user/nibras-app/vendor/autoload.php') }, () => {
  const key = 'a'.repeat(32); const secret = 'b'.repeat(64);
  const r = spawnSync('php', [new URL('./v0-auth-diagnose.php', import.meta.url).pathname, process.env.V0_AUTOLOAD ?? '/home/user/nibras-app/vendor/autoload.php'], {
    encoding: 'utf8', env: { ...process.env, S3_ENDPOINT: 'https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com.invalid', S3_KEY: key, S3_SECRET: secret, S3_BUCKET: 'canary-bucket-name' }, timeout: 120000,
  });
  const out = JSON.parse(r.stdout);
  assert.ok(Array.isArray(out.calls) && out.calls.length >= 6);
  for (const needle of [key, secret, 'canary-bucket-name', '.invalid']) assert.ok(!r.stdout.includes(needle) && !r.stderr.includes(needle), 'value leaked');
  assert.deepEqual(Object.keys(out.calls[0]).sort(), ['awsCode', 'name', 'ok', 'status']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, FP_A, FP_B, TEAM, FULL_ENV } from './helpers.js';

test('/health returns 200 {"status":"ok"} with no sensitive values', async () => {
  const s = await start();
  const r = await s.get('/health');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), '{"status":"ok"}');
  await s.close();
});

test('/health works even when association config is missing', async () => {
  const s = await start({ PORT: '0' });
  assert.equal((await s.get('/health')).status, 200);
  await s.close();
});

test('assetlinks.json: exact shape, injected fingerprints, JSON, no redirect, no cookies', async () => {
  const s = await start({ ...FULL_ENV, ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A},${FP_B}` });
  const r = await s.get('/.well-known/assetlinks.json');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('location'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.deepEqual(await r.json(), [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: 'com.example.awjmobileruntimeproof',
        sha256_cert_fingerprints: [FP_A, FP_B],
      },
    },
  ]);
  await s.close();
});

test('assetlinks.json is deterministic', async () => {
  const s = await start();
  const a = await (await s.get('/.well-known/assetlinks.json')).text();
  const b = await (await s.get('/.well-known/assetlinks.json')).text();
  assert.equal(a, b);
  await s.close();
});

test('AASA: exact shape, Team ID + bundle ID, /preview/* scope, JSON, no redirect, no cookies', async () => {
  const s = await start();
  const r = await s.get('/.well-known/apple-app-site-association');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/json');
  assert.equal(r.headers.get('location'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  assert.deepEqual(await r.json(), {
    applinks: {
      apps: [],
      details: [{ appIDs: [`${TEAM}.com.example.awjMobileRuntimeProof`], components: [{ '/': '/preview/*' }] }],
    },
  });
  await s.close();
});

test('AASA has no .json variant and no trailing-slash redirect', async () => {
  const s = await start();
  for (const p of ['/.well-known/apple-app-site-association.json', '/.well-known/apple-app-site-association/']) {
    const r = await s.get(p);
    assert.equal(r.status, 404, p);
    assert.equal(r.headers.get('location'), null);
  }
  await s.close();
});

test('missing Android fingerprint: assetlinks fails closed (503, no body that looks valid)', async () => {
  const s = await start({ APPLE_TEAM_ID: TEAM, PORT: '0' });
  const r = await s.get('/.well-known/assetlinks.json');
  assert.equal(r.status, 503);
  assert.notEqual(r.headers.get('content-type'), 'application/json');
  assert.ok(!(await r.text()).includes('delegate_permission'));
  // The other association is unaffected.
  assert.equal((await s.get('/.well-known/apple-app-site-association')).status, 200);
  await s.close();
});

test('missing Apple Team ID: AASA fails closed (503, no placeholder appID)', async () => {
  const s = await start({ ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, PORT: '0' });
  const r = await s.get('/.well-known/apple-app-site-association');
  assert.equal(r.status, 503);
  assert.ok(!(await r.text()).includes('appIDs'));
  assert.equal((await s.get('/.well-known/assetlinks.json')).status, 200);
  await s.close();
});

test('non-GET/HEAD methods are rejected; HEAD returns headers without a body', async () => {
  const s = await start();
  const post = await s.get('/health', { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  const head = await s.get('/.well-known/assetlinks.json', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  await s.close();
});

// ---- platform-independent configuration matrix ----

const BAD_FP = 'NOT-A-FINGERPRINT-MARKER';
const BAD_TEAM = 'BADTEAM';

const MATRIX = [
  { name: 'Android only', env: { ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A }, android: 200, apple: 503 },
  { name: 'Apple only', env: { APPLE_TEAM_ID: TEAM }, android: 503, apple: 200 },
  { name: 'both valid', env: { ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: TEAM }, android: 200, apple: 200 },
  { name: 'both missing', env: {}, android: 503, apple: 503 },
  { name: 'invalid Android + valid Apple', env: { ANDROID_APP_LINK_SHA256_FINGERPRINTS: BAD_FP, APPLE_TEAM_ID: TEAM }, android: 503, apple: 200 },
  { name: 'valid Android + invalid Apple', env: { ANDROID_APP_LINK_SHA256_FINGERPRINTS: FP_A, APPLE_TEAM_ID: BAD_TEAM }, android: 200, apple: 503 },
];

for (const c of MATRIX) {
  test(`config matrix — ${c.name}: association statuses; health and preview unaffected`, async () => {
    const s = await start({ PORT: '0', ...c.env });
    const links = await s.get('/.well-known/assetlinks.json');
    const aasa = await s.get('/.well-known/apple-app-site-association');
    assert.equal(links.status, c.android);
    assert.equal(aasa.status, c.apple);
    for (const [r, marker] of [[links, 'delegate_permission'], [aasa, 'appIDs']]) {
      const text = await r.text();
      if (r.status === 503) {
        // Fail closed: no association-shaped body, no echoed input, no redirect/cookie.
        assert.ok(!text.includes(marker));
        assert.ok(!text.includes(BAD_FP) && !text.includes(BAD_TEAM));
        assert.notEqual(r.headers.get('content-type'), 'application/json');
      }
      assert.equal(r.headers.get('location'), null);
      assert.equal(r.headers.get('set-cookie'), null);
    }
    assert.equal((await s.get('/health')).status, 200);
    const page = await s.get('/preview/MatrixRef123');
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(page.headers.get('cache-control'), 'no-store');
    await s.close();
  });
}

test('invalid Android fingerprint: no part of the invalid value is emitted anywhere', async () => {
  const s = await start({ PORT: '0', ANDROID_APP_LINK_SHA256_FINGERPRINTS: `${FP_A},${BAD_FP}` });
  const r = await s.get('/.well-known/assetlinks.json');
  assert.equal(r.status, 503);
  const text = await r.text();
  assert.ok(!text.includes(BAD_FP) && !text.includes(FP_A));
  await s.close();
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './helpers.js';

const REF = 'Zk3Qw9ReferenceMarkerXyz1234567890AbCdEfGh';

async function assertGenericPage(r) {
  assert.equal(r.headers.get('content-type'), 'text/html; charset=utf-8');
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('location'), null);
  assert.equal(r.headers.get('set-cookie'), null);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp.includes("default-src 'none'"));
  assert.ok(!csp.includes("'unsafe-inline'"));
  assert.ok(!csp.includes('script-src'));
  const body = await r.text();
  assert.ok(body.includes('معاينة أَوْج على الجوال'));
  assert.ok(body.includes('lang="ar"') && body.includes('dir="rtl"'));
  return body;
}

test('/preview/{reference}: generic page, 200, no redirect, security headers, reference not in body', async () => {
  const s = await start();
  const r = await s.get(`/preview/${REF}`);
  assert.equal(r.status, 200);
  const body = await assertGenericPage(r);
  assert.ok(!body.includes(REF));
  assert.ok(!body.includes(REF.slice(0, 8)));
  await s.close();
});

test('fallback page has zero third-party or scripted content', async () => {
  const s = await start();
  const body = await (await s.get(`/preview/${REF}`)).text();
  assert.ok(!/<script/i.test(body));
  assert.ok(!/<img|<iframe|<link|<form|<a\s/i.test(body));
  assert.ok(!/https?:\/\//i.test(body));
  assert.ok(!/@import|url\(/i.test(body));
  await s.close();
});

test('body is identical for different references (nothing request-derived)', async () => {
  const s = await start();
  const a = await (await s.get('/preview/AAAA1111')).text();
  const b = await (await s.get('/preview/BBBB2222')).text();
  assert.equal(a, b);
  await s.close();
});

test('query string is ignored and never echoed', async () => {
  const s = await start();
  const r = await s.get(`/preview/${REF}?utm=QUERYMARKER&next=https://evil.example`);
  assert.equal(r.status, 200);
  const body = await assertGenericPage(r);
  assert.ok(!body.includes('QUERYMARKER') && !body.includes('evil.example'));
  await s.close();
});

test('HEAD returns the same headers with no body', async () => {
  const s = await start();
  const r = await s.get(`/preview/${REF}`, { method: 'HEAD' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(await r.text(), '');
  await s.close();
});

test('malformed references: controlled 404 with the same generic body, no echo', async () => {
  const s = await start();
  const bad = [
    `/preview/${'a'.repeat(129)}`,
    '/preview/ab%2Fcd',
    '/preview/ab-cd',
    '/preview/..',
    '/preview/MALFORMED.marker',
    '/preview/MALFORMED/extra',
    '/preview/',
  ];
  for (const p of bad) {
    const r = await s.get(p);
    assert.equal(r.status, 404, p);
    const body = await assertGenericPage(r);
    assert.ok(!body.includes('MALFORMED'), p);
    assert.ok(!body.includes('aaaaaaaa'), p);
  }
  await s.close();
});

test('128-character reference is accepted', async () => {
  const s = await start();
  assert.equal((await s.get(`/preview/${'a'.repeat(128)}`)).status, 200);
  await s.close();
});

test('unknown routes: generic 404, path not echoed', async () => {
  const s = await start();
  const r = await s.get('/some/UNKNOWNMARKER');
  assert.equal(r.status, 404);
  const body = await assertGenericPage(r);
  assert.ok(!body.includes('UNKNOWNMARKER'));
  await s.close();
});

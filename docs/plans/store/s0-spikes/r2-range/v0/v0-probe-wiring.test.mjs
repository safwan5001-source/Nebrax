// Wiring regression tests: the gates are only as good as the data fed to them. These tests read the probe SOURCE and pin the structural rules that the review findings broke.
//   node --test v0-probe-wiring.test.mjs                                   → must pass
//   V0_PROBE=<path to the pre-fix probe> node --test v0-probe-wiring.test.mjs → must FAIL (see README: `git show 0bbfb0053:…/v0-r2-range-probe.mjs > /tmp/old-probe.mjs`)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(process.env.V0_PROBE ?? join(here, 'v0-r2-range-probe.mjs'), 'utf8');
const lines = src.split('\n');

test('every request goes through hit(): there is exactly one fetch() call in the probe (an untracked fetch hides a response from R11/R13/R18)', () => {
  assert.equal((src.match(/\bfetch\(/g) ?? []).length, 1);
});
test('every hit() call site feeds track() (the 8 parallel ranges are tracked right after Promise.all)', () => {
  const sites = lines.filter((l) => /\bhit\(/.test(l) && !/^\s*async function hit\(/.test(l) && !/^\s*\/\//.test(l));
  assert.ok(sites.length >= 20);
  const untracked = sites.filter((l) => !/track\(await hit\(/.test(l) && !/Promise\.all/.test(l));
  assert.deepEqual(untracked, []);
  assert.ok(/par\.forEach\(\(r, i\) => track\(r, 'signed', `I11-\$\{i\}`\)\)/.test(src));
});
test('I9 is a signed, labelled observation that keeps its streaming body (R11 + R13 see it)', () => {
  assert.ok(/track\(await hit\(shortUrl, \{ keepBody: true \}\), 'signed', 'I9'\)/.test(src));
});
test('the exit status includes cleanup verification', () => {
  assert.ok(/process\.exit\(failed\.length \|\| !cleanup\.pass \? 1 : 0\)/.test(src));
  assert.ok(/cleanupGate\(cleanupEntries\)/.test(src));
});
test('cleanup runs in a finally block, so a thrown matrix still attempts it', () => {
  const i = src.indexOf('} finally {');
  assert.ok(i > 0 && src.indexOf("op: 'delete'", i) > i && src.indexOf("op: 'head'", i) > i);
});
test('no credential, signature or URL is ever printed: the probe has no console output that interpolates a url/signature/secret variable', () => {
  const printing = lines.filter((l) => /console\.(log|error|warn)\(/.test(l)).join('\n');
  assert.ok(!/\b(getUrl|headUrl|shortUrl|emptyUrl|tamperSig|secrets|process\.env\.S3_(KEY|SECRET))\b/.test(printing));
});

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

test('every request goes through hit() AND the upstream allow-list: no raw fetch() in the probe, exactly one guardedFetch() call (inside hit())', () => {
  assert.equal((src.match(/(?<![A-Za-z])fetch\(/g) ?? []).length, 0, 'a raw fetch() would bypass the allow-list');
  assert.equal((src.match(/\bguardedFetch\(/g) ?? []).length, 1);
  const i = src.indexOf('async function hit('); const j = src.indexOf('guardedFetch(');
  assert.ok(i > 0 && j > i, 'guardedFetch is called inside hit()');
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
  assert.ok(/process\.exit\([^\n]*failed\.length[^\n]*!cleanup\.pass[^\n]*\? 1 : 0\)/.test(src));
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

// ───────────── review round 3: redaction of everything that is retained or serialised ─────────────
test('scrub() is token-aware (credentials + every requested URL), not a regex over X-Amz-* alone', () => {
  const def = lines.find((l) => /^const scrub = /.test(l)) ?? '';
  assert.ok(/redactText\(/.test(def) && /tokens\(\)|tk/.test(def), def.slice(0, 160));
});
test('every retained provider header (value AND name) goes through scrub(): no raw `seen[k] = v`', () => {
  const assigns = lines.filter((l) => /\bseen\[[^\]]+\]\s*=/.test(l));
  assert.ok(assigns.length >= 1);
  for (const l of assigns) assert.ok(/seen\[[^\]]+\]\s*=\s*scrub\(/.test(l), l.trim());
  const names = lines.filter((l) => /allNames\.push\(/.test(l));
  assert.ok(names.length >= 1);
  for (const l of names) assert.ok(/allNames\.push\(scrub\(/.test(l), l.trim());
});
test('the result file is written ONLY from safeSerialize() output, after the sweep, and never from a bare JSON.stringify(report)', () => {
  assert.ok(!/JSON\.stringify\(report/.test(src));
  const writes = lines.map((l, i) => [l, i]).filter(([l]) => /writeFileSync\(outPath/.test(l));
  assert.equal(writes.length, 1);
  assert.ok(/serial\.text/.test(writes[0][0]) && /serial\.clean/.test(writes[0][0]));
  assert.ok(src.indexOf('safeSerialize(report') > 0 && src.indexOf('safeSerialize(report') < src.indexOf('writeFileSync(outPath'));
});
test('a thrown matrix still yields a redacted report and a nonzero exit (failure cases are serialised through the same path)', () => {
  const t = src.indexOf('try {\n  if (process.env.S3_CREATE_BUCKET'); const c = src.indexOf('} catch (e) {', t); const f = src.indexOf('} finally {', t);
  assert.ok(t > 0 && c > t && f > c, 'catch between try and finally');
  assert.ok(/fatal = scrub\(/.test(src.slice(c, f)));
  assert.ok(/\.\.\.\(fatal \? \{ fatal \} : \{\}\)/.test(src));
  assert.ok(/process\.exit\([^\n]*fatal[^\n]*serial\.sweepKinds/.test(src));
});
test('error text is never printed raw: every console.error in the probe goes through scrub()/fixed text or reports kinds only', () => {
  const errs = lines.filter((l) => /console\.error\(/.test(l));
  for (const l of errs) assert.ok(!/\be\.(message|stack)\b|\$\{e\}|\be\)/.test(l.replace(/scrub\([^)]*\)/g, '')), l.trim());
});
test('scrub() redacts tokens BEFORE the credential / account substitutions (replacing the access key id first mutates an echoed URL so the whole-URL token stops matching)', () => {
  const def = lines.find((l) => /^const scrub = /.test(l)) ?? '';
  const iTok = def.indexOf('redactText('); const iSecret = def.indexOf('secrets');
  assert.ok(iTok > 0 && iSecret > iTok, def.slice(0, 200));
});

// Evidence hygiene (review round 3): none of the COMMITTED result-*.json files may contain a credential, a signature or a signed-URL parameter. The harness redacts at the
// source (scrub) and sweeps the finished report (safeSerialize); this guards the files that actually get committed to the repository.
//   node --test v0-results-secret-scan.test.mjs
// Optionally, V0_SCAN_VALUES="v1,v2,…" adds exact values to look for (e.g. the credentials of a run you are about to commit) — values are never printed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here).filter((f) => /^result-.*\.json$/.test(f));
const extra = (process.env.V0_SCAN_VALUES ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => s.length >= 6);
const PATTERNS = [
  [/x-amz-(signature|credential|security-token)=/i, 'presign parameter'],
  [/aws4-hmac-sha256/i, 'SigV4 material'],
  [/[0-9a-f]{64}/i, '64-hex run (signature-shaped)'],
  [/accesskey1|verysecretkey1/i, 'look-alike credential'],
  [/https?:\/\/[^"\s]*\?[^"\s]*x-amz/i, 'signed URL'],
];

test('there are committed result files to scan', () => assert.ok(files.length >= 10, String(files.length)));
for (const f of files) {
  test(`${f}: no credential, signature or signed URL`, () => {
    const text = readFileSync(join(here, f), 'utf8'); const lower = text.toLowerCase();
    const hits = PATTERNS.filter(([re]) => re.test(text)).map(([, what]) => what);
    const exact = extra.filter((v) => lower.includes(v)).length;
    assert.deepEqual(hits, [], `${f}: ${hits.join(', ')}`);
    assert.equal(exact, 0, `${f}: ${exact} exact value(s) from V0_SCAN_VALUES`);
  });
}

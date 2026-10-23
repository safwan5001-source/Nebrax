// Static guard for .github/workflows/v0-r2-range-probe.yml: the only workflow that can see R2 credentials must stay manual, main-only, environment-gated and
// secret-quiet. Fails if a later edit adds an automatic trigger, widens permissions, echoes a secret or references secrets outside a step `env:` mapping.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const path = new URL('../../../../../../.github/workflows/v0-r2-range-probe.yml', import.meta.url);
const raw = readFileSync(path, 'utf8');
const yml = raw.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'); // comments may mention triggers; only live YAML counts
const lines = yml.split('\n');

test('manual only: workflow_dispatch is the single trigger', () => {
  const on = yml.slice(yml.indexOf('\non:\n'), yml.indexOf('\npermissions:'));
  const triggers = [...on.matchAll(/^  ([a-z_]+):/gm)].map((m) => m[1]);
  assert.deepEqual(triggers, ['workflow_dispatch']);
  assert.doesNotMatch(yml, /pull_request|\bpush:|schedule:|workflow_run|repository_dispatch|workflow_call/);
});

test('read-only token, main branch only, environment-gated, confirmation required', () => {
  assert.match(yml, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(yml, /:\s*(write|admin)\b/);
  assert.match(yml, /if: github\.ref == 'refs\/heads\/main' && inputs\.confirm == 'RUN-V-G1-ON-REAL-R2'/);
  assert.match(yml, /environment: r2-vg1-probe/);
});

test('secrets are referenced only as S3_* values inside step env mappings, never in run scripts', () => {
  for (const [i, l] of lines.entries()) {
    if (!/secrets\./.test(l)) continue;
    assert.match(l, /^\s+(S3_ENDPOINT|S3_KEY|S3_SECRET|S3_BUCKET|V0_SCAN_VALUES): \$\{\{ (secrets\.S3_(ENDPOINT|KEY|SECRET|BUCKET)|format\('\{0\},\{1\},\{2\}', secrets\.S3_KEY, secrets\.S3_SECRET, secrets\.S3_ENDPOINT\)) \}\}$/, `line ${i + 1}`);
  }
});

test('no step prints the environment or the secret variables', () => {
  assert.doesNotMatch(yml, /printenv|\benv\s*\||set -x|set -o xtrace|echo[^\n]*\$\{?S3_(KEY|SECRET|ENDPOINT)|cat[^\n]*\$\{?S3_/);
  assert.doesNotMatch(yml, /ACTIONS_STEP_DEBUG/);
});

test('artifacts are uploaded only after the exact-value secret scan succeeded', () => {
  assert.match(yml, /if: always\(\) && inputs\.mode == 'full' && steps\.scan\.outcome == 'success'/);
});

test('the production-bucket guard exists', () => {
  assert.match(yml, /R2_PRODUCTION_BUCKET_NAMES/);
});

test('the default mode is the cheap auth diagnosis; the full matrix needs an explicit choice', () => {
  assert.match(yml, /mode:[\s\S]*?default: diagnose-auth/);
  const full = ['id: vh', 'id: ps', 'id: scan', 'id: decision'];
  for (const id of full) {
    const at = yml.indexOf(id);
    assert.ok(at > 0 && /inputs\.mode == 'full'/.test(yml.slice(at, at + 120)), `${id} must be gated on mode == full`);
  }
  assert.match(yml, /id: diag\n\s+if: inputs\.mode == 'diagnose-auth'/);
});

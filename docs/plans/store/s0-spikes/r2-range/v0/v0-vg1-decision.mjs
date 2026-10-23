// V-G1 decision per PR #1551 §4.6 (docs/reports/AWJ_ANIMATED_MEDIA_PHASE2_READINESS.md). Reads a finished V0 probe report and applies the gate table to the RECORDED SUB-RESULTS,
// never to the combined per-case `pass` (that also folds in headers the proxy replaces: Accept-Ranges, ETag, Content-Type, Last-Modified).
//
//   node v0-vg1-decision.mjs result-r2-virtualhosted.json [more.json …]     → prints a markdown table, exit 0 only if every report is GO
//
// Pure `decide(report)` is exported for tests. Nothing here reads credentials or URLs; it only reads the already-redacted report.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** What the proxy consumes from R2 for the requests it sends (§4.6 "Gate — what the proxy consumes"). */
export const CONSUMED_CASES = ['R1', 'R2', 'R3', 'R4', 'R10'];
/** Security gates, independent of range handling (R13 is scoped separately below). */
export const SECURITY_CASES = ['R14', 'R15a', 'R15b', 'R15c', 'R15d', 'R16a', 'R16b', 'R17', 'R18', 'R19', 'R20'];
/** R13 scope: signed GETs the production proxy actually sends — full GET and normalised closed in-bounds ranges. A 3xx on any other shape is recorded, not gating. */
export const PRODUCTION_SHAPED_IDS = new Set(['R1', 'I9', 'R2', 'R3', 'R4', 'R10', 'R14-before', 'R16a-after', 'R16b-after', ...Array.from({ length: 8 }, (_, i) => `I11-${i}`)]);
/** Recorded as evidence only; can never fail V-G1 (§4.6 diagnostic rows). */
export const DIAGNOSTIC_CASES = ['R5', 'R6', 'R7', 'R8', 'R9', 'R11'];

const CONSUMED_CHECKS = (id) => ['statusOk', 'contentLengthOk', ...(id === 'R1' ? [] : ['contentRangeOk']), 'noContentEncoding', 'bodyLengthOk', 'bodyHashOk'];

export function decide(report) {
  const byId = new Map((report.results ?? []).map((r) => [r.id, r]));
  const rows = []; // {condition, verdict: 'PASS'|'FAIL'|'UNVERIFIED'|'NOTE', evidence}
  const add = (condition, verdict, evidence) => rows.push({ condition, verdict, evidence });

  // 0. The run must be real R2, complete, and not fatal.
  const host = String(report.endpointHost ?? '');
  const realR2 = report.provider === 'remote S3 API' && /(^|\.)r2\.cloudflarestorage\.com$/.test(host);
  add('Real Cloudflare R2 (not a local look-alike)', realR2 ? 'PASS' : 'FAIL', `provider=${report.provider}; endpointHost=${host || 'n/a'}`);
  add('Matrix ran to completion (no fatal)', report.fatal ? 'FAIL' : 'PASS', report.fatal ? 'fatal recorded' : 'no fatal');

  // 1. What the proxy consumes, per request it sends.
  for (const id of CONSUMED_CASES) {
    const r = byId.get(id);
    const gate = r?.observed?.gate?.consumed;
    if (!r) { add(`${id}: consumed properties`, 'FAIL', 'case missing from the report'); continue; }
    if (!gate) { add(`${id}: consumed properties`, 'UNVERIFIED', 'report has no recorded sub-results (harness older than the §4.6 recording change)'); continue; }
    const failing = CONSUMED_CHECKS(id).filter((k) => gate[k] !== true);
    add(`${id}: status, Content-Length${id === 'R1' ? '' : ', Content-Range'}, no Content-Encoding, body length + hash`, failing.length ? 'FAIL' : 'PASS', failing.length ? `failed: ${failing.join(', ')}` : 'all sub-checks true');
  }
  const r12 = byId.get('R12');
  add('R12: no Content-Encoding on full and ranged responses', r12?.pass === true ? 'PASS' : r12 ? 'FAIL' : 'FAIL', r12 ? JSON.stringify(r12.observed) : 'case missing');

  // 2. Security gates.
  for (const id of SECURITY_CASES) {
    const r = byId.get(id);
    add(`${id}: ${r?.description ?? 'security case'}`, r?.pass === true ? 'PASS' : 'FAIL', r ? `pass=${r.pass}` : 'case missing');
  }
  // R13, scoped to production-shaped requests (§4.6 "R13 scope").
  const r13 = byId.get('R13');
  if (!r13) add('R13: no 3xx on the signed GETs the proxy sends', 'FAIL', 'case missing');
  else {
    const all = r13.observed?.signed3xx ?? [];
    const gating = all.filter((o) => PRODUCTION_SHAPED_IDS.has(o.id));
    const diag = all.filter((o) => !PRODUCTION_SHAPED_IDS.has(o.id));
    add('R13: no 3xx on production-shaped signed GETs (full GET, closed ranges)', gating.length ? 'FAIL' : 'PASS', gating.length ? `3xx on ${gating.map((o) => `${o.id}:${o.status}`).join(', ')}` : `${r13.observed?.signedRequests ?? '?'} signed requests observed; none gating`);
    if (diag.length) add('R13 (diagnostic shapes): 3xx recorded, investigate, not gating', 'NOTE', diag.map((o) => `${o.id}:${o.status}`).join(', '));
  }
  // 3. Cleanup is verified, not assumed.
  add('Cleanup verified (every disposable object deleted and confirmed gone)', report.cleanedUp === true ? 'PASS' : 'FAIL', `cleanedUp=${report.cleanedUp}`);
  add('Upstream allow-list refused no signer URL', (report.upstreamGuard?.requestsRefused ?? 0) === 0 ? 'PASS' : 'FAIL', `requestsRefused=${report.upstreamGuard?.requestsRefused}`);

  // 4. Diagnostic cases: evidence only.
  for (const id of DIAGNOSTIC_CASES) {
    const r = byId.get(id);
    if (r) add(`${id} (diagnostic, cannot fail V-G1)`, 'NOTE', `harness pass=${r.pass}`);
  }
  for (const id of CONSUMED_CASES) {
    const d = byId.get(id)?.observed?.gate?.diagnosticOnly;
    if (d) add(`${id} synthesised-header evidence (diagnostic, cannot fail V-G1)`, 'NOTE', Object.entries(d).map(([k, v]) => `${k}=${v}`).join(', '));
  }

  const failed = rows.filter((r) => r.verdict === 'FAIL');
  const unverified = rows.filter((r) => r.verdict === 'UNVERIFIED');
  const verdict = failed.length ? 'NO-GO' : unverified.length ? 'NO-GO (unverified)' : 'GO';
  return { verdict, label: report.label, runId: report.runId, rows, failed: failed.map((r) => r.condition), unverified: unverified.map((r) => r.condition) };
}

export function toMarkdown(d) {
  const lines = [`### V-G1 decision — ${d.verdict}  (label \`${d.label}\`, run \`${d.runId}\`)`, '', '| Condition | Verdict | Evidence |', '|---|---|---|'];
  for (const r of d.rows) lines.push(`| ${r.condition.replace(/\|/g, '/')} | ${r.verdict} | ${String(r.evidence).replace(/\|/g, '/').slice(0, 200)} |`);
  return lines.join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error('usage: node v0-vg1-decision.mjs result-<label>.json [...]'); process.exit(2); }
  let ok = true;
  for (const f of files) {
    const d = decide(JSON.parse(readFileSync(f, 'utf8')));
    console.log(toMarkdown(d) + '\n');
    if (d.verdict !== 'GO') ok = false;
  }
  process.exit(ok ? 0 : 1);
}

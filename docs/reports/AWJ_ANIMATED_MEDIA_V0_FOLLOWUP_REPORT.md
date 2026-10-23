# AWJ Animated Media — V0 / R2 follow-up (PR #1558 open findings + V-G1 status)

## Verdict (read this first)

| Stage | Status | Evidence |
|---|---|---|
| 1. Local simulation | **Completed** (in #1558) — 24/24 required cases on a SigV4-validating look-alike, fault injection, 104 tests. Re-verified on this PR's branch: 125 tests **and a fresh 24-case run on the Scality look-alike** (independent verification session, §4) | `result-selftest-scality.json`, report §5/§5a |
| 2. Real Cloudflare R2 test | **NOT performed.** No `result-r2-*.json` exists in the repository, no later PR or report records one | search of `main`, PR search, `ls …/v0` |
| 3. V-G1 formally approved | **NO.** V-G1 is defined as passing on real R2 (readiness review #1551, still open/unmerged) — gate not met | report §11 |
| 4. MP4/WebM implementation | **NOT done.** No video endpoint, DB change, UI. Verdict stays **NO-GO** | report §11 |
| 5. Production deployment | **Not applicable / not verified.** Nothing was deployed | — |

**Both open P2 findings are fixed** (P2-A I9 status, P2-B I10 host classification) with regression tests that fail on the pre-fix code. This does **not** change the V-G1 verdict.

| | |
|---|---|
| Branch | `claude/animated-media-v0-r2-followup` |
| PR | [#1646](https://github.com/safwan5001-source/Nebrax/pull/1646) (not merged) |
| Base SHA | `e59d29bac7d67fd55016fa5a1b0e859a748e2c09` (`origin/main` at branch time) |
| Code commit | `e619fdf857ea9366d21999f11e1f3cabbbb864e1` |
| Head SHA | see the PR head (this report is part of the head commit) |

## 1. Current-state verification

* **#1558:** closed/merged 2026-10-17T14:08:45Z; merge commit `5732917baf130450d1b4b5a8fdcd89ed65c47465` is an ancestor of `main` (verified). Title: "V0 R2 presigned Range feasibility — harness + report (real R2 not run)".
* **Review threads on #1558:** 11 total — **9 resolved** (R13 I10 redirect, R18 header values, R11 ETag coverage, I9 tracking, cleanup exit status, I9 report accuracy, retained-header redaction, failed upload abort, allow-list before request) and **2 unresolved at merge**, both created after the round-3 fix commit and never answered:
  * **P2-A** — `v0-i9-experiment.mjs` line 45: non-200 download starts accepted (`PRRT_kwDOS52FT86tgn9g`)
  * **P2-B** — `v0-gates.mjs` line 119: `endsWith` host suffix matching (`PRRT_kwDOS52FT86tgn9j`)
* **Already fixed later?** No. Both defects were reproduced in current `main` (the files are unchanged since #1558; the only other commit touching the directory is the bulk import `ba2a6dc`). Pre-fix experiment exit code on an HTTP 403 download URL: **0** (observed).
* **Subsequent PRs / reports completing V-G1:** none. The only related PR is **#1551** (Phase 2 readiness review — the document that *defines* V-G1 and approvals #7/#11): still **open, unmerged**, docs only. No R2 result file, no token request fulfilled, no report claiming completion.
* **Real-R2 prerequisites in this sandbox:** no `S3_*`/`R2_*` variables. The sandbox does expose `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, which are **not documented as R2 test credentials**; as in #1558 they were **not used and not printed**. No bucket, token or infrastructure was created or modified.

## 2. Completed work

### P2-A — I9 HTTP status validation (`v0-i9-experiment.mjs`)
* After `guardedFetch` returns, `status !== 200` ⇒ `aborted = "download URL answered HTTP <n>, not 200 — the in-flight download was not tested"`; the body is **cancelled, never read**. This covers 403/404/500/503 and also 206 and 3xx (no `Range` is sent, so only a plain 200 is a download).
* A failure **before any response** (connection refused/DNS/TLS) also aborts. An error **after** a 200 began (e.g. `UND_ERR_SOCKET`) is still recorded as the observation the experiment exists to make.
* An aborted run reports **no rows** (a row recorded for the first URL is discarded when the second fails), exits **1**, and cleanup is still attempted and verified (`finally`).
* Structural pin: the `status !== 200` check precedes the body loop; still zero raw `fetch(`.

### P2-B — exact redirect host classification (`v0-gates.mjs`, `v0-upstream-guard.mjs`)
* `classifyLocation(location, policy)` — `same-host-https` iff the parsed hostname is **exactly** a permitted hostname, on the endpoint's port, with no userinfo; otherwise `other-host-https`; non-https ⇒ `non-https(<scheme>)`. No URL, host or signature is ever returned.
* Permitted hostnames (`permittedHostnames`, shared with `allowedUpstream`):
  1. the configured endpoint host, which must itself be an R2 S3 endpoint — `<account>.r2.cloudflarestorage.com`, `<account>.eu.…`, `<account>.fedramp.…`, `<account>.us.…` (the documented jurisdictions; a **single** account label, so `evil.<account>.r2…` is not an endpoint) — or, for the self-test only (`allowInsecureLoopback`), the loopback IP/`localhost` the owner configured;
  2. `<bucket>.<endpoint host>` for a valid DNS-label bucket, never for an IP literal/`localhost`.
  An endpoint that is not one of those formats permits **no** host (fail closed). An invalid bucket adds nothing.
* Rejected look-alikes (all tested): `evilacct.<endpoint>` (the finding), `evil.<account>.<endpoint>`, other bucket, `<endpoint>.evil.example`, endpoint host as a path of another host, userinfo tricks, trailing-dot FQDN, other port, `acct2`, hyphen-joined, IP literal, protocol-relative.
* **Redirects are never followed**: `guardedFetch` forces `redirect: 'manual'`; new test: an allowed host answering `302 → look-alike` leaves the look-alike listener at **0 connections**.
* The probe's only change: the `classifyLocation` call passes `upstreamPolicy` instead of a bare hostname (one line).
* `regression/legacy-gates.mjs` now carries the **old suffix classifier** so the I10 tests can be shown failing on the pre-fix logic.

## 3. Changed files

`docs/plans/store/s0-spikes/r2-range/v0/`: `v0-i9-experiment.mjs` · `v0-gates.mjs` · `v0-upstream-guard.mjs` · `v0-r2-range-probe.mjs` (1 line) · `regression/legacy-gates.mjs` · `v0-i9-experiment.test.mjs` · `v0-gates.test.mjs` · `v0-upstream-guard.test.mjs` · `README.md`
`docs/reports/`: `AWJ_ANIMATED_MEDIA_V0_R2_RANGE_REPORT.md` (new §5c + status ladder) · this report.
No application code, migration, API, tenant-isolation, accounting or infrastructure file.

## 4. Tests and results (all local, hermetic — not R2)

| Check | Result |
|---|---|
| `node --test v0-gates v0-probe-wiring v0-i9-experiment v0-results-secret-scan v0-upstream-guard` | **125 pass / 0 fail** (the 104 previous tests all still pass; +21 new) |
| New I9 tests (HTTP 403, 404, 500, 503, 206, 301, 302, 304; second URL failing; connection refused; valid 200; source pin) | pass on the fix; **11 of the 22 I9 tests fail on the pre-fix experiment** (e.g. 403 → expected exit 1, actual **0**) |
| New I10 tests (positive formats, 14 look-alike/attacker hosts, unrecognised endpoint/bucket fails closed, loopback only with self-test flag) | pass; the 3 new classification tests **fail on the legacy suffix logic** |
| New guard tests (`permittedHostnames`, non-R2 endpoint permits nothing, bad bucket adds nothing, redirect to look-alike not followed) | pass |
| Offline `--hostlist` | **15/15** unchanged · `--plan` intact |
| Secret scan of every committed `result-*.json` + new outputs | clean (no credential, signature, signed URL); no new result file committed |
| 24-case look-alike (Scality) full run & fault-injection reruns | **Repeated in an independent verification session** (Docker + `zenko/cloudserver`, branch head `3c7a8052d`): **24/24 required**, cleanup verified, 35 ETag observations, 42 signed requests, 0 value leaks, 51 requests allowed / 0 refused; faults re-run: `redirect-http` exit 0 (I10 → `same-host-https` on the exact-hostname classifier), `redirect-signed` exit 1 (R3/R13/R11), `leak-etag` exit 1 (R18/R11 FAIL, 0 sensitive strings in the file), `block-delete` exit 1 (cleanup not verified); I9 experiment on the look-alike exits 0 with both rows. Independent adversarial check of `classifyLocation` (17 hosts incl. look-alike prefix/suffix, extra label, userinfo, port, trailing dot, IDN homoglyph, other jurisdiction, hostile endpoint, invalid bucket) — only the configured host, `<bucket>.<host>` and a percent-encoded dot that the URL parser decodes to the same host are `same-host-https`. Reproduced both defects on `main`: I9 → 11 of 22 new tests fail on the main experiment; `classifyLocation('https://evilacct.r2…', 'acct.r2…')` → `same-host-https` on main. Cloudflare's R2 tokens page confirms the four endpoint forms (default, `eu`, `fedramp`, `us`). Nothing from these runs was committed |

## 5. CI status
PR #1646 changes only docs and `.mjs` spike files. The `node --test` suites of this harness are **not run by any workflow** (verified: no workflow references `s0-spikes` or `node --test`) — the evidence above is local. Repository CI results for the PR head are recorded on the PR.

## 6. Security findings
* Fixed: false-success exit on a non-200 download URL (P2-A); look-alike host misclassified as the configured host (P2-B) — evidence-corruption class, not an exploitable request path (the guard already refused non-allowed hosts before connecting and never followed redirects).
* Hardening: the guard's `allowedUpstream` is now **narrower** (the configured endpoint must be an R2 format or the self-test loopback; invalid bucket names add no host). Fail-closed; behaviour for the owner's real R2 endpoint is unchanged (15/15).
* Gap noted, not changed: the harness tests are not in CI (recommend a tiny `node --test` job so these guards cannot regress silently).
* No sensitive data in this report, the logs or committed files; the ambient `AWS_*` variables were not used.

## 7. Outstanding blockers (to reach V-G1) — owner action, unchanged from report §6
1. A **new private empty R2 test bucket** (no public access/custom domain) — approval #11.
2. An R2 API token **scoped to that bucket only** (Object Read & Write, short expiry), supplied as **sandbox environment variables** `S3_ENDPOINT`, `S3_KEY`, `S3_SECRET`, `S3_BUCKET`, `S3_REGION=auto` (not pasted in chat).
3. **Outbound HTTPS** to `*.r2.cloudflarestorage.com` and `<bucket>.<account>.r2.cloudflarestorage.com` (unverified here).
   *Or* run the README commands yourself and return only the credential-free `result-r2-*.json`.
4. Then, per README: two runs (`S3_PATH_STYLE=1` and `0`), apply the §7 decision rules, revoke the token, delete the bucket.
5. Later/separate: approvals #6 (authorise endpoint) and #7 (AMEND-1 ADR), and the merge decision on #1551.

## 8. V-G1 completion verdict
**V-G1: NOT COMPLETE — not run on real R2, not approved.** The harness is hardened and trustworthy for when real credentials exist; it proves nothing about R2 itself. Video (MP4/WebM) remains **NO-GO**; Laravel streaming remains rejected.

## 9. Recommended next action
Provide the R2 prerequisites (§7) or run the harness yourself; meanwhile approve/merge #1646 (docs/spike only, no production effect). Optionally add a small CI job running the 125 `node --test` tests.

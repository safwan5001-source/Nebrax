# REM-11 / D-03 — Implementation Report: advisory offline ZATCA SDK conformance harness

| | |
|---|---|
| Status | **MERGED** (PR #1416, merge `cb87e17d7583d8b24eab76e87ae5dad1d78484b3`, 2026-10-14T02:42:50Z) · **CI verified** · **Production deployment NOT VERIFIED** (status corrected 2026-10-14; at authoring this was a Draft, not merged) |
| Base | `main` @ `22f2ee5` (includes REM-03b `322c20c`) |
| Code head evidenced below | `9a7bc235df64c3524281cb19c41f63f9601a0d2e` (earlier heads `66687c5`, `c662bcc` are documented as findings in §5/§9a) |
| Final-head CI status | Posted as a PR comment after the last push (this report is a docs-only commit on top of the code head and cannot name its own SHA) |
| Zone | C (tax / ZATCA) — no financial, VAT, ICV, PIH, QR, XML-generation, transport, schema, route or permission change |
| Evidence class | Local runs are labelled **local**; GitHub-hosted-runner runs are labelled **runner** with run/job IDs |

---

## 0. Lifecycle status (post-merge correction, 2026-10-14)

| Stage | State | Evidence |
|---|---|---|
| Implementation completed | ✅ | Advisory workflow, `scripts/zatca-sdk/` (66 unit tests), 3 AWJ fixtures + baseline, digest-based drift test |
| PR merged | ✅ | PR #1416, merge SHA `cb87e17d7583d8b24eab76e87ae5dad1d78484b3` (contained in `origin/main`); approved trigger = path-filtered `push` + `workflow_dispatch` |
| CI verified | ✅ | Final PR head `ac72e0a7a071b3e65c6f57be87351fbd11256e18`: `php artisan test (L11, sqlite)` ✅, `(L11, pgsql)` ✅, `CI Gate` ✅ (PR comment). Advisory jobs ✅ on code head `9a7bc23` (run 38498583686). Post-merge on `main` at the merge commit: `CI` push run success (38502470576) and `ZATCA SDK conformance (advisory)` push run success (38502470621) |
| Production deployment | **NOT VERIFIED** | No deployment evidence reviewed; nothing here deploys anything — the harness is a CI-only advisory check |
| Open items | **D-03a OPEN** | Legal / terms questions remain open (§8): no SDK vendoring, caching, mirroring, redistribution or promotion to blocking without counsel/ZATCA clarification. `CI Gate` / `required-checks.json` unchanged by design (D-03e) |

The harness is an **advisory development oracle**, not a statement of ZATCA Phase 2 compliance or production readiness. Sections below are the report as authored; where they say "Draft" or "not merged" the lifecycle above supersedes them.

---

## 1. Verdict

The harness is **operational on a real GitHub-hosted runner** (advisory, non-required), with two things the owner must know:

1. **Deviation from D-03f — trigger is `push`, not `pull_request`.** The first version used `pull_request` + `paths`. The mandatory **CI Gate failed on it**: the gate's own self-test `scripts/ci-gate/test_ci_gate.py::Validation::test_repo_is_clean` asserts there are *zero* unclassified PR-triggered jobs, and D-03e forbids editing the manifest. So a `pull_request`-triggered advisory job cannot coexist with D-03e. I did **not** weaken the gate; I removed the `pull_request` trigger (path-filtered `push` on all branches + `workflow_dispatch`), which shows the same checks on the PR head SHA and never enters the gate's discovery. A guard test prevents re-adding `pull_request`. The alternative (classify the two jobs as `advisory` in `required-checks.json`, then restore `pull_request` + `paths`) is a two-entry gate-config change that needs your approval.
2. **D-03a legal / terms questions are still open** (section 8). The official download page contains no prohibition on automated use, but it has an interactive "I accept the above terms" step that a CI download does not perform. Recorded as outstanding; not resolved by this PR.

## 2. Owner decisions applied

| ID | Decision | Implementation |
|---|---|---|
| D-03a | Technical evaluation only; no vendoring, mirroring, caching, redistribution | No SDK byte is committed, cached or uploaded. Terms reviewed (§8): nothing explicitly prohibits the intended use → proceed. |
| D-03b | Fail closed on download failure; no unverified fallback | `fetch_sdk.py` exit 10 (integrity) / 11 (unavailable) / 12 (unsafe archive); no fallback source. **Runner-proven** (§5, probe 1). |
| D-03c | Committed AWJ synthetic XML + tracked drift test | `tests/Fixtures/zatca-sdk/awj/*.xml` + `tests/Feature/ZatcaSdkFixtureDriftTest.php` (DB-free; digest-based in CI, see §9a). |
| D-03d | Step Summary + AWJ-owned metadata only | Markdown to `$GITHUB_STEP_SUMMARY`; AWJ result JSON in a log group. No artifact/cache action exists (guard-tested). |
| D-03e | No CI Gate manifest / required-check changes | Untouched. This is what forced the trigger deviation (§1). |
| D-03f | Path-filtered triggers + dispatch, no schedule | Path-filtered `push` + `workflow_dispatch`; no schedule. **`pull_request` dropped** (§1). |
| D-03g | SHA-pin actions | `actions/checkout@11bd719…` (v4.2.2), `actions/setup-java@c5195ef…` (v4.7.1); guard-tested. |

## 3. What was built

| Path | Purpose |
|---|---|
| `.github/workflows/zatca-sdk-conformance.yml` | Two jobs: `ZATCA SDK harness self-test (advisory)` (no network/SDK/Java) and `ZATCA SDK conformance (advisory)`. `permissions: contents: read`, no secrets, `persist-credentials: false`. |
| `scripts/zatca-sdk/sdk-pin.json` | Version `238-R3.4.8`, official link, host lock, SHA-256, size, extract allowlist, JDK major, JVM flags. |
| `scripts/zatca-sdk/fetch_sdk.py` | GET-only download from the pinned host (redirect-host-locked), size+SHA-256 verified **before** extraction, allowlisted/safe extraction. |
| `scripts/zatca-sdk/conformance.py` | Isolation proof, SDK run (`-validate` only), output parser (exit code not trusted), official-sample checks, AWJ ratchet, mutation + ratchet liveness controls, summary/metadata, local-only `update-baseline`. |
| `scripts/zatca-sdk/tests/*` | 66 stdlib unit tests (parser, ratchet, tamper, archive safety, source failure, repo guards). |
| `tests/Fixtures/zatca-sdk/awj/*.xml`, `baseline.json` | 3 synthetic AWJ fixtures + expected-failure baseline (per stage: status + error-code set). |
| `tests/Feature/ZatcaSdkFixtureDriftTest.php` | Regenerates the fixtures from fixed synthetic data via `ZatcaService` and compares the SHA-256 with an embedded `DIGESTS` table (byte-for-byte too where the files exist); DB-free; runs in the mandatory backend suite. |
| `docs/engineering/ZATCA-SDK-CONFORMANCE.md` | Runbook: ratchet rules, update workflow, security model, legal status, rollback. |

**Untouched:** `.github/workflows/ci.yml` and all other workflows, `ci-gate.yml`, `.github/ci-gate/**`, `scripts/ci-gate/**`, `app/**`, migrations, routes, permission catalogue, every GitHub setting.

## 4. Design facts verified (SDK 238-R3.4.8)

| Fact | Evidence |
|---|---|
| Source: SharePoint sharing link from `https://sandbox.zatca.gov.sa/env-config.js` (`REACT_APP_DOWNLOAD_SDK_JAVA`); anonymous GET with in-memory cookies and `download=1` works | local + **runner** (4 s) |
| 49,169,499 bytes, SHA-256 `91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6` | local + **runner** `integrity OK` |
| Needs JDK 11 (`>=11,<15`); Temurin 11.0.32+1 in both local and runner | local + **runner** |
| `-validate` exits **0** on `GLOBAL VALIDATION RESULT = FAILED`; missing input → usage text, exit 1, no marker | local (parser tests encode both) |
| All 19 bundled samples pass every reported stage offline; only warning `BR-KSA-98` on the 5 simplified samples; standard samples report 4 stages (no QR/SIGNATURE) | local + **runner** (19/19 OK) |
| Shipped `config.json` has Windows paths; `defaults.json` has wrong `schematrons` casing; `install.sh` edits shell profiles → harness writes its own `SDK_CONFIG` and never runs `install.sh` | local |
| `/sys/class/net` is **not** namespace-aware (showed host NICs inside `unshare -n`); `/proc/net/dev` is. The first canary used `/sys` and correctly refused to run — fixed to `/proc/net/dev` | local (caught by the canary itself) |

## 5. Mandatory-condition evidence

### Condition 1 — offline execution and isolation on a real GitHub-hosted runner

Run `38498583686` (push, code head `9a7bc23`), job `115639952446`: **success**. Earlier runs with identical harness logic: `38497184712` / job `115635577028` (push, `c662bcc`) and PR-event run `38496887079` / job `115634651086` (`66687c5`): **success**. The runner evidence below is from run `38496887079`; the later runs reproduce it.

| Item | Runner evidence |
|---|---|
| Runner | `ubuntu-latest`, kernel `6.17.0-1022-azure`, Python 3.12.3, Temurin `11.0.32+1`, user `runner` (uid 1001), passwordless sudo |
| Host interfaces outside | `lo, eth0, ens1, docker0` |
| `kernel.apparmor_restrict_unprivileged_userns` | `1` → `unshare -n` and `unshare -rn` are **denied** (`Operation not permitted`) |
| Positive control, outside namespace | `curl https://api.github.com/zen` → **200** |
| Same request inside `sudo -n unshare -n` | `curl: (6) Could not resolve host` (rc 6) |
| Harness proof (same command chain as the SDK) | `sudo -n unshare -n setpriv --reuid=1001 --regid=1001 --clear-groups → interfaces=['lo'], 3 outbound connects refused` |
| Payload privileges | SDK runs as uid 1001 (root dropped with `setpriv`), env scrubbed (`env -i`, no token/proxy variables) |
| Result | AWJ fixtures `OK` ×3; official samples 19/19 `OK`; mutation liveness ✅; ratchet controls ✅ |

Not claimed: egress restriction during the *download* step (hosted runners cannot limit egress to one URL). The download is a single `GET` to the pinned host; nothing from the repo, tenant or any credential is sent.

### Condition 2 — PR-triggered vs dispatch

`workflow_dispatch` was not relied on. Validation ran from an unmerged branch through event-driven runs only (PR event first, then push). Result: PR-triggered is **incompatible with the gate** (§1); push-triggered works and is shown on the PR.

### Condition 3 — cannot cause an existing mandatory CI / CI Gate failure

| Finding | Detail |
|---|---|
| **Failure observed** | With `pull_request`, CI Gate run `38496887241` **failed**: `test_repo_is_clean … unclassified PR checks exist` (two warnings promoted to a failure by the gate's own test). My earlier statement that "unclassified jobs only warn" was true for `ci_gate.py validate` but **not** for the gate's self-test. |
| Fix | Removed `pull_request`; guard test `test_no_pull_request_trigger_…`. |
| Verified locally | `python3 scripts/ci-gate/ci_gate.py validate` → `OK` with **no warnings**; `python3 -m unittest discover -s scripts/ci-gate` → 72 tests OK. |
| Gate semantics | `restrict_to_declared_workflows` ignores undeclared workflows' check runs, so even a failing advisory job cannot change the gate verdict. |
| Remaining exposure | `ZatcaSdkFixtureDriftTest` runs **inside the mandatory backend suite by design (D-03c)**: a change to `ZatcaService` XML output without updating the `DIGESTS` table will fail `php artisan test` (proven locally: a one-token generator mutation turned 3 tests red; reverted). It is DB-free and deterministic. See §9a for the first-run failure it had. |

### Condition 4 — repository-wide CI and settings preserved

No existing workflow, gate file or setting was edited (diff in §3). Branch deletion of my throw-away probe branch was refused by the environment's git proxy; I did not attempt to bypass it (§9).

### Condition 5 — no taxpayer data, credentials, OTP, CSID, ZATCA API traffic

Fixtures use only the synthetic VAT `300000000000003` (guard-tested); no secrets referenced (guard-tested); `-validate` is the only SDK flag (code allowlist + guard). The SDK's own dummy test cert/key exist only in the runner temp dir. The only outbound call is the `GET` of the public SDK link (and, in the evidence step, an unauthenticated `GET https://api.github.com/zen`).

### Condition 6 — STOP rules

SDK acquisition validated on the runner; runner isolation validated; terms reviewed with no explicit prohibition; the advisory contract needed a trigger change (§1) which is reported, not hidden.

## 6. Failure-mode tests

| # | Test | Where | Result |
|---|---|---|---|
| 1 | Pin SHA off by one hex char | unit; **runner probe** (`c0d3612`, run `38497365727`, job `115636159344`) | exit **10** `SDK_FETCH_FAILED[10]: sha256 91d0… != pinned 01d0…`; "Isolation" and "Validate" steps **skipped** |
| 2 | Flipped byte / truncated / size mismatch | unit | exit 10, nothing extracted |
| 3 | Zip-slip, absolute path, symlink, missing jar | unit | exit 12 |
| 4 | HTTP 403, URLError, HTML sign-in page, oversize, non-zip, foreign host, redirect off-host, non-https pin | unit | exit 11 / 2, fail closed |
| 5 | Request shape: GET, pinned host, `download=1`, only `User-Agent`/`Accept` | unit | pass |
| 6 | Parser: PASSED+warning, FAILED with exit 0, usage+exit 1 (no marker), empty, truncated, duplicate marker, inconsistent global, unknown stage, CODE before stage, repeated stage | unit | each classified correctly; marker problems are harness errors |
| 7 | Ratchet: unexpected pass, vanished code, new code, regression, stage added/removed, unknown/missing fixture, sample-set drift | unit; **runner probe 2** (`ba363b8`, run `38497506427`, job `115636599178`) | verdicts `REGRESSION` and `STALE_BASELINE`; job failed, `"ok": false` |
| 8 | Mutated official sample must fail QR + SIGNATURE (`IssueTime` 17:41:08→17:41:09) | local + **runner** every run | ✅ |
| 9 | Real results vs 6 deliberately wrong baselines must all be rejected | local + **runner** every run | ✅ |
| 10 | Only `-validate` allowed; scrubbed env; no isolation ⇒ refuse; leaky candidate rejected; unisolated override refused on CI; `update-baseline` refused on CI | unit | pass |
| 11 | Workflow guards: SHA-pinned actions, `contents: read`, no secrets/`pull_request_target`/cache/artifact/schedule, no `pull_request`, `persist-credentials: false` | unit (also in CI self-test job) | pass |
| 12 | Repo guards: no key/cert material, no `.jar/.zip/.pem/.xsl`, only synthetic VAT | unit | pass |

## 7. Test and CI results

| Check | Result |
|---|---|
| Harness unit tests (local) | `python3 -I -m unittest discover -s scripts/zatca-sdk/tests -t scripts/zatca-sdk` → **66 OK** |
| Harness unit tests (runner) | job `ZATCA SDK harness self-test (advisory)` success on every run |
| Fixture-drift test (local) | `ZatcaSdkFixtureDriftTest` 4 tests / 7 assertions pass **in an overlay without the fixture directory** (the CI situation); with the files present it also compares byte-for-byte. Mutation check: changing one token in `ZatcaService::buildXml` → 3 failures with the drift message; reverted. |
| Full backend suite, local sqlite (`DB_DATABASE=:memory:`, run on the pre-digest version of the drift test with fixtures present) | 38 failed / 73 skipped / **6594 passed**. The 38 failures are the known environmental set (no `bcmath`, mail/queue config: Fuel*, AuthRecovery, UserInvitation, ResendMailTransport) — **identical failing-test list to the pre-change run** (`diff` empty). Authoritative backend results are the CI jobs below. |
| CI Gate self-tests (local) | 72 OK; `ci_gate.py validate` → OK, no warnings |
| Code head `9a7bc23` — CI on GitHub (this is the head the evidence above refers to) | `php artisan test (L11, sqlite)` ✅ job `115639912790` (run `38498589329`) · `php artisan test (L11, pgsql)` ✅ job `115639912877` · `CI Gate` ✅ job `115639912326` (run `38498589303`) · `ZATCA SDK harness self-test (advisory)` ✅ job `115639895100` · `ZATCA SDK conformance (advisory)` ✅ job `115639952446` (run `38498583686`) |
| Earlier head `c662bcc` | `php artisan test (L11, pgsql)` ❌ (drift test could not see its fixtures in the CI overlay → §9a), `CI Gate` ❌ (consequence of the red required check) — fixed in `9a7bc23` |
| Earlier head `66687c5` | `CI Gate` ❌ — unclassified PR-triggered jobs (→ §5 Condition 3) — fixed in `c662bcc` |
| Final head (report commit on top of `9a7bc23`) | Docs-only; its CI table is posted as a PR comment once those runs finish |

## 8. Legal / terms (D-03a) — outstanding, not resolved

| Verified | Not resolved |
|---|---|
| `LICENSE.txt` in the SDK is LGPL-3.0 text; no named licensor, no NOTICE, no separate EULA found. | Is ZATCA the licensor? Does it cover the whole fat jar (which shades third-party libraries)? |
| Official download page (`zatca.gov.sa/…/DownloadSDK.aspx`, read 2026-10-14) lists conditions A–C (compliance only after verification; Integration-Phase requirements still apply; passing the SDK ≠ ZATCA approval) and an acceptance statement. **No text on automated use, CI, caching or redistribution.** | The page requires ticking "I accept the above terms and conditions" before download; a CI `GET` does not perform that step. Does the organisation's acceptance cover automated retrieval? |
| Portal `sandbox.zatca.gov.sa` returns 403 to this tooling; its terms (if any) could not be read. | Long-term stability of the SharePoint link; any SharePoint-side terms. |
| Running the jar in CI without distributing it is not distribution (my reading, not counsel's). | Whether temporary extraction to the runner's disk and the SDK's dummy cert/key are "use" only — expected yes. |

Per your rule: nothing explicit prohibits the intended use, so evaluation proceeded; **stop and ask counsel/ZATCA before** vendoring, mirroring, caching, artifact upload, or promoting this to a blocking check.

## 9. Known limitations and housekeeping

* **Probe branch left behind:** `claude/rem-11-negative-probe` (head `ba363b8`, two throw-away commits: tampered pin; wrong baseline) was created to produce the runner failure-mode evidence in §6. Deleting the remote branch was refused by the environment's git proxy (`remote end hung up`); I did not work around it. **Please delete it.** It has no PR, is not referenced anywhere, and its push-triggered runs are finished.
* AWJ fixtures cover the **unsigned (Phase-1-shaped)** output only; the signed path needs credentials and is out of scope. The baseline therefore records the current skeleton's failures (XSD, EN, KSA, QR, SIGNATURE, PIH for simplified; XSD, EN, KSA, PIH for standard) — consistent with AUDIT-1.
* The baseline pins SDK error **codes**, not messages (messages are SDK text and noisy). `NullPointerException` in the SIGNATURE stage is an SDK artefact for unsigned input; if a future SDK/JDK changes it the ratchet will demand a baseline update.
* Warnings are reported, not baselined.
* Advisory, non-required: a red run never blocks a merge. Link-death produces a red advisory run only.
* Push trigger runs on every branch push that touches the filtered paths (including `main`); concurrency cancels superseded runs per ref.
* Python harness assumes `ubuntu-latest` (Python ≥3.9, `sudo`, `setpriv`, `unshare`, `curl`); if the runner image drops one, isolation cannot be proven and the job fails closed.

## 9a. Finding: the first drift test failed the mandatory backend job (fixed)

On head `c662bcc`, `php artisan test (L11, pgsql)` **failed** (4 failures, all in `ZatcaSdkFixtureDriftTest`: fixture files "do not exist" and the directory listing was empty). Cause: the backend job builds a fresh Laravel project in `/tmp/nibras-app` and copies a **hard-coded folder list** (`ci.yml` and `setup.sh`, kept in sync by hand); `tests/Fixtures/zatca-sdk/**` is not on it, so the test could never see its fixtures there. Locally the test passed only because my overlay had the fixtures copied by hand — a gap between my local environment and CI, not a flaky test.

Options considered: (a) add the folder to `ci.yml`/`setup.sh` — rejected, edits the mandatory workflow, outside the slice; (b) skip the test when files are absent — rejected, silently disables the guard; (c) **chosen:** compare the generator's SHA-256 with a `DIGESTS` table embedded in the test (works in the overlay), keep byte-for-byte comparison where the files exist, and tie the committed fixture files to the same digests in `scripts/zatca-sdk/tests/test_repo_guards.py` (advisory self-test job, which has the repository checkout).

Trade-off to know: the *generator-vs-digest* half is blocking (mandatory suite); the *file-vs-digest* half is advisory (the harness workflow). Hand-editing a fixture XML without updating `DIGESTS` is therefore caught by the advisory job only.

## 10. Rollback

Delete `.github/workflows/zatca-sdk-conformance.yml` (or revert the PR). No state, secret, cache, artifact, setting or other workflow references it. The drift test is the only piece in the mandatory suite and reverts with the PR.

## 11. Owner decisions requested

| ID | Decision | Recommendation |
|---|---|---|
| D-03e′ | Classify the two jobs as `advisory` in `.github/ci-gate/required-checks.json` and restore `pull_request` + `paths`, **or** keep the push trigger. | Keep push for now; revisit when promoting. |
| D-03a | Counsel/ZATCA answer on licensor, automated download, caching. | Obtain before any vendoring/mirroring/promotion. |
| Housekeeping | Delete `claude/rem-11-negative-probe` (and the merged feature branch). | Authorized by the owner after verification; see the post-merge housekeeping report for the outcome. |
| Follow-up | Mark REM-03/03b/11 merged in the backlog/reports (stale "in review" wording). | Done in the post-merge housekeeping docs PR. |
| Next | REM-12+ (UBL rebuild) can now use this oracle; baseline shrink is the acceptance signal. | — |

## 12. Acceptance matrix

| Requirement | Met | Evidence |
|---|---|---|
| Advisory-only workflow, isolated from mandatory CI | ✅ | §3, §5-C3 |
| Download + checksum without redistribution | ✅ | §4, §5-C1, §6 #1 |
| Fail closed on download/integrity failure | ✅ | §6 #1 (runner) |
| Offline execution + isolation proven on hosted runner | ✅ | §5-C1 |
| Official samples + AWJ fixtures + ratchet + tamper | ✅ | §6 |
| Exit-code-0 failures handled | ✅ | §6 #6 |
| No taxpayer data / credentials / ZATCA traffic | ✅ | §5-C5 |
| Fixture-drift guard in backend suite | ✅ | §7 |
| No change to gate manifest / settings / existing CI | ✅ (with the trigger deviation) | §3, §5-C3/C4 |
| Legal questions recorded | ✅ (unresolved) | §8 |
| Final-head CI | see PR comment | — |

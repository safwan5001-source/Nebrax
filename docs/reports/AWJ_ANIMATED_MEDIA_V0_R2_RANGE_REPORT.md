# AWJ Animated Media — V0: Cloudflare R2 presigned GET + HTTP Range feasibility

## Verdict (read this first)

| Question | Answer |
|---|---|
| Was real Cloudflare R2 tested? | **No. BLOCKED.** This environment has no R2 test bucket, no scoped token and no R2 endpoint. **No claim of real-R2 validation is made anywhere in this report.** |
| Is architecture B2 feasible on R2? | **Not yet proven. Not disproven.** The documented capabilities and the app's own SDK are compatible with B2 (§3), but every R2-specific behaviour (§5) is **unverified**. |
| What was delivered instead | A complete, reproducible, credential-safe V0 test harness, validated end-to-end against a SigV4-validating **local look-alike** (24/24 required cases) and proven to detect (or correctly ignore) injected faults — including the three gate defects found in review (§5a) — **none of it is R2 evidence**. |
| Video implementation | **NO-GO** until the harness passes on real R2 (V-G1). No video endpoint, DB change, UI, bucket or Railway change was made. |
| What unblocks it | Owner action in §6 (an isolated R2 test bucket + a bucket-scoped token as environment variables, and network egress to the R2 host). About 15 minutes of owner time, then one command. |

| | |
|---|---|
| Branch | `claude/awj-v0-r2-range-feasibility` |
| PR | [#1558](https://github.com/safwan5001-source/Nebrax/pull/1558) (docs + throwaway spike only; **not merged**) |
| Base SHA | `3cf914235f2044c0a7b7a0357b240d6edc1b3086` (`origin/main`, includes merged #1552) |
| Head SHA | this docs-only commit (see PR head); the code/harness content (incl. the round-1 to round-4 review fixes) is at `c531ad437ffca79371fb3fe88737cb3d0f74f7e0` — CI results for the final head are recorded on the PR (the PR changes no application code; the repository CI runs only the PHP and storefront suites; the V0 `node --test` suites are local evidence, not CI) |

## 1. Scope and constraints honoured
Read-only inspection of the repo; a throwaway spike under `docs/plans/store/s0-spikes/r2-range/v0/`; this report. **Not done, by instruction:** no bucket created, no Railway
variable read or changed, no credential printed/logged/committed, no signed URL printed or stored, no production media or customer data, no video endpoint, no migration, no UI,
no merge/deploy. The sandbox exposes `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` variables that are **not documented as R2 credentials for this task**; they were deliberately
**not used and not printed** (using unrelated credentials against an object store is outside this brief).

## 2. Inputs reused
* Phase 2 readiness review (`AWJ_ANIMATED_MEDIA_PHASE2_READINESS.md`, PR #1551, still open): §4 architecture B2, gate **V-G1** ("presigned GET + `Range` — single, suffix, open-ended, past-EOF → 416, `If-Range`, HEAD — on a test bucket with a scoped token"), approvals **#7** (AMEND-1 clarification ADR) and **#11** (R2 test bucket + token).
* `docs/plans/store/s0-spikes/r2-range/range-probe.php` (S0-B) — extended, not replaced: it exercised the SDK's `GetObject` only on two S3 look-alikes. V0 adds what B2 actually needs: **presigned URLs fetched over plain HTTP by a different process**, expiry, tamper/method confusion, redirects, header hygiene and the SSRF guard.

## 3. Inspection of the current R2 integration (no credentials touched)
| Finding | Evidence | Consequence for B2 |
|---|---|---|
| `R2StorageService` exposes only `put / get / exists / delete / key`; **no `Range`, no URL signing**, `get()` returns the whole body. | `app/Services/R2StorageService.php` | V1 must add a signing method (additive). Laravel never streams video: it will only sign. |
| Key layout `tenant/{tenantId}/{domain}/{resourceId}/{filename}`; every segment validated (`[A-Za-z0-9][A-Za-z0-9._-]*`, no `..`). Tenant comes only from `TenantContext`. | same | The authorise endpoint derives the key server-side from the resolved tenant + media id — the browser cannot influence the key (tenant isolation preserved). |
| Client: `region = auto` (default), endpoint from `R2_ENDPOINT`, **`use_path_style_endpoint` defaults to `false`** (virtual-hosted). Settings come from `config('filesystems.disks.r2')` ← env names `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_REGION`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_USE_PATH_STYLE_ENDPOINT` (names read from code; Railway was **not** queried — its API returns values). | `config/filesystems.php` | The probe uses different names (`S3_*`) so a test run can never pick up production settings. It must be run in **both** addressing styles; the app's current style is virtual-hosted. |
| The repo's own SDK (`aws-sdk-php 3.401.2`) presigns offline with the production client options. For `region=auto` and an `*.r2.cloudflarestorage.com` endpoint it produced, in virtual-hosted mode, `https://<bucket>.<account>.r2.cloudflarestorage.com/<key>` and, in path style, `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`; both `AWS4-HMAC-SHA256`, scope region `auto`, **`X-Amz-SignedHeaders=host` only**. | executed offline with dummy credentials (nothing sent) | (a) Both host shapes must be allow-listed by the proxy; (b) because only `host` is signed, **`Range`, `If-Range` and conditional headers are not part of the signature**, so one signed URL can serve any range the proxy decides to send; (c) the signer needs no R2 round trip. |
| Existing private-file stance: no presigned/302/CDN to browsers. | readiness report | B2 keeps URLs server-to-server (the browser never sees an R2 host). |

## 4. What the harness does
`v0-signer.php` (Laravel's side: app SDK signs and uploads/deletes the disposable objects) + `v0-r2-range-probe.mjs` (the Node proxy's side: `fetch` with `redirect:"manual"`, the browser's `Range`
headers, no automatic decompression). It runs the plan in §5 against an 8 MiB random object, a 1 KiB second object, and an empty object under `v0-range-probe/<run>/` of the test bucket only, deletes them
and verifies deletion. Safety by construction: URLs live only in memory (signer → probe over a pipe); provider headers are reduced to an allow-list; error bodies to the S3 `<Code>`; every string is
scrubbed of credentials, signature parameters and the account id; the result files contain no URL. `README.md` in the spike folder has the exact commands.

## 5. Test matrix
**R** = required for B2 (a failure is a blocker or needs a proxy-side shim) · **I** = informational (behaviour recorded, shim chosen from it). Columns: *Real R2* — **NOT RUN** for every row;
*Look-alike* = Scality CloudServer on loopback, SigV4-validating (`result-selftest-scality.json`) — proves the harness works, says **nothing** about R2; *Neg. control* = same store behind `fault-injector.mjs --mode=drop-range` (drops `Range`).

| ID | Case | Grp | Real R2 | Look-alike | Neg. control | Note / B2 handling |
|---|---|---|---|---|---|---|
| R1 | Full GET: 200, `Content-Length`, `Accept-Ranges: bytes`, `ETag`, `Content-Type`, sha256 of body | R | NOT RUN | PASS | PASS | |
| R2 | `bytes=100-199` → 206, `Content-Range`, 100 B, bytes match | R | NOT RUN | PASS | FAIL | |
| R3 | `bytes=0-0` → 206, 1 B | R | NOT RUN | PASS | FAIL | |
| R4 | Safari probe `bytes=0-1` → 206, 2 B | R | NOT RUN | PASS | FAIL | |
| R5 | Open-ended `bytes=N-500-` → 206 to EOF | R | NOT RUN | PASS | FAIL | |
| R6 | Suffix `bytes=-500` → 206, last 500 B | R | NOT RUN | PASS | FAIL | |
| R7 | End beyond EOF → 206 clamped | R | NOT RUN | PASS | FAIL | |
| R8 | Start == size → 416 | R | NOT RUN | PASS | FAIL | Look-alike answers 416 **without** `Content-Range`; criterion relaxed (see below): proxy synthesises `bytes */N` |
| R9 | Start > size → 416 | R | NOT RUN | PASS | FAIL | |
| R10 | Last byte `bytes=N-1-` → 206, 1 B | R | NOT RUN | PASS | FAIL | |
| R11 | One strong, quoted `ETag` on **every** successful response: the 200, every 206 (closed, open-ended, suffix, EOF-clamped, If-Range, parallel…) and the HEAD; a missing required observation fails | R | NOT RUN | PASS (35 responses incl. I9, 1 ETag) | PASS | Treat ETag as opaque (multipart uploads are not MD5). *Fixed after review — see §5a* |
| R12 | `Accept-Encoding: identity` → no `Content-Encoding` on 200/206 (video/mp4) | R | NOT RUN | PASS | PASS | Proxy must send `identity` (Node's default is gzip) |
| R13 | No 3xx on any correctly signed **HTTPS** request (`redirect: manual`); negative controls and the informational I10 plain-http probe never feed this gate | R | NOT RUN | PASS (42 signed requests incl. I9) | PASS | Proxy treats **any** 3xx as failure. *Fixed after review — see §5a* |
| R14 | Expired URL → 403, nothing served | R | NOT RUN | PASS | FAIL¹ | TTL 4 s in the harness; production TTL 60–120 s |
| R15a | Tampered signature → 403 | R | NOT RUN | PASS | PASS | |
| R15b | Signed for key A, used for key B → 403 | R | NOT RUN | PASS | PASS | Tenant/key isolation at the storage layer |
| R15c | `X-Amz-Expires` extended after signing → 403 | R | NOT RUN | PASS | PASS | |
| R15d | Signature removed → 403/400 | R | NOT RUN | PASS | PASS | |
| R16a | `PUT` with a GET-signed URL → 403, object unchanged | R | NOT RUN | PASS | FAIL¹ | |
| R16b | `DELETE` with a GET-signed URL → 403, object present | R | NOT RUN | PASS | FAIL¹ | |
| R17 | Unsigned GET → 403 (bucket private) | R | NOT RUN | PASS | PASS | Needs the owner to keep the test bucket private (no public access, no custom domain) |
| R18 | No provider response header **name or value** exposes a credential, signature, SigV4 material or the signed URL (all headers of all 50 responses scanned) | R | NOT RUN | PASS | PASS | *Fixed after review — see §5a.* Proxy forwards a **whitelist** only (`content-type/-length/-range`, `accept-ranges`, `etag`, `last-modified`) |
| R19 | Offline SSRF host allow-list, 15 cases | R | **PASS (offline)** | **PASS (offline)** | PASS | The only check that needs neither R2 nor credentials; it proves the guard logic, not R2 |
| R20 | Every signer URL passes the allow-list | R | NOT RUN | PASS | PASS | Virtual-hosted and path-style hosts both pass |
| I1 | HEAD with a HEAD-signed URL | I | NOT RUN | 200, same metadata | – | B2 does not need HEAD (size/ETag come from the authorise response) |
| I2 | HEAD with a GET-signed URL | I | NOT RUN | 403 | – | Method is part of the signature |
| I3 | Multi-range `bytes=0-1,5-6` | I | NOT RUN | 200 full body (Range ignored) | – | Proxy refuses multi-range itself |
| I4 | Malformed ranges (`abc`, `5-2`, `items=0-1`, `-0`, `--5`, `0-9,`, `Bytes=0-1`, `bytes = 0-1`) | I | NOT RUN | 200 full body for all except `-0` → 416 | – | **Proxy validates `Range` and never forwards anything but one closed/open/suffix range**; otherwise a hostile client could trigger full-object transfers |
| I5 | Suffix larger than the object | I | NOT RUN | 206 whole object | – | |
| I6 | `If-Range` (matching / mismatching / date) | I | NOT RUN | **ignored: 206 even for a mismatching ETag** | – | Look-alike ignores `If-Range`; R2's docs do not list it either → **proxy implements `If-Range` itself** against the authorised ETag (keys are immutable) |
| I7 | `If-Match` wrong / `If-None-Match` current | I | NOT RUN | 412 / 304 | – | |
| I8 | `Accept-Encoding: gzip` on video/mp4 | I | NOT RUN | no `Content-Encoding` | – | |
| I9 | Download started before expiry and still running after it | I | NOT RUN | **Not established** — full body received in 8 of 10 probe runs, 2 runs 64 KiB short; every probe run ended with `UND_ERR_SOCKET`; isolated experiment (§5b): full body in 3/3, trailing socket error on either URL | – | Signature is validated at request start on the look-alike (consistent with S3 semantics) but the end-of-stream is not reliable there; informational only. The proxy sets its own total deadline anyway. **Tracked like every signed request (status → R13, ETag → R11, header values → R18)** — see §5a round 2 |
| I10 | Plain `http://` to the real endpoint | I | NOT RUN | skipped (loopback) | – | Proxy refuses non-https before connecting (R19) |
| I11 | 8 parallel ranges | I | NOT RUN | PASS | – | |
| I12 | Empty object: full GET 200 / `bytes=0-0` | I | NOT RUN | 200 len 0 / 416 | – | |
| I13 | 8 KiB `Range` header | I | NOT RUN | 200 (ignored) | – | Proxy caps header length |
| I14 | Provider error bodies echoing credential/signature material (kinds only) | I | NOT RUN | none | – | Proxy never forwards upstream bodies; log-hygiene note |

¹ Fails on the negative control only because the check reads the object back with a `Range` request, which that forwarder drops — a consequence, not a separate defect.

**Criterion change, disclosed:** R8 originally required the provider to send `Content-Range: bytes */N`. The look-alike's `416 InvalidRange` carries no such header, and the proxy knows `N` from the
authorise response, so the criterion was relaxed to "416" (provider behaviour is recorded in `providerSendsContentRangeStar`). The change was made after seeing the look-alike, **before any R2 run**.

**Look-alike result: 24/24 required pass; negative control (`drop-range`): 12/24 fail as designed** (all of R2–R10 plus the Range-dependent R14/R16a/R16b) — the probe detects a store that ignores `Range`.

### 5a. Review fixes (PR #1558, before any real-R2 run)
Three review findings were confirmed in `v0-r2-range-probe.mjs`; each is fixed, covered by a regression test that fails on the pre-fix behaviour, and demonstrated end-to-end with a fault injector against the local look-alike. The gate logic now lives in the I/O-free `v0-gates.mjs`.

| # | Finding | Defect (reproduced) | Fix |
|---|---|---|---|
| P1 | **R13** counted the informational I10 plain-http probe | A real endpoint that redirects `http://` → `https://` — an outcome I10 explicitly accepts — set the global `saw3xx` flag, so R13 reported a **false security failure** (and §7 would classify the run NO-GO). The same flag was also fed by tampered/unsigned/expired controls. | Observations carry a kind: `signed` (correctly signed HTTPS) · `negative` · `informational`. **Only `signed` feeds R13**; I10 and negative controls are recorded (`informationalRedirects`, `negativeRedirects`) but cannot fail it. A 3xx on any correctly signed request still fails, 304 is not a redirect. I10 reports where a redirect points only as a class (`same-host-https` …), never a URL. |
| P1 | **R18** looked at header *names* only | A provider that echoes the signed URL, the signature, the credential scope or the access key in the *value* of an ordinary header (e.g. `Location`, a debug header) **passed** R18 — a **false security pass** (the value was scrubbed from the output, so it was also invisible). | Every header of every response is scanned **by value**, in memory, against the secrets, every URL the probe sent (signed, derived, tampered), their query strings, signature, credential-scope and token values (raw, percent-encoded and decoded), plus generic markers (`X-Amz-Signature=`, `X-Amz-Credential=`, `AWS4-HMAC-SHA256`). Findings carry **only header name + kind + count** — never a value. Error bodies get the same scan as informational **I14**. Name-based detection is kept. |
| P2 | **R11** compared only R1–R4, R10 and HEAD | An ETag that changes on an open-ended (R5), suffix (R6) or EOF-clamped (R7) response — or on If-Range/parallel/suffix-larger responses — **passed**. | Every 200/206 for the test object is logged with a label; R11 requires one strong, quoted ETag across **all** of them (34 on the look-alike) **and** the presence of R1–R7, R10 and I1 (a silently skipped case cannot pass). |

**Reproduction → fix (all on the local look-alike, NOT R2).** Pre-fix probe = `db1ac4c5b` (with only the self-test hook added so I10 can run on loopback); fixed probe = this PR. Faults from `fault-injector.mjs`:

| Fault injected | Pre-fix probe | Fixed probe | Correct? |
|---|---|---|---|
| `leak-url-header` — full signed URL in `x-debug-origin` | R18 **PASS** (false pass) | R18 **FAIL** — `x-debug-origin`: credential, signed-url, signed-url-query, credential-scope, signature, signed-url-parameter, sigv4-material (counts only) | ✔ |
| `leak-signature-header` — signature value in `x-trace` | R18 PASS (false pass; not run pre-fix, same blind spot) | R18 **FAIL** — `x-trace`: signature | ✔ |
| `etag-drift` — new ETag only on open-ended (≥100 B), suffix and EOF-clamped ranges | R11 **PASS** (false pass) | R11 **FAIL** — different: R5, R6, I5 | ✔ |
| `redirect-http` — plain-http probe answered `301 → https` | R13 **FAIL** (false failure; `failed=['R13']`) | R13 **PASS**, I10 records `301 → same-host-https`; 0 required failures | ✔ |
| `redirect-signed` — a correctly signed GET answered `302` | – | R13 **FAIL** (signed3xx: R3 and one more) — the security gate still bites | ✔ |
| `drop-range` — store ignores `Range` (negative control) | FAIL ×12 | FAIL ×12 (R2–R10, R14, R16a, R16b) | ✔ |

**Unit regression tests** (`node --test v0-gates.test.mjs`): **22 pass** on the fix; the same file run against the pre-fix logic (`V0_GATES=./regression/legacy-gates.mjs`) → **15 fail, 7 pass** (the 7 are the baseline/"preserved" cases that were already right). They cover: 301/302/307/308 on I10 not failing R13; negative-control redirects ignored; a redirect on a signed request still failing; 304 not a redirect; URL/signature/credential-scope/access-key/secret in header values, percent-encoded and query-string copies, unknown presigned parameters, error bodies; **no finding ever contains a value** (asserted on the serialised report); no false positives on an ordinary header set; suspicious header names still failing; ETag drift on R5, R6, R7 and on the other ranged cases, missing observations, missing ETag, weak ETags, a different ETag on the 200.

#### Round 2 (three further findings, same PR)
| # | Finding | Defect (reproduced against the pre-fix probe `0bbfb0053`) | Fix |
|---|---|---|---|
| P1 | **I9 bypassed tracking** | The short-TTL streaming request used a bare `fetch()`, so its status never reached R13 and its ETag never reached R11 (only its header values were scanned). With the fault injector answering that request with `302` the old probe still reported **R13 PASS**; with a different ETag, **R11 PASS** — false passes. | I9 now goes through `hit(…, { keepBody: true })` + `track(…, 'signed', 'I9')`: the response is described and judged like every other signed request while its streaming body stays unread for the slow reader. A structural test pins that the probe contains exactly one `fetch()` and that every `hit()` result is tracked, so an untracked request cannot be reintroduced. |
| P2 | **Cleanup failure did not fail the run** | `cleanedUp` was reported in the JSON but the exit status depended only on the required cases. With the DELETE refused (`block-delete`) all three disposable objects stayed in the bucket and the probe exited **0**; with the verification HEAD answered `500` (`unverifiable-head`) it also exited **0**. | `cleanupGate`: each object must be deleted **and** confirmed gone (`HEAD` → 404). An object still present, or a verification that could not be completed (403/500/no answer), fails the run (**exit 1**) and prints the prefix to remove by hand. Cleanup runs in a `finally`, so it is attempted even if the matrix throws. The 24-case matrix is unchanged; cleanup is a separate exit condition (`summary`/`cleanup` in the JSON). |
| P2 | **Report contradicted the I9 evidence** | The matrix said the 8 MiB I9 download "completes"; the checked-in JSON showed `completed: false`, 8,323,072 bytes, `UND_ERR_SOCKET`. | Rerun and documented honestly — §5b. The earlier sentence is replaced; the claim is downgraded from "completes" to "not established". |

**Reproduction → fix (local look-alike, NOT R2; exit status shown):**
| Fault injected | Pre-fix probe | Fixed probe |
|---|---|---|
| `i9-redirect` — the I9 signed GET answered `302` | exit 0, R13 **PASS** (false) | exit **1**, R13 **FAIL** |
| `i9-etag-drift` — I9 gets another ETag | exit 0, R11 **PASS** (false) | exit **1**, R11 **FAIL** |
| `block-delete` — cleanup DELETE refused | exit 0, `cleanedUp=false` ignored | exit **1**, cleanup `remaining: [probe, other, empty]` |
| `unverifiable-head` — cleanup HEAD answers 500 | exit 0 | exit **1**, cleanup `unverified: [probe, other, empty]` |
| *(re-run of every earlier fault)* `leak-url-header`, `leak-signature-header`, `etag-drift`, `redirect-signed`, `drop-range` | – | exit 1 with the same failures as before (R18, R18, R11, R13, 12 cases); `redirect-http` → exit **0** (R13 PASS, I10 `301 → same-host-https`) |
| clean look-alike run | – | **exit 0**, 24/24 required, cleanup verified, 35 ETag observations, 42 signed requests |

**Tests (all local):** `node --test v0-gates.test.mjs v0-probe-wiring.test.mjs` → **35 pass** (29 gate + 6 wiring). Against the pre-fix logic: `V0_GATES=./regression/legacy-gates.mjs` → **20 of 29 gate tests fail**; the pre-fix probe against the wiring tests (`V0_PROBE=<0bbfb0053 probe>`) → **4 of 6 fail**. New cases: I9 redirect fails R13; I9 missing/different ETag fails R11; cleanup — all 404 passes, nothing created passes, a remaining object fails, a failed delete with the object present fails, **unverified (403/500/503/no answer) fails**, a failed delete with the object confirmed gone is clean (recorded under `deleteFailed`).

**Other gates re-verified after the change:** full harness on the look-alike **24/24 required pass** (8 MiB, TTL 4 s, 0 value leaks, 42 signed requests, 0 signed redirects, 35 ETag observations, cleanup verified); offline SSRF allow-list **15/15**; every `result-*.json` was grepped for the test credentials and for `X-Amz-Signature=<hex>` — no match.

The gate and wiring tests are local spike evidence (`node --test`); they are not wired into the repository CI, which only runs the PHP and storefront suites.

#### Round 3 (two further findings, same PR — still no real-R2 run)
| # | Finding | Defect (reproduced against the pre-fix probe `ced7cd1b6`) | Fix |
|---|---|---|---|
| P1 | **Retained provider headers were only weakly redacted** | `hit()` kept `etag`, `location`, `content-disposition`, … after `scrub()`, which removed the credentials and an `X-Amz-*=` pattern only. A signature echoed as a quoted ETag (`"<sig>"`, still a "strong" ETag) was copied into `observed.headers` and written to the JSON by `brief()`: with the fault injector in `leak-etag` mode the pre-fix result file contained **23 signature-shaped strings** (R18 correctly FAILed, but the secret was on disk). A thrown matrix wrote no report and printed a raw stack trace. | One redaction path (`scrub`) that is **token-aware** — the credentials, every URL the probe ever requested and its signature / credential / token parts, in every encoding, case-insensitively — plus the generic `X-Amz-*=` and `AWS4-HMAC-SHA256` markers; applied to every retained header **value and name**, the S3 error code and the PUT ETag. The finished report is then swept (`safeSerialize`: redact every string and key, serialise, **re-scan the serialised text**); if anything survives, **no file is written** and the run exits 1; a non-empty sweep also fails the run (it means a value bypassed `scrub`). A thrown matrix is caught: a redacted report with `fatal` is written and the exit status is 1. The I9 experiment output goes through the same step. |
| P2 | **I9 experiment continued after a failed upload** | `created = !signer({op:'put'…}).error` only set a flag. With the PUT refused (`block-put`) the experiment fetched two presigned URLs for a missing object (404, 197 bytes), printed two rows and **exited 0**. | The upload result decides: a PUT that is not confirmed `ok` (or a URL that cannot be signed) sets `aborted`; **no rows**, exit **1**, stderr `ABORTED: …`. Cleanup is still attempted and verified once the PUT was tried (an object may exist despite a reported failure). |

A defect found while verifying the fix (and fixed in the same round): `scrub()` first replaced the access key id with `<secret>`; because that id is a substring of every signed URL's `X-Amz-Credential`, an echoed URL no longer matched the whole-URL token and its host/path survived. Token redaction now runs **before** the credential/account substitutions (pinned by a wiring test).

**Reproduction → fix (local look-alike, NOT R2):**
| Fault injected | Pre-fix probe (`ced7cd1b6`) | Fixed probe |
|---|---|---|
| `leak-etag` — signature echoed as the ETag of every ranged response | R18 FAIL, **result file holds 23 signature-shaped strings** | R18 FAIL, R11 FAIL, **0** signature-shaped strings / credentials / `X-Amz-…=` in the file (22 `<redacted:signature>` markers) |
| `leak-location` — full signed URL in `Location` of a 206 (not a redirect) | R18 FAIL; URL host/path and key prefix retained in the file | R18 FAIL; 0 sensitive strings; whole URL replaced by `<redacted:signed-url>` |
| `leak-disposition` — full signed URL in `Content-Disposition` | same as above | same as above |
| `leak-then-abort` — leak, then the connection is destroyed mid-matrix (failure case) | **no result file**, raw Node stack trace on stderr, exit 1 | redacted report **with `fatal`** written, exit 1, 0 sensitive strings in file and in stdout/stderr |
| `block-put` — test-object PUT refused | probe: throws (exit 1) · **I9 experiment: exit 0 with two bogus 404 rows** | probe: report with `fatal`, exit 1 · **I9 experiment: exit 1, `aborted`, no rows**, cleanup verified |
| *(re-run of every earlier fault)* | – | same verdicts as round 2 (`leak-url-header`/`leak-signature-header` R18 FAIL, `etag-drift` R11, `redirect-signed` R3/R13/R11, `drop-range` 12 cases, `i9-redirect` R13, `i9-etag-drift` R11, `block-delete`/`unverifiable-head` cleanup → exit 1); `redirect-http` → exit **0** |
| clean look-alike run | – | **exit 0**, 24/24 required, cleanup verified, 35 ETag observations, 42 signed requests, 0 value leaks |

**Tests (all local, hermetic):** `node --test v0-gates.test.mjs v0-probe-wiring.test.mjs v0-i9-experiment.test.mjs v0-results-secret-scan.test.mjs` → **82 pass** (40 gate + 12 wiring + 6 I9 controls + 24 committed-result scans). New: hostile values in `etag`/`location`/`content-disposition`/`cache-control`/`server`/header names are all redacted; unknown SigV4 material removed by the generic markers; percent-encoded/upper/lower-case variants; a fatal error message embedding the signed URL and credentials; findings carry kinds only; clean headers untouched; the sweep **fails closed** (no text returned if a token survives); wiring pins (token-aware `scrub`, no raw `seen[k] = v`, the file is written only from `safeSerialize` output, catch between `try` and `finally`, exit status includes `fatal` and the sweep, token redaction before substitutions); the I9 negative controls use a fake `php` signer (failed upload / unparseable signer output → exit 1, no rows; cleanup still verified; positive control exits 0 with two rows and no signed URL in the output; unverifiable cleanup still exits 1). Against the pre-fix code: `V0_GATES=./regression/legacy-gates.mjs` → **29 of 40 gate tests fail**; the pre-fix probe against the wiring tests → **5 of 12 fail**; the pre-fix I9 experiment → **4 of 6 fail** (the abort tests; the positive control and cleanup test pass because that behaviour was not changed). Every committed `result-*.json` was scanned for presign parameters, SigV4 material, 64-hex runs, the look-alike credentials and signed URLs — no match; stdout/stderr of every fault run were scanned too.

#### Round 4 (one further finding, same PR — still no real-R2 run)
| # | Finding | Defect (reproduced against the pre-fix code `74199a7a6`) | Fix |
|---|---|---|---|
| P2 | **Allow-list enforced only after the matrix** | `allowedUpstream()` was applied once, as the R20 gate, after every request had been made. `hit()` — and the I9 experiment's own `fetch()` — connected to whatever URL the signer returned, so a URL on another host (compromised/misconfigured signer, wrong endpoint) would receive the presigned query, i.e. the signature. With a signer returning a URL on a local listener, the pre-fix probe **connected to it** and the pre-fix I9 experiment too (the new end-to-end tests fail on both). | New `v0-upstream-guard.mjs`: `allowedUpstream` moved there unchanged, plus `guardedFetch`, the **only** outgoing-request path (a structural test pins zero raw `fetch(` in the probe and the I9 experiment). The host/port/scheme/userinfo check runs **before** `fetch()` is called; `redirect: 'manual'` is forced, so a `Location` to another host is recorded and never requested. A refusal carries a reason code only (no URL/host/signature). Probe: counted in the report (`upstreamGuard`), fails the run (exit 1) even if an inner `catch` swallowed it. I9 experiment: aborts, no rows, exit 1, cleanup still verified. The informational I10 plain-http case keeps working through one labelled exception (`plainHttpProbe`): http only for the configured host. R20 stays as a post-hoc cross-check. |

**Scope note.** The signer (`v0-signer.php`, the app's AWS SDK) talks only to the owner-configured `S3_ENDPOINT` (credentials never go anywhere else), and presigned URLs are the only data it returns that the harness fetches; every fetch of such a URL now goes through the guard.

**Evidence (local, hermetic — NOT R2):** a listener that counts **TCP connections** (not just requests) stands in for the malicious host.
| Case | Pre-fix | Fixed |
|---|---|---|
| Probe, signer returns a URL on the listener — remote-endpoint config (`https://acct.r2…`) and loopback config (other port) | listener contacted, test fails | listener sees **0 connections / 0 requests**; exit 1; redacted report with `upstreamGuard: {requestsAllowed: 0, requestsRefused: 1, refusedReasons: ["host-not-allowed"]}`; no URL, signature or credential in stdout/stderr/report |
| I9 experiment, same two configs | listener contacted, test fails | **0 / 0**; `aborted: download URL refused by the upstream allow-list`; no rows; exit 1; cleanup verified |
| Allowed host answers `302 → malicious host` (even if the caller asks `redirect: follow`) | – | status 302 recorded, malicious host **0 connections** |
| Guard unit cases: look-alike suffix/prefix, userinfo trick, other bucket, IP literal (metadata service), loopback, plain http to the real host, other port, other scheme, non-URL | – | refused; `fetch` not called |
| Normal runs | – | full local harness **24/24 required**, cleanup verified, 35 ETag observations, 42 signed requests, 0 value leaks, `requestsAllowed: 51, requestsRefused: 0`; `redirect-http` fault still exit 0 (I10 `301 → same-host-https`); `leak-etag` fault still R18/R11 FAIL with 0 sensitive strings in the file; I9 experiment against the look-alike exits 0 with both rows; offline host list **15/15** |

**Tests:** `node --test v0-gates.test.mjs v0-probe-wiring.test.mjs v0-i9-experiment.test.mjs v0-results-secret-scan.test.mjs v0-upstream-guard.test.mjs` → **104 pass**. Against the pre-fix code: probe → 2 of 18 guard tests and 1 of 12 wiring tests fail; I9 experiment → 3 of 10 fail. Redaction and gate protections from rounds 1–3 are untouched (same tests, same results).

### 5b. I9 (in-flight download vs URL expiry) — what the evidence actually says
Local look-alike only (**not R2**). The probe reads the 8 MiB object at ≈ 1 MiB/s (≈ 8 s) on a URL with a 4 s TTL. Observed over 10 probe runs (3 earlier runs, 6 dedicated samples of the same probe, and the final baseline run): the full 8,388,608 bytes arrived in **8 of 10** runs; **2 of 10** ended **64 KiB short** (8,323,072 bytes) — one of them is the run the review quoted from the checked-in JSON — and **all 10 reported `UND_ERR_SOCKET`** at ≈ 8.0 s. The earlier sentence "completes" in this report was therefore wrong for that evidence file. Because the read lasted exactly as long as the suspicious ≈ 8 s mark, the run could not separate *expiry* from a *transport* limit, so `v0-i9-experiment.mjs` reads the same object at **0.5 MiB/s (≈ 16 s)** on two URLs, one that **expires mid-download** (TTL 2 s) and one that **does not**:

| Run | URL expiring at 2 s | URL valid for 120 s |
|---|---|---|
| 1 | 8,388,608 B, `UND_ERR_SOCKET` at the end | 8,388,608 B, no error |
| 2 | 8,388,608 B, no error | 8,388,608 B, `UND_ERR_SOCKET` at the end |
| 3 | 8,388,608 B, no error | 8,388,608 B, `UND_ERR_SOCKET` at the end |

Conclusions, limited to this simulator: (1) the signature is validated at request start — a download that began before expiry continued for ≈ 14 s after it and delivered every byte in **3 of 3** runs; (2) the trailing `UND_ERR_SOCKET` occurs on expiring *and* non-expiring URLs alike (1/3 vs 2/3), so it is a **transport artefact of the look-alike's connection handling, not an expiry effect**, and the occasional 64 KiB-short run (2 of 10) is the same artefact. I9 therefore stays **informational** and **unproven for R2**; the probe now records `socketErrorAfterAllBytes` so a clean tail is distinguishable from a truncated one. The B2 proxy does not rely on this behaviour (its own total deadline and URL TTL are independent).


## 6. Blockers requiring owner action
| # | Action | Why | Constraint |
|---|---|---|---|
| 1 | **Create an isolated, private, empty R2 bucket** (e.g. `awj-v0-range-test`), no public access, no custom domain | Source of truth for V-G1; the harness refuses to need anything else | I may not create buckets (instruction). Approval **#11** in the readiness report |
| 2 | **Create an R2 API token scoped to that bucket only** — *Object Read & Write*, no account-wide scope, short expiry (days) | The harness uploads/deletes only `v0-range-probe/…` | Never paste it into chat |
| 3 | Put these in the **sandbox environment** as variables (Environment settings → Network secrets / environment variables): `S3_ENDPOINT` (`https://<account>.r2.cloudflarestorage.com`), `S3_KEY`, `S3_SECRET`, `S3_BUCKET`, `S3_REGION=auto` | Names differ from the app's `R2_*` on purpose. A new session picks them up | — |
| 4 | **Allow outbound HTTPS to `*.r2.cloudflarestorage.com`** (and the `<bucket>.<account>.r2.cloudflarestorage.com` host) | Egress to this host family is **unverified**: general internet works through the sandbox proxy, but a probe of a made-up account host failed at TLS and that does not prove or disprove policy | Network access is an environment setting |
| 5 | Alternative to 3–4: **run the harness yourself** (`README.md`) and send back only `result-r2-*.json` | The output is credential-free and URL-free by construction | Preferred if you do not want secrets in the sandbox |
| 6 | Afterwards: **revoke the token and delete the bucket** | Hygiene | — |
| 7 | Separate, later: approval **#7** (AMEND-1 ADR: server-to-server signed fetch is not "direct R2 exposure") and **#6** (internal authorise endpoint) | Needed before V1/V2, not for V0 | Not part of this deliverable |

## 7. Decision rules for when real R2 results exist
| Outcome | Meaning |
|---|---|
| All R pass in both addressing styles | **B2 feasible** → V1 (authorise endpoint + presign, flag off) may be scheduled |
| R8 without `Content-Range` / `If-Range` ignored / multi-range or malformed ranges not rejected by R2 | **Not blockers** — handled by proxy-side shims already designed (synthesise 416 header, own `If-Range`, own `Range` validator) |
| Any of R2–R7, R9, R10 wrong (206 / `Content-Range` / clamping) or R11 unstable ETag | Blocker unless a safe shim exists → **B2 NO-GO**; do **not** fall back to Laravel streaming |
| R13 (any 3xx), R14 (expiry not enforced), R15–R17 (acceptance of tampered/unsigned/wrong-method requests) or R18 | **Security blocker** → NO-GO until understood |
| Different results between path-style and virtual-hosted | Pick one style for the signer and pin it in V1 |

## 8. Unresolved risks
* **Everything R2-specific is unverified** (Range/416/suffix/clamping, `If-Range`, multi-range, conditional requests, expiry enforcement, header set, `Content-Encoding`, redirects, plain-http behaviour, the ETag format of multipart-uploaded video).
* Cloudflare's documented facts (from the readiness review, not re-fetched here): presigned URLs work **only on the S3 API domain** (not custom domains); GET/HEAD/PUT/DELETE; expiry 1 s–7 d; they are bearer tokens; `GetObject` supports `Range`, `If-Match`, `If-None-Match`; `If-Range` is **not listed**.
* The harness runs from this sandbox's network. Latency/throughput from the Railway edge to R2 is **not** measured by V0 (that belongs to V-G3/V-G7 with the S0-E rig).
* The look-alike is Scality CloudServer; its `If-Range` and malformed-range behaviour are not a model of R2 or AWS S3.
* Real browsers (Safari/iOS range sequences) are unverified — V0 only covers the HTTP contract.
* Cost/abuse: each playback authorisation is a cheap signing call, but a client rotating ranges can generate many R2 Class-B operations; throttling and the authorisation cache are V1/V2 design items.

## 9. Reproduce
```
node docs/plans/store/s0-spikes/r2-range/v0/v0-r2-range-probe.mjs --plan
node docs/plans/store/s0-spikes/r2-range/v0/v0-r2-range-probe.mjs --hostlist          # 15/15 pass, offline
# self-test on a local look-alike (not R2):  docker run zenko/cloudserver (S3BACKEND=mem) then see README.md
# real R2 (after §6):  S3_PATH_STYLE=1 …probe.mjs --label=r2-pathstyle --autoload=…/vendor/autoload.php ; then S3_PATH_STYLE=0 … --label=r2-virtualhosted
```

## 10. Files
`docs/plans/store/s0-spikes/r2-range/v0/`: `README.md`, `v0-signer.php`, `v0-r2-range-probe.mjs`, `v0-gates.mjs`, `v0-gates.test.mjs`, `v0-probe-wiring.test.mjs`, `v0-i9-experiment.mjs`, `v0-i9-experiment.test.mjs`, `v0-results-secret-scan.test.mjs`, `v0-upstream-guard.mjs`, `v0-upstream-guard.test.mjs`, `regression/legacy-gates.mjs`, `fault-injector.mjs`, `result-selftest-scality.json`, `result-fault-*.json` (fifteen fault modes), `result-old-*.json` / `result-old2-*.json` (pre-fix probes under the same faults), and this report. No application code changed.

## 11. GO / NO-GO
| Item | Recommendation |
|---|---|
| Run V0 on real R2 | **GO as soon as §6 items 1–4 (or 5) are done** — harness ready, one command per addressing style |
| Architecture B2 | **UNPROVEN** — remains the recommended design; nothing observed contradicts it |
| V1 (authorise endpoint + presign) | **NO-GO until V0 passes on real R2** (and approvals #6/#7) |
| Any video endpoint, DB change, UI, rollout | **NO-GO** |
| Laravel streaming fallback | **Never** (S0-E) |

## 12. Required approvals
Owner action only (§6): R2 test bucket + scoped token (#11), network egress to the R2 host, token revocation afterwards. No code, DB, API or production approval is requested by this report.

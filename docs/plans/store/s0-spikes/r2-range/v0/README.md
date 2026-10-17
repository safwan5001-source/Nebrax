# V0 — R2 presigned GET + Range probe (throwaway spike, not production code)

Validates architecture **B2** against a real object store: *Laravel signs a short-lived GET URL, the Node storefront proxy fetches it
server-to-server with the browser's `Range`*. Laravel never streams the bytes. See `docs/reports/AWJ_ANIMATED_MEDIA_V0_R2_RANGE_REPORT.md`.

| File | Role |
|---|---|
| `v0-signer.php` | the "Laravel side": signs with the app's own AWS SDK (`aws/aws-sdk-php`), uploads/deletes the disposable test objects |
| `v0-r2-range-probe.mjs` | the "Node proxy side": runs the matrix with `fetch(..., {redirect: 'manual'})`, includes the reference SSRF host allow-list |
| `v0-gates.mjs` | the pass/fail LOGIC of R11 (ETag), R13 (redirects) and R18 (header-value leaks), plus the redaction helpers (`redactText`, `redactDeep`, `safeSerialize`), free of I/O so it is unit-testable |
| `v0-gates.test.mjs` | regression tests for those gates and for cleanup verification (`node --test v0-gates.test.mjs`) |
| `v0-probe-wiring.test.mjs` | structural tests on the probe source: one `fetch()` (inside `hit()`), every `hit()` result tracked, I9 tracked without consuming its stream, cleanup in the exit status, nothing secret printed |
| `v0-upstream-guard.mjs` | the SSRF host allow-list (`allowedUpstream`) and `guardedFetch` — the **only** outgoing-request path of the probe and the I9 experiment; the allow-list is checked before `fetch()` is called, redirects are never followed |
| `v0-upstream-guard.test.mjs` | guard unit tests + probe end-to-end with a malicious-host URL: a listener counts TCP connections and must see **zero** |
| `v0-i9-experiment.mjs` | isolates case I9 (does an in-flight download survive URL expiry?) from transport artefacts of the look-alike; **aborts with exit 1 and no rows if the test object cannot be uploaded** |
| `v0-i9-experiment.test.mjs` | hermetic negative/positive controls for that experiment (a fake `php` signer on `PATH`): failed upload → exit 1, no rows, cleanup still verified |
| `v0-results-secret-scan.test.mjs` | scans every committed `result-*.json` for credentials, signatures and signed URLs (`V0_SCAN_VALUES` adds exact values) |
| `regression/legacy-gates.mjs` | the gate logic as it was BEFORE the review fixes — `V0_GATES=./regression/legacy-gates.mjs node --test v0-gates.test.mjs` must show the regression tests failing |
| `fault-injector.mjs` | loopback forwarder that misbehaves in one chosen way (`drop-range`, `leak-url-header`, `leak-signature-header`, `etag-drift`, `redirect-http`, `redirect-signed`, `i9-redirect`, `i9-etag-drift`, `block-delete`, `unverifiable-head`, and — round 3 — `leak-etag`, `leak-location`, `leak-disposition`, `leak-then-abort`, `block-put`) so the probe can be shown to detect — or correctly ignore — each fault |
| `result-selftest-scality.json` | **local look-alike** self-test (Scality CloudServer) — validates the harness, **NOT R2** |
| `result-fault-*.json`, `result-old-*.json` | fault-injection runs of the fixed probe and of the pre-fix probe (db1ac4c5b) under the same faults — **NOT R2** |

## Read the plan and run the offline checks (no credentials)
```
node v0-r2-range-probe.mjs --plan
node v0-r2-range-probe.mjs --hostlist      # offline SSRF allow-list checks (15 cases)
node --test v0-gates.test.mjs v0-probe-wiring.test.mjs v0-i9-experiment.test.mjs v0-results-secret-scan.test.mjs   # gate + wiring + I9 controls + committed-result scan
V0_GATES=./regression/legacy-gates.mjs node --test v0-gates.test.mjs   # the same gate tests on the pre-fix logic: the regression tests must FAIL
git show 0bbfb0053:docs/plans/store/s0-spikes/r2-range/v0/v0-r2-range-probe.mjs > /tmp/prefix-probe.mjs
V0_PROBE=/tmp/prefix-probe.mjs node --test v0-probe-wiring.test.mjs     # the pre-fix probe: 4 of the 6 wiring tests must FAIL
```

## Run against real R2 (owner-provisioned TEST bucket only)
Create **a new, private, empty bucket** used for nothing else and an API token that is **Object Read & Write, scoped to that one bucket**
(no account-wide permissions), with a short TTL. Provide the values to the sandbox as *environment variables* using the **`S3_*` names below**
(deliberately not the app's `R2_*` names, so a test run can never pick up the production bucket). Never paste them into chat.

```
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   S3_KEY=…   S3_SECRET=…   S3_BUCKET=<test-bucket>   S3_REGION=auto
S3_PATH_STYLE=1   node v0-r2-range-probe.mjs --label=r2-pathstyle      --autoload=/home/user/nibras-app/vendor/autoload.php
S3_PATH_STYLE=0   node v0-r2-range-probe.mjs --label=r2-virtualhosted  --autoload=/home/user/nibras-app/vendor/autoload.php
```
(`S3_PATH_STYLE=0` is the app's current configuration: `R2_USE_PATH_STYLE_ENDPOINT` defaults to false.) Defaults: 8 MiB object, 4 s TTL for the expiry cases.

## What it touches and what it prints
* Writes only `v0-range-probe/<run-id>/{probe,other,empty}.bin` (random bytes generated locally — no production or customer data), deletes them at the end and verifies they are gone.
* Presigned URLs, signatures, credentials and the account id are never printed or written: URLs stay in memory (signer → probe over a pipe), provider headers are
  reduced to an allow-list, error bodies to the S3 `<Code>`, and **every retained string is redacted against the token set** (credentials + every URL ever requested and its
  signature / credential / token parts, in every encoding, plus generic `X-Amz-*=` / `AWS4-HMAC-SHA256` markers) — an allow-list of header NAMES is not a redaction, because a
  provider can echo a signature into `ETag`, `Location` or `Content-Disposition`. The finished report (failure cases included: a thrown matrix still writes a redacted report and
  exits 1) is swept and its serialised text re-scanned before the file is written; if anything survives, **no file is written** and the run exits 1 (kinds are reported, never values).
* The tamper / method-confusion cases (`PUT`/`DELETE` with a GET-signed URL) are only ever aimed at those disposable test objects.
* Exit code 0 = every *required* case passed; informational cases only record behaviour.
* Gate scopes (review fixes): **R13** judges only correctly signed HTTPS requests — negative controls and the informational plain-http probe **I10** (where a redirect to https is acceptable) never feed it;
  **R18** scans every header NAME and VALUE of every response (and error bodies, informationally) for credentials, signatures, SigV4 material and the signed URLs, reporting only header name + kind;
  **R11** requires one strong ETag across the 200, every 206 (closed, open-ended, suffix, EOF-clamped, If-Range, parallel…) and the HEAD, and fails if a required observation is missing.
* **Exit status** is nonzero when any required case fails **or when cleanup is not verified**: every disposable object must be deleted *and* confirmed gone (`HEAD` → 404); a delete that errored with the object still present, or a verification that could not be completed (403/500/no answer), fails the run and prints the prefix to remove by hand. Cleanup runs in a `finally`, so it is attempted even if the matrix throws.
* **I9** (a download that outlives the URL's expiry) goes through the same tracking as every request — its status feeds R13, its ETag R11, its header values R18 — without consuming its streaming body.
* `V0_SELFTEST_PLAIN_HTTP_HOOK=1` (self-test only) lets I10 run against a loopback look-alike by sending an `x-v0-plain` marker that `fault-injector.mjs --mode=redirect-http` answers with a 301.
* **`v0-i9-experiment.mjs`** needs its test object: if the upload fails (or a URL cannot be signed) it prints `aborted`, no rows, exits **1**, and still deletes + verifies the cleanup. Its JSON goes through the same redact-and-rescan step.
* **Upstream allow-list (round 4):** every URL the signer returns is checked against the configured endpoint (`allowedUpstream`: https — http only for the loopback self-test —, no userinfo, same port, host = endpoint or `<bucket>.<endpoint>`) **before** `fetch()` is called, in the probe (`hit()`) and in `v0-i9-experiment.mjs`. A refused URL is never connected to, so the host never sees the signature; the refusal carries a reason code only. In the probe it fails the run (`upstreamGuard.requestsRefused` in the report, exit 1); in the I9 experiment it aborts (no rows, exit 1). Redirects are never followed (`redirect: 'manual'` is forced). The informational I10 plain-http case is the one labelled exception (`plainHttpProbe`): http is allowed only for the configured host.

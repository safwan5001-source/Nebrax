# ZATCA SDK conformance harness (REM-11 / D-03) — runbook

> **Advisory.** This harness is a development oracle, not a ZATCA compliance statement.
> It is not a required check and is not registered in the CI Gate manifest.
>
> **Trigger design.** The workflow triggers on `push` (all branches, path-filtered) and `workflow_dispatch` — *not* on
> `pull_request`. Reason: the CI Gate's own self-test (`scripts/ci-gate/test_ci_gate.py::Validation::test_repo_is_clean`)
> fails on any PR-triggered job that is not classified in `.github/ci-gate/required-checks.json`, and this slice may
> not edit that manifest (D-03e). A branch push shows the same checks on the PR's head SHA without entering the
> gate's discovery. Classifying the jobs as `advisory` in the manifest (a two-entry change) is the alternative and
> needs the owner's approval; if made, `pull_request` + `paths` can be restored.

## What it does

Runs the **official ZATCA e-invoicing SDK 238-R3.4.8** (`-validate` only) **offline** against:

| Input | Expectation |
|---|---|
| The SDK's own 19 bundled samples (read in place from the downloaded SDK) | Every stage reported must `PASSED`; no error codes; the only tolerated warning is `BR-KSA-98` (old sample dates). The sample set must equal the baseline (count + names + stage set). |
| AWJ-owned synthetic XML (`tests/Fixtures/zatca-sdk/awj/*.xml`) | Per-fixture, per-stage status and error-code set must equal `tests/Fixtures/zatca-sdk/baseline.json` (a **ratchet**). |
| A one-character mutation of a signed official sample | `QR` and `SIGNATURE` **must** fail — proves the oracle is live. |
| The real results re-evaluated against deliberately wrong baselines | Each wrong baseline **must** be rejected — proves the ratchet is live on the runner. |

## Ratchet rules

| Observed vs baseline | Verdict | Meaning |
|---|---|---|
| Baselined failure now passes, or a baselined error code is gone | `STALE_BASELINE` (job fails) | Good news — shrink the baseline in the same PR. |
| Previously passing stage fails, or a new error code appears | `REGRESSION` (job fails) | Investigate; never "fix" by widening the baseline. |
| Fixture without a baseline entry / baseline entry without a fixture | `UNEXPECTED_FIXTURE` / `MISSING_FIXTURE` | Keep the two in lock-step. |

Warnings are reported but are not baselined (noisy and not a conformance verdict).

## Fixtures and the drift test

`tests/Feature/ZatcaSdkFixtureDriftTest.php` regenerates the three AWJ fixtures from fixed synthetic data (no DB,
no clock, no random UUID) through `ZatcaService::buildXml` + `attachQr` and compares **byte for byte** with the
committed files. It runs in the normal backend suite, so a change to the XML generator cannot silently desync the
fixtures the SDK harness validates. It covers the **unsigned (Phase‑1 shaped)** output; the signed path needs
credentials and stays out of scope until the Phase‑2 work.

Intended change workflow (local only):

```bash
ZATCA_SDK_FIXTURES_UPDATE=1 php artisan test --filter=ZatcaSdkFixtureDriftTest   # rewrite fixtures
python3 -I scripts/zatca-sdk/fetch_sdk.py --pin scripts/zatca-sdk/sdk-pin.json --dest /tmp/zatca-sdk
python3 -I scripts/zatca-sdk/conformance.py update-baseline \
    --sdk-root /tmp/zatca-sdk --pin scripts/zatca-sdk/sdk-pin.json \
    --fixtures tests/Fixtures/zatca-sdk --java /path/to/jdk11/bin/java
git diff tests/Fixtures/zatca-sdk      # review: the baseline diff IS the conformance change
```

`update-baseline` refuses to run when `CI=true`, and refuses to record a baseline if an official sample does not pass.

## Security model

| Control | Where enforced |
|---|---|
| SDK acquired by a single HTTPS `GET` chain restricted to the pinned host; cookies in memory only; no headers beyond `User-Agent`/`Accept`; nothing about the repo/tenant is sent | `fetch_sdk.py`, `test_fetch.py` |
| Size + SHA-256 verified **before** extraction; mismatch → exit 10, unreachable/HTML/oversize → exit 11, unsafe archive → exit 12; no fallback source, no cache, no mirror | `fetch_sdk.py` |
| Only an allowlisted subset is extracted (jar, schemas, rules, test certs, PIH, XML samples); symlinks, absolute paths and `..` are refused; `install.sh` is never extracted or run | `fetch_sdk.py` |
| SDK runs in a network namespace; harness proves it (`/proc/net/dev` = `lo` only + refused connects) through the **same command chain** the SDK uses, else aborts. There is no unisolated mode on CI | `conformance.py` |
| SDK process gets a scrubbed environment (no tokens, no proxy variables) and, when `sudo unshare` is used, runs as the invoking user (`setpriv`) | `conformance.py` |
| Only `-validate` is ever passed to the SDK (allowlist); `-sign`, `-csr`, `-invoiceRequest`, `-qr`, `-generateHash` are refused in code and absent from the workflow | `conformance.py`, `test_repo_guards.py` |
| The SDK exit code is not trusted; a missing/duplicate/inconsistent `GLOBAL VALIDATION RESULT` is a harness error | `parse_output`, `test_parser.py` |
| Workflow: `permissions: contents: read`, no secrets, no `pull_request_target`, no cache/artifact actions, all actions SHA-pinned, `persist-credentials: false`, no schedule | `test_repo_guards.py` |
| Output: GitHub Step Summary + AWJ-owned metadata (log group) only; no SDK-derived artifact is uploaded | workflow |

The SDK's bundled certificate and private key are the **official dummy test material**; they exist only in the
runner's temp directory for the job's duration and are never printed or persisted.

## Outstanding legal / terms questions (D-03a — not resolved by this change)

* `LICENSE.txt` inside the SDK is verbatim LGPL‑3.0 text with no named licensor or NOTICE. Whether ZATCA is the
  licensor, and whether the licence covers the whole fat jar (which shades third‑party libraries), is unknown.
* The official download page (`zatca.gov.sa … DownloadSDK.aspx`) states conditions A–C (compliance, scope, no
  implied approval) and requires an **"I accept the above terms and conditions"** step before download. It contains
  **no** statement about automated use, CI, caching or redistribution. An automated download does not perform that
  interactive acceptance; whether that matters is for the owner/counsel.
* The download link is a SharePoint sharing link published in `https://sandbox.zatca.gov.sa/env-config.js`.
  Its long‑term stability and any terms attached to it are unverified.
* Therefore: **no** vendoring, mirroring, caching or artifact upload of any SDK content. Do not change that without
  counsel.

## Operations

* **Link dead / HTTP 403 / HTML page:** the advisory job goes red with `SDK_FETCH_FAILED[11]`. Do nothing in code;
  do not add a mirror (D-03b).
* **Checksum mismatch (exit 10):** treat as a supply‑chain event. Do not update the pin until the new artefact is
  verified from an independent source; a new SDK version is a re‑baseline PR reviewed by the owner.
* **Isolation cannot be proven (`HARNESS_ERROR: cannot prove network isolation`):** the job fails; never add a skip.
* **JDK:** 11 only (`>=11, <15`). JDK 21 cannot verify secp256k1 so `SIGNATURE` fails; JDK 11 under a POSIX
  locale changes hashes unless `-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8` (pinned in `sdk-pin.json`).

## Rollback

Delete `.github/workflows/zatca-sdk-conformance.yml` (or revert the PR). The workflow holds no state, owns no secret
and is not referenced by any other workflow, the CI Gate manifest, or any repository setting; removing it changes
nothing else. The fixtures, scripts and the drift test can be reverted independently (the drift test is the only
piece that runs in the mandatory backend suite).

## Promotion to blocking (not part of REM‑11)

Requires, in a separate owner‑approved PR touching `.github/ci-gate/required-checks.json`: a run of green results on
`main`, a decision on link‑failure policy, and the D‑03a answers.

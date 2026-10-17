# V0 — R2 presigned GET + Range probe (throwaway spike, not production code)

Validates architecture **B2** against a real object store: *Laravel signs a short-lived GET URL, the Node storefront proxy fetches it
server-to-server with the browser's `Range`*. Laravel never streams the bytes. See `docs/reports/AWJ_ANIMATED_MEDIA_V0_R2_RANGE_REPORT.md`.

| File | Role |
|---|---|
| `v0-signer.php` | the "Laravel side": signs with the app's own AWS SDK (`aws/aws-sdk-php`), uploads/deletes the disposable test objects |
| `v0-r2-range-probe.mjs` | the "Node proxy side": runs the matrix with `fetch(..., {redirect: 'manual'})`, includes the reference SSRF host allow-list |
| `negative-control-proxy.mjs` | drops `Range` in front of a look-alike — proves the probe fails when a store mishandles Range |
| `result-selftest-scality.json` | **local look-alike** self-test (Scality CloudServer) — validates the harness, **NOT R2** |
| `result-negative-control-no-range.json` | the negative control run |

## Read the plan (no credentials)
```
node v0-r2-range-probe.mjs --plan
node v0-r2-range-probe.mjs --hostlist      # offline SSRF allow-list checks (15 cases)
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
  reduced to an allow-list, error bodies to the S3 `<Code>`, and every string is scrubbed.
* The tamper / method-confusion cases (`PUT`/`DELETE` with a GET-signed URL) are only ever aimed at those disposable test objects.
* Exit code 0 = every *required* case passed; informational cases only record behaviour.

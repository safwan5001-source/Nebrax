# IMP-H3-S2 — Partner import: `partner_master` domain, inspect/preview endpoints

**Branch:** `claude/imp-h3-s2-partner-endpoints` (stacked on H3-S1) · **No migration, env, ledger, ZATCA or AI-setting change.** Standard (deterministic) path; the AI action type (H3-S4) stays behind IMP-X-01.

## What it adds

- **Domain `partner_master`** (`ImportJobDomain::PARTNER_MASTER`) registered in `ImportDomainRegistry` with gates `partners.view` / `partners.manage` and **no capability gate** — exactly the gates of the direct `POST/PUT /partners` routes (none invented). The engine's per-domain authorization means a `partners.manage` user can run a partner job and **cannot** run a product job (tested both ways).
- **Endpoints** (`partners.manage`, upload routes behind `EnsureImportFilesScanned`):
  `GET /partners/import/template?type=` · `GET /partners/import/fields` · `POST /partners/import/inspect` · `POST /partners/import/preview`.
  `type` (`customer|supplier`) is mandatory and fixed by the entry point. **There is deliberately no synchronous `apply`** (rule 10): execution only goes through `POST /import-jobs` bound to a single-use preview; `POST /partners/import/apply` does not exist (404, nothing written).
- Preview returns counters, per-row status, the full error list and a **binding** (`ImportPreviewService::issue` with the row plan, so a bound job hits `plan_drift` if the data changed between preview and execution).
- `StoreImportJobRequest`/`ApplyImportJobRequest`: `options.type` (required for this domain — found by the tests: a `sometimes` rule skipped the check when `options` was absent), `duplicate_signal_policy`, and partner field keys in `mapping`.
- Repair, failures export and prune work through the generic S8 machinery (adapter already implements them).

## Tests

`PartnerImportApiTest` (8, SQLite + PostgreSQL): template/fields contract (no `type`/`opening_balance`/`tenant_id`); inspect (columns + suggested mapping, nothing written); preview (counters, binding row with canonical options, nothing written); no sync apply; RBAC (`partners.view` alone is refused, a products-only role is refused, `partners.manage` works, unauthenticated 401); a bound 250-row job runs in three chunks to `completed` and creates exactly 250 suppliers; an invalid row fails its window with named + rolled-back units and writes nothing; job gate per domain and mandatory `options.type`.
Existing guards stay green: `ImportDomainRegistryTest`, `ImportJobAuthorizationTest`, `ImportIntakeGuardTest` (route-invariant: the new upload routes carry the scan middleware). Related run: 160 passed.

## Notes / disclosures

- No UI yet (H3-S3). No Codex review (quota exhausted); independent subagent review noted in the PR if run.
- Partner import remains scoped by the active branch like `GET /partners`; code uniqueness is tenant-wide (see S1 report).

# AWJ Unified Import — Opus → Sonnet Handoff (end of H0)

> **From:** H0 (discovery and architecture), executed with Opus.
> **To:** the executor of H1 onward (Sonnet), under the same Horizon authority.
> **Read in this order:** this file → `AWJ_UNIFIED_IMPORT_HORIZON_TRACKER.md` → the relevant section of `AWJ_UNIFIED_IMPORT_MASTER_HORIZON.md` → `AWJ_UNIFIED_IMPORT_H0_DISCOVERY_REPORT.md` (evidence only when needed). Do **not** redo discovery.

---

## 1. Authority and stop rules (unchanged from the owner brief)

- Continuous slice execution and squash-merge are **authorized** for in-scope slices once CI is green on the final head and nothing is blocking. Do not ask for approval per PR.
- **Stop only for:**
  - a real data or security risk
  - a tenant-isolation doubt
  - a change to an accounting or tax rule, or a sensitive ZATCA change
  - a destructive or high-risk migration
  - a risk of duplicated financial or stock operations
  - activating an external AI provider or sending real data (D-02)
  - Railway, env or manual deploy work
  - a persistent failure
- When blocked, record the evidence and options in the tracker's decision log, **skip only the affected slice**, and continue with independent safe slices. H6 is pre-blocked on D-03, so go H5 → H7.
- **Every merge auto-deploys `main` to Railway and runs `migrate --force` at boot.**
  - Migrations: additive only.
  - New behavior: flag-off or entry-point-gated.
  - Never touch Railway, env vars, `AI_ACTIONS_EXECUTION_ENABLED`, remote image fetch, or the staged-image purge schedule.
- Per-slice bar, from CLAUDE.md and the brief:
  - Run the full `php artisan test` (no `--filter`) before each PR.
  - Run PostgreSQL tests for financial, concurrency and tenancy changes.
  - Run `npm run build` plus vitest for any `web/` change.
  - The PR body states the resulting journal entries for any new financial operation, or explicitly "no JE".
  - Write one implementation report per slice under `docs/plans/imports/reports/IMP-<slice>-REPORT.md`, using the fields in tracker §Slice log.
- **Never** mark Deployed or Verified without environment evidence.

## 2. Architecture you must preserve (one paragraph)

There is one execution core and two experiences. Every new entity gets an `ImportDomainAdapter`, introduced in H1-S2. The standard sync endpoints, the durable `ImportJob` domain and the AI Action type all call that same adapter for validate, match, plan and apply. The adapter writes **only** through domain services. Financial documents are imported as **drafts**; posting stays the existing explicit `post()`. A name is never an identifier. AI output is a suggestion, stored as a new action version with `origin=ai_suggested`, and is re-validated by the adapter. Document-type AI (PDF/images) reuses **Document Center**; never build another extractor. Details are in master plan §2.

## 3. First slice ready for execution: **IMP-H1-S1**

**Title:** Import jobs — honour the `inventory.core` app gate for `inventory_opening` jobs; prune media archives of completed jobs.
**Branch:** `claude/imp-h1-s1-import-jobs-gate-retention`, from the latest `origin/main`.
**Type:** security/retention fix. No migration, no accounting change, no UI change.

### 3.1 Problem (verified in H0)

1. `routes/api.php:568-572`: `/import-jobs` routes carry only `$perm(...)`. `POST /import-jobs` with `domain=inventory_opening` and `/import-jobs/{id}/apply` create an inventory-opening **draft** even when `inventory.core` is `disabled` (or `suspended`). The direct routes `inventory-openings/import/*` enforce `$app('inventory.core')` (`routes/api.php:1510-1518`).
2. `app/Console/Commands/PruneImportJobs.php:42-46` deletes `storage_path` only. A `completed` catalog job keeps `media_archive_storage_path`, so the ZIP stays in private storage forever. `cancel()` and the inspect-failure path already clean it (`ImportJobService.php:211, 600`).

### 3.2 Required change

**(a) Domain-aware app gate**

- Add a single mapping from domain to application key, for example `ImportJobDomain::applicationKey(string $domain): ?string`, returning `inventory.core` for `inventory_opening` and `null` for the product domains. The product domains have no app gate today; keep it that way.
- Enforce it with **exactly** the semantics of `App\Http\Middleware\EnsureApplicationActive`:
  - `enabled` passes.
  - `suspended` allows safe methods only (`GET`/`HEAD`).
  - Otherwise `403` with the same Arabic messages.
  - The cohort-enforcement and shadow-observation calls must still happen.
- **Preferred implementation:** extract the body of `EnsureApplicationActive::handle` into a public method (for example `authorize(Request $request, string $key): void`). `handle` calls it and then `$next`; `ImportJobController` calls it for `store` (key from the request `domain`, checked **before** any file is stored) and for `show`/`apply`/`cancel` (key from the loaded job's domain, after the tenant-scoped lookup).
- Do not duplicate the status logic in the controller.
- `index` stays ungated: it lists metadata only. Mention this in the report.

**(b) Prune completed-job archives**

- In `PruneImportJobs`, also delete `media_archive_storage_path` when it is not null, before deleting the row.
- In `--dry-run`, count only; no change to dry-run output semantics beyond that.

### 3.3 Tests (new, in the existing suites)

- `ImportJobInventoryOpeningApplyTest` (or a new `ImportJobApplicationGateTest`):
  - Use `registerTenant(..., autoEnableApplications: false)` as in `ApplicationSemanticsEnforcementTest.php:136`.
  - `POST /import-jobs` with `domain=inventory_opening` and `inventory.core` disabled → **403**, no `ImportJob` row, nothing stored.
  - With `inventory.core` enabled → a ready job, then disable it → `apply` returns **403**, there is no `InventoryOpening` draft, and the job status is unchanged.
  - With `inventory.core` suspended → `GET /import-jobs/{id}` returns 200, while `apply` and `cancel` return 403.
  - `product_catalog` jobs are unaffected when `inventory.core` is disabled (regression).
  - Cross-tenant: tenant B cannot apply tenant A's job (already covered; keep it green).
- `ImportJobTest` (prune):
  - A completed `product_catalog` job with a media archive, past `purge_after`, has its archive file deleted from the import disk and its row deleted.
  - `--dry-run` deletes nothing.
- Run the full `php artisan test` locally on SQLite. CI covers PostgreSQL.

### 3.4 Acceptance

- Every new test passes and the full suite is green.
- No route signature change; the `EnsureApplicationActive` middleware behaves identically for all existing routes (its existing tests stay green).
- PR body: "No journal entry; no migration; no UI change." Plus the tracker row update (Base/Head SHAs) and `docs/plans/imports/reports/IMP-H1-S1-REPORT.md`.

### 3.5 After merge

Continue with **IMP-H1-S2** (the adapter contract; characterization tests first). Then H1-S3 → S4 → S5 → S6, H2-S0..S4, and H3 onward, as in the tracker.

## 4. Known traps (save yourself time)

- The local environment lacks `bcmath` (the session-start hook warns about it). Fuel tests using `bcmul` fail locally but pass in CI; do not "fix" them.
- `QUEUE_CONNECTION=sync`: there is no real worker. Keep the client-driven chunk loop.
- `ProductImportService` header comment: it never imports quantity or cost and never posts. Keep that invariant, and its explicit test, for every adapter.
- `PartnerService::create` posts an opening-balance JE if `opening_balance` is present. The partner adapter **must strip it**, and a test must assert no JE (D-01).
- `ai_actions.enabled` has no write endpoint until H2-S4. Tests use `Settings::put`.
- Branch isolation: `Product`, `ProductCategory`, `Brand`, `UnitTemplate` and `Partner` are `BranchScoped` (`BranchShareable`). `ImportJob`, `AiAction`, `Warehouse` and `PriceList` are `CompanyWide`. Any new model must declare its classification (`BranchIsolationGuardTest`).
- Owner-facing communication is in Arabic, and the UI is RTL-first per `DESIGN_SYSTEM.md`.

# IMP-H1-S1 — Per-domain import-job authorization + media-archive retention fix

| Field | Value |
|---|---|
| Horizon / Slice | Unified Import · H1 · S1 |
| Standard Import status | 🟡 → ✅ (gates now match each domain's direct API) |
| AI-Assisted Import status | n/a (no AI surface touched) |
| Scope | Authorization and retention only. No migration, no accounting change, no UI change, no new route. |
| Dependencies | IMP-H0-S1 (#1595), IMP-H0-S2 (#1600, docs) |
| Branch | `claude/imp-h1-s1-import-jobs-gate-retention` |
| PR | _filled at PR creation (see tracker)_ |
| Base SHA | `a60fe8e` (`origin/main` at start) |
| Review | Codex quota exhausted. **Independent subagent review** performed (not Codex): findings are listed below. |
| Deployment | Auto-deploys on merge (Railway). No migration, no env/flag change. Behavior change is deliberate and narrow (see Risks). |
| Verification | Code Complete, CI pending → see tracker. Not Deployed/Verified. |

## Problem (verified in H0)

1. `/import-jobs` routes carried only `$perm('products.view|manage')`. An `inventory_opening` job could be created and applied (creating an opening **draft**) while `inventory.core` was `disabled`/`suspended`; the direct routes `inventory-openings/import/*` enforce that gate. Any future domain (partners, expenses, purchases) would have inherited *product* permissions.
2. `imports:prune` deleted only `storage_path`, so the image archive of a `completed` job stayed in private storage forever.

## Change

- `ImportJobDomain::authorization($domain)` — one map of `{view, manage, app}` per domain, matching the direct API's gates. Unknown domain throws (fail closed). A test fails CI for any domain registered without a declaration.
- `EnsureApplicationActive::authorize(Request, string)` — the middleware body extracted unchanged (`handle()` now calls it). **Only** place the application-gate rules live; cohort enforcement, shadow observation and the Arabic messages are preserved.
- `ImportJobAccess` — `assertView`, `assertManage`, `viewableDomains`. Order: RBAC (same `Rbac::allows` check and message as `EnsurePermission`), then application gate.
- Enforcement points:
  - `StoreImportJobRequest::authorize` (runs before validation and before any file is stored). An unknown `domain` is judged on the product-catalog gates (the old route behavior), then fails validation with 422.
  - `ApplyImportJobRequest::authorize` (domain read from the stored job, before option validation).
  - Controller: `show` (view), `cancel` (manage), `index` (filtered to viewable domains; empty list, never 403).
- `routes/api.php`: route-level `$perm` removed from the five `import-jobs` routes (comment explains why).
- `PruneImportJobs`: also deletes `media_archive_storage_path`.

## Behavior changes (deliberate, state them in release notes)

| Case | Before | After |
|---|---|---|
| `inventory_opening` job: create/apply/cancel with `inventory.core` disabled or suspended | allowed | 403 (nothing stored) |
| `inventory_opening` job: show with `inventory.core` disabled | allowed | 403 (suspended: allowed, read-only) |
| `GET /import-jobs` without `products.view` | 403 | 200 with an empty list |
| `GET /import-jobs` with `inventory.core` disabled | lists opening jobs | lists only the viewable domains |
| Product jobs | gated by products.* | unchanged |

Roles keep the same permissions as before for product domains (`products.view` / `products.manage`).

## Journal entries

None. No migration.

## Tests

`tests/Feature/ImportJobAuthorizationTest.php` (11 tests, 78 assertions):
- every domain declares valid gates; unknown domain throws;
- opening job create/apply refused when `inventory.core` is disabled, with no `ImportJob`, no stored file and no `InventoryOpening` draft; job status unchanged;
- suspended: read allowed, create/apply/cancel refused;
- disabled: show 403 and the list omits opening jobs while keeping catalog jobs;
- catalog jobs unaffected by a disabled `inventory.core`;
- a role without manage is refused on create/apply/cancel in every domain, and keeps view;
- a role without view: 403 on show, empty list, 403 on create (including an unknown domain);
- cross-tenant: 404 on show/apply/cancel, empty list;
- prune deletes a completed job's media archive file with its row; dry-run deletes nothing; a job inside its window is untouched.

**Negative control:** against the pre-change controller/requests/routes/prune, 6 of these 11 fail; with the change all 11 pass.

Existing suites run on the same tree: see tracker for the full-suite result.

## Risks

- A user relying on `/import-jobs` list returning 403 will now receive an empty list (UI not affected; first-party UI does not branch on it).
- A tenant with `inventory.core` disabled can no longer create or apply opening-import jobs through `/import-jobs`. That equals the direct route's behavior.
- `ImportJobAccess` builds on `EnsureApplicationActive::authorize`; `viewableDomains` calls it once per domain (3 today), which records shadow observations per call. Cost is trivial; the order of 403 vs other exceptions is unchanged.

## Next

IMP-H1-S2 — `ImportDomainAdapter` contract and registry (characterization tests first).

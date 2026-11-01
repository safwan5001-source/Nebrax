# IMP-PS-A1 — Partner statements: staging tables, canonical parser, inspect / preview / apply (Track A, no financial effect)

**Scope (owner, 2026-11-01):** PS-A1 only, on the existing Unified Import Engine, per `AWJ_IMP_PARTNER_STATEMENTS_PLAN.md`. **Not built:** PS-A2 or any matching engine, Track B / historical posting, invoices, vouchers, journal entries, stock movements. D-PS-05..09, D-03, D-06 and D-13 stay open and are not assumed. **No merge, no deploy, no Railway or environment change.**

## Approved decisions applied (D-PS-01..04)
| Decision | Where it lands |
|---|---|
| D-PS-01 SAR only, others rejected | option `currency`, per-row `currency` cell and the tenant currency are all checked; no conversion anywhere |
| D-PS-02 independent `partner_statements.*`, no implicit grant | `partner_statements.view` / `partner_statements.reconcile` added to `Rbac::PERMISSIONS` only (owner/admin via `*`); not in `MATRIX`, no stored role, no migration grant — asserted by test |
| D-PS-03 `CompanyWide`, tenant isolation, existing visibility controls | both models `CompanyWide`; partner resolved with `BranchScope::reference(Partner::class)` exactly as `ReportService::partnerStatement`; actor must also hold `partners.view` |
| P-1 date tolerance | default 3, 0–30 per run, integer |
| P-2 amount tolerance | default 0 halalas, 0–10000, integer; any `%` value refused |
| P-3 one-column direction | `amount_direction` (`positive_is_debit` / `positive_is_credit`) **mandatory** for an `amount` column, refused for debit/credit files; a lone debit or credit column is refused as ambiguous |
| P-4 reversed entries | recorded in the frozen policy (`include_reversed: true`, same source as the statement report, no doubling); used by PS-A2, nothing to compute in A1 |
| P-5 partner at tenant level, optional branch filter | `branch_id` option, must exist and be inside the actor's branch scope; stored in the policy |

## What was built
- **Domain `partner_statement`** in the existing engine: `ImportJobDomain` (gates `view = partner_statements.view`, `manage = partner_statements.reconcile`, **`app = null`** — D-PS-08 is open, so no catalogue key was invented), `PREVIEW_BOUND_ONLY`, `ImportDomainRegistry`, `PartnerStatementImportAdapter` (atomic file unit, 2000 rows, no AI path), `StoreImportJobRequest` / `ApplyImportJobRequest` option rules (frozen options are compared at apply: `options_frozen`).
- **Endpoints** (`/api`): `GET partner-statements/import/template|fields`, `POST …/inspect` (file only — reads no partner data), `POST …/preview` (returns the single-use binding). **No synchronous apply**; the write happens only through `POST /import-jobs` bound to a preview. Route gate `partner_statements.reconcile` + the file-scan middleware.
- **Staging tables** (additive migration `2026_12_25_010000`): `partner_statement_reconciliations` (partner, role, period, `SAR`, status `draft`, file SHA-256, source job, totals, frozen `policy`, `checks`) and `partner_statement_lines` (as printed by the counterparty: `debit_minor` / `credit_minor` halalas, normalized reference keys for PS-A2, printed running balance, kind). Composite FK `(tenant_id, reconciliation_id)`; unique `(tenant, partner, role, from, to, sha256)` for idempotent re-upload; lines immutable (model guard); `down()` refuses while data exists. No FK or reference to any journal table.
- **Canonical parser** (`PartnerStatementCellParser`, pure): dates (`YYYY-MM-DD`, `DD/MM/YYYY` day-first, Excel serial), unsigned halala amounts (ambiguous European comma refused), signed amounts (`-x`, `(x)`, `x-`, `+x`; mixed forms refused), SAR recognition, kind aliases (unknown = warning).
- **Checks:** per-row errors (named, Excel row numbers), out-of-period lines = warning, in-file repeats = warning, printed running balances = **consistency warning only** (sign-agnostic, never a blocker, never a matching input).
- **Apply (atomic):** re-authorizes and re-validates everything, then creates the header + lines in one transaction; same file for the same partner/role/period returns the existing reconciliation (`replayed`), under a PostgreSQL advisory lock (+ unique index as last resort).

## Accounting statement
**No journal entries, no stock movements, no invoice/voucher/payment/expense/credit-note, no partner or balance change, no ZATCA artefact.** Verified two ways: a test compares row counts of 9 financial tables and a hash of `partners` before/after a full import; a static test (comments stripped via the token stream) asserts none of the feature files reference `LedgerService`, journal tables, `InventoryService`, `Zatca*`, or any document service. Nothing to tabulate for the pre-PR journal-entry table.

## Authorization matrix (verified by tests)
| Actor | inspect | preview | create/apply job | notes |
|---|---|---|---|---|
| owner / admin (`*`) | ✅ | ✅ | ✅ | |
| `partner_statements.reconcile` + `partners.view` | ✅ | ✅ | ✅ | |
| `partner_statements.reconcile` **without** `partners.view` | ✅ (file only) | ❌ 422 "الطرف غير متاح لك في هذا الدور." | ❌ at apply | partner name never disclosed |
| `partner_statements.view` only | ❌ 403 | ❌ 403 | ❌ 403 | view ≠ reconcile; reading a job also needs `partners.view` |
| `partners.manage`, accountant, staff | ❌ 403 | ❌ 403 | ❌ 403 | no implicit grant |
Partner unavailable for any reason (other tenant, unknown id, wrong role, invisible) → **one identical message**, asserted equal across all four causes and free of the foreign partner's name.

## Files changed
Backend: `app/Support/{Rbac,ImportJobDomain}.php` + `app/Services/ImportJobAccess.php` (edit) · `app/Support/PartnerStatement{ImportFields,CellParser}.php` · `app/Models/PartnerStatement{Reconciliation,Line}.php` · `app/Services/PartnerStatementImport{Service,Adapter}.php` · `app/Services/ImportDomainRegistry.php` · `app/Http/Controllers/Api/PartnerStatementImportController.php` · `app/Http/Requests/PartnerStatement{Import,Inspect}Request.php` · `app/Http/Requests/{StoreImportJobRequest,ApplyImportJobRequest}.php` · `routes/api.php` · `database/migrations/2026_12_25_010000_create_partner_statement_tables.php`.
Tests: `tests/Feature/PartnerStatementImportTest.php` (34) · `tests/Feature/PartnerStatementImportConcurrencyPostgresTest.php` (2).
Web (minimal, to keep the Hub and the role editor from breaking on the new domain/permissions): `modules/import-jobs/client.ts` (union), `modules/imports/catalog.ts` (+ test: no resume link until the PS-A4 wizard), `messages/{ar,en}.json` (`domain_partner_statement`, role-editor labels `partner_statements` / `reconcile` required by the `Rbac::PERMISSIONS` label-coverage guard).
Docs: this report, the plan (decision note), the Tracker (decision log + parked row).

## Tests
- `PartnerStatementImportTest` **35** + `PartnerStatementImportConcurrencyPostgresTest` **2** — all green on **SQLite and PostgreSQL**: registration/gates/no-implicit-grant · fields/template/inspect · preview counts/totals/policy · direction (declared, sign flips, ambiguous forms, lone column, mixed) · currency (option, row, tenant) · tolerances (bounds, percentage) · period (order, span, bad dates, out-of-period warning) · invalid files and rows (11 cases) · balances warning · repeats/kind warnings · apply stores header+lines+policy · **re-upload replay** and distinct identity variants (content/period/partner/role) · unbound job and changed options refused · frozen options at apply (8 fields) · permissions matrix · losing visibility before apply · identical refusal for unavailable partners · cross-tenant isolation and foreign binding · branch filter in/out of scope · static financial wall · line immutability · migration rollback guard · quoted formula cells.
- PostgreSQL real-fork race (6 processes, same file → exactly one reconciliation and one set of lines, 5 replays, zero DB errors; 4 different files → 4 reconciliations).
- **Mutation controls (each fails tests):** job-read `partners.view` requirement removed · partner data re-added to the stored result · `partners.view` check removed · role/type check removed · SAR option check removed · direction requirement removed · replay removed · branch-access check removed · PostgreSQL advisory lock removed (race test fails).
- Web: `modules/imports` + `modules/import-jobs` + capabilities guard green (99+); `tsc` clean for touched files (the pre-existing `useImportJobEngine.test.tsx` error is unrelated).
- **Codex review (3 rounds): two valid P2 findings fixed** — (1) the downloadable template mixed the `amount` column with debit/credit, which the mapping guard rejects, so the shipped example could not be uploaded unchanged → template is now debit/credit only, with a round-trip test; (2) `ApplyImportJobRequest` did not accept the statement field keys, so repeating an explicit mapping at apply returned 422 → keys added, with a test (accepted when unchanged, `options_frozen` when changed). (3) **P1 (cd09899): reading a statement import job bypassed partner visibility** — `GET /import-jobs` and `/import-jobs/{id}` authorize through the domain permission only and returned `apply_result` with the partner name and every line. Fixed in two layers: `ImportJobDomain::alsoRequires()` makes the domain also require `partners.view` on every job read/create/apply (list filtered, revocation effective immediately), and the stored result now carries only the reconciliation id and counters (no partner identity, references, descriptions or amounts). Tested incl. revocation after completion; both layers mutation-verified. Earlier review (`ac68b63`): no findings.
- **CI web-build catch:** the label-coverage guard `modules/roles/catalog.test.ts` requires a role-editor label for every `Rbac::PERMISSIONS` module/action → added (`08f6ded`).

## Verification (local, Laravel mirror)
- Targeted: `PartnerStatementImport*`, `ImportDomainRegistry`, `ImportJobAuthorization`, `BranchIsolationGuard`, `ImportJobDomain*` — green on SQLite and PostgreSQL (only the 2 environmental `PublishedVersionArchiveTest` cases fail).
- Full SQLite suite (on `abb24ca`, before the two Codex fixes): **10203 passed, 307 skipped, 46 failed — all 46 environmental in this sandbox, none in this feature:** Fuel suites (36, need `bcmath`), `FuelStationScopeApiTest` (bcmath), `InventoryOpeningZeroValueDateGuardTest` (2, known), `AppSchemaContractCheckerTest` / `BuilderDraftOptimisticLockTest` / `PublishedVersionArchiveTest` (the mirror lacks the repo's `contracts/` folder), `RetailCustomerAccountsTest` / `BuyerMailFailureLoggingTest` (the mirror lacks `resources/views/emails`). CI runs the real tree on both databases.
- Full web suite: 9186 tests passed; 5 test *files* fail to load locally because `libphonenumber-js` is not installed in this sandbox (phone / auth / app-builder files, unrelated); CI installs dependencies.

## Owner review of 2026-11-01 (post hand-off) — one defect fixed inside A1
Read-only review of the whole slice found **one impactful defect (P1)**: idempotency was keyed on the file bytes alone, so re-uploading the *same file with a different interpretation* (a corrected `amount_direction`, tolerance, mapping or branch filter) silently returned the earlier — wrongly interpreted — draft as `replayed`, and A1 has no discard, so the user was trapped. This contradicts the approved period policy (multiple drafts allowed; do not trap the user in a wrong draft).
**Fix:** new column `identity_sha256` = SHA-256 of {file hash, effective column mapping, frozen policy}; the unique index `partner_stmt_recon_idem_unique` moved to `(tenant, partner, role, period_from, period_to, identity_sha256)`; `file_sha256` stays (indexed, informational); the advisory lock keys on the identity. Same file + same interpretation still replays; same file + different interpretation is a new draft and the old one is untouched. The migration was edited in place (not yet merged, no environment has it); its filename/date is unchanged. Regression test `the_same_file_under_a_different_interpretation_is_a_new_draft_and_the_old_one_is_untouched` (mutation-checked: reverting the identity to the file hash fails it).

## Risks and disclosures
1. **No application-key gate yet.** D-PS-08 is now approved (independent catalogue key); wiring it is PS-A2a (see `AWJ_IMP_PS_A2_EXECUTION_PLAN.md` §6). Until then access is governed by the two permissions + `partners.view` only.
2. **Period policy (approved 2026-11-01):** many drafts per scope are allowed and A1 never limits them; the *one effective final* guarantee (`closed`, partial unique index, advisory lock, events) is designed in the PS-A2 plan §5 and built in PS-A3. A1 deliberately has no close/discard.
3. **Direction semantics:** lines are stored **as printed by the counterparty**; translating debit/credit to our ledger's side per role is PS-A2's job (and where a wrong assumption would hurt). Two-column files carry no explicit perspective flag — documented in the fields class.
4. **Balance consistency is sign-agnostic** (|Δbalance| = |amount|): it cannot detect a flipped sign convention, only a truncated/mixed file.
5. Statement text can contain commercial data; it is kept only in the tenant's staging tables and never sent to an AI provider (no AI path).
6. Local note: `PublishedVersionArchiveTest` fails in this sandbox's Laravel mirror (missing `contracts/` folder) — environmental, unrelated.

## Next step
**PS-A2 — matching engine + explanation + totals** (read-only service over these tables and the ledger source used by `ReportService::partnerStatement`), after the owner approves the A2 plan (D-PS-10..13). PS-A3 adds review/close; PS-A4 the wizard; Track B stays blocked on D-PS-05..07, D-03, D-06, D-13.

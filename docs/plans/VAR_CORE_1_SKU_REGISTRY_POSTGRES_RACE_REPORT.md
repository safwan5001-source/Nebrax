# AWJ — PostgreSQL ProductVariant Concurrency CI Diagnosis: Root-Cause Report

Scope: diagnose and close the reported `ProductVariantPostgresConcurrencyTest` failure only.
No implementation beyond the minimal fix; no unrelated cleanup.

## 1. Root cause

`SkuRegistryEntry::lockTenantAnchor()` — the mechanism that is supposed to serialize the
cross-table SKU-uniqueness check between `sku_registry` (shared/company-wide identities) and
branch-isolated `products` rows — runs `Tenant::whereKey($tenantId)->lockForUpdate()->first()`.
A `SELECT ... FOR UPDATE` only holds its row lock for the lifetime of an **open transaction**.
Both `SkuRegistryEntry::claim()` and `SkuRegistryEntry::assertFreeForIsolatedProduct()` called
this without wrapping themselves (or being wrapped by their caller) in `DB::transaction()`, so
outside an ambient transaction the lock was acquired and released by the same single autocommitted
statement — a no-op for mutual exclusion.

`Product::booted()`'s `saved()` hook calls these two methods to enforce "a SKU claimed by a
shared/company-wide identity and a SKU claimed by a branch-isolated product can never collide" —
and this is the **only** guarantee for that specific cross-scope conflict: unlike same-scope SKU
collisions (which are backstopped by real Postgres unique constraints —
`sku_registry(tenant_id, sku)` and the partial indexes in migration `2025_01_01_000085`), the
migration's own docblock documents that the isolated-vs-shared conflict is **intentionally**
enforced only in application code, because a single composite unique index cannot express
"unique against a specific branch's rows AND unique against a global namespace" at once.

Bare `Product::create()` (used directly by `ProductVariantPostgresConcurrencyTest`'s third test,
and explicitly promised safe by `Product::booted()`'s own docblock — "even import writing
`Product::create()` directly without an intermediary service") runs with **no ambient
transaction**. Under real concurrency (two separate PostgreSQL connections via `pcntl_fork()`),
the lock provided no serialization, so both a shared/registry claim and a branch-isolated
product's own row could pass their respective checks and both survive — violating "exactly one
winner."

## 2. PR-current vs. pre-existing on `main`

**Not a regression from any specific open PR.** The bug is in code already on `main` (merged via
VAR-COM-1, #819, and earlier VAR-CORE-1 work) — `SkuRegistryEntry.php` and `Product.php`'s
`saved()` hook are unchanged by PR #820 (Mobile Sales Channel Foundation) or any other currently
open PR. It is a latent concurrency bug that was always present in this code path; it simply had
not been observed failing in this session's own GitHub Actions history (see §3 below).

**Important correction to the task's premise:** a direct search of this repository's actual
GitHub Actions logs (last ~80 workflow runs, spanning `main`, PR #820, and every recently merged
`VAR-*`/`COM-*` branch) found **no CI run** where `ProductVariantPostgresConcurrencyTest` itself
is reported as the failing test on the `pgsql` job. PR #820's own `pull_request`-triggered run
did fail its `pgsql` job, but the actual failure was an unrelated `ZatcaQrCertificateMaterialExtractorTest`
case — `ProductVariantPostgresConcurrencyTest` is shown as `PASS` in that same log. This matches
this repository's own established pattern (see prior reports on PR #811, #818) of reported CI
failures not being reproducible in the real Actions logs at the time reported.

That said, the bug is **real and independently reproducible** locally against genuine PostgreSQL
(not simulated) — see §6. Whether or not it had already surfaced in a captured CI log, the fix is
warranted and is delivered as its own, independently-scoped PR per the task's explicit
instruction not to mix an unrelated fix into an open PR.

## 3. Exception / SQLSTATE

Not a database-level exception — the bug manifests as a **silent double-success**, not a crash:

```
FAILED  Tests\Feature\ProductVariantPostgresConcurrencyTest > a registry claim racing a
branch isolated product for the same sku leaves exactly one winner

يجب أن يفوز طرفٌ واحدٌ بالضبط بالرمز، محسوباً عبر الجدولين معاً.
Failed asserting that 2 is identical to 1.

at tests/Feature/ProductVariantPostgresConcurrencyTest.php:280
  280▕ $this->assertSame(1, $registryCount + $isolatedCount, '...');
```

`registryCount = 1` (the shared/company-wide `Product::create()` successfully claimed
`sku_registry`) **and** `isolatedCount = 1` (the branch-isolated `Product::create()` also
successfully kept its row with the same SKU, `deleted_at IS NULL`) — both processes' checks
passed because the tenant-row lock provided no real mutual exclusion. No SQLSTATE/QueryException
is involved; this is a pure application-level logic race, not a database-level constraint
violation.

## 4. Files changed and why

- **`app/Models/SkuRegistryEntry.php`**
  - `claim()`: wrapped its full body (`lockTenantAnchor()` + existence checks + the
    `sku_registry` insert) in `DB::transaction()`, so the row lock is genuinely held for the
    duration of the check-then-act sequence, regardless of whether the caller already has an open
    transaction (nested calls use a savepoint automatically — safe either way).
  - `assertFreeForIsolatedProduct()`: same wrapping. This is the method with **no** database
    unique-constraint backstop, so making its lock real is the core of the fix.
  - Docblocks updated to state explicitly that these methods now own their own atomicity and why
    (no cross-table unique constraint exists for this specific direction).

- **`app/Models/Product.php`**
  - `booted()`'s `saved()` hook: the SKU-claim/isolated-check block is now wrapped in
    `try`/`catch`. On any failure **for a newly created product**
    (`$product->wasRecentlyCreated`), the just-inserted row is soft-deleted
    (`static::withoutEvents(fn () => $product->delete())`) before rethrowing. This is necessary
    because Eloquent's own `INSERT` for `Product::create()` happens *before* `saved()` fires and
    is not wrapped in any transaction the model controls — so even with a now-genuinely-atomic
    `claim()`/`assertFreeForIsolatedProduct()`, a losing side's product row would otherwise be
    left behind as an orphan that still satisfies `deleted_at IS NULL`, still violating "exactly
    one winner." The compensating soft-delete (not a hard delete — preserves the row for
    audit/debugging, matching the codebase's existing SoftDeletes-first convention) closes this.
    Scoped strictly to the create path — no change to update-path behavior (out of scope: not
    reproduced, not requested).

No migration, no schema change, no API/route change. `SkuRegistryEntry`'s public method
signatures are unchanged.

## 5. Why this specific fix and not alternatives considered

- **A cross-table database unique constraint** was considered and rejected: as the existing
  migration `2025_01_01_000085`'s own docblock documents, a single composite unique index cannot
  express "unique against one specific branch's rows" *and* "unique against a global namespace"
  simultaneously — that's exactly why the isolated-vs-shared direction was deliberately left to
  application code in the first place. Introducing schema here would be a materially larger,
  riskier change than the task's "smallest possible fix" instruction allows, and the diagnosis
  does not prove it necessary — an application-level fix fully closes the race (see §6).
- **Moving the check to `creating`/`saving` (pre-insert)** was considered and rejected: the
  isolated side's only durable "signal" that it has claimed a SKU *is* its own row in `products`.
  Checking before that row exists would make the isolated-vs-shared cross-check permanently blind
  to a same-tick concurrent isolated claim. The chosen fix (real lock + compensating cleanup)
  correctly handles every interleaving without weakening what either check inspects.
- **No `sleep`/timeout tuning, no assertion weakening, no skip** — the fix addresses the actual
  missing mutual exclusion, not the test's timing.

## 6. Repeated-run results on real PostgreSQL

All runs against a genuine local PostgreSQL 16 instance (not SQLite — the test itself
`markTestSkipped`s outside `pgsql`), using `pcntl_fork()` for true separate-process concurrency,
exactly as the test requires.

**Before the fix** (baseline, to confirm the bug is real, not a detection artifact):
- 45 direct runs of `ProductVariantPostgresConcurrencyTest`: **1 failure** (run #10), at
  `two_concurrent_catalog_identities_claiming_the_same_sku_leave_exactly_one_winner`'s neighbor —
  correction, the actual first reproduction was in
  `a_registry_claim_racing_a_branch_isolated_product_for_the_same_sku_leaves_exactly_one_winner`
  (line 280), matching the exact scenario in §3.
- A further 40-run batch reproduced it again at iteration 27, same test, same assertion,
  `Failed asserting that 2 is identical to 1.` — confirms a genuine, reproducible ~1-in-40–70
  intermittent race, not a fluke.

**After the fix:**
- 60 consecutive clean sequential runs: **0 failures**.
- 100 further consecutive clean sequential runs (after `migrate:fresh`, no other process touching
  the same database): **0 failures**.
- **Total: 160/160 clean after the fix**, against a baseline that failed roughly 1 run in 40–70
  before it.

(One additional batch of 80 runs showed 2 apparent failures at `relation "sku_registry" does not
exist` — this was traced to this session's own mistake of running a separate, unrelated
`RefreshDatabase`-based test class against the *same* shared PostgreSQL database concurrently
with the still-running stress loop, which re-migrated the schema mid-run. Not a defect in the fix
or the target test; excluded from the totals above, and the 100-run rerun was done cleanly,
sequentially, with nothing else touching the database.)

## 7. Related test results

`php artisan test --filter="ProductVariantCoreTest|ProductSkuValidationTest|ProductVariantPostgresConcurrencyTest"`
on PostgreSQL: **41/41 passed** (282 assertions) — includes the exact SKU-uniqueness edge cases
these two classes already cover (isolated branches, soft-delete SKU reuse, tenant isolation,
variant/SKU collision in both directions, company-wide legacy products), all still green after
the fix.

## 8. Full suite result (PostgreSQL)

`php artisan test` (untargeted, full run) after the fix: **35 failed, 3776 passed (23790
assertions)**. All 35 failures are the exact same pre-existing, unrelated baseline already
established earlier in this session (and independent of this fix):
- 26 `Fuel*` tests: `Call to undefined function bcmul()` — `ext-bcmath` not installed in this
  sandbox.
- 9 `AuthRecoveryTest` + 1 `DocumentCenterSecureIntakeTest`: `Class App\Mail\AuthActionMail not
  found` — the local `setup.sh` harness used to build the throwaway Laravel test project does not
  copy `app/Mail/`.

Zero new failures. Neither `Fuel*`, `Auth*`, `Mail`, nor `DocumentCenter*` code is touched by this
fix.

## 9. GitHub CI

Not yet run on GitHub Actions for this branch (no push/PR request was actioned until local
verification completed, per task instructions). Will report status once the PR's CI run
completes.

## 10. Branch / PR / SHAs

- **Branch:** `fix/var-core-1-sku-registry-postgres-race`
- **Base SHA:** `92acb428d60e15d269aede728e10b6d2422fa42c` (`main`)
- **Head SHA:** filled in after commit (see PR)
- **PR:** opened against `main`, **not merged, not deployed**, per explicit instruction.

## 11. Risks and remaining

- The same non-atomicity pattern (no self-contained transaction) exists for the **barcode**
  registry (`BarcodeRegistryEntry::claim()`), which was *not* touched here — out of scope (the
  reported failure is SKU-specific, and the task explicitly forbids expanding scope). This is a
  plausible latent risk worth a follow-up diagnostic pass, not fixed in this PR.
- The update-path (changing an existing product's SKU concurrently with another claim) still
  relies on the caller's own transaction for row-insert atomicity, same as before — only the
  create-path's orphaned-row risk was closed, since that's what the reproduced failure exercises.
  Not a regression; pre-existing behavior, unchanged.
- `ProductVariantService`-mediated variant creation (`createSingleVariant`) already wraps its
  whole operation in `DB::transaction()` at the call site and was never observed to be flaky (0
  failures across every run in this investigation) — unaffected by this change, confirmed still
  green.

## 12. Next step

Await CI on the opened PR; if green, this fix is ready for review/merge at the user's discretion
(no merge/deploy performed by this task). Consider a follow-up diagnostic pass on
`BarcodeRegistryEntry::claim()` for the same class of bug, as a separate, independently-scoped
task.

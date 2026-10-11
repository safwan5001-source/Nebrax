# AWJ-TAX-REM-02 — Credit Note VAT Accuracy · Implementation Report

| | |
|---|---|
| **Task** | REM-02 from the audit/remediation plan (PR #1290) — closes **VAT-02** (P1) and **ACC-06** (P2) |
| **Branch** | `claude/awj-tax-rem-02-credit-note-vat` |
| **PR** | [#1304](https://github.com/safwan5001-source/Nebrax/pull/1304) — open, ready for review, not merged |
| **Base SHA** | `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0` (`origin/main`, includes merged #1291 / REM-01) |
| **Head SHA** | `6f9fa4a850474cc6b315e52ac749224234cd70eb` (code head; this report is committed after it, so the PR head is one docs-only commit ahead). Main at last merge: `bdecbd01668df6cb43cd3899b3d9ba10f24a4b03` |
| **Owner decisions applied** | **ADR-E → Option A** (source invoice required by default; standalone only by setting). **Migrations → both** (`source_line_id` + `restrictOnDelete`), additive only. |
| **Status** | Pre-merge review round done (§0). **Not merged, not deployed, no production migration run. Awaiting owner approval.** |

---

## 0. Pre-merge review — owner decisions (2026-10-11) and outcome

| # | Decision | Outcome | Evidence |
|---|---|---|---|
| 1 | No bypass of the VAT/amount cap, **even when POS runs concurrently with a credit note** | **Done.** One lock order everywhere: *source invoice row → branch row → tenant*. `PosReturnService::create` (both entry paths) and `PosExchangeService::create` now take the invoice lock **first** (`SourceInvoiceLock`), before the branch idempotency lock. Notes and API returns already took invoice → branch. | `CreditNotePosLockOrderPostgresTest` (4 tests, real `pcntl_fork` processes calling the real `PosReturnService::create`): POS vs note, POS vs API return, 3-way partials, 4-way mixed deadlock stress (4 rounds). **Mutations:** lock removed → 3/4 fail (over-credit); lock taken *after* the branch lock → `SQLSTATE[40P01] deadlock detected` (proves why the order matters); correct order → 4/4 pass on 6 consecutive runs. |
| 2 | Fix refund of withheld amounts after reduced-price notes — pre-merge condition | **Done.** POS final part no longer sweeps a prior reduced-price hold-back (`1f1c5ba`); the API/note paths already honour it through the shared allocator (`min_price`), now fed by notes too. | Tests for every pair: note→API return, API return→note, note→note, API return→POS, note→POS (`…withheld…`), the returnable flag, and a seeded random sequence test (10 cases: never exceeds invoice net/VAT at any prefix; exact to the halala at full price). |
| 3 | Legacy notes that cannot be tied to an invoice line must not allow unsafe extra reversal — **targeted block + safe finance review path, no edit of posted documents** | **Done.** Per-invoice block (not global): further credit notes, API returns, POS returns/quotes on an invoice that has posted pre-REM-02 note lines with **no product or an ambiguous product** are refused with an explicit message and surfaced as `blocked_reason = legacy_credit_review` (sources list, returnable endpoint, web). Attributable lines (single matching product) keep being counted automatically. **Finance path:** `php artisan credit-notes:legacy-review --tenant=` (read-only list with candidate lines) and `credit-notes:legacy-resolve <line> --tenant= (--attribute-to=<invoice line> \| --not-applicable) --reason= --by=<reviewer e-mail>`; each decision is an **append-only overlay row** (`credit_note_legacy_reviews`: outcome, mandatory reason ≥ 10 chars, reviewer of the same tenant, timestamp). Nothing in `credit_notes`/`credit_note_lines`/invoices is modified. | `CreditNoteLegacyBlockTest` (11 tests): no-product and ambiguous cases block note/return/POS and the list/endpoint; other invoices and attributable lines unaffected; attribute-to counts against the cap and lifts the block; not-applicable lifts without counting; snapshot proves no posted row changes; input validation (both/none options, short reason, unknown reviewer, foreign-invoice line, already-resolved, bad tenant UUID); append-only; cross-tenant isolation. Mutation (block disabled) → tests fail. |
| 4 | Keep ADR-E Option A, but give users a clear path to create an invoice-linked note | **Done.** `/credit-notes/new` defaults to **invoice-linked** mode (customer → posted invoice → lines with remaining qty, optional lowered price, preview through the shared allocator mirror). Standalone mode appears only if the tenant setting allows it, otherwise a hint points to Sales settings. Deep link `/credit-notes/new?invoice=<id>` and a "create credit note" action on posted invoices; the Sales-settings toggle exists. Blocked invoices are listed disabled with the reason (incl. `legacy_credit_review`). | 13 vitest tests (`invoice-linked.test.ts`) + existing helper tests; `tsc` clean for touched files; web build in CI. Not exercised in a real browser. |
| 5 | Do **not** widen REM-02 into a general document-template redesign; document the display problem and propose the smallest independent fix | **Done (docs only).** | `docs/audits/AWJ-TAX-REM-02-PRINT-AMOUNTS-NOTE.md`: root cause, the two remaining cases (discounted line; per-unit rounding), and the smallest independent fix — one optional `lineNet` field + one opt-in `line_net` column for credit/debit-note templates (row reads *amount before tax + tax = total*, exact). Not implemented. |
| 6 | Separate the price-adjustment-without-quantity decision into a clear ADR, without changing financial rules automatically | **Done (docs only).** | `docs/audits/ADR-E2-PRICE-ADJUSTMENT-CREDIT-NOTES.md` — **Proposed**, options A/B/C, the Finance/tax questions that must be answered first, sizing of the implementation. Current behaviour (price-only notes consume quantity) unchanged. |
| 7 | Focused tests on SQLite and PostgreSQL: concurrency, discounts, rounding, tenant isolation | **Done** — see §8. | |
| 8 | Address open Codex findings with evidence; update report and PR | **Done** — see §0.1 and the PR. | |

### 0.1 Codex threads

| Thread | Resolution |
|---|---|
| Legacy credits in the cap (P1, ×2) | Attributable lines counted at read time (`fa1090f`); **unattributable lines now block the invoice + finance review path** (decision 3). |
| Rollback keeps prior policy values (P2) | Marker-based `down()` (`fa1090f`). |
| Printed line amounts (P1, ×3) | Pre-tax unit price printed (`9a8a2eb`); discount/rounding limit documented with the smallest independent fix (decision 5); thread left for the owner. |
| Return-source list ignores notes (P2) / POS derivation (P1 ×3) | Fixed (`2675c9a`, `6c7f019`, `1f1c5ba`). |
| Serialize POS with credit-note posting (P1) | **Fixed in this round** (decision 1) — supersedes the earlier "follow-up slice" reply. |
| Usable path before disabling standalone (P1) | Toggle (`6c7f019`) + invoice-linked screen (decision 4). |

### 0.2 Lock order — design and rollout

* **Order (all sourced reversal paths):** `invoice (FOR UPDATE)` → `branch (numbering/idempotency anchor)` → `tenant`.
  `CreditNoteService::post`: note → invoice → ledger. `ReturnService::post` (non-POS): return → invoice → ledger. POS return / exchange: invoice → branch → … (new). The ledger's journal numbering locks the branch row, which is why taking the invoice **after** the branch deadlocks (reproduced).
* **Change size:** 1 new 40-line class + 3 one-line calls; no schema change, no setting.
* **Rollout:** code-only, no migration; safe to deploy in any order across app servers (the lock is advisory to the code, not a DB object). **Rollback** = revert the 3 calls (restores the old behaviour including the old race; no data impact).
* **Monitoring after deploy:** PostgreSQL log for `40P01` (deadlock) and the POS return latency; any occurrence ⇒ stop and report (the stress test did not reproduce one in 6 consecutive runs of 4 rounds).
* **Not covered (pre-existing, unchanged):** flows that take a branch/numbering anchor and *then* lock an existing invoice for a different purpose (e.g. payment allocation in the same transaction as document creation) — same class of risk as before this PR, not introduced by it.

---

## 1. Summary

A sales credit note that references a posted invoice no longer recomputes VAT from the client's price and a hard-coded 15 %. Each note line is bound to its **source invoice line** (`source_line_id`) and inherits from it — through the **same `ReturnSourceAllocator` REM-01 introduced** — the charged net base (after line discount and the line's share of the header discount), the charged VAT, and the invoice's tax rate, in the invoice's inclusive/exclusive mode. Amounts are allocated by quantity (`F(c+q) − F(c)`), so any split, in any order, sums to the charged amount **to the halala**.

The cap is **cumulative and shared with returns**: quantity, net and VAT consumed by *posted* returns **and** posted notes are deducted from what is left. Posting re-derives under a `lockForUpdate` on the invoice row (the same row `ReturnService::post()` locks), so concurrent posts cannot over-credit.

| Defect | Before | After |
|---|---|---|
| Probe R2-style: credit a 1 × 115.00 **inclusive** invoice in full (screen default price = 115.00) | net 115.00 + VAT **17.25** = **132.25** (Dr 2120 17.25) | net 100.00 + VAT **15.00** = **115.00** |
| **Probe R4**: qty 2 against 1 sold, inclusive | 230.00 + **34.50** = **264.50** posted | **rejected** (422 — quantity exceeds remaining) |
| Invoice 100.00 with 10.00 header discount (charged VAT 13.50) | 100.00 + **15.00** = 115.00 | 90.00 + **13.50** = **103.50** |
| 7 × 0.10 (invoice VAT 0.11), seven 1-unit notes | Σ VAT **0.14** | Σ VAT **0.11** |
| Default sales rate changed to 5 % — standalone note without a rate | **15 %** (hard-coded) | **5 %** (`sales.default_tax_rate`) |
| Default rate changed to 5 % — note against a 15 % invoice | 15 % (client-sent) | 15 % (inherited from the invoice line) |
| 3-unit invoice: 1 returned + 2 credited, then 1 more credit | accepted (no cap) | **rejected** |
| Note against a draft / cancelled invoice, another customer's invoice, another invoice's line | accepted | **rejected** |

## 2. ADR-E (owner-approved Option A) — how it is implemented

* New tenant setting **`sales.allow_standalone_credit_notes`**, default **`false`** (`Settings::DEFAULTS`, also accepted by `UpdateSalesSettingsRequest` / `PUT /api/sales-settings`).
* **New tenants** have no stored key → default `false` → a sales note without `original_invoice_id` is refused with an explicit Arabic message pointing at the setting.
* **Existing tenants** — migration `2026_11_04_030000` pins `true` for every tenant that has **no stored value** (precedent: `000088` / `enforce_min_sale_price`). A tenant that already holds an explicit value is never touched. No guess from historical usage. `down()` removes only what the migration pinned (a companion marker), so an earlier explicit choice or a value the tenant saved afterwards survives rollback + redeploy.
* A standalone note keeps today's behaviour (exclusive-only, **uncapped**) but takes its rate from `sales.default_tax_rate`, never 15 hard-coded.
* The gate is checked **at creation** (like `require_return_source`); an already-drafted standalone note is not blocked at post.
* **Purchase debit notes are not affected** by the policy. (They only gain the configured `purchases.default_tax_rate` instead of a hard-coded 15 when the line has no rate; both defaults are 15, so no tenant changes unless they had changed the setting.)

## 3. Design

* **Source resolution** (`CreditNoteService::resolveInvoice`): tenant-scoped lookup (foreign id → not found), `isPosted()`, same `partner_id`. At post it is re-resolved under `lockForUpdate`.
* **Line binding** (`deriveFromInvoice`): explicit `source_line_id` (must belong to this invoice) or, for backward compatibility with requests that only name the product, the *unambiguous* invoice line for that product/variant. Ambiguity or a missing product is **rejected, never guessed**.
* **Identity**: product and variant are copied from the source line; a mismatching `product_id`/`product_variant_id` is rejected. `variant_descriptor_snapshot` comes from the source line.
* **Price**: may *lower* the amount (partial credit scales net **and** VAT proportionally, as for returns); a price above the invoiced price is rejected. Omitted → the invoiced price. Client `tax_rate` is ignored for sourced lines.
* **Cap**: quantity `≤ sold − (posted returns + posted notes + earlier lines of this note)`; net and VAT additionally clamp to `charged − consumed`, so a historical over-credit is never extended. A sourced note with zero remaining value is refused.
* **`ReturnSourceAllocator::returned()`** now also sums posted `CreditNoteLine`s (optional `$exceptCreditNoteId`); `ReturnService::assertWithinSource` and `ReturnableController` read through it, so a return can't re-return what a note credited and the returnable screen shows the real remainder.
* **Lock order**: `note → invoice → ledger tenant anchor`, identical to `return → source → ledger`.
* **Immutability**: posted notes are never rewritten (post is draft-only; lines of posted notes are not touched by later activity — tested).
* **Historic invoice-linked drafts** (created before this change, no `source_line_id`): at post they are re-bound by product when unambiguous and re-derived; otherwise the post is **refused with a clear message and no ledger effect**. Posted notes are untouched.
* **Branch authorization** (controller): `show`/`post` now apply `assertRecordAccessible($note->branch_id)` and `store` applies it to the source invoice's branch (404 for a restricted user, non-leaking). Unrestricted users may credit another branch's invoice; the note takes its own branch and the cap is shared across branches.

## 4. Schema (additive; nothing run against production)

| Migration | What | Safety |
|---|---|---|
| `2026_11_04_010000_add_source_line_to_credit_note_lines` | `source_line_id` (nullable uuid, indexed with tenant), `line_discount` (default 0), `unit_price_before_tax` (nullable; print/display only) | Existing rows: `NULL` / `0` → their derived totals do not change. `down()` drops both. |
| `2026_11_04_020000_restrict_credit_note_original_invoice_delete` | `original_invoice_id`: `SET NULL` → `RESTRICT` (PostgreSQL) | **Pre-checks first**: a *dangling* reference aborts the migration with a clear message (nothing rewritten); cross-tenant / other-customer / non-posted-source / draft-without-line-links counts are **logged, not modified**. SQLite DDL is skipped on purpose (same precedent as `2026_08_31_020000`: a table rebuild drops the partial numbering indexes); the app-level guard below covers both drivers. `down()` restores `SET NULL`. |
| `2026_11_04_030000_pin_standalone_credit_notes_for_existing_tenants` | JSON update of `tenants.settings` | Idempotent; explicit values untouched; no accounting table touched; `down()` removes only what it pinned (marker). |
| `2026_11_05_010000_create_credit_note_legacy_reviews` | new table — append-only finance review decisions (overlay) | additive; no existing row touched; `down()` drops the table only. |

`InvoiceService::deleteDraft` now refuses (clear message) to delete a draft invoice that a historic note references, instead of surfacing a DB error.

## 5. Journal entries (shape unchanged; amounts now correct)

Sales credit note against the 1 × 115.00 inclusive invoice (credit refund), amounts in SAR:

| Account | Debit | Credit |
|---|---:|---:|
| 4110 Sales revenue | 100.00 | |
| 2120 Output VAT | 15.00 | |
| 1130 Receivables (partner) | | 115.00 |
| **Σ** | **115.00** | **115.00** |

Cash refund replaces 1130 with 1110. Header-discounted invoice (100.00 − 10.00): 4110 Dr 90.00 · 2120 Dr 13.50 · 1130 Cr 103.50. Debit notes (purchase side) are unchanged: Dr 2110 (or 1110) / Cr 5115 + Cr 1150. All entries are posted only through `LedgerService::post`.

## 6. Changed files

_See the PR file list; summary below._

| File | Change |
|---|---|
| `app/Services/Accounting/CreditNoteService.php` | source-anchored derivation, cumulative cap, standalone gate, locked re-derivation at post, configured default rate |
| `app/Services/Accounting/ReturnSourceAllocator.php` | `returned()` also counts posted credit-note lines (optional `$exceptCreditNoteId`) |
| `app/Services/Accounting/ReturnService.php` | `assertWithinSource` reads cumulative quantity through the allocator (4 lines) |
| `app/Services/Accounting/InvoiceService.php` | `deleteDraft` guard against referenced drafts (5 lines) |
| `app/Http/Controllers/Api/CreditNoteController.php` | branch access on show/post and on the source invoice |
| `app/Http/Controllers/Api/ReturnableController.php`, `ReturnSourcesController.php`, `PosController::returnableInvoice` | `returned/remaining` now include posted notes (screens agree with the enforced cap) |
| `app/Services/Accounting/PosReturnService.php` | `buildSourceItems` accumulates through the credit-note-aware `returned()` (POS-derived VAT closes exactly after a note) |
| `app/Http/Requests/StoreCreditNoteRequest.php` | `items.*.source_line_id`; `unit_price` optional when an invoice is given |
| `app/Http/Requests/UpdateSalesSettingsRequest.php`, `app/Support/Settings.php` | the new setting |
| `app/Models/CreditNoteLine.php`, `app/Http/Resources/CreditNoteLineResource.php` | the new columns (`source_line_id`, `line_discount`, `unit_price_before_tax`) |
| `web/src/app/(app)/sales-settings/invoices/page.tsx`, `web/src/messages/{ar,en}.json` | the opt-in toggle for standalone credit notes (so new tenants can enable the policy from the UI) |
| `web/src/modules/documents/builder/from-credit-note.ts` (+ test) | the printed credit note uses the pre-tax unit price so unit price, tax and total reconcile for inclusive invoices (2 vitest cases) |
| `database/migrations/2026_11_04_01…/02…/03…` | see §4 |
| `tests/Feature/CreditNoteSourceVatAccuracyTest.php` | **new** — 41 tests |
| `tests/Feature/CreditNoteMigrationPolicyTest.php` | **new** — 7 tests (existing/new tenants, rollback, historical references) |
| `tests/Feature/CreditNoteSourcePostgresTest.php` | **new** — 7 tests (PostgreSQL: restrict rule, rollback, real forked concurrency) |
| `app/Services/Accounting/SourceInvoiceLock.php`, `PosReturnService.php`, `PosExchangeService.php` | one lock order (invoice → branch → tenant) for POS return / exchange |
| `app/Models/CreditNoteLegacyReview.php`, `app/Services/Accounting/CreditNoteLegacyReviewService.php`, `app/Console/Commands/{ReviewLegacyCreditNotes,ResolveLegacyCreditNote,LegacyCreditNoteCommandSupport}.php`, migration `2026_11_05_010000…` | legacy-credit finance review path (append-only overlay) |
| `ReturnSourceAllocator.php` (`legacyCreditLines`, `unresolvedLegacyCounts`, `assertNoUnresolvedLegacyCredits`), `CreditNoteService.php`, `ReturnService.php`, `PosReturnService.php`, `ReturnSourcesController.php`, `ReturnableController.php` | targeted block + `blocked_reason = legacy_credit_review` |
| `web/src/components/credit-notes/{credit-note-form,credit-note-linked-form}.tsx`, `invoice-linked.ts` (+ test), `web/src/app/(app)/credit-notes/new/page.tsx`, `web/src/app/(app)/invoices/[id]/page.tsx`, `web/src/messages/{ar,en}.json` | invoice-linked credit-note screen, deep link, invoice action |
| `tests/Feature/CreditNotePosLockOrderPostgresTest.php` | **new** — 4 PostgreSQL tests (real POS service, forked processes, deadlock stress) |
| `tests/Feature/CreditNoteLegacyBlockTest.php` | **new** — 11 tests (block, review path, isolation, append-only) |
| `docs/audits/AWJ-TAX-REM-02-PRINT-AMOUNTS-NOTE.md`, `docs/audits/ADR-E2-PRICE-ADJUSTMENT-CREDIT-NOTES.md` | documentation only |
| existing credit-note tests (`CreditNoteTest`, `…SourceOwnershipTest`, `…PostingOwnershipTest`, `CustomerRefundTest`, `DebitNoteTest`, `DocumentHttpVariantsTest`, `InteractsWithApi`) | mechanical: standalone-note tests opt in to the policy; invoice-source tests now use a *posted* invoice and a source line |

No change to `LedgerService`, `InventoryService`, `PaymentService`, ZATCA, or any posted document. **No e-invoicing of credit notes (REM-18).**

## 7. Tests

**Requirement → test**

| Requirement | Test(s) |
|---|---|
| Inclusive / exclusive | `a_note_against_an_inclusive_invoice_credits_exactly_the_charged_vat`, `…exclusive…unchanged`, `partial_and_repeated_notes_of_an_inclusive_line…`, `the_split_order_does_not_change_the_total` |
| Line + header discounts | `a_note_against_a_header_discounted_invoice…`, `line_and_header_discounts_on_an_inclusive_multi_line_invoice…` |
| Changed default VAT rate | `a_sourced_note_inherits_the_invoice_rate_after_the_default_rate_changes`, `a_standalone_note_uses_the_configured_default_rate_not_a_hard_coded_15`, `the_default_rate_still_defaults_to_15_when_unchanged` |
| Halala rounding / repeated notes | `seven_single_unit_notes…` (0.11 not 0.14), partial/split tests |
| Cumulative notes + returns | `notes_and_returns_share_one_cumulative_cap…`, `a_note_first_then_a_return_is_also_capped`, `the_returnable_endpoint_counts_posted_notes_but_not_drafts`, `a_historically_over_credited_vat_is_never_credited_again`, `drafts_do_not_reserve_quantity…`, `the_post_time_rederivation_closes_the_remainder…` |
| Over-credit | `the_probe_r4_over_credit_is_rejected`, price-above-invoice test |
| Draft / cancelled / invalid source | `a_draft_invoice_is_not_a_valid_source`, `a_cancelled_invoice_is_not_a_valid_source` |
| Customer mismatch | `a_different_customer_cannot_credit_the_invoice` |
| Cross-tenant | `a_foreign_tenant_invoice_is_not_found_and_leaks_nothing` (+ existing `…cross_tenant_…non_leaking_not_found`) |
| Cross-branch | `a_branch_restricted_user_cannot_use_show_or_post_notes_or_invoices_of_another_branch`, `a_note_in_another_branch_shares_the_cumulative_cap…` |
| Source-line ownership | `a_line_of_another_invoice_is_rejected`, `a_product_that_differs_from_the_source_line_is_rejected`, product-match test |
| ADR-E existing / new tenants | `existing_tenants_are_pinned…`, `an_existing_tenant_keeps_issuing_standalone_notes_while_a_new_tenant_must_opt_in`, `a_standalone_note_is_refused_by_default_and_allowed_by_the_setting`, `the_policy_migration_is_idempotent` |
| Deletion restriction | `the_engine_refuses_to_delete_an_invoice_that_a_note_references` (PostgreSQL), `a_draft_invoice_referenced_by_a_historic_note_cannot_be_deleted` (both drivers) |
| Migration rollback / history | `the_columns_migration_is_additive_and_rolls_back…`, `rolling_the_policy_back…`, `the_restrict_migration_passes_on_clean_data_and_leaves_historical_mismatches_untouched`, `…refuses_to_run_over_a_dangling_reference`, `the_restrict_rule_rolls_back_to_set_null_and_forward_again` (PostgreSQL) |
| Historic drafts / immutability | `a_historic_invoice_linked_draft_without_line_links_is_rederived_on_post`, `a_historic_draft_that_cannot_be_mapped_is_refused…`, `posted_notes_are_never_rewritten_by_later_activity` |
| Concurrency (PostgreSQL, forked processes) | 2 concurrent full posts → 1 wins; 3 concurrent 1-unit posts → Σ exact (26 090 / 3 913 / 30 003); note vs return of the same units → exactly one; 2 notes + 2 returns mixed → Σ exact |
| POS vs note lock order (PostgreSQL, real `PosReturnService::create`, forked) | `CreditNotePosLockOrderPostgresTest` ×4: POS return vs note, keyed and non-keyed POS path, POS exchange, deadlock stress (4 rounds) — exactly one consumer wins, Σ never exceeds the invoice, no `40P01` |
| Reduced-price hold-back on every path | note→API return, API return→note, note→note, note→POS final part, returnable screen flag, seeded random mixed sequences (Σ never exceeds the invoice; withheld amount stays withheld) |
| Legacy unattributable credits | `CreditNoteLegacyBlockTest` ×11: block on notes / returns / POS returns / quotes, `blocked_reason = legacy_credit_review`, resolve `attributed` / `not_applicable`, mandatory reason, tenant-scoped reviewer, append-only overlay, other invoices unaffected |
| Invoice-linked web flow | `invoice-linked.test.ts` ×13 (vitest) + `from-credit-note.test.ts`; web build |
| Ledger + VAT balance | `assertBalanced` / `assertBooksBalanced` in the accuracy tests; `2120` Dr = charged VAT asserted |

**Evidence the tests bite**
* Against the original `CreditNoteService`: 29 of 34 accuracy tests failed (the rest are guards that hold either way).
* PostgreSQL concurrency with the invoice-row lock removed: 3–4 of the 7 PostgreSQL tests fail on every run; with the lock: 7/7 pass on 3 consecutive runs.
* POS lock order: without `SourceInvoiceLock` in the POS paths 3 of 4 `CreditNotePosLockOrderPostgresTest` tests fail (cap exceeded); with the lock taken *after* the branch lock PostgreSQL raises `40P01` (deadlock); with invoice → branch the class passes 6/6 consecutive runs.
* Legacy block: with the `assertNoUnresolvedLegacyCredits` calls removed the block tests fail (mutation checked on SQLite).

**Runs** — see §8.

## 8. Test & CI results

**Local, PHP 8.3** (SQLite and PostgreSQL 16; sandbox lacks `bcmath`, the AWS SDK and mail transport, so a few unrelated classes cannot pass here — CI installs them):

| Run | Result |
|---|---|
| New REM-02 classes, SQLite | `CreditNoteSourceVatAccuracyTest` 35 ✅ · `CreditNoteMigrationPolicyTest` 7 ✅ (PG-only test skipped) |
| New PostgreSQL class (`CreditNoteSourcePostgresTest`), PG 16 | 7 ✅ — repeated 3× with the lock in place; 3–4 fail without it |
| Credit/debit-note + refund + document + return + invoice-API related set, SQLite | 588 passed (the only failures were R2/AWS-SDK tests caught by my broad filter, and two `ProductReferenceRegistryTest` cases that pass alone) |
| Same related set, PostgreSQL | 368 passed; 7 `ApiInvoiceTest` failures were the known migration-DDL collision between sessions — class alone: **25/25 pass** |
| New classes, final round | SQLite: `CreditNoteSourceVatAccuracyTest` + `CreditNoteLegacyBlockTest` + `CreditNoteMigrationPolicyTest` + ownership classes all green · PostgreSQL: `CreditNoteSourcePostgresTest` 7 ✅, `CreditNotePosLockOrderPostgresTest` 4 ✅ (6 consecutive runs) |
| Full suite, SQLite (final head) | 5 677 passed · 72 skipped · 92 failed. 88 of the failures were collateral of running two suites at once ("database is locked" / missing table on the shared SQLite file); the credit-note, contract, cost-centre, contact and company classes **all pass when re-run alone** (264 passed). The 4 remaining failures are `StorefrontSliderTest` media-upload cases (no AWS SDK in the sandbox; arrived with the merge of `main`, unrelated to credit notes) |
| Full suite, PostgreSQL (final head) | 5 828 passed · 1 skipped · 12 failed: 11 × `StorefrontSliderTest` / `StorefrontSectionDesignTest` (same sandbox limitation, from `main`) and `ImportJobApplyTest` (concurrent-run timing) — **`ImportJobApplyTest` passes alone 14/14**. No credit-note, return, POS, invoice or ledger test fails |

**CI on the head commit** — `6aca2887b473098bb76f2c7f76baa5239a4a6b47` (code identical to `1f1c5ba`): `php artisan test (L11, sqlite)` ✅ · `php artisan test (L11, pgsql)` ✅ · `web build (Next.js)` ✅ — full suites, both the push and the pull-request runs.

## 9. What remains (risks / not done on purpose)

**Resolved in the pre-merge round** (were open before): POS-vs-note race (§0.2), legacy unattributable credits (block + review path), invoice-linked creation path, reduced-price hold-back on every path.

1. **Price-only notes still consume quantity** (two 20 % rebates on a 1-unit line: the second is refused although value remains). Unchanged on purpose — decision pending in `ADR-E2-PRICE-ADJUSTMENT-CREDIT-NOTES.md`; it can never over-credit.
2. **Printed row equation** is exact at line-net and document level only (discount / per-unit rounding). Smallest independent fix documented in `AWJ-TAX-REM-02-PRINT-AMOUNTS-NOTE.md`; not implemented (owner: no template redesign here).
3. **Finance review path is CLI-only.** `credit-notes:legacy-review/-resolve` need an operator with shell access; there is no web screen. Decisions are append-only: a *wrong* decision is corrected by an operational procedure, not by the app. Count of affected lines is logged by migration `…020000` (`posted_invoice_note_lines_without_product`) so the blast radius is known before deploy.
4. **Deadlock watch.** The lock-order change was verified with 6×4 rounds of mixed forked POS/note/API postings and a negative control (reverse order deadlocks), but production traffic is the real test: watch PostgreSQL for `40P01` after deploy; rollback = revert the three `SourceInvoiceLock::acquire` calls.
5. **Web invoice-linked screen is unit-tested, not browser-tested** (vitest on the pure logic; `tsc` clean; build in CI). The Arabic wording of the `legacy_credit_review` message is mine and should be confirmed by the owner.
6. **Historic invoice-linked drafts** that cannot be bound to exactly one invoice line (or whose price exceeds the invoice's) are refused at post; there is no draft-delete endpoint for credit notes. Migration `…020000` logs how many exist.
7. **Standalone notes stay uncapped and exclusive-only** by design of ADR-E Option A — the setting is the control.
8. **SQLite keeps the old FK action** (`SET NULL`); production PostgreSQL is `RESTRICT`. The service-level guard covers the draft-invoice case on both.
9. **Pre-existing SQLite-only quirk** (REM-01): branch-less unique numbering index on `credit_notes` lost its `WHERE` predicate; the branch test passes explicit numbers.
10. **Multi-invoice notes (R1-117)** not implemented; per-line `source_line_id` keeps the design compatible with a later note↔invoice link table (REM-18).
11. **Branch checks on `show`/`post`** are new for credit notes: a branch-restricted user now gets 404 for a note of a branch they cannot access (legacy null-branch notes are hidden from restricted users, as for customer refunds).
12. **Pre-existing lock-order risks outside these paths** (e.g. a transaction that takes a numbering anchor and *then* locks an existing invoice for payment allocation) are unchanged by this PR.

## 10. Readiness decision

@@READINESS@@

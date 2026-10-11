# AWJ-TAX-REM-02 — Credit Note VAT Accuracy · Implementation Report

| | |
|---|---|
| **Task** | REM-02 from the audit/remediation plan (PR #1290) — closes **VAT-02** (P1) and **ACC-06** (P2) |
| **Branch** | `claude/awj-tax-rem-02-credit-note-vat` |
| **PR** | _filled in after opening_ |
| **Base SHA** | `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0` (`origin/main`, includes merged #1291 / REM-01) |
| **Head SHA (code)** | _filled in after the final code commit_ |
| **Owner decisions applied** | **ADR-E → Option A** (source invoice required by default; standalone only by setting). **Migrations → both** (`source_line_id` + `restrictOnDelete`), additive only. |
| **Status** | Implemented. Test results below. **Not merged, not deployed. Awaiting owner approval.** |

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
| `2026_11_04_030000_pin_standalone_credit_notes_for_existing_tenants` | JSON update of `tenants.settings` | Idempotent; explicit values untouched; no accounting table touched. |

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
| `tests/Feature/CreditNoteSourceVatAccuracyTest.php` | **new** — 35 tests |
| `tests/Feature/CreditNoteMigrationPolicyTest.php` | **new** — 7 tests (existing/new tenants, rollback, historical references) |
| `tests/Feature/CreditNoteSourcePostgresTest.php` | **new** — 7 tests (PostgreSQL: restrict rule, rollback, real forked concurrency) |
| existing credit-note tests (`CreditNoteTest`, `…SourceOwnershipTest`, `…PostingOwnershipTest`, `CustomerRefundTest`, `DebitNoteTest`, `DocumentHttpVariantsTest`, `InteractsWithApi`) | mechanical: standalone-note tests opt in to the policy; invoice-source tests now use a *posted* invoice and a source line |

No change to `LedgerService`, `InventoryService`, `PaymentService`, ZATCA, or any posted document. **No e-invoicing of credit notes (REM-18).** Web changes limited to the credit-note document builder mapping and the standalone-notes toggle on the sales-settings page.

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
| Ledger + VAT balance | `assertBalanced` / `assertBooksBalanced` in the accuracy tests; `2120` Dr = charged VAT asserted |

**Evidence the tests bite**
* Against the original `CreditNoteService`: 29 of 34 accuracy tests failed (the rest are guards that hold either way).
* PostgreSQL concurrency with the invoice-row lock removed: 3–4 of the 7 PostgreSQL tests fail on every run; with the lock: 7/7 pass on 3 consecutive runs.

**Runs** — see §8.

## 8. Test & CI results

**Local, PHP 8.3** (SQLite and PostgreSQL 16; sandbox lacks `bcmath`, the AWS SDK and mail transport, so a few unrelated classes cannot pass here — CI installs them):

| Run | Result |
|---|---|
| New REM-02 classes, SQLite | `CreditNoteSourceVatAccuracyTest` 35 ✅ · `CreditNoteMigrationPolicyTest` 7 ✅ (PG-only test skipped) |
| New PostgreSQL class (`CreditNoteSourcePostgresTest`), PG 16 | 7 ✅ — repeated 3× with the lock in place; 3–4 fail without it |
| Credit/debit-note + refund + document + return + invoice-API related set, SQLite | 588 passed (the only failures were R2/AWS-SDK tests caught by my broad filter, and two `ProductReferenceRegistryTest` cases that pass alone) |
| Same related set, PostgreSQL | 368 passed; 7 `ApiInvoiceTest` failures were the known migration-DDL collision between sessions — class alone: **25/25 pass** |
| Full suite, SQLite | 5 897 passed · 69 skipped · 125 failed — all in classes unrelated to this change: Fuel (`bcmul()` missing, no `bcmath`), StorefrontMedia/ProductMedia/R2 (AWS SDK missing), AuthRecovery/UserInvitation/ResendMail (mail transport), plus 5 "database is locked" from running two suites at once. None touches credit notes, returns, invoices or the ledger. |
| Full suite, PostgreSQL (same unrelated families excluded; R2 tests hang on network here) | 5 780 passed · 1 skipped · 5 failed: `AccountManagementTest` (1 DDL deadlock + 2 cascaded) and `CashDrawerBridgeTest` ×2 — both classes **pass alone (14/14)** |

**CI on the head commit** — _see the PR checks; recorded in the PR description once complete._

## 9. Risks / not done on purpose

1. **Quantity is consumed by price-only notes.** The cap is cumulative in *quantity* as well as net/VAT (as for returns). A series of reduced-price notes against a single unit (e.g. two 20 % rebates on a 1-unit line) is refused after the first one even though value remains. Alternative: a value-only cap for notes below invoiced price — an owner/product decision, deliberately not guessed.
2. **Note vs POS return race.** (Derivation is now consistent — POS returns count posted notes — but the *concurrency* gap remains.) POS returns take the branch lock, not the invoice lock (REM-01's deliberate choice to keep lock order consistent). A note posted concurrently with a POS return of the same line is not serialized with it; the net/VAT clamp at post prevents any over-credit of value, but a quantity could in theory be double-counted in that narrow window. Same residual risk REM-01 recorded for POS-vs-API returns.
3. **Historic posted notes without line links.** Posted notes from before this change have `source_line_id = NULL`. The cap counts them at read time (no posted row is modified) when their product is the **single** matching line of the invoice; a legacy line with no product, or whose product repeats in the invoice, cannot be attributed without guessing and is **not** counted — the restrict migration logs how many lines have no product so Finance can review. (Before this PR no cap existed at all, so this is not a regression.)
4. **Historic invoice-linked drafts** that cannot be bound to exactly one invoice line (or whose price exceeds the invoice's) will be refused at post and there is no draft-delete endpoint for credit notes; Finance would have to recreate them. The restrict migration logs how many such drafts exist per database.
5. **Web credit-note form is still standalone-only.** New tenants (default: source required) must switch on «Standalone credit notes» in Sales settings (toggle added in this PR) before the existing form works; the form does not yet pick an invoice or send `source_line_id`. An invoice-linked credit-note form is the follow-up web slice.
6. **Standalone notes stay uncapped and exclusive-only** by design of ADR-E Option A — the setting is the control.
7. **SQLite keeps the old FK action** (`SET NULL`) at DB level; production (PostgreSQL) is `RESTRICT`. SQLite is test-only; the service-level guard covers the draft-invoice case on both.
8. **Pre-existing SQLite-only quirk** (documented in REM-01): the branch-less unique numbering index on `credit_notes` lost its `WHERE branch_id IS NULL` predicate, so two branches cannot reuse a number on SQLite; the branch test passes explicit numbers.
9. **Multi-invoice notes (R1-117)** are not implemented; per-line `source_line_id` keeps the design compatible with a later note↔invoice link table (REM-18).
11. **Line discounts are not a printed column.** A discounted credit-note line shows the pre-tax unit price, so unit price × quantity differs from the line total by the discount; document-level subtotal/tax/total reconcile. A discount column is a document-template change outside REM-02 (Codex P1 thread left open for the owner).
10. **Branch checks on `show`/`post` are new** for credit notes: a branch-restricted user now gets 404 for a note of a branch they cannot access (`canAccessBranch(null)` is false for restricted users, so legacy null-branch notes are also hidden from them — same as customer refunds).

## 10. Recommended next step

Owner review of the PR (focus: `CreditNoteService::deriveFromInvoice` / `post()` lock placement, `ReturnSourceAllocator::returned()`, and migration `…020000`), then decide risk 1 (quantity consumption by price-only notes) and the web follow-up (setting toggle + invoice-linked credit-note form).

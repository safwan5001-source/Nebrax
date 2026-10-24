# IMP-H5-S3a — PurchaseService owns the supplier-invoice reservation lifecycle + `purchases.duplicate_reference_policy`

**Branch:** `claude/imp-h5-s3a-purchase-reservations`. **No migration, route, permission, ledger, accounting-rule, ZATCA, env or AI-setting change.** One new tenant setting (default preserves today's behaviour). **No importer yet** (S3b): nothing in production passes a reservation context.

## What changes

- `PurchaseService::create(array $data, array $items, ?array $reservation = null)` — `$reservation = ['source' => …]` is supplied only by importers / Document Center (later slices). Direct creation (`null`) is **byte-for-byte the old behaviour** unless the tenant opts in to `block`.
  - Identity = **supplier ‖ normalised `supplier_invoice_no`** (`DocumentDuplicateReservationService::purchasePredicate`; Arabic/Latin digit, case, punctuation, kashida normalisation shared with expenses).
  - Order inside the one transaction: derive predicate → look up existing purchases of that supplier (company-wide; covers purchases created before any reservation, any status including posted/reversed) → `Purchase::create` → `reserve()`.
  - A purchase **without** a supplier invoice number has no identity: direct creation is never blocked or reserved (`allow` and `block` alike). An **import** without one is refused (`رقم فاتورة المورّد مطلوب…`) — the number *is* the document's identity in this domain.
- `PurchaseService::update` — a reserved draft **re-keys in place** when the supplier or the (normalised) number changes; clearing the number releases the reservation; a collision (reserved holder or an existing purchase) ⇒ `DuplicateDocumentException` ⇒ 422, raised **before** lines are touched so nothing changes. An unreserved draft is only checked/reserved under `block` **and** only when its identity actually changed — a legacy draft that already duplicates another can still have its notes edited.
- `PurchaseService::deleteDraft` releases the reservation in the same transaction as the (row-locked, draft-only) delete → a corrected re-import succeeds; posted purchases cannot be deleted so their reservation keeps blocking re-import (reversal does not free it).
- Setting `purchases.duplicate_reference_policy = allow | block` (`GET/PUT /purchase-settings`, same gates; validated `in:allow,block`). `allow` (default): direct creation unchanged, no reservation; imports still refuse an existing or reserved supplier invoice. `block`: direct creation and number/supplier edits join the protocol. Policy, not a forced behaviour (CLAUDE.md rule 6): some tenants legitimately re-use supplier numbers.

## Decisions / disclosures

- **No advisory lock (deliberately differs from S1b).** For expenses the broad identity (vendor‖date‖amount) is wider than the reservation key, so a lock was needed; for purchases the identity *is* the reservation key and the unique index arbitrates (`reserve()` waits for the winner's commit, then throws). I first added the same advisory lock, then **disabled it in a mutation run: all five PG race tests still passed (3/3 runs)** — so it added no protection, only a lock order to maintain. Removed.
- **Disclosed limit of the "many rows, one transaction" PG test:** two importers touching the same invoices in opposite order inside long transactions can wait on each other's uncommitted unique rows (40P01) — inherent to any unique index, fails closed (the loser's unit/chunk fails; same class as IMP-LOCK-XBRANCH-01). The test asserts only that what survives has no duplicate identity and no orphan reservation, and that any non-duplicate error is a 40P01.
- Existing-document lookup loads the supplier's purchase numbers and compares normalised values in PHP (a SQL-side match cannot reproduce the normalisation). Bounded by one supplier's purchases; fine at Beta scale — flagged for an indexed normalised column if a supplier ever has tens of thousands.
- `Purchase` is `BelongsToBranch` (explicit filtering), so the lookup is company-wide by construction.
- Document Center's `PurchaseDocumentDraftBuilder` and `ProcurementService` still call `create()` directly (manual source); under `block` a duplicate there returns the stable 422 body (`reason: duplicate_document`) already mapped in S1b. Passing `source=document_center` is H5-S6.
- `duplicate()` ("copy") clears the supplier number so it never collides.
- No UI for the setting in this slice.

## Tests

- `PurchaseDuplicateReservationTest` (22, SQLite + PG): default/validation of the setting; `allow` unchanged (two identical numbers, zero reservations); `block` refuses same supplier+number (case/punctuation-insensitive), passes other number/supplier; `block` with no/symbol-only number never blocks or reserves; `block` refuses a legacy unreserved duplicate; import reserves under `allow` and refuses a reserved *and* an existing manual duplicate (reports the holder); import without a number refused; failed import leaves no purchase/lines/reservation; edit re-keys (number, then supplier + counterparty) and frees the old identity; edit into a taken identity ⇒ 422 with nothing changed (number, notes, lines, reservation); edit of a reserved draft into an unreserved legacy number refused; identity-preserving edit not self-refused; clearing the number releases; unreserved draft never reserves under `allow`; under `block` an unchanged legacy duplicate stays editable while a changed identity is checked; delete releases and re-import succeeds; posted keeps its reservation, cannot be deleted or re-imported; copy action unchanged; **posting an imported draft yields the same journal-line shape as a manual one** (no ledger change).
- `PurchaseDuplicateReservationConcurrencyPostgresTest` (5, real PG + `pcntl_fork`, fails rather than skips without pcntl): 8 racers (import + direct under `block`, two spellings of one number) ⇒ exactly one purchase and one reservation, losers get `DuplicateDocumentException`; 6 importers under `allow` ⇒ one; mixed multi-row workload ⇒ no duplicate identity, no orphan; delete racing a re-import ⇒ no orphan reservation; two edits racing into one identity ⇒ one holder.
- **Mutation controls (manual):** removing the delete-release fails the delete test; removing `rekey` fails the re-key and supplier-change tests; removing the advisory lock changed nothing (hence removed).
- Regression: `Purchase*`, `Procurement*`, `DocumentCenter*`, `Settings*`, `DocumentDuplicate*`, `Branch*` — 841 passed locally (SQLite). Full SQLite run: only environment failures present without this change (Fuel tests need `bcmath`, absent locally; 2 `InventoryOpeningZeroValueDateGuardTest` cases fail identically with this change reverted — not investigated here). Full suite + PG in CI.

## Journal entries

None. Drafts only; posting is the existing path and its entries are unchanged (asserted by the shape test).

## Independent review (read-only subagent; not Codex) — findings and disposition

No correctness bug, no behaviour change under the default `allow` for unreserved documents, no race or isolation defect found.

| # | Finding | Disposition |
|---|---|---|
| 1 | A draft reserved under `block` (or imported) keeps its reservation if the policy returns to `allow`; editing it into a taken identity is still 422 | **Documented + tested** (`a_held_draft_keeps_its_identity_protection_after_the_policy_returns_to_allow`): a held document's identity is protected for as long as the document exists; an unreserved draft behaves exactly as before. Intentional |
| 2 | Existing-number lookup is O(n) per supplier, in PHP | **Accepted, disclosed above** (indexed normalised column if a supplier ever reaches tens of thousands of invoices) |
| 3 | Document Center purchase draft under `block` now throws `DuplicateDocumentException` from inside the batch transition; message wording mentions expense fields | **Accepted**: the builder runs in one transaction so the transition rolls back with the failed create (same as the S1b expense path); `source=document_center` and the purchase-specific wording are H5-S6 |
| 4 | `partner_id` identity check was case-sensitive (uppercase UUID looked like a supplier change) | **Fixed** (case-insensitive compare); **no test**: an uppercase UUID is a 404 on SQLite (case-sensitive string compare) and works only on PostgreSQL's `uuid` type, so the case is driver-dependent at the API layer; harmless before (self-excluding recheck) |
| 5 | Two edits swapping identities (A→B / B→A) could deadlock (40P01 ⇒ 500) | **Accepted** (theoretical; fails closed, no partial state) |
| — | Filler `assertNotNull`s; copy-action test passed trivially; no tenant-isolation test | **Fixed**: filler removed, rekey test now asserts the old key survives, copy test uses a *reserved* source and asserts no inherited number/no new reservation, new cross-tenant test |
| — | `duplicate_reference_policy` rejects explicit `null` (422) unlike sibling `nullable` fields | **Accepted**: same as `finance.duplicate_reference_policy`; the settings UI for it is a later slice |

The master plan's "lock the supplier `Partner` row" was **not** implemented: the unique reservation key already serialises the same identity (mutation-verified), and a partner-row lock would also serialise unrelated purchases of that supplier.

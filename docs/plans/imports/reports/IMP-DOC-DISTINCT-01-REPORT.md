# IMP-DOC-DISTINCT-01 — Confirming a genuine repeat expense in the Document Center

**Branch:** `claude/imp-doc-distinct-01`. **No migration, no permission, no env change.** Owner decision (2026-10-30): allow confirming a *real* repeated expense only, with explicit confirmation, idempotency protection and tests against unintended duplication.

## Accounting
Drafts only: `ExpenseService::create` makes a **draft** expense. **No journal entry, stock movement, payment or ZATCA effect at creation**; posting stays the existing explicit action on the draft (`ExpenseService::post`, unchanged: Dr expense account (+ input VAT 1150) / Cr cash, bank or suppliers). Nothing new to tabulate.

## Behaviour
- `POST document-batches/{batch}/create-expense-draft` accepts an optional boolean `confirm_distinct_occurrence`. Absent/`false` ⇒ identical to before (a vendor ‖ day ‖ amount repeat is refused 422 `duplicate_document`).
- The refusal now also carries `distinct_confirmable` (still **no internal id**): `true` for a vendor/day/amount repeat, `false` when the reviewed document number is already held by an expense of the same identity (the *same document*, never a distinct occurrence).
- With the flag, the builder **always tries without an occurrence id first**. Only if that is refused for an expense duplicate does it re-check the reference rule and retry with a deterministic occurrence id `sha256('document_center|'.batch_id)[0..32]`. Consequences: a confirmation with no repeat is inert and leaves **no latent bypass** (a later identical document is still refused); the same document number can never be confirmed (`holdsSameExpenseReference`, a read-only probe on the existing reservation predicate); a third identical expense is refused again unless it is itself confirmed.
- **Codex review (P1/P2) folded in:** (P2) the *first* refusal is already classified — a reviewed document number held by an expense of the same identity returns `distinct_confirmable: false` even without a confirmation, so the UI never offers a confirmation that cannot succeed. (P1) the reference check and the occurrence-id create now run in `ExpenseService::createDistinctOccurrence` **in the caller's outer transaction**, re-taking the numbering anchor then the identity lock *before* probing (the first attempt's savepoint rollback had released them), so two concurrent confirmations of one new document number serialize and the second is refused `same_document_reference`.
- Idempotency: the existing batch ↔ expense link replays (HTTP 200, `idempotent_replay: true`) for any later request on the batch, with or without the flag; two submissions race on the batch row lock. The review audit row records `distinct_occurrence_confirmed: true` only when a confirmation was actually consumed.
- Scope: expenses only. The purchase flow is untouched (a supplier invoice number is a true identity); the flag is not accepted by the purchase request.
- Tenant isolation: reservations and the probe are tenant-scoped; another tenant's identical expense never counts or is consumed.

## UI
`ExpenseDraftDialog`: the confirmation step appears **only after a server refusal with `distinct_confirmable: true`**, requires an explicit checkbox, sends the flag only then, and is dropped if the reviewer edits the reason or account. A non-confirmable refusal shows the server message with no confirmation option. ar/en copy added.

## Tests
- `DocumentExpenseDraftBuilderTest` +10 (29 total; SQLite and PostgreSQL green): confirmable flag and no id leak · confirmed creation audited, reservations 2, no journal/payment · idempotent replay · same document number never confirmable (also after a confirmed repeat) · third repeat refused unless confirmed · inert confirmation without repeat · reference-probe unit cases · boolean validation / `false` = not confirmed · tenant and purchase-flow isolation.
- `expense-draft-dialog.test.tsx` 4.
- **Mutation controls** (each fails tests): reference check removed (2) · occurrence on first attempt (3) · confirmation ignored (5) · UI sends the flag unconditionally (1) · UI submit not gated by the checkbox (1).

## Disclosed limits
- The occurrence id being deterministic per batch is defence in depth: it is not observable by a test because the batch link already replays first (mutating it to a random value survives the suite).
- A prior expense created manually under the `allow` policy has no reservation, so for it the "same document" rule cannot apply; the reviewer's confirmation decides. PostgreSQL real-fork race (`racing_confirmations_of_one_new_document_reference_admit_exactly_one_distinct_expense`, 5 racers): exactly one distinct expense; removing the anchor + identity locks fails it 3/3. The numbering anchor alone is what serializes in that test (the explicit identity lock is defence in depth).

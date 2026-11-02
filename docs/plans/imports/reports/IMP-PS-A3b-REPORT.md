# IMP-PS-A3b — Manual review of a proven reversed pair (`link_pair`)

**Scope (owner, 2026-11-02):** PS-A3b only. **Not built:** automatic `R-REV` matching (D-PS-15: forbidden), reviewed/close (A3c), unit claims + overlap acknowledgement (A3d), void/replace (A3e), PS-A4 UI, Track B. **No journal entry, document, payment, balance, stock or ZATCA effect; no posting rule change; no new permission.** Base: `main@ce081f8ca` (PS-A3a merge).

## 1. What was built

| Piece | File | Role |
|---|---|---|
| Migration | `2026_12_29_010000_add_pair_link_to_partner_statement_review_decisions.php` | 4 nullable columns on the A3a log (`pair_member`, `pair_original_entry_id`, `pair_reversal_entry_id`, `engine_code`) + the shape guard widened to a 4th action. `down()` refuses once any `link_pair` row exists |
| Candidates | `PartnerLedgerCandidates` | additive per-unit `entries` list (id, number, date, status, `reversal_of`, debit, credit). **Not** part of the fingerprint |
| Service | `PartnerStatementReviewService` | action `link_pair`, `provePair()`, member-level claims, D-PS-16 rule, `reversedPairs()` |
| API | `PartnerStatementReviewController` + 1 route | `POST …/decisions` accepts `action = link_pair` + `pair_member`; new read-only `GET …/reversed-pairs` (view + app gate, throttled) |
| Model | `PartnerStatementReviewDecision` | `ACTION_LINK_PAIR`, `MEMBERS`, new fillables |

## 2. Contract

**What may be linked.** A statement line may be linked to **one member** (`original` or `reversal`) of a pair that the **ledger proves**, never inferred. The proof (`provePair`) uses only ledger facts from the actor's scoped statement source:

1. the unit is `neutralised` (a complete chain inside the statement window; otherwise `pair_incomplete` for `incomplete`, `unit_not_a_reversed_pair` for an active unit);
2. exactly **two** entries (`pair_not_simple` otherwise);
3. exactly one entry carries `reversal_of`, and it points to the other entry (`pair_not_proven` otherwise);
4. the original has no `reversal_of` and status `reversed`; the reversal has status `posted`;
5. the two nets are opposite, non-zero and cancel exactly.

Nothing is derived from similar amounts, dates or document numbers, and **the member is the reviewer's explicit choice** (`pair_member_required` if absent).

**What the reviewer must give.** `unit_keys` = exactly the one pair unit, `pair_member`, and a **reason (≥ 3 characters)**. As in `override`, if the member's own net differs from the line by more than the frozen tolerance, `accept_difference = true` is required. (A "credit" statement line expects `+` and the original is `+`; the cancellation line is `−` and matches the reversal. Linking a line to the *wrong* member is therefore visible as a difference that has to be accepted on purpose.)

**Claims and double use.** A `link_pair` claims the token `unit@member`; each member can be held by **one line at most** (`409 unit_already_decided`, `details.unit_key = invoice#…@original`). The two members are independent (one line on the invoice, another on the cancellation). Re-linking the same line to the other member releases the first. A normal `override`/`confirm` on the pair unit is still refused (`unit_not_reviewable`), so a reversed or incomplete entry never serves as an ordinary active entry.

**Engine results are untouched.** The deterministic engine and `GET …/matches` are unchanged: a line citing the reversed invoice still reads `amount_difference / reversed_in_books`, the cancellation line still `missing_in_books` (asserted equal before/after in the test). The decision stores `engine_outcome` **and** `engine_code` (`reversed_in_books`…) so the audit shows exactly what the reviewer saw.

**Audit.** Each decision is an append-only row: actor, time, `reason`, `run_id`, `ledger_fingerprint`, engine outcome/code, revision (gapless), the two proven entry ids, the member, and the numbers compared.

**Freshness and concurrency.** Unchanged from A3a: the ledger source, the freshness check (`engine`/`policy`/`scope`/`fingerprint`) and the proof are all recomputed **inside the transaction after the advisory lock and the reconciliation row lock**. Replay is bound to the same run, member, units, reason and fingerprint.

**`GET …/reversed-pairs`.** Read-only helper for the reviewer: every `neutralised`/`incomplete` unit visible in the actor's scope, with `reviewable` / `blocked_reason`; for provable pairs the original and the reversal (entry id, number, date, net) and who holds each (`claimed`, `line_id`). A holder whose run the reader cannot read shows `claimed: true, line_id: null`. Capped at 200 pairs (`truncated`).

**D-PS-16 (owner decision, applied here).** Accepting a financial difference always needs a reason, not configurable per tenant. Implemented for `confirm`, `override` and `link_pair`. *Side effect on A3a:* confirming a `matched` result whose difference is **non-zero but inside the tolerance** previously needed no reason; it now does. There is no setting and the API accepts no policy parameter (asserted).

## 3. Authorization, isolation, gates
Same as A3a: write = `partner_statements.reconcile` **and** `.view`; reads = `.view`; `partners.view`, partner visibility, role and branch scope via `assertAccess`; `EnsureApplicationActive:accounting.partner_statements` (suspended ⇒ reads only). Tenant isolation by the single refusal message. A branch-restricted reviewer sees only pairs whose **both** entries are inside their branches — a pair split across branches looks incomplete to them and is refused (safe by construction). Runs are usable only inside the reader's scope.

## 4. Database guards
The widened shape guard (PostgreSQL `CHECK`, SQLite trigger): `link_pair` ⇒ exactly one unit, reason ≥ 3, `pair_member ∈ {original, reversal}`, both entry ids present and different; any other action ⇒ the three pair columns null. **A finding worth recording:** the first version of the guard let a `link_pair` row with a NULL member through, because a `CHECK` passes on a NULL result (three-valued logic) — caught by the raw-SQL guard test and fixed with explicit `IS NOT NULL` terms in both engines. The A3a guard terms were re-read for the same pattern (all nullable columns were already guarded). Append-only, gapless-revision and immutability triggers are untouched.

## 5. Tests (SQLite and PostgreSQL)

| Suite | Result |
|---|---|
| `PartnerStatementPairReviewApiTest` (11, real ledger) | pass on both (167 assertions) |
| `PartnerStatementReviewConcurrencyPostgresTest` (7: 5 from A3a + 2 pair races, `pcntl_fork`) | pass on PostgreSQL |
| `PartnerStatementReviewApiTest` (A3a, 14) | pass on both with the D-PS-16 rule |
| Wider filter | see PR description |

Covered: member-by-member linking with the engine rows asserted identical before/after and no financial row-count change; every malformed request (missing/invalid member, missing/short reason, two units, `pair_member` on other actions, unknown parameter); an active unit with a matching amount is **not** a pair; ordinary `override` of the pair refused; an `incomplete` chain refused and listed `reviewable:false`; the proof itself over synthetic units (3 entries, 1 entry, no `reversal_of`, dangling `reversal_of`, original not `reversed`, reversal not `posted`, nets that do not cancel, zero nets); per-member double use, replay, changed reason, member move between lines; stale run (`run_stale`, then a fresh run works); D-PS-16; independent permissions, disabled/suspended gate, other-tenant refusal; branch-restricted reviewer (pairs outside their branches invisible and unlinkable, hidden holder shown without identity); raw-SQL shape guards; migration refuses `down()` with `link_pair` rows and rolls down/up cleanly without them. PostgreSQL races: six racers over two lines for the same member ⇒ one winner and clean refusals; original + reversal linked concurrently with duplicate requests ⇒ two decisions, no false blocking, replays for the rest.

**Mutation controls (each must fail ≥ 1 test):** 
- `incomplete` pair allowed to be linked → fails 2 tests
- member-level claim token replaced by the plain unit key → fails 2
- member inferred (defaults to `original`) instead of required → fails 1
- D-PS-16 difference-reason rule removed → fails 1
- member net replaced by the unit's net (0) → fails 5
- original `reversed` / reversal `posted` status checks removed → fails 1
- hidden holder's line identity exposed in `reversed-pairs` → fails 1
- replay ignoring the member → **survived the first run** (the changed-member request also changed the reason, so it was never a replay candidate); the test now sends the identical reason, and the mutation fails it. Recorded because a surviving mutant is a weak test, not a pass.
- (PostgreSQL) the A3a lock-removal controls still apply: the review path and its locks are unchanged.

## 6. Risks and disclosures
1. **No netting check.** Linking only the invoice line (or only the cancellation) is allowed and shown as such; the system does not verify that a statement "nets to zero" — that would be R-REV, forbidden by D-PS-15. `reversed-pairs` shows which members are held.
2. **Simple pairs only.** A reversal of a reversal restores an *active* unit (not a pair); families with more than two entries or several sources are refused (`pair_not_simple`), not guessed.
3. **Pair links do not yet claim movements for D-PS-14** (overlapping finals); that is A3d. Nothing here closes or finalises a reconciliation.
4. **D-PS-16 tightens A3a slightly** (see §2); noted for the owner.
5. `entries` adds payload to every candidate unit in memory (not stored; not in the fingerprint; not in run snapshots).
6. Each `reversed-pairs` call and each decision reads the ledger once, as `GET matches` does.
7. Sandbox: `bcmath` and `contracts/` absent locally (unrelated `Fuel*` / `AppSchemaContractCheckerTest`); CI is the authority.

## 7. Next step (owner approval required; not started)
A3c — `draft → reviewed → closed`, events table, single-scope close, the "dismiss — absent from our books" action, and a statement digest check at close.

# IMP-PARTNER-STATEMENTS — Import & reconcile customer / supplier account statements

**Status:** plan, contracts and open decisions only. **No code, no migration, no journal entry, no permission and no environment change in this PR.** Nothing here is approved for implementation until the decisions in §9 are answered. Owner direction (2026-10-30): *separate the no-financial-effect reconciliation from historical posting into reviewable drafts; start with plan, contracts and decisions — not with real financial posting.*

Verified against `origin/main@0d7f10c0c` (code, not memory); every "today" claim below names the file it was read from.

## 1. Problem

A tenant receives a statement from a supplier (or sends/receives one for a customer) and needs to answer two different questions:

1. **Does the other party's statement agree with our books?** (reconciliation) — read-only comparison; the answer is a list of agreed, missing and different lines.
2. **For the lines we do not have, should we record them?** (historical posting) — creating documents, which *is* an accounting act.

These are different risk classes and are delivered as two tracks that never share a write path.

## 2. What exists today (reused, not rebuilt)

| Asset | Where | Use here |
|---|---|---|
| Partner statement of account (running balance from posted journal lines tagged with the partner; customer/supplier role split; opening-balance by `from`) | `ReportService::partnerStatement` | The **ledger side** of every comparison — read as is; never re-derived |
| Partner master import; opening balance is an accounting act with a journal, not a column (owner decision D-01) | `PartnerImportService`, `PartnerService::create` | Statement import must not reintroduce balances through the partner file |
| Unified import engine: durable `ImportJob`, preview-bound apply, domain gates, error CSV, repair jobs | `app/Services/Import*`, `ImportJobDomain`, `ImportJobAccess` | Upload/parse/preview/progress of statement files |
| Saved column-mapping presets (per tenant × domain) | `ImportMappingPresetService` (H8-S2) | Suppliers send the same layout every month |
| Shared duplicate-identity protocol (reservation per document identity, advisory locks, `DuplicateDocumentException`) | `DocumentDuplicateReservationService` | Track B identity (no double-recording of a statement line as a document) |
| Document Center (OCR/extraction, review, draft builders for purchase/expense) | `app/Services/DocumentCenter/*` | Later: PDF statements as a document type feeding the same line model |
| Ledger engine and document services | `LedgerService`, `InvoiceService`, `PurchaseService`, `ExpenseService`, `PaymentService` | **Only** writers in Track B; the plan adds no writer |

## 3. Two tracks and the wall between them

| | **Track A — Reconcile** | **Track B — Historical posting to drafts** |
|---|---|---|
| Effect | None on the books | Creates **draft** documents through the existing services |
| Writes | Only its own staging/match tables | Existing document tables, via services only |
| Journal / stock / ZATCA | **Never** (guarded by a static test: no reference to `LedgerService`, `JournalEntry`, `JournalLine`, `InventoryService`, `Zatca*`, document services) | Posting stays the existing explicit user action on the draft; the importer never posts |
| Review | Reviewer confirms/overrides each proposed match | Each proposed draft is reviewed before it is created and again as an ordinary draft |
| Gate | New capability; can ship alone | **Blocked** until §9 decisions D-PS-05..07 and the open accounting decisions (D-03 historical sales invoices; D-13) are approved |
| Rollback | Delete the reconciliation (no financial residue) | Per-draft cancel/delete; posted documents follow the ordinary reversal rules |

Track B code does not exist in Track A's PRs. The wall is enforced by a static architecture test, not by convention.

## 4. Track A — Reconciliation

### 4.1 Input
A statement is one party's account listing for a period, from a file (CSV/XLSX in A1; PDF/image through the Document Center in a later slice that only produces the same lines).

Canonical line (all amounts in halalas, `bigint`; SAR only in v1 — other currencies are rejected with a named row error, not converted):

| Field | Rule |
|---|---|
| `line_date` | required, `Y-m-d`, normalised from Arabic/Hijri-free numerals as the other importers do |
| `reference` | the other party's document number (normalised like `DocumentDuplicateReservationService::normalizeReference`) |
| `our_reference` | optional, their citation of **our** number (invoice/PO/payment) — strongest match key |
| `description` | free text, bounded |
| `debit_minor`, `credit_minor` | exactly one non-zero **or** a signed `amount_minor` + a declared sign convention (policy P-3); never `float` |
| `balance_minor` | optional running balance printed on the statement — used only as a checksum, never as input to matching |
| `kind` | optional hint: invoice / credit_note / payment / opening / other |

Header block: `partner_id` (chosen by the user from the tenant's partners; never read from the file), `role` (customer | supplier), `period_from`, `period_to`, optional printed opening and closing balances.

### 4.2 Matching (deterministic, explained, never silent)
Candidates are the **ledger lines of that partner within the statement period ± window** from the same source the report uses (posted + reversed entries, branch filter as the report), grouped to the document level through `source_type/source_id` (invoice, purchase, payment, return, credit/debit note, expense, opening).

Rule ladder, first hit wins, each result stores the rule that fired:
1. `our_reference` equals our document number **and** amounts equal.
2. `reference` equals the supplier-invoice number we stored (purchases) / our invoice number (sales) **and** amounts equal.
3. Same direction + same amount + date within the tolerance window, **unique** candidate on both sides.
4. Many-to-one (one payment line settling several invoices, or the reverse) only when the sum of a user-selected set equals the line — never auto-guessed.

Outcomes per statement line: `matched`, `amount_difference` (reference agrees, amount does not — difference stored), `date_difference`, `missing_in_books`, `ambiguous` (several candidates — needs a human). Per ledger document in the period: `matched`, `missing_in_statement`. Totals: statement closing vs ledger closing, difference, and whether the printed running balances were internally consistent (checksum failure is a warning that the file may be mis-parsed, not a blocker).

A reviewer can confirm, change or clear a match; every human decision is stored with actor/time/reason. **No decision modifies a ledger row or a document.**

### 4.3 Policies (CLAUDE.md rule 6 — configurable, protective default, owner decides the default)
| ID | Choice | Proposed default |
|---|---|---|
| P-1 | Date tolerance (days) for rule 3 | 3, range 0–30, per run |
| P-2 | Amount tolerance (halalas) | 0 (exact), per run; never a percentage |
| P-3 | Sign convention of a one-column amount | must be declared per run (no guess); two-column files need none |
| P-4 | Include reversed entries as ledger candidates | yes (as the statement report does) |
| P-5 | Branch scope of the ledger side | tenant-wide for the partner (statements are per party, not per branch), filter optional |

### 4.4 Data model (additive, proposed — classification per CLAUDE.md rule 5)
`partner_statement_reconciliations` (header: tenant, partner, role, period, status `draft|reviewed|closed`, totals, policy snapshot, source `import_job_id`, created_by, `CompanyWide`) · `partner_statement_lines` (staged canonical lines, immutable after creation, per reconciliation) · `partner_statement_matches` (line ↔ ledger document set, rule, difference, reviewer decision, audit fields) — all tenant-scoped, composite FKs `(tenant_id, id)` like the AI-actions tables, no FK into journal tables beyond read references by id. Classification is a decision (§9 D-PS-03): `CompanyWide` is proposed because a statement is per party, not per branch. A reconciliation never changes after `closed`; correcting means a new one.

### 4.5 API (proposed, `/api`, tenant+RBAC like the rest)
`POST import-jobs` (existing engine, new domain `partner_statement`) · `GET partner-statement-reconciliations` / `…/{id}` (lines + matches, paginated, ≤ 50) · `POST …/{id}/matches` (confirm/override a match; idempotent via `Idempotency-Key`) · `POST …/{id}/close` · `GET …/{id}/export` (CSV of differences, formula-safe). Permissions: `partner_statements.view` / `.reconcile` (new, owner/admin via `*` first, then explicit role grants — same posture as `commerce.orders.*`) **plus** the partner-visibility the report already enforces.

## 5. Track B — Historical posting to reviewable drafts (design only)

Input: the `missing_in_books` lines of a **closed** Track A reconciliation, a user-chosen document type per line (supplier role: purchase / expense / debit note; customer role: sales invoice / credit note / receipt), and the data each document needs that a statement does not carry (account, tax rate, items) supplied by the reviewer.

Rules proposed (all pending §9):
- Output is **drafts only**, through `PurchaseService` / `ExpenseService` / existing document services with `source = statement_import` and the shared identity reservation, so a line cannot become two documents and cannot collide with a spreadsheet/AI/Document Center creation of the same document.
- Dates in a closed fiscal year or locked period are refused by the existing guards (`AccountingDateGuard`); the importer does not retry with another date.
- **No ZATCA artefacts for historical sales documents** until D-03 states what a historical invoice is for ZATCA purposes (issue time, chain, submission). Until then sales-side Track B stays blocked even if purchase-side is approved.
- Journal entries are produced only when a user later posts a draft; this PR family therefore adds **no new accounting operation**. When Track B is implemented, its PR must show the resulting entries per CLAUDE.md pre-PR protocol.

## 6. Authorisation, isolation, safety (both tracks)
- Tenant isolation by `TenantScope`; the partner is resolved inside the tenant (a foreign partner id is a 404 indistinguishable from a missing one); statement file contents are untrusted: size/rows/columns limits like the other importers (2000 rows, 5 MB, 200 columns), formula-safe exports, no external entities in XLSX.
- Statement text can contain personal/commercial data: it is stored only in the tenant's staging tables, never sent to an AI provider by this feature (an AI-assisted mapping would reuse the existing consent/category gates, separate decision).
- Concurrency: one open reconciliation per (tenant, partner, role, period) enforced by a unique index + advisory lock around create; match confirmation is a compare-and-swap on a version column.
- Idempotency: file re-upload with the same content hash for the same (partner, period) returns the existing reconciliation, never a second one.

## 7. Slice plan (each its own small PR; none starts without its decisions)
| Slice | Content | Needs |
|---|---|---|
| PS-S0 | This plan + Tracker rows + decision log | — (this PR) |
| PS-A1 | Staging tables + canonical parser/inspect/preview for one domain `partner_statement` in the import engine; **no matching** | D-PS-01..04 |
| PS-A2 | Matching engine + explanation + totals (service, API read) | A1 |
| PS-A3 | Review actions (confirm/override/clear), close, audit | A2 |
| PS-A4 | UI: upload wizard, side-by-side reconciliation table, differences export | A3 |
| PS-A5 | PDF/image statements through the Document Center producing the same lines | A4 + Document Center decision |
| PS-B1 | Supplier side → purchase/expense **drafts** | A4 + D-PS-05..07 + accounting approvals |
| PS-B2 | Customer side → invoice/credit-note/receipt drafts | B1 + D-03 + ZATCA decision |

## 8. Test strategy (every slice)
Static architecture test for the Track A wall; cross-tenant partner/reconciliation access (list, show, close, match); permission matrix (view vs reconcile vs none); idempotent re-upload; sign-convention matrix (customer/supplier × one/two columns); matching ladder with ambiguity; many-to-one explicit sum; period/branch filters equal to `partnerStatement` for the same inputs (parity test against the report); PostgreSQL real-fork race for create and for two reviewers confirming the same line; mutation controls for each guard.

## 9. Decisions needed (owner) — recommendation first

> **2026-11-01 — approved by the owner: D-PS-01..04** (SAR only; independent `partner_statements.*` permissions with no implicit grant; `CompanyWide` with tenant isolation and the existing partner-visibility controls; policies P-1..P-5 as in §4.3, P-4/P-5 as clarified in the Tracker decision log). **D-PS-05..09, D-03, D-06 and D-13 remain open and are not assumed.**
| ID | Question | Recommendation |
|---|---|---|
| D-PS-01 | Is v1 SAR-only with other currencies rejected? | Yes |
| D-PS-02 | Who may reconcile: new permission `partner_statements.*` (owner/admin first) or reuse the partner/report permissions? | New permission; no implicit grants |
| D-PS-03 | Classification of the three tables: `CompanyWide` (per party) or `BranchScoped`? | `CompanyWide` |
| D-PS-04 | Default policies P-1..P-5 | As proposed in §4.3 |
| D-PS-05 | May Track B ever create **posted** documents, or drafts only? | Drafts only, permanently |
| D-PS-06 | Supplier-side Track B before customer-side? | Yes (no ZATCA dependency) |
| D-PS-07 | What does a historical customer line become for ZATCA (no artefact / flagged historical)? | Needs the tax advisor input already tracked under D-03/D-06; sales side stays blocked |
| D-PS-08 | Application key: reuse `customers.followup` / `purchases.cycle` or a new catalogue entry? | New entry only if the catalogue owner agrees; otherwise gate by existing keys per role |
| D-PS-09 | Retention of statement files/lines after `closed` | Same as import jobs until a policy exists |

## 10. Risks
Parsing a free-form statement is the main source of wrong matches — hence checksums, explicit sign convention, no auto many-to-one, and a reviewer step. Reconciliation results look authoritative: the UI must say "comparison, not a book entry". Track B is where money can be wrong: kept behind decisions and drafts-only. Scope creep into bank-statement reconciliation: out of scope (different counterparty model).

# IMP-PARTNER-STATEMENTS — PS-A2 execution plan (matching engine) + D-PS-08 + period-reconciliation policy

**Status: plan only. No code, no migration, no permission, no catalogue entry and no environment change.** Nothing here starts until the owner approves it explicitly. Written 2026-11-01 after the PS-A1 review (PR #1877). Every "today" claim names the file it was read from.

Boundaries that do not move: Track A has no financial effect (no journal entry, document, payment, stock movement or ZATCA artefact); Track B and PS-A3/A4 are out of scope; D-PS-05, D-PS-06, D-PS-07, D-PS-09, D-03, D-06 and D-13 stay open and are not assumed.

## 1. Owner decisions recorded (2026-11-01)

| ID | Decision | Consequence for the plan |
|---|---|---|
| D-PS-01..04, P-1..P-5 | Approved earlier | Unchanged |
| **D-PS-08** | **Approved: an independent catalogue key for customer/supplier statements** | §6 |
| **Period policy** | **Approved: many drafts for the same tenant + partner + role + period; at most one *effective final* reconciliation per scope. No unique constraint on drafts; no deletion of earlier reconciliations; not an authorisation to touch balances or create entries** | §5 |

## 2. Ledger source — the one `ReportService::partnerStatement` reads

`ReportService::partnerStatement` (app/Services/Reporting/ReportService.php:670) reads `journal_lines` tagged with the partner (`partner_type = Partner`, `partner_id`) joined to `journal_entries` with `status IN ('posted','reversed')` (`postedLines`, line 925), branch-filtered like every report, optionally role-split (`partner_role`) by the entry's source document, ordered by `entry_date, created_at`. Each row carries entry number, description, debit, credit, running balance and a `source` block (`kind`, `id`, `label`, payment allocations).

**Rule for PS-A2: the engine consumes exactly this source — it does not write a second query that could drift from the report.** Two ways, recommended first:
1. **Wrap the report (recommended).** A read-only `PartnerLedgerCandidates` service calls `ReportService::partnerStatement($partnerId, ['from' => period_from − date_tol, 'to' => period_to + date_tol, 'partner_role' => role, branch filter per policy])` and groups rows to the **document level** by `source.kind + source.id`. Needs two *additive* row keys the report does not expose today — `entry_id` and `reversal_of`/`entry_status` — see §4. Adding keys is backward compatible but it *is* a change to a shared service, so it needs the owner's explicit nod (decision **D-PS-10** below). Parity test: for a fixed fixture the candidate set equals the report's rows.
2. **Look up entry status by number** from the report rows (one `whereIn('number')` query). No `ReportService` change, but entry numbers are scoped per branch (`GeneratesDocumentNumbers`), so a number can repeat across branches → ambiguous. Not recommended.

Window: the report is called with the period widened by the date tolerance so a line dated 30 Sep in their books and 2 Oct in ours can still pair; candidates outside the *period* are shown as "outside period" and cannot be `missing_in_statement`.

## 3. Matching — deterministic, explained, never silent

### 3.1 Orientation (the customer/supplier question)
A1 stores lines **as printed by the counterparty** (their books). Their debit is our credit and vice versa — for **both** roles:

| | Counterparty statement | Our ledger (partner line) |
|---|---|---|
| Supplier invoices us 1,000 | their debit 1,000 (we are their receivable) | our **credit** 1,000 on 2110 |
| We pay the supplier 400 | their credit 400 | our **debit** 400 |
| We invoice a customer 1,000 | their credit 1,000 (we are their payable) | our **debit** 1,000 on 1130 |
| Customer pays us 400 | their debit 400 | our **credit** 400 |

So the *mirror* rule is uniform (`stmt.debit ↔ ledger.credit`, `stmt.credit ↔ ledger.debit`). What the **role** changes is (a) which ledger lines are candidates (`partner_role` source split, so a "both" partner is not mixed) and (b) the **sanity check** of `kind` against the side (e.g. role=customer, kind=`payment` must land on our credit; a mismatch is reported as a warning on the explanation, never used to override a match). The one-column direction (P-3) is already resolved to debit/credit at import, so the engine never sees a sign.
**Open question D-PS-11:** a statement exported from *our own* orientation (customer sends back our statement) would need an `orientation` flag frozen in the policy JSON at import. Not assumed; A2 treats every stored line as counterparty-orientation, which is what A1's contract says. Policy is JSON, so adding the flag later needs no schema change.

### 3.2 Units
Ledger side is matched at **document level**: lines with the same `source.kind + source.id` are summed per direction (an invoice may carry several partner lines; a payment settles several documents via allocations — allocations are *evidence*, not units). Manual journal lines (no source) are individual units (`kind=journal`).

### 3.3 Rule ladder (first hit wins; the fired rule and its inputs are stored)
1. **R1** `our_reference_key` = document number key **and** mirrored direction **and** |amount difference| ≤ P-2.
2. **R2** `reference_key` = our counterpart key (sales: our invoice/credit-note number; purchases: `purchases.supplier_invoice_no`; payments: payment number) **and** direction **and** amount within P-2.
3. **R3** same mirrored direction + amount within P-2 + date within P-1, **unique on both sides** (one candidate each way). Not unique ⇒ `ambiguous`, never a guess.
4. **Many-to-one** (one payment line vs several invoices, or the reverse): **never automatic.** A reviewer picks the set; the engine only *verifies* that the selected set sums to the line (±P-2) and records it. PS-A2 exposes only the **verification read** ("does this set equal this line?"); persisting a manual decision is PS-A3. The engine may *suggest* candidate sets ("sum of invoices X+Y equals the line") as a hint flagged `suggestion`, never applied.

### 3.4 Outcomes (statement side) and (ledger side)
| Outcome | Meaning |
|---|---|
| `matched` | a rule hit with amount within P-2 and date within P-1 |
| `amount_difference` | R1/R2 key agrees, direction agrees, amount outside P-2 — signed difference stored |
| `date_difference` | key/amount agree but date outside P-1 — day difference stored |
| `ambiguous` | R3 has several candidates (or one candidate claimed by several lines) — candidate list stored, needs a human |
| `missing_in_books` | no candidate at all (statement line we do not have) |
| ledger side: `matched` / `missing_in_statement` | document in the period with no statement line |

A key hit on the **opposite** direction is reported as `amount_difference` with `detail.direction_mismatch = true` (proposed; owner may prefer a sixth outcome). Each stored result carries `rule`, `explanation_code` + parameters (codes, not prose, so the UI translates), and the numbers compared.

### 3.5 Reversed entries (P-4) without double counting
Today `LedgerService::reverse` (LedgerService.php:104) creates the reversing entry with `reversal_of = original.id` but **no `source_type/source_id`**, and flips the original to `reversed`. The report keeps both (original + reversal = 0). Two consequences the engine must handle:
- **Pair netting:** an original with a reversal is a *neutralised pair*: both are loaded, flagged `neutralised`, excluded from R1–R3 candidacy and from `missing_in_statement`, and shown with the pair link. If the counterparty statement **also** lists the invoice and its cancellation, those two statement lines match the pair as `matched` by amount netting rule R-REV (original + cancellation = 0 on both sides); a statement that lists only the invoice yields `amount_difference` against a zero net (explained as "reversed in our books on <date>"). Balances are never summed twice because the engine never adds a reversed pair's amounts into a candidate total.
- **Existing-report observation to verify first (not fixed here):** because the reversal has no source, the role-filtered branch of `partnerStatement` (`$sourceRoles[$key] ?? null) === $role`) appears to drop the reversal rows while keeping the original, so a role-filtered statement may not net a reversed document. From code reading only — PS-A2 starts with a characterisation test; if confirmed it is reported to the owner as a separate report-service issue and the engine does **not** inherit it (it links reversal → original through `reversal_of`, which needs the §4 keys).

## 4. Data model and API additions (proposed, each its own review)

- `partner_statement_matches` (per reconciliation + line): `outcome`, `rule`, `explanation` (json codes), `difference_minor`, `day_difference`, `candidate_refs` (json: `source_kind`, `source_id`, entry id/number, signed amount, date), `computed_at`, `engine_version`. **Derived data**, recomputable: PS-A2 stores a run (`partner_statement_match_runs`: reconciliation, policy snapshot copy, engine version, counts, `ledger_fingerprint`) + the matches; a rerun creates a new run, the previous one is kept. Both `CompanyWide`, composite tenant FKs like A1, no FK into journal tables (ids stored as references).
- `ledger_fingerprint` = hash of the candidate set (ids + amounts + dates + entry status). A later read shows "ledger changed since this run" instead of silently showing stale matches.
- Additive keys on `ReportService::partnerStatement` rows (`entry_id`, `entry_status`, `reversal_of`) **only if D-PS-10 is approved**.
- API (read + compute only): `POST partner-statement-reconciliations/{id}/match` (run, idempotent per fingerprint+policy), `GET …/{id}/matches` (paginated ≤ 50, filter by outcome), `GET …/{id}/verify-set` (many-to-one verification, read-only). Gates: `partner_statements.view` for reads, `partner_statements.reconcile` for the run, `partners.view`, partner-visibility + branch scope (same `assertAccess` as A1, extracted so both slices share one check), and the application gate (§6). Throttled.
- Static wall extended: the matching code may read the ledger **only** through the report/candidate service; no writer class referenced.

## 5. One effective final reconciliation per scope, many drafts

*PS-A2 itself adds no close, no status change and no uniqueness rule* — close is PS-A3. This section fixes the design so A2's schema does not paint A3 into a corner.

**Scope** = `tenant + partner + role + period_from + period_to` (exact tuple, as approved). Branch filter is *not* part of the scope (**D-PS-12:** may a branch-filtered reconciliation be the final one for the tuple? Recommended yes — the filter is part of what was finalised and is shown on it; overlapping-but-different periods are a *warning*, not a block).

**Statuses (A3):** `draft → reviewed → closed`, plus the two terminal-for-history states `superseded` and `voided`.
- **Effective final** = `status = 'closed'`. It is the only status that is unique per scope. `superseded`/`voided` rows are history, never effective.
- Drafts and `reviewed` are unlimited per scope. Uploading a corrected file creates a new draft (A1 now guarantees this even for the same file under a different interpretation).
- **Close** (A3): `reviewed → closed`. If an effective final already exists for the scope the call is refused with the existing id unless the caller passes an explicit `replace = true` + reason; with it, one transaction marks the old one `superseded` (`superseded_by`, `superseded_at`, actor, reason) and closes the new one. Without `partner_statements.reconcile` nothing moves.
- **Void** (A3): `closed → voided` with a mandatory reason; the scope then has no effective final. Nothing is deleted; lines, matches and runs stay.
- **Append-only events table** `partner_statement_reconciliation_events` (reconciliation, actor, from_status, to_status, reason, at) written in the same transaction as every transition; DB triggers forbid UPDATE/DELETE on it (same pattern as `zatca_rollout_control_events`).
- **Guarantee in layers:** (1) service takes `pg_advisory_xact_lock(hash(scope))` then `SELECT … FOR UPDATE` on the current effective row; transitions are compare-and-swap on `status`; never catch a unique violation inside a PostgreSQL transaction. (2) **Partial unique index** on `(tenant_id, partner_id, role, period_from, period_to) WHERE status = 'closed'` — supported by PostgreSQL and SQLite — as the last net; it constrains only `closed`, so drafts stay unconstrained. (3) Status `CHECK` constraint and a trigger forbidding any change to a `closed` row's lines/policy (immutable after close, as the plan §4.4 already says).
- **Concurrency test (PostgreSQL, real `pcntl_fork`):** N racers closing different drafts of one scope → exactly one `closed`, the rest refused or (with `replace`) serialised into a clean supersede chain; a close racing a void; cross-scope closes do not block each other. SQLite covers the logic, PostgreSQL the race; missing `pcntl` is a failure, not a skip.
- Not an authorisation to alter balances or post entries: close/void/supersede change reconciliation status only.

## 6. D-PS-08 — independent application key

**Existing convention** (`ApplicationCatalog`): `group.capability`, snake_case (`purchases.cycle`, `finance.operations`, `crm.follow_up`, `document_center.core`, `accounting.cheques`), with `group`, `maturity`, `mandatory`, `dependencies`, optional `access`.

**Proposed key: `accounting.partner_statements`** — group `accounting` (it reconciles against the ledger and serves customers *and* suppliers, so neither `crm` nor `purchases` fits), `maturity = built` **only when PS-A2 ships a usable capability** (A1 is staging only; a `coming_soon` key cannot be enabled and `ApplicationCatalogTest` forbids storing `true` for it), `mandatory = false`, `dependencies = ['accounting.ledger']`, `access` omitted (= operational, state decides; `ApplicationAccessGateGuardTest` verifies it against the middleware). Alternatives considered and rejected: reusing `purchases.cycle` / `crm.follow_up` (would couple a cross-role feature to one side and let disabling an unrelated app hide it); a new group (no precedent, extra sidebar semantics).

Integration, using the existing architecture only:
- `ImportJobDomain::AUTHORIZATION[PARTNER_STATEMENT]['app'] = 'accounting.partner_statements'` (the same field `EXPENSE_IMPORT` etc. use); `ImportJobAccess` already calls `ApplicationAccess::authorize` when `app` is set.
- The new A2 routes get `EnsureApplicationActive:accounting.partner_statements`; the A1 routes (`partner-statements/*` template/fields/inspect/preview) get it in the same PR that registers the key, so import and match are gated together.
- **RBAC stays mandatory and independent:** the app gate never replaces `partner_statements.view/reconcile` or `partners.view`; no new implicit grant; owner/admin still only via `*`.
- Sidebar/nav: only if a screen exists (A2 has none) — then through `nav-state` with the key, like other optional capabilities. No UI in A2.
- **Activation policy — needs the owner's eyes (do not assume):** `TenantApplicationService::isGrandfatheredTenant()` treats tenants registered before `ENFORCEMENT_CUTOVER_AT = 2026-08-21` as **enabled for any capability they never decided on**; newer tenants start disabled until explicit enable. So registering a `built` key makes it *automatically enabled for every legacy tenant* and off for new ones. Exposure is bounded because the permissions are owner/admin-only, but this is a rollout decision (**D-PS-13:** accept the grandfathering default, or ship the key with a per-tenant explicit-enable list / platform-console enablement first). Commercial plans/entitlements (`Plans`, `ApplicationEntitlement`) are untouched: the key is operational, not commercially gated, until the owner says otherwise.
- Tests: `ApplicationCatalogTest` (key, group, dependency), `ApplicationAccessGateGuardTest`, an enable/disable/suspended matrix for the routes (disabled ⇒ 403/blocked, suspended ⇒ reads only — suspended is reachable once statements exist: `disable()` data-aware check must include `PartnerStatementReconciliation` rows, a required addition to the P2 data probe list), RBAC-without-app and app-without-RBAC both refused, tenant isolation.

## 7. Slice plan (each its own small PR, owner approval between slices)

| Slice | Content | Blocked by |
|---|---|---|
| **PS-A2a** | Catalogue key + gate wiring on A1 routes/domain (D-PS-08, D-PS-13), `disable()` data probe | owner nod on D-PS-13 |
| **PS-A2b** | `PartnerLedgerCandidates` + characterisation test of the report (incl. the reversal/role-filter observation) + additive keys (D-PS-10) | D-PS-10 |
| **PS-A2c** | Matching engine R1–R3, outcomes, reversed-pair netting, match tables/run, `match`/`matches`/`verify-set` API; no UI | A2a, A2b, D-PS-11 |
| PS-A3 | Review actions, close/replace/void, events, partial unique index, concurrency tests | A2c; §5 decisions D-PS-12 |
| PS-A4 | UI | A3 |

## 8. Test strategy for A2 (SQLite + PostgreSQL)
Per rule and outcome fixtures; mirror orientation for both roles and for a `both` partner; reversed original + reversal + statement listing both/one/none; duplicate amounts ⇒ `ambiguous`; tolerance edges (date 0/30, amount 0/10000); branch-restricted actors; ledger changing between runs (fingerprint); tenant isolation of lines, runs and candidates; static wall (no writer class); mutation controls (drop the uniqueness check in R3, drop the pair netting, drop the direction check, drop the app gate); query-count test (no N+1); a financial no-effect test (row counts of the ledger/document tables and balances unchanged by a full run).

## 9. New decisions raised (recommendation first; none assumed)
| ID | Question | Recommendation |
|---|---|---|
| D-PS-10 | May `ReportService::partnerStatement` rows gain additive keys `entry_id`, `entry_status`, `reversal_of`? | Yes, additive + parity test |
| D-PS-11 | Support statements in *our* orientation via a frozen `orientation` flag? | Not in A2; add later if a real file needs it |
| D-PS-12 | Is a branch-filtered reconciliation allowed to be the effective final of its tuple? | Yes; overlapping periods only warn |
| D-PS-13 | Legacy-tenant grandfathering of the new key: accept, or enable per tenant first? | Owner decision; default behaviour is grandfathered-on |

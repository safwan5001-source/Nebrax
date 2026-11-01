# IMP-PARTNER-STATEMENTS — PS-A2 execution plan (matching engine) + D-PS-08 + period-reconciliation policy

**Status: plan only. No code, no migration, no permission, no catalogue entry and no environment change.** Nothing here starts until the owner approves it explicitly. Written 2026-11-01 after the PS-A1 review (PR #1877); **updated the same day with the owner's answers to D-PS-10..14** (this revision is documentation only, in its own PR). Every "today" claim names the file it was read from.

Boundaries that do not move: Track A has no financial effect (no journal entry, document, payment, stock movement or ZATCA artefact); Track B and PS-A3/A4 are out of scope; D-PS-05, D-PS-06, D-PS-07, D-PS-09, D-03, D-06 and D-13 stay open and are not assumed.

## 1. Owner decisions recorded (2026-11-01)

| ID | Decision | Consequence for the plan |
|---|---|---|
| D-PS-01..04, P-1..P-5 | Approved earlier | Unchanged |
| **D-PS-08** | **Approved: an independent catalogue key for customer/supplier statements** | §6 |
| **D-PS-10** | **Approved:** `entry_id`, `entry_status`, `reversal_of` are added to the statement source **additively and compatibly**; tests must prove the current report results do not change | §2 |
| **D-PS-11** | **Approved: deferred.** No `orientation` support; v1 uses the counterparty's orientation only | §3.1 |
| **D-PS-12** | **Approved:** a final reconciliation is final **within its real scope (organisation or branch)**; a one-branch reconciliation is never presented as organisation-wide; non-conflict rules between overlapping scopes are designed **before** PS-A3 builds close | §5 |
| **D-PS-13** | **Approved:** `accounting.partner_statements` is **not** auto-enabled for legacy tenants; the existing activation mechanism is used and the absence of a decision never enables it | §6 |
| **D-PS-14** | **Approved:** overlapping statement periods are allowed with a clear warning and an explicit acknowledgement; a **real** conflict between effective finals is prevented at close. Date overlap alone is **not** evidence of a conflict of movements | §5.5 |
| **Period policy** | **Approved: many drafts for the same tenant + partner + role + period; at most one *effective final* reconciliation per scope. No unique constraint on drafts; no deletion of earlier reconciliations; not an authorisation to touch balances or create entries** | §5 |

## 2. Ledger source — the one `ReportService::partnerStatement` reads

`ReportService::partnerStatement` (app/Services/Reporting/ReportService.php:670) reads `journal_lines` tagged with the partner (`partner_type = Partner`, `partner_id`) joined to `journal_entries` with `status IN ('posted','reversed')` (`postedLines`, line 925), branch-filtered like every report, optionally role-split (`partner_role`) by the entry's source document, ordered by `entry_date, created_at`. Each row carries entry number, description, debit, credit, running balance and a `source` block (`kind`, `id`, `label`, payment allocations).

**Rule for PS-A2: the engine consumes exactly this source — it does not write a second query that could drift from the report.** Two ways, recommended first:
1. **Wrap the report (recommended).** A read-only `PartnerLedgerCandidates` service calls `ReportService::partnerStatement($partnerId, ['from' => period_from − date_tol, 'to' => period_to + date_tol, 'partner_role' => role, branch filter per policy])` and groups rows to the **document level** by `source.kind + source.id`. Needs two *additive* row keys the report does not expose today — `entry_id` and `reversal_of`/`entry_status` — see §4. **Approved as D-PS-10 — implemented in PS-A2b (report `reports/IMP-PS-A2b-REPORT.md`).** The change is strictly additive: three new keys on each row, nothing renamed, reordered, re-typed or re-computed. Required tests (PS-A2b): (a) a **golden snapshot** of `partnerStatement` for a fixture covering invoice, purchase, payment with allocations, credit note, return, opening balance, reversed document, role-split partner and branch-filtered read — the existing keys/values/order are byte-identical before and after the change; (b) the new keys are correct (`entry_status` ∈ posted/reversed, `reversal_of` only on reversal entries, `entry_id` = the journal entry id); (c) the HTTP report endpoint response is **identical** to the old one — `ReportController` whitelists its row keys, so the three keys exist on the service rows only (verified in PS-A2b); (d) web/OpenAPI consumers: typed readers ignore unknown keys (checked, not assumed); (e) parity: the candidate set equals the report's rows.
2. *(rejected by the owner's choice of option 1)* **Look up entry status by number** from the report rows (one `whereIn('number')` query). No `ReportService` change, but entry numbers are scoped per branch (`GeneratesDocumentNumbers`), so a number can repeat across branches → ambiguous. Not recommended.

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
**D-PS-11 (approved: deferred).** v1 supports the **counterparty's orientation only**, which is what A1's contract says. There is no `orientation` option, no heuristic and no detection; a file in our own orientation must be re-exported or is out of scope for v1. The frozen policy carries `version: 1`; if orientation is ever approved it is a `version: 2` policy field (policy is JSON — no schema change) and the identity hash changes with it, so v1 drafts are never reinterpreted.

### 3.2 Units
Ledger side is matched at **document level**: lines with the same `source.kind + source.id` are summed per direction (an invoice may carry several partner lines; a payment settles several documents via allocations — allocations are *evidence*, not units). Manual journal lines (no source) are individual units (`kind=journal`).

### 3.3 Rule ladder (first hit wins; the fired rule and its inputs are stored)
1. **R1** `our_reference_key` = document number key **and** mirrored direction **and** |amount difference| ≤ P-2.
2. **R2** `reference_key` = our counterpart key (sales: our invoice/credit-note number; purchases: `purchases.supplier_invoice_no`; payments: payment number) **and** direction **and** amount within P-2.
3. **R3** same mirrored direction + amount within P-2 + date within P-1, **unique on both sides** (one candidate each way). Not unique ⇒ `ambiguous`, never a guess.
4. **Many-to-one** (one payment line vs several invoices, or the reverse): **never automatic.** A reviewer picks the set; the engine only *verifies* that the selected set sums to the line (±P-2) and records it. PS-A2 exposes only the **verification read** ("does this set equal this line?"); persisting a manual decision is PS-A3. The engine may *suggest* candidate sets ("sum of invoices X+Y equals the line") as a hint flagged `suggestion`, never applied.

> **PS-A2c implementation notes (2026-11-02, `reports/IMP-PS-A2c-REPORT.md`):** R1–R3 are built exactly as above on top of `PartnerLedgerCandidates`; `rule` is an ordinal evidence tier (no probability/confidence score is invented). **Not built:** `R-REV` netting of a statement's invoice+cancellation lines against a neutralised pair (proposed as D-PS-15) — a key hit on a neutralised unit is `amount_difference / reversed_in_books`, an incomplete one is `ambiguous / candidate_reversal_incomplete`, never matched. Running a match needs `partner_statements.reconcile` **and** `.view` (no implicit grant). Many-to-one is only suggested (pool ≤ 20, sets of 2–3, ≤ 5 per line, first 200 unresolved lines) and verifiable read-only.

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
- Additive keys on `ReportService::partnerStatement` rows (`entry_id`, `entry_status`, `reversal_of`) (D-PS-10, approved).
- API (read + compute only): `POST partner-statement-reconciliations/{id}/match` (run, idempotent per fingerprint+policy), `GET …/{id}/matches` (paginated ≤ 50, filter by outcome), `GET …/{id}/verify-set` (many-to-one verification, read-only). Gates: `partner_statements.view` for reads, `partner_statements.reconcile` for the run, `partners.view`, partner-visibility + branch scope (same `assertAccess` as A1, extracted so both slices share one check), and the application gate (§6). Throttled.
- Static wall extended: the matching code may read the ledger **only** through the report/candidate service; no writer class referenced.

## 5. One effective final reconciliation per scope, many drafts

*PS-A2 itself adds no close, no status change and no uniqueness rule* — close is PS-A3. This section fixes the design (including the scope rules of **D-PS-12**) so A2's schema does not paint A3 into a corner.

### 5.1 Scope is the *real* scope of what was compared
Tuple = `tenant + partner + role + period_from + period_to` (as approved) **plus the effective ledger scope**:
- `scope_kind = organization` — only when the ledger side was read for **all** branches: no branch filter **and** an actor not restricted to a branch subset.
- `scope_kind = branch` with one `scope_branch_id` — a branch filter was chosen (inside the actor's scope), or the actor is restricted to exactly one branch.
- An actor restricted to **several** branches with no filter has no honest single scope: they may run drafts and matching (the ledger side is the intersection the report already computes), but **cannot close** until they pick one branch. `ReportService::branchIds` intersects the request with the user's permissions, so "no filter" for a restricted user is *not* organisation-wide — the system never labels it as such.
- The effective scope is taken from the **match run** (the ledger actually read, §4 `ledger_scope`), not from the A1 `policy.branch_id`, which only records the requested filter. Close requires a match run.
- Every surface (list, detail, export, status badge, any future summary) carries `scope {kind, branch_id, branch_name}` and `covers_organization` (true only for `organization`). A read model "final coverage for partner/period" returns `{organization_final | null, branch_finals[]}` and **never** reports organisation coverage from branch finals.

### 5.2 Statuses (A3)
`draft → reviewed → closed`, plus the history states `superseded` and `voided`.
- **Effective final** = `status = 'closed'` within its scope. `superseded`/`voided` are history, never effective. Drafts and `reviewed` are unlimited per tuple. Uploading a corrected file creates a new draft (A1 guarantees this even for the same file under a different interpretation).
- **Close:** `reviewed → closed`, requires a match run on the current ledger fingerprint (or an explicit acknowledgement that the ledger moved).
- **Void:** `closed → voided`, mandatory reason; the scope then has no effective final.
- **Replace** is explicit (`replace = true` + reason) and only in the allowed directions below. Nothing is deleted; lines, matches and runs stay. An **append-only events table** (`partner_statement_reconciliation_events`: reconciliation, actor, from_status, to_status, reason, at; UPDATE/DELETE forbidden by triggers, like `zatca_rollout_control_events`) is written in the same transaction as every transition.

### 5.3 Non-conflict rules between overlapping scopes (designed now, enforced in A3)
For one tuple (partner, role, period) the effective finals must satisfy:
| Existing effective final | Closing another… | Result |
|---|---|---|
| none | organization or branch | allowed |
| organization | organization | refused unless `replace` (supersedes the old one) |
| organization | branch (any) | **refused** — an organisation final already covers it; to narrow, void the organisation final first (explicit, audited) |
| branch A | branch A | refused unless `replace` |
| branch A | branch B | allowed (disjoint scopes) |
| branch A, B… | organization | **refused** unless `replace` with the explicit list of the branch finals it supersedes (all in one transaction, one event each, reason mandatory) |
Different but overlapping **periods** of the same partner/role are governed by §5.5 (D-PS-14): warning + acknowledgement, and a block only on a real conflict of movements.

### 5.4 Guarantee in layers
1. **Service:** every close/void/replace takes `pg_advisory_xact_lock(hash(tenant, partner, role))` — **partner/role-wide** (not per tuple and not per scope), because periods that overlap but differ conflict through shared movements (§5.5), so an organisation close, a branch close and closes of overlapping periods must all serialise — then `SELECT … FOR UPDATE` on the effective finals of the tuple and re-checks the table above; transitions are compare-and-swap on `status`. Never catch a unique violation inside a PostgreSQL transaction.
2. **Same-scope net:** partial unique index on `(tenant_id, partner_id, role, period_from, period_to, scope_key) WHERE status = 'closed'`, where `scope_key` is `'org'` or the branch UUID (stored at close). Partial indexes work on PostgreSQL and SQLite; drafts and history rows are unconstrained.
3. **Cross-scope net:** a trigger (PostgreSQL + SQLite, same pattern as the F2 fences) rejects a row becoming `closed` when the table above forbids it (organisation vs any other effective final of the tuple), because a unique index cannot express "org excludes branch". Triggers take no locks beyond the row (MVCC reads), so the advisory lock stays the only serialiser.
4. **Immutability:** status `CHECK`; a trigger forbids changing lines/policy of a `closed` row.
- **PostgreSQL fork tests (`pcntl_fork`, failure not skip):** N racers closing different drafts of one scope → exactly one `closed`; org close racing branch close of the same tuple → exactly one wins and the loser is refused; two different branches close concurrently → both succeed (no false blocking); close racing void; replace chains stay linear. SQLite covers the logic, PostgreSQL the race.
- Close/void/replace change reconciliation status only — **no authority over balances, entries, documents or tax.**

### 5.5 Overlapping periods and real conflicts (D-PS-14, approved)
**Principle:** overlap of *dates* is a reason to warn, never by itself a reason to block. What is blocked is the same **movement** being claimed by two effective finals, because then one ledger movement would be "reconciled" twice, possibly with different outcomes.

- **Overlap warning (non-blocking, always shown):** at close, the server computes the effective finals of the same partner + role whose period overlaps and whose scope intersects (organisation intersects everything; branch A intersects only branch A). If any exist, close is refused with `overlap_ack_required` and the list, until the caller repeats the request with `acknowledge_overlap = [ids]` — the list must **equal** the server's list at that moment (a stale or partial list is refused, `overlap_ack_stale`). The acknowledgement and the list are stored in the close event. The UI shows the overlapping finals, their periods and scopes.
- **Claimed movements (the conflict test):** closing writes, in the same transaction, one claim per **ledger unit** the final actually covered. **The claimed set is not the search candidate set** (§2 widens the search by the date tolerance, so a 31 Jan entry is a *candidate* for both January and February runs). Claimed = (a) every entry whose `entry_date` lies **inside** the statement period `period_from..period_to`, plus (b) every **outside-period** entry that the run actually **used** — matched to a statement line (`matched`, `amount_difference`, `date_difference`) or included in a reviewer-verified many-to-one set. Unused tolerance-window candidates, and unresolved `ambiguous` candidates outside the period, are **not** claimed. Units are document-level entries from the report source (`entry_id` from D-PS-10); reversed originals and their reversals are ordinary entries. Table `partner_statement_unit_claims` (`tenant_id`, `reconciliation_id`, `partner_id`, `role`, `unit_key` = journal entry id, `branch_id`, `claimed_at`, `released_at` null while the final is effective; composite tenant FKs; `CompanyWide`; append-only except `released_at`). Drafts and `reviewed` rows never claim.
- **Real conflict** = a unit that already has an active claim (`released_at IS NULL`) from another final of the same partner + role. Then close is refused with `unit_conflict` naming the conflicting reconciliation ids and a bounded sample of unit refs. Because units are per entry and entries carry their branch, an organisation final and a branch final conflict **only** through genuinely shared movements, and two different-branch finals never do. (§5.3 stays as the stricter rule for the *identical* period tuple.)
- **Resolution:** `replace = true` with the explicit list of the finals to supersede and a reason; all in one transaction — conflicting finals → `superseded`, their claims `released_at`, the new final's claims written, one event each. Void releases the claims too. A final never silently loses units.
- **Statement-side duplicates** (the same `reference_key` + amount + direction in another effective final's statement lines, which have no ledger unit — typically `missing_in_books` lines) are a **warning only**, listed in the same acknowledgement; they cannot be a ledger conflict.
- **Disjoint movements in overlapping dates** (e.g. Jan–Mar and Feb–Apr with no ledger movement dated Feb–Mar for that partner): no claim collides → allowed after acknowledgement. This is the case the owner called out: overlap alone is not conflict.
- **Documented limits:** (1) a movement posted *after* a final closed is not claimed by it; the final shows "ledger changed since close" (fingerprint) and a later final that covers the date claims it — no conflict. (2) A reversed pair whose original and reversal fall in different finals is split across them (each entry claimed once); the UI flags the pair. (3) Claims are per entry, not per journal line.
- **Guarantee in layers:** (a) the partner/role-wide advisory lock (§5.4) serialises every close/void/replace; (b) the service pre-checks the claims and overlap list under the lock; (c) **net:** a partial unique index `UNIQUE (tenant_id, partner_id, role, unit_key) WHERE released_at IS NULL` on the claims table (PostgreSQL + SQLite) rejects any second active claim even from raw SQL; never catch a unique violation inside a PostgreSQL transaction (the pre-check makes it unreachable in normal flow).

**How the conflict prevention is tested (PS-A3, SQLite + PostgreSQL):**
1. *Date overlap alone is not a conflict (negative test):* overlapping periods with disjoint movements → refused without acknowledgement (`overlap_ack_required`), allowed with it; both finals effective; no `unit_conflict`.
   1b. *Adjacent periods and the tolerance window (Codex #1886):* January and February finals for one partner, a 31 Jan entry inside the 3-day window of February's run but **not matched there** → both close with no `unit_conflict` (adjacent periods need no acknowledgement unless they overlap); the 31 Jan entry is claimed by January only. Counter-case: if February's run **does** match that 31 Jan entry to a February statement line, it becomes a used outside-period entry and the second close is a real `unit_conflict` (or is resolved by `replace`). Also: an unresolved `ambiguous` outside-period candidate is not claimed.
2. *Real conflict:* overlapping periods sharing ≥ 1 movement → `unit_conflict` with ids and sample; allowed only through `replace` listing the conflicting final; afterwards the old final is `superseded`, its claims released, the new claims active, event rows written.
3. *Stale/partial acknowledgement* (a new overlapping final appeared after the UI loaded) → `overlap_ack_stale`.
4. *Scopes:* organisation vs branch sharing movements → conflict; branch A vs branch B → both close; identical-tuple org vs branch → §5.3 rule; a restricted actor without a single-branch filter cannot close.
5. *Drafts:* many drafts over the same units never claim and never conflict.
6. *Void/supersede release:* after void a new final over the same units closes; claims history kept.
7. *Reversed pair:* original and reversal both claimed; split across finals is flagged, not a conflict.
8. *Statement-side duplicates:* warning in the acknowledgement list only.
9. *DB net:* a raw `INSERT` of a second active claim for the same unit fails on both engines (bypasses the service on purpose); a service-less `released_at` update re-opening an already-released duplicate fails the same index.
10. *PostgreSQL `pcntl_fork` races (failure, not skip, if `pcntl` is missing):* two closes of different drafts with overlapping periods and a shared unit → exactly one succeeds; two closes with disjoint units → both succeed; close vs void; replace vs concurrent close; org close vs branch close sharing a unit → exactly one wins; zero database errors surfaced to callers.
11. *Mutation controls (each must fail at least one test):* claim the whole search candidate set instead of in-period + used (breaks 1b); remove the advisory lock; remove the claim pre-check; drop the partial unique index; make date overlap alone block (breaks the negative test); skip the acknowledgement equality check; release claims on `reviewed` instead of void/supersede.
12. *Wall / no-effect:* static test (no writer class referenced), row counts of the ledger/document tables and balances unchanged by close, void and replace.

## 6. D-PS-08 — independent application key

**Existing convention** (`ApplicationCatalog`): `group.capability`, snake_case (`purchases.cycle`, `finance.operations`, `crm.follow_up`, `document_center.core`, `accounting.cheques`), with `group`, `maturity`, `mandatory`, `dependencies`, optional `access`.

**Proposed key: `accounting.partner_statements`** — group `accounting` (it reconciles against the ledger and serves customers *and* suppliers, so neither `crm` nor `purchases` fits), `maturity = built` **together with `explicit_enable_only = true`** (§6 activation, D-PS-13). Why `built` already in PS-A2a and not `coming_soon`: `statusFor()` returns `enabled` for every non-`built` key, so a `coming_soon` key would make the gate a pass-through on the A1 routes, and a `coming_soon` key cannot be enabled by anyone; `built` + explicit-enable-only is safe because nothing enables it implicitly, `mandatory = false`, `dependencies = ['accounting.ledger']`, `access` omitted (= operational, state decides; `ApplicationAccessGateGuardTest` verifies it against the middleware). Alternatives considered and rejected: reusing `purchases.cycle` / `crm.follow_up` (would couple a cross-role feature to one side and let disabling an unrelated app hide it); a new group (no precedent, extra sidebar semantics).

Integration, using the existing architecture only:
- `ImportJobDomain::AUTHORIZATION[PARTNER_STATEMENT]['app'] = 'accounting.partner_statements'` (the same field `EXPENSE_IMPORT` etc. use); `ImportJobAccess` already calls `ApplicationAccess::authorize` when `app` is set.
- The new A2 routes get `EnsureApplicationActive:accounting.partner_statements`; the A1 routes (`partner-statements/*` template/fields/inspect/preview) get it in the same PR that registers the key, so import and match are gated together.
- **RBAC stays mandatory and independent:** the app gate never replaces `partner_statements.view/reconcile` or `partners.view`; no new implicit grant; owner/admin still only via `*`.
- Sidebar/nav: only if a screen exists (A2 has none) — then through `nav-state` with the key, like other optional capabilities. No UI in A2.
- **Activation (D-PS-13, approved): never implicit.** Today `TenantApplicationService::statusFor()` and `navVisibility()` treat a tenant registered before `ENFORCEMENT_CUTOVER_AT` (2026-08-21) as **enabled for any built capability with no stored decision** (and `isDependencySatisfiedForPlatformEnable` follows `statusFor`). Registering a plain `built` key would therefore switch it on for every legacy tenant. To honour the decision *with the existing machinery*, the catalogue entry carries one additive attribute, `explicit_enable_only => true` (default false = today's behaviour for every other key), honoured in exactly those two read paths: no stored `TenantApplicationState` row ⇒ `disabled` for legacy and new tenants alike. Enabling remains the existing explicit paths (`POST /applications/enable` by `apps.manage`, or the platform console `enableForPlatform`), which create the row and the audit event; disabling/suspension rules (P2 data probe) are unchanged. No second activation system, no migration backfill, no per-tenant list in code. `stateFor()` / the `/applications` screen already show the stored state (absent ⇒ disabled), so they need no change. The attribute is guarded by `ApplicationCatalogTest` (shape) and a behavioural test: legacy tenant without a row ⇒ routes blocked, nav hidden, `statusFor` = `disabled`; with an explicit enable ⇒ allowed; a legacy tenant's *other* undecided keys are unaffected. Commercial plans/entitlements (`Plans`, `ApplicationEntitlement`) are untouched: the key stays operational.
- Tests: `ApplicationCatalogTest` (key, group, dependency), `ApplicationAccessGateGuardTest`, an enable/disable/suspended matrix for the routes (disabled ⇒ 403/blocked, suspended ⇒ reads only — suspended is reachable once statements exist: `disable()` data-aware check must include `PartnerStatementReconciliation` rows, a required addition to the P2 data probe list), RBAC-without-app and app-without-RBAC both refused, tenant isolation.

## 7. Slice plan (each its own small PR, owner approval between slices)

| Slice | Content | Blocked by |
|---|---|---|
| **PS-A2a** | Catalogue key (`explicit_enable_only`) + gate wiring on A1 routes/domain (D-PS-08, D-PS-13), `disable()` data probe, registered `built` + `explicit_enable_only` so the gate is effective on the A1 routes from the start and no tenant is enabled implicitly | none (decisions recorded) |
| **PS-A2b** | `PartnerLedgerCandidates` + golden-snapshot/characterisation tests of the report (incl. the reversal/role-filter observation) + the three additive keys (D-PS-10) | none |
| **PS-A2c** | Matching engine R1–R3, outcomes, reversed-pair netting, match tables/run (with `ledger_scope`), `match`/`matches`/`verify-set` API; counterparty orientation only (D-PS-11); no UI | A2a, A2b |
| PS-A3 | Review actions, close/replace/void, events, scope-aware constraints (§5.3–5.4), overlap acknowledgement + unit claims (§5.5), concurrency tests | A2c |
| PS-A4 | UI | A3 |

## 8. Test strategy for A2 (SQLite + PostgreSQL)
Per rule and outcome fixtures; mirror orientation for both roles and for a `both` partner; reversed original + reversal + statement listing both/one/none; duplicate amounts ⇒ `ambiguous`; tolerance edges (date 0/30, amount 0/10000); branch-restricted actors; ledger changing between runs (fingerprint); tenant isolation of lines, runs and candidates; static wall (no writer class); mutation controls (drop the uniqueness check in R3, drop the pair netting, drop the direction check, drop the app gate); query-count test (no N+1); a financial no-effect test (row counts of the ledger/document tables and balances unchanged by a full run).

## 9. Decisions
| ID | Question | Status |
|---|---|---|
| D-PS-10 | Additive `entry_id` / `entry_status` / `reversal_of` on the statement source | **Approved 2026-11-01** (additive, tests prove current results unchanged) |
| D-PS-11 | `orientation` support | **Approved: deferred** (counterparty orientation only in v1) |
| D-PS-12 | Final reconciliation scope | **Approved 2026-11-01:** final within its real scope (organisation or branch); no branch reconciliation shown as organisation-wide; non-conflict rules designed before PS-A3 (§5) |
| D-PS-13 | Legacy-tenant default for the new key | **Approved 2026-11-01:** never implicit; `explicit_enable_only` through the existing mechanism (§6) |
| D-PS-14 | Overlapping different periods for the same partner/role | **Approved 2026-11-01:** allowed with a clear warning + explicit acknowledgement; real conflicts between effective finals are prevented at close; date overlap alone is not proof of a movement conflict (§5.5) |

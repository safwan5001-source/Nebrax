# REM-05 / ACC-01 — Accounting Decision Report: VAT account roles & tax-report accuracy

STATUS: **PHASE 1 ONLY — DECISION REPORT FOR OWNER APPROVAL. NO IMPLEMENTATION. NOT MERGED. NOT DEPLOYED.**
DATE: 2026-10-14
HORIZON: TAX-ZATCA (origin: AWJ-TAX-ZATCA-AUDIT-1 ACC-01 → backlog REM-05)
ZONE: C — tax / accounting
BASE: `origin/main` @ `899bcba4f3ecfbe4bf504c2276db2dc817daff42` (includes REM-04)

> Not legal or tax advice. This report makes **no** statement of ZATCA Phase 2 compliance or production readiness. The accounting policy below is a recommendation; every item in §6 needs an explicit owner decision before any code is written (CLAUDE.md rule 6: policy is configured/decided, not assumed).

## 0. Verdict in five lines

1. **Confirmed defect, two halves.** (a) `tax_input` / `tax_output` accept *any* active posting account — 11 of 11 invalid targets were accepted in a probe (revenue, expense, equity, cash, AR, inventory, the other VAT account, the *same* account for both roles). (b) `ReportService::taxReport` reads the fixed codes `1150`/`2120`, so after a legitimate remap the return **silently under-states** VAT (probe: 30,000 truth → 15,000 reported, both sides).
2. **Today's default tenants are correct** (default mapping = system accounts `1150` asset / `2120` liability, which are immutable). Only tenants that *remapped* a VAT role are exposed; the count cannot be read from here (no production access) — a read-only audit query is specified in §5.
3. **Recommended policy:** `tax_output` ⇒ active, postable **liability** account only; `tax_input` ⇒ active, postable **asset** account only; the two distinct; neither may be a cash/bank-bound account or mapped to any other role; a VAT target must be clean (no posted lines) unless it is a system VAT account or already part of that role's history.
4. **Report policy:** compute each VAT figure over the **set of role accounts** = current mapping ∪ system default account ∪ every account the role was ever mapped to (from the immutable `account_role_mapping_events`). Unchanged for every tenant that never remapped; complete for those that did; **no journal entry, balance or mapping is rewritten**.
5. **No data migration.** Existing invalid mappings are *grandfathered* (never auto-rewritten, posting never newly blocked), surfaced as a warning, and left for the tenant to correct under the new write-time rules.

## 1. How the roles are assigned and validated today

| Step | Code | What is checked |
|---|---|---|
| Catalog | `app/Support/AccountingRoles.php` | Role keys, labels, `legacy_code` (`tax_output` → `2120`, `tax_input` → `1150`), `configurable: true`. **No required account type / class per role.** |
| Seeding (registration + historical backfill) | `AccountRoleMappingSeeder::seedDefaults` | Creates one explicit mapping per role to the legacy-code account; never overwrites an existing choice; **writes no mapping event**. |
| Write (API `PUT/DELETE /accounting-settings/account-routing/{role}`, permission `accounting_settings.manage`, owner/admin by default) | `AccountRoutingService::setMapping` (`:64`), `reset` (`:101`), `assertEligibleAccount` (`:180`) | Role known + configurable; account belongs to the active tenant (TenantScope); `is_active`; `!is_group`. **Nothing else.** One transaction under the tenant-row lock; an immutable `AccountRoleMappingEvent` (previous/new account id + code, actor) is written. |
| Read at posting time | `AccountRoleResolver::resolve` (`:24`) | Mapping exists; account exists in tenant, active, not a group — otherwise fails closed. **No type check; no legacy fallback.** |
| Posting consumers of the VAT roles | `InvoiceService:1006` (`tax_output`), `PurchaseService:476` and `ReturnService:925` purchase side (`tax_input`) | Use the resolver. |
| **Not** on the roles (hard-coded) | `CreditNoteService:477/516` (`2120`/`1150`), `ReturnService:601` sales side (`2120`), `ExpenseService:153` (`1150`), `AssetService:103` (`1150`) | Backlog REM-06 / ACC-02 — **out of REM-05 scope**, but it bounds what a role-based report can promise (§3, §6 D-6). |
| Account integrity facts the policy can lean on | `AccountManagementService` | An account's **type can never change** after creation (`update` refuses it; system accounts are not editable at all); `normal_balance` is derived from `type` (`asset/expense` ⇒ debit, else credit); there is **no contra-account flag**; accounts with history cannot be re-coded or deleted. |

## 2. How the VAT report sources its numbers

`ReportService::taxReport` (`:475`):

```php
$movements = $this->movementsByAccount($filters)->keyBy(fn ($m) => $m['account']->code);
$input  = (int) ($movements->get('1150')['net'] ?? 0);      // debit − credit
$output = -(int) ($movements->get('2120')['net'] ?? 0);     // credit − debit
// net = output − input; status payable/recoverable by sign
```

* `movementsByAccount` aggregates `journal_lines` per account for entries with status `posted` **or** `reversed` (original + reversal net to zero), optional `from`/`to` on `entry_date`, optional branch filter, tenant-scoped (`BaseModel`). It is **activity in the period**, not a closing balance.
* The VAT accounts are selected **by code string**, independent of `account_role_mappings`.
* A neighbouring consumer, `FiscalCloseService::roleBalance`, already reads the **role** (current mapping only, whole-life balance) — the precedent for role-based reading, but it also ignores history.

## 3. Do the fixed codes cause wrong reports after a legitimate remap? — **Yes (reproduced)**

Probe (scratch test on the overlay, **not** committed; SQLite; Arabic chart seeded): post 1 invoice and 1 purchase (VAT 15,000 each), remap `tax_output` → custom liability `2125` and `tax_input` → custom asset `1155`, post 1 more invoice and purchase.

| State | Report (`input_vat` / `output_vat` / `net_vat`) | Ledger truth |
|---|---|---|
| before remap | 15,000 / 15,000 / 0 ✔ | 15,000 / 15,000 |
| after remap | **15,000 / 15,000 / 0** ✘ | **30,000 / 30,000** — balances: `2120`=15,000, `2125`=15,000, `1150`=15,000, `1155`=15,000 |

The second VAT amount sits in the new accounts the report never reads. With a mismatched mapping the effect is worse (audit probe: `tax_output` → revenue ⇒ report 0 while the invoice carries 15,000 and revenue is overstated). Net-position errors of this kind change the amount declared to the authority without any error shown.

Second-order effect (REM-06, not fixed by REM-05): after a remap, credit notes, sales returns, expenses and asset purchases still post to `2120`/`1150`, so the *account-level* ledger splits one VAT stream across two accounts. A role-based report that *includes the system default accounts* (policy P6) stays complete; GL-by-account reconciliation remains split until REM-06.

### Invalid targets accepted today (probe, 11/11)

| Role | Target | Accepted? | Consequence |
|---|---|---|---|
| `tax_output` | `4110` revenue / `5110` expense / `3110` equity | ✔ accepted | VAT credited to revenue/expense/equity; report 0 |
| `tax_output` | `1110` cash, `1150` (the input-VAT account) | ✔ accepted | VAT credited to cash / merged with input VAT |
| `tax_input` | `2120` (the output-VAT account) | ✔ accepted | input and output merge |
| `tax_input` | `1110` cash, `1130` AR role account, `1140` inventory role account, `4110` revenue | ✔ accepted | purchase "input VAT" debited to cash/AR/inventory/revenue |
| both | the **same** account | ✔ accepted | VAT nets to zero in one account |

Note: a *type-only* rule (asset/liability) would **not** stop `tax_input → 1110/1130/1140` (all assets) — hence the extra rules P2/P3 below.

## 4. Existing tenants and custom charts

* Every tenant has the system accounts `1150` (asset) and `2120` (liability) (seeded, `is_system`, immutable type/code, cannot be deleted) and a default mapping to them (registration seeder or the 2026-09 backfill; `reset` writes the default back). **A tenant that never touched Account Routing is correct today and stays correct under the policy, byte for byte.**
* A custom chart only matters if the tenant *remapped* `tax_input`/`tax_output`. Possible bad states: wrong type; same account for both; cash/AR/inventory/other-role account; a dedicated account that also carries unrelated postings; a mapping later deactivated (already handled — fails closed at posting).
* **Unknown from here:** how many tenants are in each state. Production data is out of scope for this task (no production database operation). §5 specifies a read-only audit to be run by an operator before any enforcement rollout.
* Account type immutability means a *valid* mapping cannot become type-invalid later; only "inactive/group" (already fail-closed) or a new violation by remapping.

## 5. Recommended policy

### 5.1 Allowed account types per VAT role

| Role | Allowed `type` | Natural balance | Report sign |
|---|---|---|---|
| `tax_output` | **`liability`** only | credit | credit − debit |
| `tax_input` | **`asset`** only | debit | debit − credit |

Rejected for both: `equity`, `revenue`, `expense`, the wrong one of asset/liability, inactive, group (existing).

**Contra accounts.** The platform has no contra flag; a "contra" is simply a different `type` carrying an abnormal balance. Policy:
* *Within* the allowed type, an abnormal balance is legitimate and shown as such (output VAT debit-heavy after credit notes ⇒ `recoverable`; input VAT credit-heavy after purchase returns ⇒ negative input) — the report already handles both signs.
* A **liability-typed account for `tax_input`** (input VAT presented as a contra-liability) or an **asset-typed account for `tax_output`** is **rejected**: it would invert the report sign convention and the balance-sheet classification; tenants wanting a combined presentation do it in report layout (REM-28), not by routing. (Owner option D-1b below.)

### 5.2 Additional rules (needed because type alone is insufficient)

| # | Rule | Why |
|---|---|---|
| P2 | The two VAT roles must map to **different** accounts. | Stops merging input and output. |
| P3 | A VAT role target must not be (a) mapped to **any other role**, nor (b) a **cash/bank-bound** account (`cash_bank_accounts.account_id`). Conversely, no other role may be mapped to a VAT-reserved account (`1150`, `2120`, or any account in a VAT role's mapping history). | `tax_input → 1110/1130/1140` are all assets and would pass a type rule. |
| P4 | A VAT role target must have **no posted journal lines**, *unless* it is a system VAT account (`1150`/`2120`) or is already in that role's history. | Makes "every line on a VAT-role account is VAT" true by construction, so the history-aware report (P6) cannot import unrelated balances. A tenant with an already-used custom VAT account moves its balance by an ordinary journal entry to a clean account (or asks for exception D-3b). |
| P5 | `reset` (back to the default) is always allowed for the VAT roles (the defaults satisfy P1–P4). | Preserves the escape hatch. |
| P6 | **Report source = role-account set** `S(role)`: current mapping ∪ system default account (`legacy_code`) ∪ every `previous_account_id`/`new_account_id` of that role in `account_role_mapping_events`. `input_vat` = Σ over `S(tax_input)` of (debit − credit); `output_vat` = Σ over `S(tax_output)` of (credit − debit); `net_vat`/`status` as today. | Keeps history (pre-remap postings stay in the old account and are still counted), keeps hard-coded posters (REM-06 pending) in scope via the system accounts, and equals today's output for every tenant that never remapped. |

### 5.3 Existing invalid assignments — backward-compatible handling

* **Never auto-rewrite** a mapping, never touch posted journal entries or balances (CLAUDE.md rule 3).
* **Do not newly block posting** for tenants already in an invalid state (that turns a reporting defect into an outage). The write path (PUT) enforces P1–P4 for new/changed mappings only.
* **Surface it:** `GET …/account-routing` marks a violating VAT role `state: "invalid"` with a machine-readable reason (`type_mismatch`, `shared_account`, `cash_bank_account`, `reserved_by_other_role`), and the tax report returns an additive `warnings` array (same reasons). Existing keys of both payloads are unchanged.
* **Operator audit (read-only, before rollout):** per tenant list `role_key`, account code/type, violated rule, plus whether the tenant has posted VAT lines on the wrong accounts; no writes. (Delivered as a documented SQL/artisan dry-run in Phase 2 if approved; **not** executed against production by this work.)
* **Remediation is the tenant's, with an audit trail:** pick a valid account and (if needed) post an ordinary correcting journal entry. The remap itself already writes an immutable mapping event.

### 5.4 Migration policy

**No schema migration and no data migration.** The rules are write-time checks plus a read-time report change; mapping events already exist and are immutable. Rollout order: (1) deploy, (2) run the read-only audit, (3) tenants/operators fix flagged mappings. No backfill of events is needed because the system default account is added to `S(role)` explicitly (the seeder wrote no event for it).

## 6. Accounting implications and open decisions (owner approval required)

| ID | Decision | Recommendation | Implication if different |
|---|---|---|---|
| D-1 | Allowed types: `tax_output`=liability, `tax_input`=asset | **Approve** | D-1b: allow `tax_input` = liability (contra-liability) — needs a sign rule per account type in the report and balance-sheet presentation review |
| D-2 | Exclusivity (P2, P3: distinct, not cash/bank, not mapped to another role, VAT-reserved accounts closed to other roles) | **Approve** | Without P3 a type-only rule still lets VAT hit cash/AR/inventory |
| D-3 | History rule P4 (target must be clean unless system/already-VAT) | **Approve (strict)** | D-3b permissive: allow used accounts with a UI/API acknowledgement flag — adds an API field and accepts that the whole prior activity of the account is reported as VAT |
| D-4 | Existing invalid mappings: grandfather + warn, no auto-fix, posting not newly blocked | **Approve** | Fail-closed at posting would stop invoicing for affected tenants |
| D-5 | Report = role-account set incl. history and system default (P6), additive `warnings` field | **Approve** | Pure current-mapping report would drop pre-remap history (re-creates the defect in the other direction) |
| D-6 | Relationship with REM-06: allow remaps now while credit notes/returns/expenses/assets still hit `1150`/`2120` | **Approve**, report stays complete via the system accounts; GL-by-account (and the Fiscal Close VAT-control line, which reads only the *current* role account) stay split until REM-06 | Alternative: freeze VAT remaps until REM-06 ships (blocks the legitimate use the card wants) |

Accounting implications in plain terms:
* **Declared VAT** becomes independent of how the chart is organised, as long as VAT lives in role-designated accounts: output = credits − debits across all output accounts; input = debits − credits across all input accounts.
* **Historical balances stay where they were posted.** A remap changes only where *future* VAT lands; the report adds old and new, so period totals are continuous across the remap date.
* **Reversals and credit notes** are unaffected: `posted` + `reversed` entries are both read (as today), so original + reversal net to zero inside the set.
* **Balance sheet / trial balance** are unchanged (no entries are touched).
* The new write rules can make an *existing* intended setup impossible to re-save (e.g. an input-VAT account typed liability); the tenant must create a correctly typed account and remap — types cannot be edited by design.

## 7. Proposed Phase 2 scope (only after approval)

| Area | Change |
|---|---|
| `AccountingRoles` | optional per-role constraint metadata (`required_type`) for the two VAT roles only |
| `AccountRoutingService` | `setMapping`/`reset`: enforce P1–P4 inside the existing transaction **after** the tenant-row lock (so two concurrent mappings cannot both claim one account); Arabic messages; surfaced as **HTTP 422** via the existing `domain()` path (`{"message": …}`); `list()` marks violating existing mappings (additive `reason`) |
| `ReportService::taxReport` | role-account set per P6 (queries `account_role_mappings`, `account_role_mapping_events`, `accounts` — all tenant-scoped); additive `warnings`; existing keys/values identical for non-remapped tenants |
| UI (optional, can be a separate slice) | filter the account picker by allowed type and show the warning |
| Not touched | VAT calculation, invoice/purchase posting, `AccountRoleResolver` fail-closed behaviour, ICV/PIH/QR/XML, ledger, hard-coded poster services (REM-06), schema |

### Test plan (Phase 2)
* Each invalid category → 422 with stable message: equity, revenue, expense, wrong-direction asset/liability, same account for both roles, cash/bank-bound account, account mapped to another role, VAT-reserved account to another role, used (posted-lines) account (P4), inactive/group (existing); `reset` still allowed.
* Valid custom mappings (custom liability for output, custom asset for input, clean) → 200 and posted VAT lands there.
* **Report accuracy before/after remap** against Σ document VAT (the probe in §3 becomes the regression test), multiple remaps (history chain), reversal inside the set, credit note via hard-coded `2120` after remap still counted, period boundary across the remap date, branch filter.
* **Historical postings untouched:** journal line count/amounts/balances identical before and after enforcement; no entry or mapping row rewritten.
* **Grandfathered invalid mapping:** posting still works; list/report show the warning; changing it must satisfy the new rules.
* **Tenant isolation:** tenant B cannot map to or be affected by tenant A's accounts/events; report for A ignores B.
* **Concurrency (PostgreSQL):** two simultaneous mappings of the same account to the two VAT roles — exactly one succeeds.
* SQLite and PostgreSQL; existing suites (`AccountRoutingTest`, `SalesPaymentAccountRoutingTest`, `PurchaseAccountRoutingTest`, `GeneralReportTest`, Fiscal Close) unchanged and green.

## 8. Risks

1. **Unknown blast radius** — no production visibility; the read-only audit is the control. Enforcement only affects *future writes*, so rollout risk is low; the report change is identical for non-remapped tenants.
2. **P4 strictness** may frustrate tenants with an already-used custom VAT account (remedy: clean account + ordinary journal entry, or D-3b).
3. **History set pollution** only if an account later joins/leaves roles outside the rules (closed by P3 reservation) or already carried unrelated postings before this change (detectable only by the audit; cannot be fixed automatically).
4. **REM-06 dependency** — until the hard-coded services follow the roles, account-level reconciliation after a remap is split (the report is not).
5. **Additive API fields** (`warnings`, `reason`) — consumers that validate response shape strictly must tolerate new keys (web client is tolerant; mock data to be updated).
6. **Other roles** (`accounts_receivable`, `accounts_payable`, revenue…) still have no type validation; deliberately out of REM-05 (VAT roles only) — recommend a follow-up.

## 9. What I need from the owner

Approve, amend or reject **D-1 … D-6** (recommendations in §6). Nothing will be implemented, migrated, merged or deployed before that.

## 10. Evidence index

* Code: `AccountRoutingService.php:64,101,180`, `AccountRoleResolver.php:24`, `AccountingRoles.php` (VAT entries), `ReportService.php:475`, `AccountManagementService.php` (type immutability, derived `normal_balance`), `ChartOfAccountsSeeder.php:35,49`, `FiscalCloseService.php:604`, hard-coded VAT posters listed in §1.
* Audit: `AWJ-TAX-ZATCA-AUDIT-1.md` ACC-01 (L933-958), ACC-02; backlog card REM-05.
* Probe: scratch test on the Laravel overlay (SQLite), run 2026-10-14, **not committed**; outputs reproduced in §3.
* Existing tests that pin current behaviour: `GeneralReportTest::tax_report_uses_only_posted_vat_account_movements`, `AccountRoutingTest` (inactive/group/unknown/tenant isolation), `SalesPaymentAccountRoutingTest::mapped_tax_output_is_used_with_unchanged_vat_amount` (asserts only that the mapped account receives the VAT — no type check anywhere).

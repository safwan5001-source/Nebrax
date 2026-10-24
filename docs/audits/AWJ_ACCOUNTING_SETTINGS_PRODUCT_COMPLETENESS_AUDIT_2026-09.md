# أَوْج / AWJ ERP — Accounting Settings Product Completeness Audit

**Date:** 2026-09
**Repository:** `safwan5001-source/Nebrax`
**Audit basis:** current `main` source code (backend `app/`, frontend `web/src/app/(app)/accounting-settings/**` and directly linked pages), `docs/plans/accounting/` task/design docs and implementation reports, RBAC (`app/Support/Rbac.php`), i18n catalogs (`web/src/messages/{ar,en}.json`).
**Scope authority:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md` — the merged and documentation-closed ACC-1 → FISCAL-2 track (PR #701, merge `2db95a2abc8a4816912d8dc3abdd1e8f9f292bbf`).
**Nature of this document:** Audit only. No application code, migration, API, permission, schema or test was changed to produce it. No data was reset, migrated or deleted.
**Explicitly out of scope:** ZATCA implementation and readiness. This audit answers whether *Accounting Settings* is a complete product surface, not whether AWJ is ready to file taxes.

---

## 1. Executive Verdict

> **READY TO CLOSE V1 WITH MINOR FOLLOW-UPS**

The backend track (ACC-1 → FISCAL-2) delivered a real, correct, tenant-isolated, RBAC-gated accounting
core: semantic account routing (14 roles), accounting period locks with no bypass, and fiscal year close/
reopen/re-close — all backed by deep test suites on SQLite and PostgreSQL and confirmed in this audit by
reading the shipped code, not just the reports.

The frontend built on top of it is **not a thin technical shell**. Three of the four pages under
`/accounting-settings` (the hub, Period Locks, Fiscal Years) are genuinely good accounting UX: readiness
panels that separate blockers from warnings, mandatory reasons on privileged actions, immutable audit-
history dialogs, and confirmation copy that tells the accountant in plain Arabic exactly what will and
will not happen (*"لا يعني هذا تعديل أي فاتورة ضريبية صادرة"*) before they commit. This is a materially
higher bar than "the API works."

**Zero Critical Gaps were found** — nothing here blocks correct daily use, and nothing requires touching
`LedgerService`, historical journals, or posting behavior. What was found is **one real, evidence-backed
completeness gap** (Account Routing's own audit trail is fully built on the backend and completely
unreachable from the UI or even the API — a real inconsistency given its two sibling pages both expose
this exact feature) plus a handful of small, low-risk, non-accounting UI polish items. None of it needs to
block starting ZATCA work in parallel; all of it is small enough to close out first if preferred.

---

## 2. Current Product Surface

What a user can actually do today, verified by reading the shipped page components and their wired API
calls — not by what classes or routes exist.

**`/accounting-settings` (hub)** — a permission-filtered card grid. Shows Account Routing and Fiscal Years
and Period Locks as real links (each gated by its own permission, not inherited from the hub's); Cost
Centers as a real link to `/cost-centers`. No "coming soon" placeholders remain in this hub — every card
that renders is a working page.

**`/accounting-settings/account-routing`** — a per-role list, grouped by accounting domain
(المدينون/الدائنون/المبيعات/المشتريات/المخزون/الضرائب/مشترك بين المستندات/حقوق الملكية), each row showing
the current account, a state badge (Default / Custom / Invalid / Unmapped), and a dropdown of eligible
accounts to remap it live. A reset-to-default action per role. View-only users see the same list with
controls disabled and a plain notice explaining why.

**`/accounting-settings/period-locks`** — a table of lock ranges with status, reason, creator and releaser
(name + timestamp). Create requires start/end/reason; release requires a reason and shows a
"this will make posting possible again" confirmation. A History icon opens the immutable audit trail
(lock_created / lock_released events) per range.

**`/accounting-settings/fiscal-years`** — a table of fiscal years with range, status, active close
generation, and net result. Creating a year is a simple form. Closing opens a **readiness dialog** that
fetches live BLOCKER/WARNING/INFO data, disables the close button while any blocker stands, and requires
an explicit checkbox acknowledgement if warnings exist. Reopening requires a typed reason and states
plainly that it does not touch issued tax documents. A History icon shows the year's own event log
(created / closed / reopened) with actor and generation.

**`/cost-centers`** (reachable from the hub and directly from the sidebar) — a mature, pre-existing
full CRUD screen (create, edit, activate/deactivate, delete-with-confirm, filters, mobile card view) that
predates this track and needed no changes.

**Not reachable from `/accounting-settings` at all, but accounting-relevant:** Chart of Accounts lives at
its own top-level `/accounts` page (pre-existing, mature); VAT rate definitions live at their own
`/tax-settings` page (pre-existing, unrelated to this track). Both work; neither is cross-linked from the
routing screen that actually posts against them. See §4.

---

## 3. Capability Matrix

| Capability | Current State | UI | Backend | Classification | Importance | Evidence |
|---|---|---|---|---|---|---|
| Semantic account routing (14 roles → concrete accounts) | Live, editable, fail-closed | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `AccountRoutingController`, `account-routing/page.tsx` |
| Product-level sales/COGS override precedence over tenant routing | Preserved end to end | N/A (product form) | ✅ Full | ✅ COMPLETE | Core | ACC-3/ACC-5 reports |
| Account routing audit trail (who changed which role, when, from what to what) | **Recorded, never readable** | 🔴 None | 🟡 Write-only | 🔴 MISSING / IMPORTANT | High | `AccountRoleMappingEvent` written in `AccountRoutingService::setMapping()`/`reset()`; zero read route, zero UI (§4) |
| Accounting period locks (create/release, company-wide, inclusive range) | Live, enforced in `LedgerService` itself | ✅ Full | ✅ Full | ✅ COMPLETE | Core | ACC-6 report; `period-locks/page.tsx` |
| Period lock audit trail | Live, own History dialog | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `AccountingPeriodLockController::events` |
| Fiscal year definition (calendar or non-calendar, no overlap) | Live | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `fiscal-years/page.tsx` |
| Fiscal year **edit** (rename / adjust dates before any close exists) | Backend allows it; **no UI trigger at all** | 🔴 None | ✅ Full | 🟡 PARTIAL | Medium | `PUT .../fiscal-years/{id}` wired to `FiscalYearController::update`, never called from the page (§4) |
| Fiscal year close with live readiness (BLOCKER/WARNING/INFO) | Live | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `FiscalCloseService::readiness()`; readiness dialog with warning acknowledgement |
| Fiscal year reopen (reason-mandatory, reverses exact journal) | Live | ✅ Full | ✅ Full | ✅ COMPLETE | Core | FISCAL-2 report §12 |
| Re-close as a new generation after reopen | Live | ✅ Full (same close dialog) | ✅ Full | ✅ COMPLETE | Core | FISCAL-2 report §13 |
| Fiscal year close/reopen audit trail | Live, own History dialog | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `FiscalYearController::events` |
| Cost centers (CRUD, active/inactive, used on journal lines) | Live, pre-existing | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `cost-centers/page.tsx` |
| Chart of Accounts management | Live, pre-existing, but **outside** the settings hub | ✅ Full (own page) | ✅ Full | ✅ COMPLETE (elsewhere) | Core | `/accounts` |
| VAT rate definition | Live, pre-existing, but **outside** the settings hub and **not cross-linked** with `tax_output`/`tax_input` routing | ✅ Full (own page) | ✅ Full | 🟡 PARTIAL (fragmented) | Medium | `/tax-settings`, `TaxSettingsCard` (§4) |
| RBAC: four independent permission families (`accounting_settings.*`, `accounting_period_locks.*`, `fiscal_years.*`, `cost_centers.*`) | Live, least-privilege, custom-role-extensible | ✅ Full | ✅ Full | ✅ COMPLETE | Core | `app/Support/Rbac.php` |
| Confirmation copy that states accounting/compliance consequences before a privileged action | Live, in Arabic, on both Period Locks and Fiscal Years | ✅ Full | — | ✅ COMPLETE | Core | i18n strings quoted in §2 |
| Branch / cost-center allocation of Retained Earnings | Not built — deliberate V1 boundary | 🚫 N/A | 🚫 N/A | ⚪ DEFERRED BY DESIGN | Low | FISCAL-1 "no branch close V1" |
| Multi-currency / FX | Not built | 🚫 N/A | 🚫 N/A | ⚪ DEFERRED BY DESIGN | Low | AWJ is single-currency SAR by product scope; explicitly prohibited in FISCAL-1 |
| Document numbering settings (prefix/format per document type) | Backend layer ready (`GeneratesDocumentNumbers`), **no settings UI anywhere in the product**, not just this hub | 🔴 None | 🟡 Partial | ⚪ DEFERRED BY DESIGN (pre-existing, not this track's scope) | Low | `CLAUDE.md` "نطاق مستقبلي" |
| Maker-checker / dual approval for routing or fiscal changes | Not built | 🚫 N/A | 🚫 N/A | 🚫 NOT APPROPRIATE (see §9) | — | — |

---

## 4. Critical Gaps

**None.** No finding in this audit prevents correct daily use of Accounting Settings, and no finding
requires touching `LedgerService`, historical journals, posting behavior, or any accounting-sensitive
surface. The items below were considered for this section and deliberately placed in §5 instead, with the
reasoning stated so the call is checkable:

- **Account Routing has no audit-trail UI or API**, while its two sibling pages (Period Locks, Fiscal
  Years) both have one. This is a real, product-visible inconsistency and the strongest finding in this
  audit — but it does not stop anyone from routing an account correctly today, and the underlying data
  (`AccountRoleMappingEvent`) is safely recorded and not lost. It is a visibility gap, not a functional
  one, so it is `§5` and not `§4`.
- **No UI to edit a fiscal year's name or dates.** The backend already supports it safely (dates freeze
  only once a close generation exists). A typo in a year's name is cosmetic and does not affect any
  posting, close calculation, or report.

---

## 5. Important but Deferrable

Ranked by how visibly it affects trust/usability, not by effort.

1. **Expose the Account Role Mapping audit trail.** `AccountRoleMappingEvent` rows are written on every
   `setMapping()`/`reset()` call and never read anywhere in the codebase — confirmed by grepping the
   controller and service for any read path. Given that Period Locks and Fiscal Years both ship this
   exact "History" affordance, its absence here reads as an oversight rather than a deliberate choice, and
   nothing in any ACC-2 report frames it as intentional. **Not accounting-sensitive** (pure read of
   existing rows, no posting or historical-journal change).

2. **Fiscal year edit UI.** Add a rename/date-edit action reusing the existing, tested `PUT` endpoint.
   Only relevant while a year has no close generation (the backend already enforces the freeze once one
   exists — see FISCAL-2 report). **Not accounting-sensitive** (never touches a posted journal; the
   backend already refuses the unsafe case).

3. **UI consistency: native `window.confirm()` on Account Routing's reset action.** Every other
   destructive/privileged action in this exact feature area (release a lock, reopen a year) uses the
   app's own styled `Dialog` with clear copy; Account Routing's reset falls back to the browser's native
   confirm box. Minor, but it is the one visible seam in an otherwise consistent design language.
   **Not accounting-sensitive** (UI-only).

4. **Money formatting on the Fiscal Years table bypasses the app's own currency formatter.** The page
   defines a local `money()` helper (`(halalas/100).toLocaleString('en-US', …)`) instead of the existing
   `formatMinorRiyal()` in `web/src/lib/money.ts`, whose entire purpose (per its own comment) is exactly
   this: format API halalas as human riyal with the official Saudi Riyal sign, without exposing minor
   units. The result today is a bare number with no currency unit on the one page in the app that shows
   a profit/loss figure this way. **Not accounting-sensitive** (display formatting only — the underlying
   number is correct).

5. **Tax rate definitions and VAT account routing are two disconnected screens.** `/tax-settings` defines
   named rates (name/%/inclusive) that a document line picks per unit; `/accounting-settings/account-
   routing` defines which GL account `tax_output`/`tax_input` post to. An accountant configuring VAT for
   the first time has no link from one to the other. This predates ACC-1 → FISCAL-2 and was not
   introduced by it, but it is real friction in the accounting-settings *product*, not just this track.
   **Not accounting-sensitive** (an IA/navigation observation; nothing about either mapping mechanism is
   wrong).

6. **Navigation duplication for owner/admin.** Cost Centers, Period Locks and Fiscal Years each appear
   twice for a user who holds all the relevant permissions: once as a direct sidebar leaf under
   "المحاسبة", and again as a card inside the `/accounting-settings` hub they just walked past. This is a
   consequence of the (correct) ACC-6 decision to give each of these its own independent, non-inherited
   permission and sidebar leaf so a narrowly-permissioned viewer isn't stranded — but for the common
   owner/admin case it produces two paths to the same screen with no signal for which is canonical. Not a
   functional bug; worth a product decision (keep both deliberately, or drop one) rather than a blind fix.

7. **`/tax-settings` gates management with a hardcoded `role === 'owner' || role === 'admin'` check**
   instead of a permission string, unlike every permission introduced by ACC-1 → FISCAL-2. A tenant that
   grants a custom role every other accounting-settings permission still cannot let that role manage tax
   rates. This predates the track and is **not this track's item to fix**, but it is directly adjacent to
   the RBAC pattern this audit was asked to evaluate, so it is recorded here for awareness rather than
   silently dropped.

---

## 6. Existing Deferred Items Classification

Every item from PR #701's "Deferred / Future Scope" section, classified per the audit's A/B/C/D scheme
(A = do before closing V1, B = fine as V2, C = technical debt not a settings feature, D = belongs to
another track).

### Fiscal close and period locks

| Item | Classification | Why |
|---|---|---|
| Branch / cost-center allocation of Retained Earnings | **B** | Explicit, well-reasoned V1 boundary (company-wide close only); no evidence any current workflow needs it yet |
| Integrated release → reopen → re-lock orchestration | **B** | The two-step manual workflow (release lock, then reopen) is safe and already usable via two separately-permissioned, separately-audited screens; automating it is a convenience, not a completeness gap |
| Fiscal Close readiness must grow with new document types | **C** | This is a maintenance obligation on future feature work (add to `FiscalCloseService::DOCUMENTS`), not a settings feature to build now |
| Per-transaction exception workflow for period locks | **B** | ACC-6 explicitly reserved this behind separate design approval; the current release-then-post workflow is safe and audited |
| Period-lock `reason` is free text, not a taxonomy | **B** | No evidence of a reporting/compliance need for structured reasons yet |
| Zero-activity closes create no journal | **N/A** | This is documented *current, correct behavior*, not deferred work — nothing to classify as a future task |

### Account routing — deliberately hardcoded accounts

| Item | Classification | Why |
|---|---|---|
| Cash-sale debit in `InvoiceService` bypasses `CashBankAccountService` | **B** | Pre-existing, reported transparently by ACC-3, not worsened by this track; a real settlement-path question but not an Accounting Settings feature |
| `5116` purchase-return valuation variance not an approved role | **B** | No approved semantic role was designed for it in any slice; adding one is a chart-of-accounts decision, not an outstanding bug |
| `receiveStock()` counterparties (`2110`, `3130`) | **B** | Narrow, low-traffic path (`ProductService::create()` initial-quantity shortcut only); flagged, not blocking |
| `3130` opening balances outside the configurable catalog | **B** | Deliberate: opening/cutover equity is not annual retained earnings, repeated consistently across ACC-2/ACC-5/FISCAL-2 |
| `PartnerService::ACC_OPENING` | **D** | Partner AR/AP opening balances — belongs to a Partners/AR-AP track, not Accounting Settings |
| Fuel vertical account overrides bypass tenant `inventory_count_variance` mapping | **D** | Owned by the fuel-station vertical's own override contract, not Accounting Settings |
| Three inventory variance roles share default account 5180 | **B** | Intentional identity-vs-default distinction; splitting defaults is a chart-of-accounts decision for tenants who want it, not a defect |

### Routing scope not taken in V1

| Item | Classification | Why |
|---|---|---|
| No branch-specific account mappings | **B** | Consistent, repeated architectural decision (`CompanyWide`); no evidence of demand |
| No generic cash/bank semantic roles | **B** | `CashBankAccount` domain already serves this need correctly |
| No product/category routing beyond existing override fields | **B** | Existing per-product override already covers the real use case (an item that must post differently) |

### Supplier refund / purchase return

| Item | Classification | Why |
|---|---|---|
| On-account (unallocated) supplier cash receipts | **D** | Belongs to the Supplier Refund / AP track, not Accounting Settings |
| Refundable-balance snapshot/cache | **C** | A performance/caching concern, not a settings feature |
| Request-idempotency framework for a future public API | **C** | Infrastructure concern, not a settings feature |
| No backfill of historical cash purchase returns | **D** | A one-time data-migration decision for the Purchase/Refund track |
| `supplier_refunds.*` not granted to `accountant` by default | **D** | A role-matrix tuning question for the Supplier Refund track, not Accounting Settings |
| `payment_type=credit` still accepted on purchase returns | **D** | Purchase Return domain compatibility shim, not Accounting Settings |
| No `ApplicationCatalog` app-key guard on supplier-refund routes | **D** | Application-catalog enforcement question for the Purchases track |

### Environment and tooling

| Item | Classification | Why |
|---|---|---|
| Missing `bcmath` in the sandbox | **C** | Environment/CI configuration, not a product feature at all |
| PDF-parsing quirk in `DocumentCenterSecureIntakeTest` | **C** | Same |
| PostgreSQL `migrate:rollback` failure in an unrelated SKU migration | **C** | Same |
| SQLite's residual check-then-post window for locks | **C** | Documented test-engine limitation, production unaffected |
| No automated UI tests beyond ACC-6/FISCAL-2's targeted pages | **C** | Testing-infrastructure debt, not a settings feature |

---

## 7. UX / Information Architecture Findings

- **Section names are accountant-legible, not raw technical identifiers.** "توجيه الحسابات" (Account
  Routing) groups roles under real accounting headings (المدينون، الدائنون، المبيعات، المشتريات، المخزون،
  الضرائب، حقوق الملكية) with a plain-language description per role
  (e.g. *"الحساب الذي تُقيَّد عليه مديونيات العملاء عند البيع الآجل"*), not the internal role key
  (`accounts_receivable`). This is a genuine strength, not a gap.
- **Dangerous actions are visually and textually distinct.** Close/Reopen/Release all use the app's
  `danger` button variant, sit behind a typed-reason or checkbox gate, and carry copy that states the
  accounting consequence before commit. This matches AWJ's own "ثقة" (trust) design pillar concretely,
  not decoratively.
- **Fiscal Years and Period Locks are placed logically** as siblings under the same "المحاسبة" sidebar
  group and the same settings hub, and their relationship (a period lock can block a fiscal close; the
  close dialog surfaces that as a named BLOCKER with the exact remedy) is explained in-product rather than
  left to a manual.
- **Cost Centers is correctly *not* folded into Account Routing** even though both configure how postings
  are dimensioned — they are different concerns (which account vs. which cost dimension) and keeping them
  as siblings avoids conflating two independent settings menus.
- **One real navigation redundancy**, not a misclassification: Cost Centers / Period Locks / Fiscal Years
  each have two paths to the same screen for a fully-permissioned user (direct sidebar leaf + hub card).
  See §5.6.
- **No page here is misclassified as a "settings" form when it should be a read-only summary**, or vice
  versa. Account Routing, Period Locks and Fiscal Years are all genuinely actionable admin surfaces, and
  each treats its own read path (list/history) as a first-class view rather than a side effect of editing.
- **The one visible design-system seam**: Account Routing's reset-to-default uses the browser's native
  `confirm()` instead of AWJ's own `Dialog`. Everywhere else in this feature area, confirmations are
  styled and carry explanatory copy; this one doesn't. See §5.3.
- **No dashboard-style redesign is warranted or suggested anywhere in this audit.** Every page reviewed is
  already dense, table-first, and free of decorative cards — consistent with AWJ's existing direction.

---

## 8. Accounting & Safety Findings

Every gap identified in §4 and §5 was checked against posting behavior, historical journals, tenant
isolation, permissions, fiscal close, period locks, VAT, inventory valuation, AR/AP and reports.

**None of them are `ACCOUNTING-SENSITIVE`.** Specifically:

- Exposing `AccountRoleMappingEvent` (§5.1) is a **read-only** addition. It cannot change which account a
  role resolves to, cannot touch a posted journal, and mirrors an access pattern (`GET .../events`) already
  proven safe and tenant-isolated by Period Locks and Fiscal Years.
- Fiscal year edit (§5.2) would only ever call the **already-shipped, already-tested** `update()` path,
  which itself already refuses to move dates once a close generation exists. No new backend logic is
  implied.
- The `window.confirm()` swap (§5.3) and money-formatting fix (§5.4) are pure frontend display changes
  with no API surface at all.
- The Tax Settings / Account Routing cross-link (§5.5) and the navigation-duplication question (§5.6) are
  IA observations, not code changes, and touch no posting path.
- The `/tax-settings` hardcoded-role finding (§5.7) is a permission-check change confined to a page
  **outside** the Accounting Settings track; it does not touch VAT calculation, only who may edit the rate
  list.

No finding in this audit implies a change to `LedgerService`, `AccountingDateGuard`, `FiscalCloseService`'s
posting logic, `AccountRoleResolver`'s resolution order, tenant scoping, or any historical journal.

---

## 9. External Benchmark Findings

Used only where a judgement call was genuinely unclear from AWJ's own documented decisions — this section
is intentionally short.

**Maker-checker / dual approval for account-routing or fiscal-close changes** (considered in §3 as
🚫 NOT APPROPRIATE). SAP and, to a degree, Dynamics 365 Business Central offer configurable approval
workflows for master-data and period-close changes — this is an **ERP product convention** at the
enterprise-scale end of the market, not a **regulatory requirement** and not universal **accounting best
practice** at SMB scale. NetSuite, Odoo and Daftra — the closer comparables for AWJ's actual Saudi SMB
target segment — do not require it either; they rely on role-based permission gating exactly as AWJ does
(owner/admin-only by default, extensible via custom roles). **AWJ-specific recommendation:** do not build
this now. AWJ's existing combination of least-privilege RBAC plus the audit trail pattern (once §5.1 closes
the one gap in it) already matches the control level of its actual comparables.

**Audit-trail-on-every-configuration-change** (relevant to §5.1's severity). This is not a Saudi regulatory
requirement by itself, but it is close to universal **accounting best practice** — every benchmarked
system (Dynamics 365, NetSuite, SAP, Odoo, Daftra) logs who changed a chart-of-accounts mapping and when,
because "why did this month's postings look different" is a standard audit question. This — not the ERP
comparison alone — is why §5.1 is ranked first in §5 rather than being a nice-to-have: AWJ has already
adopted this exact standard for Period Locks and Fiscal Years, so the missing piece on Account Routing is
AWJ falling short of its own established bar, not an externally-imposed one.

No other finding in this audit required an external comparison; AWJ's own design docs (FISCAL-1, ACC-6,
the routing gate documents) already resolved the relevant questions with explicit, checkable reasoning.

---

## 10. Recommended V1 Finish Line

Nothing is required to truthfully call Accounting Settings V1 "functionally complete" today — no finding
in this audit blocks correct use. If closing out the small remaining polish before moving on is preferred,
the finish line is exactly the three independent items below, all frontend-weighted, all non-accounting-
sensitive, all small:

1. Account Routing audit-trail exposure (§5.1) — the one item worth prioritizing, since it is the
   difference between "this pattern is applied consistently across the whole settings surface" and "two
   out of three pages have it."
2. Fiscal year edit UI (§5.2) — small, self-contained, reuses existing backend.
3. UI consistency pass (§5.3 + §5.4) — trivial, bundle together.

Everything else in §5 (the Tax Settings cross-link, the navigation duplication, the `/tax-settings`
permission hardcode) is a product/IA decision or belongs to a different page entirely, not a build item for
this track.

---

## 11. Proposed Next PRs

Not implemented. Ordered by dependency; PR 1 and PR 2 are independent of each other and could run in
parallel; PR 3 depends on nothing and could go first if preferred.

### PR-AS-1 — Account Role Mapping audit trail

- **Goal:** Make the already-recorded `AccountRoleMappingEvent` history visible, closing the one real
  completeness gap this audit found.
- **Scope:** One new read-only backend route (`GET accounting-settings/account-routing/events`, or
  per-role `GET .../account-routing/{roleKey}/events`) on `AccountRoutingController`, backed by a new
  `AccountRoutingService::events()` read method mirroring `FiscalYearService::events()` /
  `AccountingPeriodLockService::events()` exactly. Frontend: a "History" icon per role row opening the
  app's existing `Dialog` pattern, reusing the same event-list rendering already built for Period Locks
  and Fiscal Years.
- **Explicit non-goals:** No change to `setMapping()`/`reset()` write behavior. No change to what gets
  recorded. No new permission — reuses `accounting_settings.view`.
- **Accounting sensitivity:** Not sensitive. Read-only; cannot alter a mapping, a resolution, or a posted
  journal.
- **Dependencies:** None. `AccountRoleMappingEvent` already exists and is already populated.
- **Required tests:** Backend — tenant isolation of the events list (mirrors the existing ACC-2 audit
  tests), RBAC (`accounting_settings.view` sees it, no view permission gets 403). Frontend — a page test
  asserting the History dialog renders recorded create/change/reset events with actor and before/after
  account, mirroring the existing `period-locks/page.test.tsx` / `fiscal-years/page.test.tsx` pattern.

### PR-AS-2 — Fiscal year edit UI

- **Goal:** Let a user fix a fiscal year's name (always) or dates (only while no close generation exists)
  from the UI, using the already-shipped `PUT` endpoint.
- **Scope:** Frontend only — an "Edit" action on each row opening a form dialog pre-filled with the
  year's current name/dates, calling the existing `PUT accounting-settings/fiscal-years/{id}`. Disable
  the date fields (name-only edit) once the row has any close generation, matching the backend's own
  `rangeIsMutable()` rule, so the user sees why rather than hitting a 422.
- **Explicit non-goals:** No backend change. No new permission (reuses `fiscal_years.manage`). No change
  to overlap or freeze rules.
- **Accounting sensitivity:** Not sensitive. Calls an existing, already-tested backend path that itself
  refuses the unsafe case.
- **Dependencies:** None.
- **Required tests:** Frontend page test — edit dialog opens pre-filled, submits the `PUT` call correctly,
  and disables date fields for a year with any generation (asserted from mock API data, matching the
  existing page-test conventions).

### PR-AS-3 — UI consistency pass

- **Goal:** Remove the one native-dialog seam and the one currency-formatting inconsistency found in this
  feature area.
- **Scope:** Replace `window.confirm()` on Account Routing's reset action with the app's `Dialog`
  component (matching the confirm pattern already used for lock release / year reopen). Replace the local
  `money()` helper on the Fiscal Years page with `formatMinorRiyal()` from `web/src/lib/money.ts`.
- **Explicit non-goals:** No behavior change — same confirm-then-call flow, same numeric value, only the
  presentation changes.
- **Accounting sensitivity:** Not sensitive. Pure frontend display/interaction, zero API surface.
- **Dependencies:** None.
- **Required tests:** Update `account-routing/page.test.tsx` to assert the styled dialog appears instead
  of mocking `window.confirm`; update `fiscal-years/page.test.tsx` to assert the Riyal symbol appears in
  the result cell.

**Not proposed as a PR** (needs a product decision first, not a spec): the navigation-duplication question
in §5.6 — whether Cost Centers/Period Locks/Fiscal Years should keep both their sidebar leaf and their hub
card, or drop one. Recommend Safwan decide the intended pattern once, and apply it consistently, rather
than implementing a guess.

**Not proposed as a PR for this track**: the `/tax-settings` hardcoded-role check (§5.7) and the Tax
Settings/Account Routing cross-link (§5.5) both live partly or fully outside `/accounting-settings` and
are better scoped as their own small Tax Settings task if pursued.

---

## 12. Final Recommendation

> **Accounting Settings can be closed as V1 now — with the three small PRs above (AS-1, AS-2, AS-3) queued
> as immediate, low-risk follow-ups rather than blockers — and the team should move to ZATCA next.**

Nothing found in this audit rises to the level of "must fix before moving on": no functional gap, no
accounting-correctness gap, no tenant-isolation or permission gap. The one finding worth acting on quickly
(Account Routing's missing audit-trail UI) is worth a single small, non-sensitive, well-scoped PR — not a
reason to hold the whole track open. Everything else classified in §6 as B/C/D is either a legitimate V2
decision, technical debt unrelated to settings UI, or ownership of a different track entirely, exactly as
the merged implementation reports already said when each item was first deferred.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_011Ww1oZyiE5JYmzcWCrBaG2

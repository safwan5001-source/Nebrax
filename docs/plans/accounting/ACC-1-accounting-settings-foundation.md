# ACC-1 — Accounting Settings Foundation + Workspace + RBAC

**Status:** READY FOR IMPLEMENTATION  
**Parent plan:** `docs/plans/accounting/AWJ_ACCOUNTING_SETTINGS_PLAN.md`  
**Planning baseline:** `58513fe77d1dd34ba4eaa797f2b12ab55996e3fd`  
**Risk:** Low functional risk; security/RBAC correctness is mandatory.  
**Merge / Deploy:** PROHIBITED without explicit Safwan approval.

## Objective
Create the first real Accounting Settings workspace in AWJ without changing any accounting posting behavior, database schema, ledger logic, account routing, fiscal-period behavior, or historical data.

ACC-1 is strictly a workspace + RBAC + navigation + i18n foundation.

## Required implementation

### 1. RBAC
Add these explicit permissions following the repository's existing `domain.view` / `domain.manage` convention:

- `accounting_settings.view`
- `accounting_settings.manage`

Required default behavior:
- owner/admin continue to receive access through existing wildcard `*` semantics.
- do **not** grant either permission to accountant or staff system roles by default.
- do not temporarily reuse `accounts.manage`, `settings.manage`, or another nearby permission.

`accounting_settings.manage` is intentionally introduced now even though ACC-1 contains no mutable accounting-policy API, so later ACC-2 does not require a security-contract rename.

### 2. Accounting Settings route/page
Create a real authenticated workspace at:

`/accounting-settings`

Use AWJ's existing dense settings/workspace design language. The existing `/finance-settings` page may be used as a structural interaction precedent, but do not clone its placeholders blindly.

The page should communicate that Accounting Settings is the company-level accounting configuration hub.

Initial destinations/state:
- **Account Routing** — planned/coming in ACC-2; may be visibly disabled/non-interactive until a real route exists.
- **Cost Centers** — real link to existing `/cost-centers`.
- **Fiscal Periods** — planned; no fake editable controls.
- **Accounting Period Locks** — planned; no fake editable controls.
- **General Accounting Settings** — do not expose fake toggles. If there is no real backend-enforced setting in ACC-1, represent this as planned or omit it.

Do not create dead links that look operational.

### 3. Sidebar
Under the existing `accounting` group add one built leaf:

- href: `/accounting-settings`
- key: `accountingSettings`
- permission: `accounting_settings.view`

Use an existing appropriate Lucide icon; do not introduce decorative/icon-system divergence.

Do not move Cash/Bank, Payment Methods, Finance Settings, or Cost Centers merely to accommodate this page.

### 4. Frontend permission guard
The sidebar item must be hidden when the current user lacks `accounting_settings.view`.

The page/workspace must also be protected using the repository's actual authenticated/RBAC patterns; sidebar hiding alone is not authorization.

If the frontend architecture delegates authoritative permission enforcement to backend/session permission data, follow that existing pattern rather than inventing a second RBAC system.

### 5. i18n
Add Arabic and English translations for:
- Accounting Settings navigation label.
- page title/subtitle.
- destination titles/descriptions/status labels used by the page.

Reuse existing translation organization and naming conventions. No hardcoded user-facing Arabic/English strings when the surrounding module uses i18n.

### 6. Backend/API
ACC-1 does **not** require account-routing APIs or a mutable Accounting Settings controller.

Only add a backend endpoint/controller if the existing application architecture genuinely requires one to authorize/render the workspace. Do not create speculative APIs.

If a route is added, it must use `accounting_settings.view` server-side.

## Explicitly out of scope
Do NOT:
- modify `LedgerService`;
- modify InvoiceService, PurchaseService, PaymentService, ReturnService, InventoryService, StocktakeService, StockPermitService, or any posting service;
- replace any `ACC_*` hardcoded account yet;
- create `account_role_mappings` or any database migration;
- create the Account Role resolver/catalog implementation (ACC-2);
- change purchase-return cash behavior or implement Supplier Refund;
- implement fiscal periods or accounting date locks;
- add branch-specific accounting settings;
- migrate/rewrite historical journal lines;
- refactor unrelated navigation/settings code;
- merge or deploy.

If implementation appears to require any item above, STOP and report the blocker instead of expanding scope.

## Required tests / verification
Run the smallest relevant tests first, then broader checks only as needed.

Must verify:
1. RBAC permission catalog contains `accounting_settings.view` and `accounting_settings.manage`.
2. owner/admin retain access through wildcard behavior.
3. accountant/staff are not granted these policy permissions by default.
4. Accounting Settings sidebar leaf is visible only with `accounting_settings.view`.
5. direct workspace access is appropriately permission-protected according to existing AWJ architecture.
6. `/accounting-settings` renders in Arabic/RTL and English/LTR without broken layout.
7. Cost Centers destination navigates to the existing real route.
8. planned destinations cannot be mistaken for functioning controls/dead links.
9. no accounting posting behavior changed.
10. relevant frontend tests/typecheck/build pass.
11. run relevant backend RBAC tests if RBAC code changes; do not weaken existing tests.

Do not spend time fixing unrelated pre-existing lint/build failures. If encountered, identify them separately with evidence.

## Acceptance criteria
ACC-1 is complete only when:
- the two permissions exist with the approved defaults;
- Accounting Settings is a real permission-aware workspace under Accounting;
- UI follows AWJ design-system density and RTL/i18n conventions;
- no fake accounting controls exist;
- no DB/accounting behavior changed;
- targeted tests and build checks pass, or any genuine pre-existing blocker is documented precisely;
- implementation report is delivered;
- no merge/deploy occurred.

## Implementation report contract
Create/update an MD implementation report containing:
- Status: DONE / BLOCKED / PARTIAL.
- Summary of what was implemented.
- Exact changed files and why.
- Tests run and exact results.
- Frontend build/typecheck result.
- Relevant backend test result.
- Confirmation that no DB migration or accounting posting service changed.
- RBAC behavior for owner/admin/accountant/staff.
- Risks, blockers, and remaining work.
- Branch name.
- PR number/link if opened.
- Base SHA and Head SHA.
- Explicit confirmation: **no merge, no deploy**.
- Recommended next step.

## Stop conditions
Stop and ask/report before proceeding if:
- the approved permission semantics conflict with an already-shipped newer RBAC contract;
- direct route protection cannot be achieved without a broader auth redesign;
- a schema change appears necessary;
- any accounting posting behavior would need to change;
- the implementation baseline has materially diverged and creates a real conflict with this task.

## Final instruction
Implement **ACC-1 only**. Keep the diff small and reviewable. Preserve Tenant Isolation, RBAC integrity, backward compatibility, and the AWJ design system. Do not start ACC-2.
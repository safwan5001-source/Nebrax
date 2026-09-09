# PR-COM-0 — Commerce Module Boundary & Test Harness

**Status:** READY FOR IMPLEMENTATION — requires Safwan approval for merge/deploy  
**Parent:** `docs/plans/store/AWJ_COMMERCE_IMPLEMENTATION_MASTER_PLAN.md`  
**Milestone:** M1 — Stock Promise Foundation  
**Type:** architecture/safety scaffolding only; no Commerce business behavior

## 1. Objective

Establish the smallest real Commerce module boundary and test harness needed for later `PR-COM-1A` ATS and `PR-COM-1B` Inventory Reservation work, while producing **zero business behavior change**.

This PR must not create speculative abstractions. Inspect current repository conventions first and introduce only the minimum structure that later Commerce code can safely live inside.

## 2. Binding architecture

The following merged decisions are non-negotiable:

- `CommerceOrder != Invoice`.
- `Reservation != StockMovement`.
- `PaymentIntent != provider attempt/transaction != AWJ Payment`.
- `Return != Refund != CreditNote != Exchange`.
- `SalesChannel != Branch != Warehouse != PickupLocation`.
- Commerce customer identity is separate from ERP staff `User` and from `Partner`.
- Existing AWJ Invoice/Inventory/Ledger/Payment/ZATCA services remain authorities for their existing responsibilities.
- Commerce code must not directly write journal lines, stock valuation, COGS or ZATCA artifacts.
- Legacy ERP/POS flows are not routed through Commerce merely by introducing this module.
- Tenant Isolation and backward compatibility are mandatory.

## 3. Required pre-implementation inspection

Do a **targeted** inspection only. Do not re-audit the repository.

Verify current conventions for:

1. Laravel service/domain organization under `app/`.
2. API controller/resource organization only to determine where future Commerce APIs belong; do not add public endpoints in this PR.
3. Test organization under `tests/`.
4. `BaseModel` / tenant model conventions and `BranchIsolationGuardTest` behavior.
5. `TenantContext`, `TenantScope`, `BelongsToTenant`, branch isolation markers/contracts and any model-classification mechanism.
6. Existing architecture/safety tests that can be extended without creating brittle source-code string scans.
7. Existing approved service boundaries around:
   - `InvoiceService`
   - `InventoryService`
   - `LedgerService`
   - `PaymentService`
   - ZATCA services
8. Composer/PSR-4 autoloading to confirm no unnecessary autoload configuration is required.

If repository reality differs from this task, stop and report the conflict instead of inventing structure.

## 4. Implementation scope

### 4.1 Commerce namespace/module boundary

Create only the minimum directories/classes needed to establish a clear backend Commerce boundary following current AWJ conventions.

Preferred conceptual boundary:

```text
app/
  Commerce/   OR current-repo-equivalent
    Contracts/
    Services/
```

This path is **not prescribed** if it conflicts with existing repository conventions. The implementation report must state the actual chosen structure and why it matches AWJ.

Do not add empty folders merely to mirror a future architecture. Git does not preserve empty directories and speculative placeholders add noise.

At least one small, meaningful module marker/contract may be introduced only if it gives the architecture test something stable to assert. Avoid a generic service provider, facade, repository layer, event bus or dependency container unless current AWJ conventions demonstrably require it.

### 4.2 Test organization

Create a Commerce-specific test location following current Laravel test conventions, for example conceptually:

```text
tests/Feature/Commerce/
tests/Unit/Commerce/
```

Only create locations that contain actual tests in this PR.

### 4.3 Architecture safety contract

Add a focused test or guard proving the new Commerce boundary exists and does not itself create forbidden financial/inventory coupling.

The test must be robust and behavior/structure oriented. Avoid broad grep/string scanning of the entire repository unless an established AWJ architecture-test convention already does so safely.

Acceptable assertions may include, depending on repository conventions:

- Commerce namespace autoloads correctly.
- Commerce safety/boundary contract exists.
- No Commerce model/business aggregate is introduced by PR-COM-0.
- No route/API endpoint is registered by PR-COM-0.
- No migration/schema is introduced by PR-COM-0.
- Existing tenant/branch guard remains green.

Do **not** create fake CommerceOrder/Reservation/Payment classes just to make a test pass.

### 4.4 Boundary documentation in code/test

The durable boundary should state that Commerce orchestration must call approved services for financial/inventory side effects rather than directly writing:

- journal/ledger entries;
- stock movements/valuation/COGS;
- ZATCA invoice artifacts;
- financial settlement records outside existing approved payment authority.

Use the least intrusive repository-appropriate form: contract documentation, architecture test description, or module README only if such README convention exists.

## 5. Explicitly out of scope

PR-COM-0 must NOT add or change:

- database migrations;
- database tables/columns/indexes;
- `CommerceOrder` model/schema;
- Reservation/ATS implementation;
- SalesChannel;
- CommerceListing;
- cart/checkout;
- payment intent/provider integration;
- inbound webhooks;
- fulfillment/shipping;
- customer/mobile authentication;
- public/mobile Commerce API routes;
- storefront/admin UI;
- pricing/tax calculations;
- accounting rules;
- inventory movement behavior;
- ZATCA behavior;
- POS behavior;
- existing invoice flow;
- Product variants;
- unrelated refactoring.

No new dependency/package unless absolutely required by an existing architecture-test convention; if required, stop and request approval before adding it.

## 6. Tenant / branch requirements

Even though this PR should introduce no tenant-owned business model, it must preserve the safety harness that future Commerce models will enter.

Verify:

- `BranchIsolationGuardTest` remains green.
- Current tenant/branch model classification rules remain unchanged unless a minimal test-only registration is genuinely required.
- No weakening, exclusion or bypass is added to make future Commerce easier.

Future Commerce background/inbound work will require trusted `TenantContext` before tenant queries, but no inbound/background implementation belongs in PR-COM-0.

## 7. Accounting and inventory safety

Expected accounting impact: **none**.  
Expected inventory impact: **none**.

PR-COM-0 must not invoke posting, COGS, stock movement, payment settlement or ZATCA generation as part of any new behavior because it must introduce no business behavior at all.

If implementation inspection reveals that merely establishing the module boundary requires touching those services, stop: scope is wrong.

## 8. Backward compatibility

Required outcome:

- Existing ERP invoice routes/services unchanged.
- Existing POS routes/services unchanged.
- Existing public API unchanged.
- No existing request/response payload changes.
- No new mandatory config/env variables.
- No migration required.

## 9. Tests

Run progressively.

### Tier 1 — new focused tests

Run the exact new Commerce architecture/boundary tests.

### Tier 2 — isolation guards

Run at minimum:

```bash
php artisan test --filter=BranchIsolationGuardTest
```

Also run the directly relevant tenant-isolation guard/test discovered during inspection if separate from the branch guard.

### Tier 3 — representative regression

Run a small representative backend regression set covering the existing boundaries that PR-COM-0 promises not to alter. Select exact existing test names after repository inspection; include at least one existing invoice/accounting path and one POS path if available and stable.

### Tier 4 — broader suite

Run the normal backend suite required by current AWJ CI for this change. Do not hide pre-existing failures; report them separately with evidence.

PostgreSQL concurrency testing is mandatory in PR-COM-1B, not artificially required here unless normal CI already runs PostgreSQL.

## 10. Acceptance criteria

PR-COM-0 is acceptable only if all are true:

1. A minimal Commerce backend boundary exists following actual AWJ conventions.
2. Commerce-specific tests have a stable home.
3. A meaningful architecture/safety test guards the boundary without speculative domain implementation.
4. No migration/schema change.
5. No API route or payload change.
6. No accounting/inventory/ZATCA behavior change.
7. No legacy ERP/POS behavior change.
8. Tenant/branch isolation guards remain green.
9. Existing relevant regression tests remain green.
10. No unrelated refactor/dependency addition.
11. Final implementation report documents exact files, tests and CI.

## 11. Stop conditions

Stop and report instead of expanding scope if any of these occurs:

- Current repository conventions make the proposed module path inappropriate.
- A new package/dependency appears necessary.
- A migration/model/API endpoint appears necessary.
- Existing tenant/branch guard requires weakening or exclusion.
- The implementation would need to modify Invoice/Inventory/Ledger/Payment/ZATCA behavior.
- A pre-existing CI failure prevents trustworthy validation and cannot be isolated within this task.

## 12. Required final implementation report

Create a final MD report containing:

- Summary.
- Actual architecture/module structure chosen and why.
- Files changed.
- Confirmation: migrations/schema = none.
- Confirmation: API changes = none.
- Confirmation: accounting/inventory/ZATCA behavior changes = none.
- Tests run with exact commands and exact results.
- Build/CI status.
- Tenant/branch isolation result.
- Risks / open findings / remaining work.
- Branch name.
- PR number/link if opened.
- Base SHA.
- Head SHA.
- Recommended next step: `PR-COM-1A — Available-to-Sell read model` only if PR-COM-0 is clean.

## 13. Execution constraints

- Keep scope narrow.
- Do not merge.
- Do not deploy.
- Do not start PR-COM-1A in the same branch/PR.
- Do not perform broad cleanup/refactoring.
- Do not change financial rules or database/API contracts.
- If a decision is not supported by current AWJ code or merged Commerce docs, mark it `OPEN / REQUIRES VERIFICATION` rather than guessing.

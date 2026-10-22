# AWJ Unified Import — Parked requirements register

Requirements raised **during** the Horizon that are recorded now and **not started**. Nothing here changes the **scope** of any slice or **reorders** any slice in `AWJ_UNIFIED_IMPORT_MASTER_HORIZON.md`; each item names its dependencies and the earliest sensible window. A parked item can still be a **blocking prerequisite** of later slices (IMP-X-01 blocks the first additional AI Action type, and those slices list it as a dependency in the Tracker). No code, migration, Railway or env change is made by registering an item.

| ID | Title | Status | Recommended window |
|---|---|---|---|
| IMP-X-01 | Super Admin control of AI Actions (global, per tenant, per action type) | **Parked — not started** (D-10/D-11 approved, D-12 approved in principle, 2026-10-22) | Right after **IMP-H2-S4**, and **before IMP-H3-S4** (the first extra AI Action type) |

---

## IMP-X-01 — Super Admin control of the assistant's AI Actions

**Source:** owner note, 2026-10-22 (planning note on the continuing Horizon).

### Requirement (as stated)

Manage the AWJ Assistant's AI Actions capabilities from the **Super Admin platform console**:

1. **Global execution control** — platform-wide switches (master enable, and execution/write enable) that can be changed at runtime and stop everything at once.
2. **Per-tenant control** — enable/disable AI Actions (and execution) for one specific tenant.
3. **Per-action-type availability** — each supported action type (`product_import.v1` today; later `partner_import`, `expense_import`, `purchase_import`, `inventory_opening_import`, … ) can be made available independently, globally and per tenant.
4. **Unchanged guarantees** — tenant isolation, branch isolation, RBAC, and **approval before execution** all stay exactly as they are. These controls are *necessary, never sufficient*: they never grant a permission, never widen a branch scope, never skip the preview → approval → execution chain.

### Where it stands today (verified in code)

| Aspect | Today |
|---|---|
| Platform enable | `config('ai_actions.enabled')` ← env `AI_ACTIONS_ENABLED` (default off). **Changing it = a Railway env change + redeploy.** Read in `AiActionPolicy::authorize()` |
| Execution enable | `config('ai_actions.execution_enabled')` ← env `AI_ACTIONS_EXECUTION_ENABLED` (default off; OPS-01). Read in `AiActionProductExecutionService` |
| Tenant enable | `Settings::group('ai_actions')['enabled']` (default `false`). **No write path exists** (this is IMP-H2-S4, owner/admin toggle) |
| Per type | Closed `AiActionRegistry` (one type). Since **H1-S7** every type declares `domain_permissions` + `application_key`, enforced in `AiActionPolicy`; `AiActionTypeGatesTest` guards the registry. **No availability switch per type** |
| Approval | `AiActionApprovalLedger` / `ai.actions.approve`, preview + approval bound to content; unchanged |

### Reuse (do not rebuild)

| Existing asset | Reuse for |
|---|---|
| **`PaymentsRolloutControl` / `ZatcaRolloutControl` family** — `scope` (platform\|tenant) × `feature_key`, `enabled`, `version` (CAS), append-only `*_events` audit (actor, reason, previous/new), DB triggers forbidding UPDATE/DELETE/TRUNCATE outside an audit event, service (`effectiveForTenant`, `setPlatformState`, `setTenantState`), controller + `platform:read` / `platform:manage` abilities, platform console UI | **The pattern for every control here** (platform kill-switch + tenant control + audit). Copy the shape, not the table: see "Needs new work" |
| `PlatformAdministrator` principal, `/api/platform/*` (not through `SetTenant`), `platform:read|manage` | Authorization and isolation model for the Super Admin side |
| `PlatformAiBudgetController` / `PlatformAiBudgetService` + platform console pages | Precedent of an AI-specific platform-admin surface and its UI conventions |
| `PlatformApplicationOverride*` (preview → grant → revert with audit) | UX/flow precedent for a per-tenant grant with explicit preview |
| `Settings::group('ai_actions')` tenant opt-in + **IMP-H2-S4** | The *tenant's own* opt-in (owner/admin). Stays; becomes the second layer |
| `AiActionPolicy::authorize()` (the single enforcement point; all 6 gateway call sites) and `AiActionRegistry::types()/definition()` (H1-S7) | Where the effective state is enforced, and the source of the list of types/gates the console shows |
| `ApplicationCatalog` + `TenantApplicationState` + commercial assignment | **Optional** commercial packaging (see decision D-12); not a per-type mechanism |

### Needs new work (a separate, additive slice — not a parallel engine)

1. **Control storage** keyed by `action_type` and **capability** (`use` covering preview+review, and `execution` — see capability separation), scope platform|tenant, with append-only audit events. Prefer **one new additive table pair** following the existing pattern over editing the payments/ZATCA tables (those are live compliance paths; generalizing them is a refactor with its own risk). A shared abstract service can be extracted later.
2. **One resolver** — `AiActionsAccessResolver::effective(tenant, actionType, capability)` returning allowed/denied **with a reason code** (`env_floor_off`, `platform_off`, `type_off`, `tenant_not_granted`, `tenant_owner_not_approved`, `execution_off`, …); capability ∈ {`preview`, `review`, `execution`}. Single read, no lock, fail closed (same discipline as `ZatcaRolloutControlService`).
3. **Wiring** in the existing single points only: `AiActionPolicy::authorize()` (use) and `ExecutionService::assertEnabled()` (execute) route through the resolver, **which still reads the env floor itself** (`env_floor_off`; D-10) — the direct `config(...)` reads are replaced by the resolver, never bypassed by it; no new execution path, no second policy.
   **In-flight shutdown (verified in code):** each `run()`/`retry()` call runs `assertEnabled()` and `process()` applies **one batch per call** (up to `execution_batch_rows` rows, each in its own transaction, then that batch's images); a multi-batch execution proceeds through repeated `run()` calls. So a runtime stop already takes effect at the next batch call, across requests. The residual gap is **inside one `process()` call**: after a flip, the current batch (≤ 200 rows + images) would still finish. The slice must choose and record one of: (a) re-read the resolver before each row write (a cheap single indexed read; stop within one row, recommended), or (b) accept "stops within one batch call". A stopped execution is left resumable via the existing lease/retry model, never half-applied inside a row transaction. Weakening this further is an explicit owner decision, not assumed.
4. **Platform API + console UI**: global page (master + execution + per-type matrix) and a tenant-detail card (per-tenant grant, per-type), each change with a mandatory reason and a visible audit trail.
5. **Tenant-facing explanation**: the tenant settings screen (H2-S4) and the AI import screens show the effective state and *why* it is off (reason code → Arabic/English copy), without leaking platform internals.
6. **Tests**: tenant A's grant never affects tenant B; kill-switch precedence; per-type independence; audit is append-only; a platform change cannot grant RBAC or bypass branch scope; preview/approval requirement unchanged with every control on; real-PostgreSQL concurrency (flip racing a use/execution) with `pcntl_fork`; **a flip during an execution stops further domain writes within the chosen bound** (per-row under option (a); at most one batch call under (b)), and later `run()` calls are refused.

### Dependencies

- **IMP-H1-S7** (merged): type gates + `AiActionRegistry::types()` — the list the console enumerates.
- **IMP-H2-S4**: the tenant opt-in write path. Design the two together so the effective state has exactly two inputs from outside the code: *platform grant* and *tenant opt-in*.
- Existing platform console + `PlatformAdministrator` (no dependency on the Import UX slices H8).
- Must land **before the first additional AI Action type goes live** (H3-S4, H4-S4, H5-S5, H7-S2/S4) — per-type availability only matters once there are ≥ 2 types — and **before AI Actions are enabled for any production tenant**.
- Independent of D-02 (that decision concerns the *assistant's* data scope, not Actions) and of H9.

### Owner decisions (recorded 2026-10-22)

| ID | Decision | Status | Binding consequence for the slice |
|---|---|---|---|
| **D-10** | Env flags vs runtime controls | **Approved** | The env flags (`AI_ACTIONS_ENABLED`, `AI_ACTIONS_EXECUTION_ENABLED`) stay a **hard safety floor** that no Super Admin setting can override: env off ⇒ off, always. Runtime controls sit above it and can only *narrow*. Effective = env floor ∧ platform control ∧ type availability ∧ tenant grant ∧ tenant approval. Removing the env floor is a separate future decision |
| **D-11** | Default for tenants | **Approved** | **Default deny.** Execution is permitted only after an explicit Super Admin grant **and** the tenant owner's approval. All existing checks keep running on top: RBAC (`ai.actions.*` + the type's `domain_permissions`), the type's `application_key` gate, tenant isolation, branch isolation, preview, and approval-before-execution. A grant or approval never creates a permission |
| **D-12** | AI Actions in `ApplicationCatalog` / commercial plans | **Approved in principle (future)** | Linking AI Actions to the catalog and plans is supported later. **Commercial entitlement is independent of operational control and never grants the right to execute**: entitlement may at most make a type *available to be granted*; running it still needs the operational controls above. Not part of the first IMP-X-01 slice unless the owner asks |

Two points to settle at the start of the IMP-X-01 slice (design, not new owner decisions; they do not touch H2-S4's scope):

- **Who may give the tenant-side approval.** D-11 says the tenant *owner*. H2-S4 plans an owner/admin toggle for `ai_actions.enabled`. IMP-X-01 must make the second key owner-only (or record an owner-approved marker next to the toggle); H2-S4 itself is **not** widened or reordered by this.
- **Where "approve" sits** (see capability separation below). **Verified in code:** today `approve` and repair `start` are gated only by `ai_actions.enabled` (they record an approval / create a new draft; neither writes domain data and neither calls `assertEnabled()`), and `config/ai_actions.php` states this is by design ("the review/approval surface can be on while writes are off"). The default is therefore to **keep that mapping** (no behavior change). Moving approval under the execution tier is an optional owner decision, not assumed.

### Capability separation (preview / review / execution)

The effective state is resolved **per capability**, so stopping execution never disables the safe read and review functions.

| Capability | Covers (today's call sites) | Writes domain data? | Controlled by |
|---|---|---|---|
| **`preview`** | create/upload, add version, parsing/inspection, building a preview/draft, image-archive staging, cancel | No (drafts/previews only) | env `AI_ACTIONS_ENABLED` floor ∧ platform `use` ∧ type ∧ tenant grant ∧ the tenant's existing opt-in (`ai_actions.enabled`) |
| **`review`** | read-only: show action/preview/execution, history, failure explanations, repair-candidate reads, thumbnails, status — **and, as today, `approve` and repair `start`** (they record an approval / create a new draft only) | No | same chain as `preview`, **independent of the execution switches** |
| **`execution`** | `ExecutionService::run` and `retry` — the only calls that write domain data (rows and images) | **Yes** | all of the above ∧ env `AI_ACTIONS_EXECUTION_ENABLED` floor ∧ platform execution control ∧ per-type execution availability ∧ per-tenant execution grant ∧ **the tenant owner's approval (D-11)** |

Rules:
1. **Turning `execution` off (globally, per type, or per tenant) must leave `preview` and `review` working.** Users can still upload, preview, inspect and (as today) approve; only run/retry is refused, with a stable reason code (`execution_off`, …).
2. A denial in a higher capability never relaxes a lower one, and a grant in a lower one never implies a higher one (preview/review access never implies execution).
3. Today the code already behaves like these tiers: `AiActionPolicy::authorize()` (`ai_actions.enabled` + RBAC + application key) is the single gate for all non-execution call sites, and `ExecutionService::assertEnabled()` gates `run`/`retry` only. **The resolver must keep exactly that split**; it may add the preview/review distinction without changing which capability any current call site uses. The `USE` permission currently covers both preview and review (nothing in code distinguishes them), so splitting them is optional.
4. The kill-switch semantics remain: the platform *use* switch off ⇒ preview and review off as well (a full stop), the execution switch off ⇒ execution only.

OPS-01 (enabling `AI_ACTIONS_EXECUTION_ENABLED` in production) stays an owner approval **and an environment edit**: under D-10 the env flags are a hard floor, so every Super Admin setting stays denied until OPS-01 turns the floor on (and redeploys). This requirement adds audited runtime controls **above** that floor — a second gate for narrowing/granting per platform, type and tenant after OPS-01 — it never replaces the env edit.

### Suggested timing

Start after **IMP-H2-S4** is merged and before **IMP-H3-S4** starts (the first extra action type). It is one backend slice (storage + resolver + wiring + tests), one platform-console slice (UI), and a small tenant-side message addition to H2-S4's screen. Do **not** start it now: the Horizon continues in tracker order (H1-S3 → S8 → S4 → S5 → S6 → H2 …).

### Acceptance (definition of done for IMP-X-01)

- A Super Admin can, from the console and with a reason each time: stop/start AI Actions globally; stop/start execution globally; grant/revoke a tenant; make a type available/unavailable globally and per tenant — all audited append-only.
- Switching `execution` off at any level leaves `preview` and `review` fully working (tested per level: global, type, tenant).
- No Super Admin setting can enable anything the env floor has switched off (tested).
- With every control **on**, a request still requires the tenant owner's approval, the type's RBAC + application gates (H1-S7), the branch scope, and the preview → approval → execution chain (unchanged tests green).
- A denied request returns a stable reason code the UI can translate; no tenant can read another tenant's controls.
- No new import or AI engine; the writes still go through the existing domain services and adapters.
- Deploy evaluation recorded (additive migration; no Railway/env change; behavior for existing tenants unchanged = default-deny).

# IMP-X-01b — Wiring the operator controls into AI Actions (deploy gate default OFF)

**Branch:** `claude/imp-x01b-wire-controls` (stacked on X-01a) · **No migration, env value, Railway, RBAC, route or tenant-facing change.** New config key `ai_actions.runtime_controls_enforced` ← env `AI_ACTIONS_RUNTIME_CONTROLS_ENFORCED`, **default `false`**: while it is off, `AiActionsAccessResolver::assertAllowed()` returns before any query, so merging this slice changes nothing for any tenant. Turning the gate on is a separate, owner-approved env change; when on, **default deny applies** (no tenant works until the Super Admin grants it and, for execution, the tenant owner approves — D-11). This slice does not touch OPS-01 (`AI_ACTIONS_EXECUTION_ENABLED`) nor any AI setting, provider or the assistant.

## What it does (only the existing single enforcement points; no new engine, no second policy)
- `AiActionPolicy::authorize(..., ?string $actionType)` → after the existing tenant/actor/opt-in checks it calls `assertAllowed(tenant, type, PREVIEW)`; **every one of the six `AiActionGateway` call sites passes the type** (previously guarded statically for permissions + application key; that invariant now also requires `type`). `approve` and repair `start` keep their current mapping (the `use` tier), as the requirement's default says.
- `AiActionProductExecutionService`: `run()` and `retry()` call `assertAllowed(.., EXECUTION)` after `assertProductImport`; **in-flight stop = option (a), the recommended one:** the resolver is re-read **before every row write** (one cheap read set) and once before the images. A stop leaves the remaining rows `pending` and the execution `running`, releases the lease, writes nothing after the stop (no row, no image), and a later `run()` resumes from where it stopped without repeating a row — each row stays in its own transaction, never half-applied.
- Stable denial reason codes returned as `error.code` (403): `platform_off`, `type_off`, `tenant_not_granted`, `tenant_not_enabled`, `execution_env_floor_off`, `execution_platform_off`, `execution_type_off`, `execution_tenant_not_granted`, `tenant_owner_not_approved`, … with Arabic messages (UI translation is X-01d).

## Guarantees kept (tested)
Gate closed ⇒ no behaviour change (full `AiAction*` suites green: 157 + the new file). Gate open: deny by default with the exact reason per layer; a grant never replaces RBAC, the tenant's own opt-in, or the env floor; tenant A's grant never lets tenant B in; execution is refused until its own platform/type/tenant grants **and** the owner approval, while preview/approval keep working; a stop flipped by the Super Admin *during* a three-row execution after the first row stops the second row, then resumes after release with no duplicate product.

## Not here
X-01c (owner-only approval write path `ai_actions.execution_approved` + tenant-side reason copy) and X-01d (console UI) — until X-01c lands nobody can approve execution, which is the intended default-deny state, and the gate stays off.

No Codex review (quota exhausted); independent read-only review: see below.

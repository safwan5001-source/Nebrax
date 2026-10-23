# IMP-X-01b — Wiring the operator controls into AI Actions (deploy gate default OFF)

**Branch:** `claude/imp-x01b-wire-controls` (stacked on X-01a) · **No migration, env value, Railway, RBAC, route or tenant-facing change.** New config key `ai_actions.runtime_controls_enforced` ← env `AI_ACTIONS_RUNTIME_CONTROLS_ENFORCED`, **default `false`**: while it is off, `AiActionsAccessResolver::assertAllowed()` returns before any query, so merging this slice changes nothing for any tenant. Turning the gate on is a separate, owner-approved env change; when on, **default deny applies** (no tenant works until the Super Admin grants it and, for execution, the tenant owner approves — D-11). This slice does not touch OPS-01 (`AI_ACTIONS_EXECUTION_ENABLED`) nor any AI setting, provider or the assistant.

## What it does (only the existing single enforcement points; no new engine, no second policy)
- `AiActionPolicy::authorize(..., ?string $actionType)` → after the existing tenant/actor/opt-in checks it calls `assertAllowed(tenant, type, PREVIEW)`; **every one of the six `AiActionGateway` call sites passes the type** (previously guarded statically for permissions + application key; that invariant now also requires `type`). `approve` and repair `start` keep their current mapping (the `use` tier), as the requirement's default says.
- `AiActionProductExecutionService`: `run()` and `retry()` call `assertAllowed(.., EXECUTION)` after `assertProductImport` (before the replay branch — like the existing env check, so a replay of a finished execution is refused while execution is off; `GET` still shows the result); **in-flight stop = option (a), the recommended one:** the resolver is re-read **before every write — each row and each image**. A stop leaves the remaining rows/images `pending`, records the batch's counts (`finish()` runs), releases the lease, then throws the denial; nothing is written after the stop, and an execution whose last write already happened is finalised normally (a stop *after* the last write does not strand it as `running`). A later `run()` resumes from where it stopped without repeating a row or image — each row stays in its own transaction, never half-applied.
- Stable denial reason codes returned as `error.code` (403): `platform_off`, `type_off`, `tenant_not_granted`, `tenant_not_enabled`, `execution_env_floor_off`, `execution_platform_off`, `execution_type_off`, `execution_tenant_not_granted`, `tenant_owner_not_approved`, … with Arabic messages (UI translation is X-01d).

## Guarantees kept (tested)
Gate closed ⇒ no behaviour change (full `AiAction*` suites green: 157 + the new file). Gate open: deny by default with the exact reason per layer; a grant never replaces RBAC, the tenant's own opt-in, or the env floor; tenant A's grant never lets tenant B in; execution is refused until its own platform/type/tenant grants **and** the owner approval, while preview/approval keep working; a stop flipped by the Super Admin *during* a three-row execution after the first row stops the second row, then resumes after release with no duplicate product.

## Not here
X-01c (owner-only approval write path `ai_actions.execution_approved` + tenant-side reason copy) and X-01d (console UI) — until X-01c lands nobody can approve execution, which is the intended default-deny state, and the gate stays off.

## Independent review (read-only subagent) — disposition
Gate-off behaviour, enforcement coverage (all six gateway sites, every service path, the only other caller is the maintenance purge), claim-token release and the no-double-write on resume were verified clean. Findings:

| # | Finding | Disposition |
|---|---|---|
| 1 | Image attachment ignored the in-flight stop (one check before a loop of up to 50 media writes) | **Fixed**: re-read before every image + test (3 staged images, stop after the first → exactly 1 media, resumes to 3) |
| 2 | A check after the last write stranded a finished import as `running` and dropped the batch counts | **Fixed**: checks only precede real writes; `finish()` always runs before the denial is thrown + test |
| 4b | The operator check ran before RBAC, so an unauthorised user saw `type_off`/`platform_off` instead of `permission_denied` | **Fixed**: moved after RBAC/domain permissions |
| 6 | Gate on: replay of a completed execution returns 403 while execution is off | **Accepted, documented** (same position as the existing env check; `GET` still returns the result) |
| T | No tests for images, the retry path, post-loop stop, mid-run owner withdrawal, closed-gate query count; weak static `>= 4` check | **Added** `AiActionControlInFlightStopTest` (4) and a stricter static invariant |
| 3, 4a, 5 | Sticky approval after re-enable; operator state visible in tenant status; additive `status()` fields | **Belong to X-01c** (fixed/recorded there) |

No Codex review (quota exhausted).

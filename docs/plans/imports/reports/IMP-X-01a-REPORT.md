# IMP-X-01a — Operator controls for AI Actions: storage, resolver, platform API (unwired)

**Branch:** `claude/imp-x01a-ai-action-controls` · Additive migration `2026_12_01_010000_create_ai_action_control_tables` (two new tables, **no rows inserted**), two platform-only models, two services, platform API. **Nothing reads these controls yet** — `AiActionPolicy`/`ExecutionService` are untouched (wiring is X-01b behind a default-off deploy gate), so **no behaviour changes for any tenant**. No env, Railway, RBAC, tenant-facing route, ledger or ZATCA change. The assistant/provider/AI settings are not touched.

## Binding decisions implemented
- **D-10** env flags are a hard floor: the resolver reads `ai_actions.enabled` / `ai_actions.execution_enabled` itself and no console setting can override them (tested; the console *shows* the floor, never edits it).
- **D-11** default deny: a missing row means disabled; a "grant" is an explicit audited event. Execution additionally needs the **tenant owner's approval** (`Settings ai_actions.execution_approved`, default `false`, added to `Settings::DEFAULTS`; its owner-only write path is X-01c).
- **Capability separation:** `preview`/`review` resolve through the `use` chain; `execution` requires the whole `use` chain *and* its own chain. Turning execution off at any level (master, type, tenant, env floor) leaves preview and review working (tested at each level); a `use` grant never implies execution and an `execution` grant without `use` grants nothing.

## What it adds
- **Storage** (`ai_action_controls` + append-only `ai_action_control_events`, the `payments_rollout_*` pattern generalised): key = (scope `platform|tenant`, tenant, `action_type`, capability `use|execution`); platform `action_type='*'` is the master switch; tenant rows are per concrete type. New action types need **no migration** (type is a validated string, not an enum). DB-level guards on PostgreSQL and SQLite: baseline-only insert (`enabled=false`, version 0), state changes only through a matching audit event (compare-and-swap on version), direct UPDATE/DELETE/TRUNCATE refused, events immutable, shape CHECKs, tenant cascade only. `down()` refuses while any row exists.
- `AiActionControlService` (writes): active platform administrator re-loaded and share-locked inside the transaction, tenant anchor then control row `FOR UPDATE` (payments lock order), reason 3–500 chars mandatory, idempotent (requesting the current state writes no event), unknown type / capability / `*` for a tenant refused.
- `AiActionsAccessResolver::effective(tenant, type, capability)` → decision + stable reason code (`env_floor_off`, `platform_off`, `type_off`, `tenant_not_granted`, `tenant_not_enabled`, `execution_env_floor_off`, `execution_platform_off`, `execution_type_off`, `execution_tenant_not_granted`, `tenant_owner_not_approved`, `unknown_type`, `no_tenant_context`, …). One read, no locks, fail closed, **never reads another tenant's rows** (tested). `matrix()` feeds the console.
- Platform API (`/api/platform/*`, `platform:read` / `platform:manage`, never through `SetTenant`): `GET/PUT ai-action-controls`, `GET/PUT tenants/{tenant}/ai-action-controls` (grants, effective matrix, last 30 audit events).

## Tests
- `AiActionControlTest` (19, SQLite + PostgreSQL), `AiActionControlApiTest` (6), `AiActionControlConcurrencyPostgresTest` (3, real `pcntl_fork`: four racing grants → one event; racing grant/revoke → gapless consistent audit chain). Related suites (`AiAction*`, `Settings*`, `Platform*`: 538 tests) green.

## Not in this slice (next)
- **X-01b** wiring + deploy gate `AI_ACTIONS_RUNTIME_CONTROLS_ENFORCED` (default off) + in-flight stop (re-read before each row write) + the "who approves" and "where approve sits" design points recorded in the parked doc.
- **X-01c** tenant-owner approval (owner-only) and tenant-side reason copy; **X-01d** console UI. No Railway/env change in any of them; enabling the gate or OPS-01 stays an owner decision.

## Independent review (read-only subagent) — disposition

Clean on all six axes (triggers/SQL on both engines incl. NULL-tenant partial indexes, authorization, resolver order/isolation/Settings key handling, lock order and `insertOrIgnore` + re-read, no change to existing behaviour). Findings were test gaps and notes:

| # | Finding | Disposition |
|---|---|---|
| 1 | The platform-scope *first-create* race was never exercised (tenant rows are serialised by the tenant anchor) | **Added** a real-PostgreSQL test: four administrators making the first grant of `*|execution` at once → one control, one event, one `changed` (platform rows cleaned with the payments-test trigger-disable pattern) |
| 2 | `tenant_inactive` branch untested | **Added** (inactive and soft-deleted tenant, preview and execution) |
| 3 | Cross-type independence untestable with one registered type (`AiActionRegistry` is final) | **Accepted**: the SQL keys every read by `action_type`; becomes testable with the second registered type (H3-S4) — noted for that slice |
| 4 | `execution_approved` is sticky across operator re-grants / tenant opt-in toggles | **Design note for X-01c** (D-11 says "grant AND approval", not "fresh"): kept sticky and visible; the owner can withdraw at any time and a withdrawal stops a running execution within one row. Making it expire on re-grant is an owner call, not assumed |
| 5 | Platform-scope changes could not be read back | **Fixed**: `GET /platform/ai-action-controls` returns the last 30 platform events (+ test) |
| 6 | Branch behind `origin/main` | Merged before the PR |

No Codex review (quota exhausted).

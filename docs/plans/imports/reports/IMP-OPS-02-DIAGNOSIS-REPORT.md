# OPS-02 — "AI Actions execution unavailable" — application-logic diagnosis

**Scope (owner, 2026-10-30):** inspect the application logic and the Super Admin grant model for `product_import.v1`. **No Railway change, no platform-control bypass, no deploy.** This PR adds a test file and this report only — **no production code changed**, no migration, no journal entries.

## Verdict
**No application defect found.** The screen text «التنفيذ غير متاح حالياً من إدارة المنصة» is the tenant-facing code `platform_unavailable`, which `AiActionTenantEnablementService::tenantFacing()` produces by merging **six** platform-level reasons (so the tenant never learns environment details). The resolver (`AiActionsAccessResolver`) and the merge behave exactly as designed; four new tests reproduce the reported scenario and every step to the fix.

## What the symptom means
With the three deploy flags on (`AI_ACTIONS_ENABLED`, `AI_ACTIONS_EXECUTION_ENABLED`, `AI_ACTIONS_RUNTIME_CONTROLS_ENFORCED`), tenant enablement on and owner approval on, the **default-deny** rule (D-11) still needs these rows, in this evaluation order:

| # | Control row | Raw reason when missing |
|---|---|---|
| 1 | platform master `*` — **use** | `platform_off` |
| 2 | platform `product_import.v1` — **use** | `type_off` |
| 3 | tenant `product_import.v1` — **use** | `tenant_not_granted` *(shown as its own message)* |
| 4 | platform master `*` — **execution** | `execution_platform_off` |
| 5 | platform `product_import.v1` — **execution** | `execution_type_off` |
| 6 | tenant `product_import.v1` — **execution** | `execution_tenant_not_granted` *(own message)* |
| + | tenant owner approval | `tenant_owner_not_approved` *(own message)* |

Rows 1, 2, 4, 5 and the environment floors fold into `platform_unavailable`. **A tenant-level grant (rows 3/6) never helps while any platform row (1, 2, 4, 5) is off** — rows 1–2 come before row 3 in the chain, so a tenant that sees `platform_unavailable` has not yet reached the tenant grant check at all. Therefore "we granted the tenant" does not contradict the symptom.

Second possible cause with the identical message: `execution_enabled` (env) is off **in the serving process** (e.g. the API service that answers the request differs from the one that was redeployed, or the variable is on a different service). The tenant cannot distinguish it from a missing row (by design: env flags are never exposed to tenants).

## How the Super Admin finds the missing one (no Railway access needed)
Platform console → Tenants → *the tenant* → **AI Action controls** card: for each capability it shows the **raw** effective reason per type. Reading it:
- `platform_off` / `type_off` / `execution_platform_off` / `execution_type_off` ⇒ grant the matching **platform** row (global page: master row `*`, then the `product_import.v1` row; capabilities *use* and *execution*).
- `execution_env_floor_off` / `env_floor_off` ⇒ the environment flag is off in the serving process (owner action on the environment, outside this task).
- `tenant_not_granted` / `execution_tenant_not_granted` ⇒ grant the **tenant** row in the same card.
- `tenant_owner_not_approved` ⇒ the organisation owner approves in AI Actions settings.
Each grant needs a reason (3–500 chars) and is audited.

## What I did not do (and why)
- I did not grant anything: grants are Super Admin actions in the platform console on the live environment; this session has no access to it and bypassing the console would defeat the audit trail.
- I did not change messages. A possible improvement (**not done, needs owner approval**): let the tenant-facing text distinguish "environment" from "platform grant" — rejected for now because it would expose deployment details to tenants.

## Related behaviour (PR #1802, history list)
The new `GET /api/ai-actions` applies the same per-type operator controls as `show`, so while the platform rows are missing the history is **empty** for that type — the same root cause, not a separate bug.

## Tests (`AiActionsOps02DiagnosisTest`, 4, SQLite)
1. The reported scenario: every platform row missing ⇒ tenant sees `platform_unavailable` for preview and execution; raw reason `platform_off`.
2. Granting the four platform rows in order moves the raw reasons `platform_off → type_off → (preview allowed) execution_platform_off → execution_type_off → allowed`.
3. With all platform rows on, a missing tenant grant / owner approval names its **own** reason (`tenant_not_granted`, `execution_tenant_not_granted`, `tenant_owner_not_approved`) and not the platform one.
4. Execution env floor off in the serving process looks identical to a missing row for the tenant (`platform_unavailable`) while the platform sees `execution_env_floor_off`; preview keeps working.

Existing coverage unchanged: `AiActionControlTest` (resolver layers), `AiActionControlWiringTest`, `AiActionExecutionApprovalTest`.

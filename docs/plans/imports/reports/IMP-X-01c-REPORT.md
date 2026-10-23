# IMP-X-01c — Tenant-owner approval of AI Actions execution (+ tenant-side availability explanation)

**Branch:** `claude/imp-x01c-owner-approval` (stacked on X-01b) · No migration, env, Railway or provider/AI-setting change. Adds the **write path** of the second key (D-11): `Settings ai_actions.execution_approved`, which the resolver (X-01a) already requires for the `execution` capability. Until the operator gate (X-01b) is opened by the owner nothing reads it, so no tenant's behaviour changes.

## What it adds
- `PUT /api/ai-actions-settings/execution-approval {approved: bool}` — closed contract (unknown fields → 422), route permission `ai.actions.execution_approve` (new RBAC catalogue entry) **and** the service refuses anyone whose role is not `owner` (`owner_required`, 403): not an admin and not a custom role even if the permission was granted to it (tested).
- Approving requires the tenant's own opt-in (`ai_actions.enabled`, H2-S4) first (`tenant_not_enabled`, 409); **withdrawing is always possible** and, with the gate open, stops a running execution within one row (X-01b). Atomic (tenant row lock), mandatory descriptive audit `ai_actions.execution_approval.updated` with a boolean-only meta key (`ai_actions_execution_approved`), nothing written/audited when the value is unchanged.
- `GET /api/ai-actions-settings` now also returns `execution_approved`, `controls_enforced` and — only when the operator gate is open — `access`: per action type and capability `{allowed, reason}` with the stable reason codes (`platform_off`, `tenant_not_granted`, `tenant_owner_not_approved`, …) so the tenant can see *why* something is off without platform internals. `AiActionTenantEnablementTest` expectations updated for the new keys.
- Not widened: the approval grants nothing by itself — operator grants, env floors, RBAC, branch scope, preview and approval-before-execution all still apply.

## Design notes recorded (from the X-01a review)
- The approval is **sticky** (it is not reset when the operator revokes/re-grants execution or when the tenant toggles its opt-in): D-11 says "grant AND approval", not "fresh approval". The owner can withdraw at any time. Making it expire on re-grant is an owner decision, not assumed.

## Tests
`AiActionExecutionApprovalTest` (7): owner approve/withdraw + audit trail, unchanged value writes nothing, opt-in prerequisite but withdrawal always allowed, owner-only (admin, custom role with the permission, accountant), closed contract + unauthenticated, tenant isolation, availability explanation only when the gate is open. `AiActionTenantEnablementTest` + Rbac suites green.

## Not here
The web card (toggle + reason copy, ar/en) and the platform console are the web slices (X-01d); no screenshots in this backend slice. No Codex review (quota exhausted); independent read-only review: see the PR.

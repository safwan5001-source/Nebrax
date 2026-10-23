# IMP-X-01c — Tenant-owner approval of AI Actions execution (+ tenant-side availability explanation)

**Branch:** `claude/imp-x01c-owner-approval` (stacked on X-01b) · No migration, env, Railway or provider/AI-setting change. Adds the **write path** of the second key (D-11): `Settings ai_actions.execution_approved`, which the resolver (X-01a) already requires for the `execution` capability. Until the operator gate (X-01b) is opened by the owner nothing reads it, so no tenant's behaviour changes.

## What it adds
- `PUT /api/ai-actions-settings/execution-approval {approved: bool}` — closed contract (unknown fields → 422), route permission `ai.actions.execution_approve` (new RBAC catalogue entry) **and** the service refuses anyone whose role is not `owner` (`owner_required`, 403): not an admin and not a custom role even if the permission was granted to it (tested).
- Approving requires the tenant's own opt-in (`ai_actions.enabled`, H2-S4) first (`tenant_not_enabled`, 409); **withdrawing is always possible** and, with the gate open, stops a running execution within one row (X-01b). Atomic (tenant row lock), mandatory descriptive audit `ai_actions.execution_approval.updated` with a boolean-only meta key (`ai_actions_execution_approved`), nothing written/audited when the value is unchanged.
- `GET /api/ai-actions-settings` now also returns `execution_approved`, `controls_enforced` and — only when the operator gate is open — `access`: per action type and capability `{allowed, reason}` with the stable reason codes (`platform_off`, `tenant_not_granted`, `tenant_owner_not_approved`, …) so the tenant can see *why* something is off without platform internals. `AiActionTenantEnablementTest` expectations updated for the new keys.
- Not widened: the approval grants nothing by itself — operator grants, env floors, RBAC, branch scope, preview and approval-before-execution all still apply.

## Design notes recorded (X-01a/b/c reviews)
- **Disabling AI Actions for the organisation withdraws the owner's execution approval** (changed after review): re-enabling later — even by an admin holding `ai.actions.manage` — no longer silently restores an old approval; a fresh owner approval is required (audit meta records both flags). The approval is still **not** reset when the *operator* revokes/re-grants execution (D-11 says "grant AND approval", not "fresh approval"): making it expire on an operator re-grant is an owner decision, not assumed. The owner can withdraw at any time, and a withdrawal stops a running execution within one write (tested).
- The tenant-facing `access` matrix collapses the platform-layer reasons (`env_floor_off`, `platform_off`, `type_off` and their `execution_*` forms) into `platform_unavailable`, so tenants never see environment flags or operator-control details (changed after review).
- `status()` gained additive keys (`execution_approved`, `controls_enforced`, `access`); the web client reads only the old fields.

## Tests
`AiActionExecutionApprovalTest` (7): owner approve/withdraw + audit trail, unchanged value writes nothing, opt-in prerequisite but withdrawal always allowed, owner-only (admin, custom role with the permission, accountant), closed contract + unauthenticated, tenant isolation, availability explanation only when the gate is open. `AiActionTenantEnablementTest` + Rbac suites green.

## Not here
The web card (toggle + reason copy, ar/en) and the platform console are the web slices (X-01d); no screenshots in this backend slice. Independent read-only review (shared with X-01b): owner-only approval verified clean (role check, custom-role slugs cannot collide with `owner`, atomic, audited, no other writer of `ai_actions`); its findings on sticky approval and tenant-visible operator state were **fixed** as above. No Codex review (quota exhausted).

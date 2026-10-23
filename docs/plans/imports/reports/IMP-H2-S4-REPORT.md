# IMP-H2-S4 — Tenant opt-in endpoint for AI Actions (backend)

**Branch:** `claude/imp-h2-s4-ai-actions-enablement` · **Closes finding F-13** (H0 discovery: no write path for `ai_actions.enabled`). **No migration, no env change, no AI-setting/provider change, no accounting/ZATCA change.**
UI is a separate slice (**H2-S4b**) so this review stays backend-only. **Not** IMP-X-01 (Super Admin control) — not widened, not reordered.

## What it adds

- `GET /api/ai-actions-settings` → `{platform_enabled, tenant_enabled, effective, reason}` with `reason ∈ platform_disabled | tenant_not_enabled | enabled`.
  Readable by anyone holding an AI Actions permission (`use|approve|repair|manage`), so screens can explain *why* it is off. No platform internals beyond the two booleans.
- `PUT /api/ai-actions-settings {enabled}` — closed contract (`enabled` only; any other key is 422). New permission **`ai.actions.manage`**
  (owner/admin via `*`; **not** granted to accountant/staff; independent of `use/approve/repair` and of `ai.consent.manage`).
- `AiActionTenantEnablementService` is the **only writer** of the `ai_actions.enabled` key:
  - one transaction with a row lock on the tenant, no-op (no write, no audit) when unchanged;
  - **platform flag stays a hard floor** (consistent with D-10): enabling while `AI_ACTIONS_ENABLED` is off → 409 `platform_disabled`; disabling is always allowed;
  - **required audit event in the same transaction** (`ai_actions.enablement.updated`, meta `ai_actions_enabled` bool only — no free text); failure to write the audit aborts the change;
  - takes effect on the next request: `AiActionPolicy` already reads the tenant setting fresh.
- It grants **no execution**: `AI_ACTIONS_EXECUTION_ENABLED`, RBAC (`use/approve/repair` + domain permissions), preview and approval are untouched.

## Notes for IMP-X-01 (recorded, not built)

- D-11 wants the tenant-side approval to be **owner**-only once the Super Admin grant exists; today `ai.actions.manage` is owner/admin (as planned for H2-S4). IMP-X-01 will make the second key owner-only or add an owner-approval marker.
- The single-writer service is the integration point for the effective-state resolver (platform grant ∧ tenant opt-in) and for the preview/review/execution capability split.

## Tests — `AiActionTenantEnablementTest` (6)

default off → enable → draft creation succeeds → disable → refused (`tenant_not_enabled`), audit rows = 2 with meta `{ai_actions_enabled:true}`; unchanged value writes/audits nothing;
platform floor (enable refused 409, disable allowed, `reason: platform_disabled` while the tenant flag stays true); RBAC (accountant/staff 403, `ai.actions.use` reads but cannot write, no AI permission 403 on read, `manage` alone can write, unauthenticated 401);
closed contract (empty, non-boolean, `execution_enabled`, `tenant_id` → 422); tenant isolation.
**Negative control:** removing `ai.actions.manage` from the PUT route makes the RBAC test fail; restored.

## Deploy evaluation

Additive endpoints only. Railway auto-deploy of `main` runs `migrate --force` — there is no migration here. No setting is flipped by the deploy (default stays off for every tenant).

## Disclosures

No Codex review (quota exhausted). Full local suite not run (CI is the full gate); related subsets run locally.

## Independent review (read-only subagent, static — it could not run tests) — disposition

No high/medium findings. Authorization chain (auth → principal → tenant → subscription → permission), single-writer lock + required audit, platform floor (no bypass), route non-collision and audit-endpoint visibility were each checked: nothing found.

| # | Finding | Disposition |
|---|---|---|
| 1 | Unknown-field check used `all()`, so a query string (`?x=1`) made a valid PUT 422 | **Fixed** (body keys only; test) |
| 2 | `tenants.settings` is one JSON blob: a non-locking `Settings::put` elsewhere can lose-update this key (pre-existing, same as the assistant-consent precedent) | **Not fixed here — pre-existing; tracked as a hardening item** |
| 3 | Unnamed throttle bucket is per user and shared with other AI routes | Informational (existing convention) |
| 4 | 409 here vs 403 for the same `platform_disabled` code in `AiActionPolicy` | Informational (different surfaces; documented) |
| 5 | Audit event stored under `feature='assistant'` and visible in the assistant audit list | Cosmetic; accepted |
| – | Test gaps: audit-failure rollback, concurrent PUTs, inactive user/tenant (covered upstream by `SetTenant`) | Noted; not added in this slice |

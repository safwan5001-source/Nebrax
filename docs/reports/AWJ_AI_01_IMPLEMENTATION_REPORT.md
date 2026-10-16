# AWJ Intelligence — AI-01 Secure AI Gateway: Implementation Report

| Item | Value |
|---|---|
| Branch | `feat/ai-01-secure-gateway-20261016` |
| Draft PR | see PR description (Draft, not merged) |
| Base SHA (`origin/main`) | `97341a197a47024dda60c2ea541761aac0b1f355` |
| Draft PR | [#1546](https://github.com/safwan5001-source/Nebrax/pull/1546) (Draft, not merged) |
| Code Head SHA (all runtime code + tests, CI-verified) | `49f857b49854e969f478f608d5bd850e4b4afe88` |
| Earlier commits | `5ebcbb5` (initial implementation), `ecf3861` (initial report) |
| Final Head SHA | the report-update commit that follows `49f857b` is docs-only; the exact SHA is the PR head |
| Scope | AI-01 only. Mock provider, default OFF, zero egress, no schema change |

## 0. Review round (owner decisions applied)

1. **Audit:** log-based audit is accepted **temporarily, for the Mock phase only**. Durable audit and atomic spend limits are **mandatory in AI-02, before any paid provider connection**.
2. **`ai.assistant.use` added to the default `accountant` role.** Data and report permissions stay independent (see §2 and §5).
3. **422 before the kill switch is kept** and now documented and tested (see §6.1). No security issue was found.
4. **CI:** all jobs green on `49f857b` (see §5).

## 1. References (not merged, not dependencies)

- #1543 `docs/plans/ai/AWJ_INTELLIGENCE_MASTER_PLAN.md` (branch `docs/awj-intelligence-master-plan-20261016`, head `d4782f4`)
- #1544 `docs/reports/AWJ_AI_ARCH_0_BASELINE_AUDIT.md` (branch `docs/ai-arch-0-baseline-audit-20261016`, head `630a377`)
- #1545 `docs/plans/ai/AWJ_AI_FOUND_1_V2_EXECUTION_CONTRACT.md` (branch `docs/ai-found-1-v2-execution-contract-20261016`, head `9a3d333`)

The architecture review was not repeated. The implementation follows contract §3 (AI-01) and the gates in §2.

## 2. What was built

A narrow Laravel gateway: `POST /api/ai-assistant/messages`.

Request flow (every denial stops the request before any prompt is built):

1. Route: `auth:sanctum` → `EnsureUserPrincipal` → `SetTenant` → `SetBranch` → `EnsureActiveSubscription` → `ai.assistant.use` permission → `throttle:20,1`.
2. `AiAssistantMessageRequest`: closed, bounded schema. Unknown fields are **rejected, not ignored**. This covers `tenant_id`, `user_id`, `provider`, `model`, `tools`, `sql` and `url`.
3. `AiAssistantPolicy::authorize`: platform kill switch ∩ tenant opt-in ∩ per-category consent ∩ fresh actor. It reloads the actor and tenant from the database on every call.
4. `AiAssistantScopeGuard`: explicit rejection of forbidden branch and warehouse identifiers (see §4).
5. Provider resolution: only `mock`. Any other value returns 503 `provider_unavailable`.
6. Provider tool proposals: each one goes through the closed registry, then a **full re-authorization with a freshly loaded actor**, then scope re-resolution, then execution. The registry is empty in AI-01.
7. Metadata-only audit log line.

### Response contract

- Success `200`: `{"data": {request_id, status, provider, locale, message{role,content}, data_categories, scope{branch,warehouse}, tool_calls[]}}`, plus the `X-AI-Request-Id` header.
- Failure: `{"error": {"code", "message"}, "request_id"}`.
- Codes:
  - `platform_disabled` (503)
  - `provider_unavailable` (503)
  - `tenant_not_enabled`, `consent_required`, `data_category_unavailable` (403)
  - `permission_denied`, `actor_unavailable`, `actor_inactive`, `tenant_inactive` (403)
  - `branch_scope_forbidden`, `warehouse_scope_forbidden` (403)
  - `tool_not_registered`, `tool_permission_denied` (403)
  - `too_many_tool_calls`, `invalid_request` (422)
  - `internal_error` (500)

Note: the RBAC route middleware (`EnsurePermission`) and the auth middleware keep their existing response shape. A user who lacks `ai.assistant.use` therefore gets the standard `403 {message}`, not the `error.code` envelope.

### Consent and policy

- Platform: `config/ai_assistant.php` → `AI_ASSISTANT_ENABLED`, default `false`. Only an explicit `true` opens it.
- Tenant: new settings group `ai_assistant` (`enabled=false`, `consented_categories=[]`) in the existing `tenants.settings` JSON. It is independent of `allow_document_sending` and `document_intelligence`; the policy never reads them (test proves it).
- Data categories (`AiAssistantDataCategory`):
  - `assistant_messages` is the only available category.
  - `financial_summary` and `document_projected_text` are **reserved/unavailable**. They cannot be used even if stored in settings. No financial data is transmitted in AI-01.
- There is no write path for the `ai_assistant` group yet (no settings controller or UI), so it cannot be changed through the generic settings API. Consent management belongs to AI-03.
- New permission `ai.assistant.use` in `Rbac::PERMISSIONS`.
  - **owner/admin:** hold it via `*`.
  - **accountant (default role):** granted explicitly. The accountant matrix gained exactly this one string and nothing else.
  - **staff and self_service:** not granted. Custom roles may be granted it.
  - **Independent of data access:** it only opens the gateway and grants no read of any record, report or financial data. Every future tool declares its own permission (for example `reports.view`), re-checked on each invocation with a freshly loaded actor.
  - **Existing tenants:** their stored `roles` rows are unchanged because no migration was added. Their accountants stay denied until granted. This is safe, since the feature is off platform-wide and no tenant has opted in. New tenants get the permission through `Rbac::systemRoles()`. A backfill migration is a decision for AI-02 or a later step.

### Provider secrets

- The gateway does not read `PlatformIntegrationSetting` or any API key.
- No second secrets store was created.
- Existing encrypted, platform-owned settings are untouched (test asserts the raw encrypted value is unchanged and still the only row).

### Audit (no schema change)

- One structured log line `ai_assistant.request` per request.
- Fields: `request_id`, `tenant_id`, `actor_id`, `data_categories`, `locale`, `message_chars`, requested branch and warehouse id counts, tool call counts, `provider`, `outcome`, `reason`.
- It never contains the prompt, the reply, scope ids or any secret. A test pins the exact key allow-list.
- A durable DB audit table needs a migration and was deliberately not added. It is a decision gate for AI-02, which needs budget and usage persistence anyway.

## 3. Changed files

| File | Change |
|---|---|
| `config/ai_assistant.php` | new: kill switch, provider, limits |
| `app/Support/AiAssistantDataCategory.php` | new: category contract |
| `app/Support/AiAssistantDenied.php` | new: structured denial catalog |
| `app/Contracts/AiAssistantProvider.php`, `AiAssistantTool.php` | new: contracts |
| `app/Services/AiAssistantGateway.php` | new: orchestration and audit |
| `app/Services/AiAssistantPolicy.php` | new: platform ∩ tenant ∩ actor authorization |
| `app/Services/AiAssistantScopeGuard.php` | new: explicit scope rejection |
| `app/Services/AiAssistantToolRegistry.php` | new: closed, empty registry |
| `app/Services/MockAiAssistantProvider.php` | new: deterministic mock |
| `app/Http/Requests/AiAssistantMessageRequest.php` | new: bounded schema; documents validation-before-kill-switch order |
| `app/Http/Controllers/Api/AiAssistantController.php` | new |
| `app/Support/Rbac.php` | `ai.assistant.use` added to `PERMISSIONS` and to `MATRIX['accountant']` |
| `app/Support/Settings.php` | +`ai_assistant` defaults group |
| `routes/api.php` | +1 route and import |
| `tests/Feature/AiAssistantGatewayTest.php` | new: 39 tests |
| `docs/reports/AWJ_AI_01_IMPLEMENTATION_REPORT.md` | this report |

- No migrations, no CI or assembly script changes (all new files sit in directories already copied by `setup.sh`, `ci.yml` and `deploy/assemble.sh`).
- No `web/` change.
- Nothing touching AWJ Store or classifications.

## 4. Scope semantics

- `allowedBranchIds()` / `allowedWarehouseIds()` return `null` for unrestricted. An empty assignment is never reinterpreted as deny-all.
- Existing report helpers (`ReportBranchScope`) widen a forbidden request to the user's full scope. The gateway does **not**: any requested id outside the actor's set is a hard `403`. Mixed allowed and forbidden lists are rejected whole.
- Unrestricted actors may only name ids that exist inside their own tenant. Another tenant's ids, or random ids, are rejected.
- Response `scope.mode` is one of:
  - `all`: unrestricted, no selection
  - `selected`: an explicit, allowed subset
  - `assigned`: restricted, defaulted to the actor's assignments

## 5. Tests and verification

Local runs used SQLite on the assembled app (`setup.sh` layout). CI runs SQLite and PostgreSQL.

| Check | Result |
|---|---|
| `AiAssistantGatewayTest` (focused, after review changes) | **39 passed, 567 assertions, 0 failed, 0 skipped** |
| Adjacent RBAC, grant-boundary, scope and route-guard suites | **194 passed, 2480 assertions, 0 failed** |
| Initial full local suite (`ecf3861`, before the review round) | 7296 passed, 140 skipped, 26 failed (environmental, see below) |
| `git diff --check` | clean |

Adjacent suites run: `UserGrantBoundaryTest`, `RoleGrantBoundaryTest`, `MeActorScopeTest`, `Rem37Zatca*`, `DeliveryConnectorCoreTest`, `DeliveryConnectorAuditPermissionTest`, `DeliveryHubProjectionTest`, `ReportEffectiveScopeTest`, `UserAccessScopeTest`, `ApiUnauthenticatedResponseTest`, `ApplicationAccessGateGuardTest`. These were chosen because they assert on the role matrix, grant ceilings or route guards that this change touches.

The full local suite was **not re-run** after the review round, as requested. The change is one permission string, test code and comments. CI is the full-suite authority for the final head.

### CI

| Run | Commit | SQLite | PostgreSQL | CI Gate |
|---|---|---|---|---|
| Initial implementation | `ecf3861` | success | superseded by the new push before finishing | superseded |
| Review round | `49f857b` | **success** (13 min) | **success** (17 min) | **success** |

- No job failed, so there were no failure logs to inspect.
- The 26 local failures were not reproduced in CI. They were all `undefined function bcmul()` in 6 fuel test classes, because the sandbox PHP lacks `bcmath`. SQLite and PostgreSQL CI both pass the full suite, confirming the failures were environmental.
- The report-only commit that follows `49f857b` changes no code. CI may re-run on it.

### New RBAC tests (review round)

- Default matrix: owner/admin hold `*`, accountant holds the permission, staff and self_service do not. The `Rbac::allows` fallback agrees.
- The accountant matrix differs from the previous one by exactly `ai.assistant.use`. Data and report permissions are unchanged, and `self_service` still lacks them.
- A newly registered tenant's default accountant gets 200 once platform and tenant gates are open.
- The same accountant is still denied while the platform is off (503 `platform_disabled`) or the tenant has not opted in (403 `tenant_not_enabled`).
- staff and self_service are denied even when platform and tenant allow.
- A stored accountant role without the permission is **not** backfilled (denied until granted).
- A custom role holding only `ai.assistant.use` can call the gateway but gets 403 on income statement, invoices, payments, accounts and purchases.
- A tool requiring `users.manage` is denied (`tool_permission_denied`) for an accountant who holds `ai.assistant.use`, so tool permissions are independent.
- Revoking the permission between requests, and between planning and tool execution, takes effect immediately (from the initial suite).
- Validation order: a malformed request returns 422 with an identical body whether the platform is on or off, and leaks no platform state. A valid request then hits the kill switch (503).

### Initial-suite scenario coverage (unchanged)

- Default OFF, no consent, Document Center consent not authorizing the assistant, and reserved categories unusable.
- Cross-tenant ids; forbidden branch and warehouse scope rejected (not widened); unrestricted semantics preserved.
- Malformed and bounded input, and every smuggled field rejected.
- Deterministic mock; closed registry; per-invocation re-authorization.
- Zero egress: `Http::preventStrayRequests()` plus `assertNothingSent()` in every test, and non-mock providers fail closed.
- No secrets or prompts in responses or logs.
- Mutation checks: breaking the kill switch or the scope rejection fails the tests.

## 6. Risks and limitations

1. **422 precedes the kill switch (kept, documented, tested).** A malformed request to a disabled platform returns `422 invalid_request`, not `503`. No security issue was found, for these reasons:
   - The 422 body is identical whether the platform is on or off, so it reveals nothing about the switch.
   - No policy read, provider call or audit entry happens before validation.
   - A well-formed request is always gated by the switch first.
   - Rationale and test: comment in `AiAssistantMessageRequest` and `shape_validation_runs_before_the_kill_switch_and_leaks_nothing`.
2. **Audit is log-only, accepted temporarily for the Mock phase only.** Logs are not an immutable store. **Durable audit and atomic global and tenant spend limits are mandatory in AI-02, before any paid provider connection.** No live provider may be enabled without them.
3. **No consent write path or UI** in this PR. Opt-in can only be set by code or data until AI-03.
4. **Existing tenants' stored accountant role is not backfilled** (no migration). They stay denied until granted, which is safe while the feature is off. A backfill is a separate decision.
5. **Tool contract is a design stub.** The re-authorization path is tested with a test-only tool, but no production tool exists. AI-02 must add its own financial parity tests.
6. **Gateway-level `permission_denied`** is reachable only through the tool re-authorization path. The route middleware answers first on the request path.
7. `tenant_id` appears in log lines. This is operational metadata, not a secret.

## 7. Remaining work and next step

- AI-02: atomic global and tenant budgets, durable usage audit (schema decision), three deterministic finance tools, SAR and parity tests.
- AI-03: UI, consent management and status endpoint.
- AI-04: Document Center integration with a separate consent.
- Before any live provider: privacy, retention and residency approval, billing owner and caps. These open gates are unchanged from contract §5.

**Next step:** owner review of Draft PR #1546 (CI is green). AI-02 follows, with durable audit and atomic budgets as hard prerequisites for any paid call. No merge or deploy was performed.

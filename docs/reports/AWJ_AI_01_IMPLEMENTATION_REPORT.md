# AWJ Intelligence — AI-01 Secure AI Gateway: Implementation Report

| Item | Value |
|---|---|
| Branch | `feat/ai-01-secure-gateway-20261016` |
| Draft PR | see PR description (Draft, not merged) |
| Base SHA (`origin/main`) | `97341a197a47024dda60c2ea541761aac0b1f355` |
| Code Head SHA (all runtime code + tests) | `5ebcbb5db93c667e6af4ff1e2ff5874af1f74cb6` |
| Report commit | the commit following the code head; final Head SHA is shown on the PR |
| Scope | AI-01 only. Mock provider, default OFF, zero egress, no schema change |

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
- New permission `ai.assistant.use` was added to `Rbac::PERMISSIONS`. owner/admin hold it via `*`; it is **not** added to the accountant, staff or self_service matrices. Custom roles may be granted it.

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
| `app/Http/Requests/AiAssistantMessageRequest.php` | new: bounded schema |
| `app/Http/Controllers/Api/AiAssistantController.php` | new |
| `app/Support/Rbac.php` | +1 permission string (`ai.assistant.use`) |
| `app/Support/Settings.php` | +`ai_assistant` defaults group |
| `routes/api.php` | +1 route and import |
| `tests/Feature/AiAssistantGatewayTest.php` | new: 32 tests |
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

Run on SQLite against the assembled app, using the repo's own assembly (`setup.sh` layout).

| Check | Result |
|---|---|
| `AiAssistantGatewayTest` (focused) | **32 passed, 513 assertions, 0 failed, 0 skipped** |
| Mutation sanity (kill switch ignored; scope widened instead of rejected) | 4 of the new tests failed as expected, then code restored |
| Full suite `php artisan test` | **7296 passed, 140 skipped, 26 failed** (58,055 assertions, 677 s) |
| `git diff --check` | clean |

### The 26 failures

- All 26 are in 6 fuel test classes: `FuelAviRfidServiceTest`, `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`, `FuelSupplyReceivingTest`.
- Cause: `Call to undefined function App\Services\bcmul()`. The sandbox PHP lacks the `bcmath` extension; the session bootstrap warned about this beforehand.
- CI installs `bcmath`. I re-ran two of the classes and reproduced the identical error.
- None of them touch the changed files. I did not compare against a baseline run on `main`, so treat this as environmental until CI confirms.
- The 140 skips are pre-existing skips in other suites, not changed by this PR.

### Coverage of the required scenarios

- Default OFF: shipped config defaults, and kill switch OFF blocks a fully opted-in tenant.
- No consent, enabled without consent, consent without enabled; Document Center consent does not authorize the assistant.
- Permission denied (staff, accountant), and permission revoked between requests and between planning and tool execution.
- Cross-tenant: actor id, branch id, warehouse id, and per-tenant consent isolation.
- Forbidden branch and warehouse scope for restricted users (rejected, not widened), plus unrestricted semantics preserved.
- Malformed and bounded input: 14 invalid shapes, boundary values at exactly 2000 chars (including multi-byte Arabic), and every smuggled field.
- Mock behavior: deterministic, does not echo the prompt, locale-aware.
- Closed registry: unregistered tool, over-limit tool calls, reserved data category on a tool, tool scope re-resolution.
- No external calls: `Http::preventStrayRequests()` plus `Http::assertNothingSent()` run in every test. Non-mock providers fail closed even with a live Anthropic connection configured in the platform. A static scan checks the new sources for network and provider-client code.
- No secrets in responses or logs: a canary API key in platform settings and a canary prompt never appear in responses or in captured log contexts.

## 6. Risks and limitations

1. **Validation precedes the kill switch.** A malformed request to a disabled platform returns `422`, not `503`. No data is processed and nothing sensitive is exposed, but the disabled response is not the very first thing evaluated.
2. **Audit is log-only.** Logs are not an immutable store. Durable, immutable audit and budget settlement are AI-02 prerequisites before any live provider call.
3. **No consent write path or UI** in this PR. Opt-in can only be set by code or data until AI-03.
4. **Accountants do not get the permission by default.** Contract §1 names owners, managers and accountants as the audience. Accountants need a custom-role grant or a deliberate matrix change.
5. **Existing tenants' stored roles** are unaffected. owner/admin hold the permission through `*`; nothing is migrated.
6. **Tool contract is a design stub.** The re-authorization path is tested with a test-only tool, but no production tool exists. AI-02 must add its own financial parity tests.
7. **Gateway-level `permission_denied`** is reachable only through the tool re-authorization path. The route middleware answers first on the request path.
8. `tenant_id` appears in log lines. This is operational metadata, not a secret.

## 7. Remaining work and next step

- AI-02: atomic global and tenant budgets, durable usage audit (schema decision), three deterministic finance tools, SAR and parity tests.
- AI-03: UI, consent management and status endpoint.
- AI-04: Document Center integration with a separate consent.
- Before any live provider: privacy, retention and residency approval, billing owner and caps. These open gates are unchanged from contract §5.

**Next step:** review this Draft PR and CI results. If the owner accepts the log-only audit, proceed to AI-02. No merge or deploy was performed.

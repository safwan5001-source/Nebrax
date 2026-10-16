# AWJ Intelligence — Master Plan (Proposal)

**Date:** 2026-10-16  
**Status:** Architecture proposal / documentation only — NOT implemented or approved for deployment.  
**Repository:** safwan5001-source/Nebrax  
**Principle:** Extend existing AWJ workflows; do not rebuild Document Center, Help Center, reports, or accounting engines.

## 1. Goal
Create one permission-aware, Arabic/English AI assistant accessible contextually throughout AWJ ERP. It answers grounded questions, explains evidence and calculations, and eventually prepares reviewable drafts; it must not autonomously post ledgers, approve, pay, file tax submissions, change stock, send communications, or execute transactions.

## 2. Existing evidence and integration constraints
- Document Center already has intake UI (`web/src/components/document-center/document-upload-dialog.tsx`), preview, governance, extraction readiness and a provider integration path. `config/document_center.php` sets `DOCUMENT_AI_PROVIDER_NETWORK_ENABLED=false` by default; persistent storage is gated by `DOCUMENT_DURABLE_STORAGE_ENABLED=false` by default. See `docs/reports/AWJ_DOCUMENT_CENTER_STATUS_WIRING_REPORT.md` and `deliverables/DOCUMENT_CENTER_RETRY_PRODUCTION_DIAGNOSIS.md`.
- The documented extraction path includes Gemini, tenant policies, engine/provider enablement and a non-sync queue. A successful provider connection test is **not** proof extraction works end-to-end. Reassess current deployment and latest merged code before implementation; historical reports are not production verification.
- Existing Help Center V2 (`docs/plans/help-center/AWJ_HELP_CENTER_V2_MASTER_PLAN.md`) explicitly excludes an AI assistant/RAG. Intelligence is a separate initiative and must reuse existing article content without silently changing the Help Center scope.
- Existing `TenantContext` and tenant-scoped models underpin data isolation. Additional branch/warehouse, RBAC and document-specific permission checks are mandatory, including tool-output filtering.

## 3. Functional domains
1. **Finance and accounting:** explain P&L, receivables/payables, cash flow, ledger movement, period comparisons, with links to source records and explicit accounting periods/currency.
2. **Sales and collections:** overdue customers, invoice trends, collection priorities and draft reminders (never automatically sent).
3. **Purchasing and inventory:** suppliers, price variances, slow/fast movers, replenishment suggestions, with units/warehouse scopes.
4. **Document Center:** summarization, classification, extraction/validation, evidence-backed comparison against related purchase orders/invoices, review queue. Reuse intake, storage, governance, provider selection, extraction and retry policies. Do not introduce duplicate document infrastructure.
5. **Reports:** natural language navigation to existing reports and traceable aggregations; no fabricated KPIs.
6. **HR:** permitted summaries only; sensitive employee data isolated and minimized.
7. **Help Center and operational guidance:** context-aware explanations grounded in versioned AWJ help articles.
8. **Audit and controls:** anomaly indicators with supporting evidence, never automatic allegations or irreversible action.

## 4. Proposed architecture
`Next.js contextual assistant UI -> authenticated Laravel AI Gateway -> permissioned AWJ domain tools + model provider adapter (Claude API initially optional)`.

- Gateway obtains actor/tenant from trusted auth context, never model input, URL parameters, or untrusted headers.
- Tools are explicitly registered operations (e.g. `finance.getReceivablesSummary`, `reports.getProfitLoss`, `documents.getAuthorizedDocumentSummary`), with field-level allowlists and server-side branch/warehouse scopes; **no arbitrary SQL**.
- Model never receives raw credentials or an unrestricted database connection.
- Model provider abstraction allows Claude for reasoning without displacing the existing Gemini document-extraction path. Benchmark accuracy/cost/security before changing any existing provider routing.
- Return source record IDs/deep links only after authorization, plus period, timestamp, filters, calculations and confidence/limitations. Distinguish factual totals computed by deterministic AWJ services from AI narrative.
- Use bounded conversation history and explicit tool call/time/token budgets. Error/timeout/fallback states must never fabricate answers.

## 5. Document Center contract
- First inspect actual current controllers/services, extraction schemas, document statuses, governance events, retry limits, storage/retention and tenant settings.
- Reuse existing document IDs and lifecycle; no parallel uploads, classification database, OCR store or attachment ownership model by default.
- Summaries/comparisons only for documents the actor may read; never bypass `allow_document_sending` or provider-network gate.
- External transfer requires tenant policy and explicit opt-in where required; redact/minimize customer, employee and banking data.
- A suggested document/accounting draft goes through existing validation and review flows; model text is not a posted transaction.
- Treat documents as untrusted input: embedded instructions cannot override system permissions or tool policies.

## 6. Security, privacy and spending
- Tenant isolation + RBAC + branch/warehouse scope evaluated **on each tool invocation**, not only on the conversation entrypoint.
- Default read-only. Any write-capable phase requires explicit per-action approval, idempotency, audit trail, server-side validation and separate security review.
- Never log raw documents, secrets or full prompts indiscriminately. Define retention/deletion policy and provider data-handling/legal review before production with real financial records.
- Back-end-only API keys in secret manager/env; never `NEXT_PUBLIC_*` or Git.
- Provider circuit breaker, per-tenant quotas, rate limits, token caps, retries, spend alerts and hard monthly ceiling; fail closed if caps exhausted.
- The personal $100/month promotional API credit is **development/test funding**, not a dependable commercial budget, nor proof of service entitlement. Verify eligible usage, expiration and billing behavior in the provider console.
- Separate AI usage metering per tenant and model; consider commercial AI Credits/tiers only after cost measurement.

## 7. Delivery roadmap (small PRs, separate approval each)
| Phase | Deliverable | Gate |
|---|---|---|
| AI-ARCH-0 | Evidence-led inventory: current routes, schemas, Document Center/Gemini extraction, permissions, Help Center, current deployment, provider policy and spend | Architecture review only |
| AI-FOUND-1 | Backend gateway skeleton, provider adapter, secure config, mock provider, audit/usage controls, unit tests | No external calls by default |
| AI-READ-2 | Read-only finance/reports domain tools, deterministic aggregation, strict tenant/actor/scope tests | No invented figures |
| AI-UX-3 | Contextual assistant desktop/mobile, AR/EN RTL/LTR, cited source links, loading/error/cost notices | Screenshot + accessibility QA |
| AI-DOC-4 | Document Center integration using existing extraction/review/governance APIs; summary and invoice/PO comparison | Data-sharing and readiness gates |
| AI-OPS-5 | Sales/purchases/inventory/help contexts and coverage tests | Least privilege across tools |
| AI-DRAFT-6 | Human-approved proposal/draft workflows, never posting/approval by AI | Explicit authorization & audit |
| AI-PROD-7 | Staged production pilot, privacy sign-off, cost measurement, verification on real deployment | Explicit deploy approval |

## 8. Acceptance tests
- Cross-tenant, cross-branch, cross-warehouse, role/field restriction, revocation-mid-conversation, direct object-ID enumeration and prompt-injection tests.
- Deterministic numerical parity with existing AWJ reports (including rounding, currency, tax and date boundaries); refusal when data unavailable.
- Document access/retention/provider-off/queue-off/stale storage scenarios; no unauthorized document transmission.
- Error handling: key missing, quota exceeded, timeout, malformed model tool call, duplicate request, retry and partial results.
- Arabic/English, RTL/LTR, mobile navigation, keyboard accessibility, latency and token/cost budgets.
- Verify CI, integration tests and production behavior separately. Passing tests/merging a PR alone does not mean production feature complete.

## 9. Open decisions (do not assume)
- Is initial pilot restricted to owners/accountants or all roles via strict authorization?
- Which document types and fields may be sent to Anthropic? Is tenant-level opt-in required?
- Current Gemini versus Claude role by task; no forced migration.
- Data residency, privacy/legal/compliance requirements, retention, provider agreement, and production billing account.
- Initial per-tenant quota and hard stop; model selection per task.
- Whether deployed queue workers and durable object storage actually meet Document Center requirements.

## 10. Explicit non-goals for this documentation PR
No runtime code changes, migrations, credentials, activation of provider network, production data transfer, PR merge or deployment. Future execution requires a reviewed baseline and separate approval.

**References:** `config/document_center.php`; `docs/reports/AWJ_DOCUMENT_CENTER_STATUS_WIRING_REPORT.md`; `docs/plans/help-center/AWJ_HELP_CENTER_V2_MASTER_PLAN.md`; `app/Tenancy/TenantContext.php`; `web/src/components/document-center/document-upload-dialog.tsx`.

## 11. Platform Administration AI Integration — existing capability (verified 2026-10-16)

**Important correction to the implementation plan:** Platform Administration already has multi-provider Document AI integration settings. Do **not** build a second secrets/settings management interface for the new assistant without proving a distinct configuration need.

Current repository evidence:
- `web/src/app/platform/(console)/integrations/payload.ts` defines `document_ai`, three provider keys `openai`, `anthropic`, `google_gemini`, primary/fallback routing, sync/async, per-provider API key/model/enablement, `allow_document_sending`, monthly operations/pages limits, data region and retention policy.
- `app/Services/PlatformIntegrationService.php` persists platform integration configuration, requires platform administrator password for updates, tests individual providers and audits configuration/test events.
- `app/Services/DocumentCenter/AnthropicDocumentExtractionProvider.php` demonstrates an existing Anthropic document extraction adapter. **Do not confuse it with a general-purpose financial conversational AI implementation.**
- Existing platform settings appear to be a shared/platform-level configuration; this review has **not established per-tenant provider credentials or billing ownership**. Investigate tenant policies/entitlements separately; never assume keys are owned by individual companies.

Required architecture changes/gates:
1. AI-ARCH-0 must inventory Platform Administration integrations, provider registry, integration secret handling, tenant document intelligence policies, administrator vs tenant access rights, and cost/usage tracking before proposing any new schemas or settings.
2. Keep **platform controls** (providers, network readiness, secret rotation, supported models, global budgets, audit) distinct from **tenant controls** (opt-in, feature access, allowed data categories, per-tenant quotas) and **user controls** (RBAC, branch/warehouse scope). Confirm actual ownership and precedence from code, not assumptions.
3. Reuse existing Anthropic/OpenAI/Gemini connections only where their security, policy, capability and cost contracts fit; document-extraction credentials must not silently authorize broader finance/HR data sharing or cross-company access.
4. Provider selection for the AI assistant can be proposed as an **extension of existing platform integration governance**, with distinct feature-specific permissions/policy and metering. Avoid separate unrestricted provider registry, duplicate storage of keys or shadow admin console.
5. Test company A/B isolation with one shared platform API key and different tenant opt-in/limits; absence of an individual tenant key must **not** relax isolation. Verify platform budget vs per-tenant metering and failure modes.
6. Promotional Anthropic API credits belong to the provider billing organization, **not** intrinsically to AWJ tenants. Never expose an owner's personal API key or presume that the credit funds multi-tenant production.

**Scope note:** This section documents code evidence and design consequences; it does not claim existing AI assistant functionality or validated production integration readiness.

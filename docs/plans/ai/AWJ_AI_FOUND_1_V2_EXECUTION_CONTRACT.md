# AWJ Intelligence — AI-FOUND-1 v2: Lean Execution Contract

**Date:** 2026-10-16  
**Status:** Approved planning baseline; implementation requires separately reviewed PRs.  
**Basis:** AWJ Intelligence Master Plan (Draft PR #1543), AI-ARCH-0 evidence audit (Draft PR #1544), original AI-FOUND-1 design contract.  
**Rule:** Minimize delivery friction, not security controls. No redundant infrastructure.

## 1. Confirmed product decisions
- Reuse Platform Administration's encrypted shared provider connections (Anthropic/OpenAI/Gemini); do not create another secret store or administration console.
- Platform funds pilot under hard global and individual tenant spending limits; promotional personal credit is not assumed for tenant production usage.
- Per-tenant explicit enablement and consent per data category; document-extraction consent cannot authorize finance/HR.
- First audience: owners/managers/accountants **subject to existing real permissions**. Initially SAR only.
- Read-only analysis. No financial postings, approvals, payments, outbound messages, autonomous writes, arbitrary SQL or provider-selected URLs/tools.
- No raw chat/prompt/financial or document payload storage by default; bounded, privacy-reviewed metadata audit.
- Default OFF for provider network and paid calls. Real requests need separate privacy, retention, residency, consent, billing and deployment approval.

## 2. Non-negotiable safety gates — not deferred
- Trust Laravel auth, TenantContext and current actor, never tenant supplied by model/client.
- Explicitly reject forbidden branch/warehouse IDs. Existing empty-scope semantics = unrestricted; do not reinterpret as zero access.
- Enforce platform ∩ tenant ∩ actor/field ∩ allowed tool rules **per request and per tool invocation**, including revocations.
- No secrets in browser, logs, prompts or test snapshots.
- Use established deterministic AWJ accounting/reporting services for figures, not model-generated calculations or SQL.
- Financial correctness, tenant isolation, RBAC, scope boundaries and concurrency/fail-closed must be tested in the PR that introduces each behavior.
- Provider routing/fallback must never broaden approved data categories, providers or regions.
- Before any live API call: concurrency-safe global/tenant budget reservations, settlement for success/failure/retries, hard stop and immutable/metadata-only audit. No temporary bypass.

## 3. Small independently reviewable implementation PRs
These are **cohesive boundaries, not mandatory bureaucracy**. If an individual PR becomes too wide, split at a clean interface. Do not artificially split trivial adjacent changes.

### AI-01 — Secure gateway (FIRST)
- Reuse existing auth, platform connection configuration/secret ownership, and policy conventions.
- Introduce an internal Laravel AI assistant gateway, disabled by default, accepting bounded requests.
- Add simple feature-specific policy/consent contract and explicit denied-scope checks; current actor revalidation.
- Mock-only provider, closed tool registry, structured denial/error responses and basic non-sensitive operational audit if safe without schema change.
- No external calls, finance queries, runtime provider activation, broad rewrites or unapproved migrations.
- Tests: platform/tenant OFF, actor denied/revoked, company A vs B, forbidden branch/warehouse, key secrecy, zero external egress.

### AI-02 — Budgets + deterministic financial tools
- Implement **atomic** global/tenant pre-reservation, actual usage settlement and auditable failure/retry counting BEFORE provider egress can ever be enabled. Use minimal reviewed schema changes if essential.
- Expose exactly three controlled wrappers: income statement, receivable aging, payable aging; preserve filters, basis, currency and source links where authorized.
- Security/financial tests: concurrency cap, failures/retries, report parity including rounding/date scope/SAR, denied scopes and tenant isolation.
- Keep live provider disabled until all approval gates pass.

### AI-03 — AWJ Intelligence UI
- Design-system-aligned RTL/LTR, themes Default/Ink/Core plus Light/Dark inheriting the application's existing tokens. Responsive contextual assistant and expandable Intelligence Canvas.
- States: disabled, requires consent, permission denied, budget exhausted, unavailable, loading, financial evidence links.
- UI uses mocks/tests until backend gates passed; no hidden live provider calls.
- Mobile full-screen assistant, desktop contextual panel; no global app-shell redesign.

### AI-04 — Existing Document Center integration
- Reuse intake, scan, storage, extraction provider settings, review, projected/redacted read models, governance and retention.
- Require separate assistant-specific consent for sending document content, even if `allow_document_sending` is set.
- No duplicate upload/extraction infrastructure. Tests for held/purged/quarantined documents, prompt-injection, cross-tenant/branch scope, provider OFF.
- Deployment/runtime readiness for scanner, worker, storage and retention assessed before any production use.

**Hardening:** Fix concrete problems in owning PR or a narrowly-scoped follow-up only; no automatic generic AI-05 project.

## 4. Fast execution process
1. Start each PR from up-to-date `main`, read PR #1543 and #1544 as references (do not assume merged).
2. Implement the smallest coherent code change, run focused tests first, broader security/accounting tests as required, build when frontend changes.
3. Report changed files, checks and results, risks, pending decisions, Base SHA, Head SHA, branch and PR. Draft PR for review.
4. Continue to the next PR without a new comprehensive discovery phase. No merge/deploy/production release without explicit owner permission.

## 5. Open gates (not reasons to block offline coding)
- Contractual privacy, retention, data residency and legal evaluation for each live provider/data class.
- Actual production billing organization and numeric budget caps.
- Production worker/scanner/durable storage health where used.
- Explicit approval before migrations outside task scope, credential activation, paid API calls and deployment.

## 6. First handoff
**Next implement AI-01 only** (mock, default OFF). Do not rebuild Document Center or Help Center, alter accounting calculations or connect a paid provider.

**Reference files/paths:** `app/Services/PlatformIntegrationService.php`, `app/Tenancy/TenantContext.php`, `config/document_center.php`, `app/Services/Reporting/ReportService.php`, `docs/reports/AWJ_AI_ARCH_0_BASELINE_AUDIT.md` (PR #1544), `docs/plans/ai/AWJ_INTELLIGENCE_MASTER_PLAN.md` (PR #1543).

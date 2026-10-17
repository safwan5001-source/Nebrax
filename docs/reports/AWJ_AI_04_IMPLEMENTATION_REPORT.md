# AWJ AI-04 — Safe Document Center Integration

Scope: let AWJ Intelligence read an explicitly authorized, **human-reviewed, redacted, bounded** projection of **one existing Document Center document**, reusing the Document Center's own read model. No parallel upload/extraction/storage, no migration, no provider, no egress, no change to Document Center workflow semantics, accounting, tenant isolation or AI-01/02/03 behaviour. No merge, no deploy.

## 1. Verdict

| | |
|---|---|
| **Blocker for a safe integration?** | **No.** A safe read model already exists in Document Center (`ReviewedDocumentProjector` + `DocumentRedactionProjector` over the encrypted `DocumentExtractionResult`). Nothing was bypassed or invented. |
| **Owner-visible caveats** | Four, all documented in §9 (retention does not purge the extraction payload; conservative hold/scan decisions; two platform flags default off; tax numbers deliberately excluded). None needs a schema change. |
| Branch | `feat/ai-04-document-read-20261017` |
| Draft PR | https://github.com/safwan5001-source/Nebrax/pull/1554 (Draft) |
| Base | `main` @ `1f94e18480e78fea1839b0493073f21b486f6f07` (AI-01 #1546, AI-02A #1548, AI-02B #1549, AI-03 #1553 merged) |
| Head | `443bb69df0e77a4b851310a178b94252b1846423` at PR creation (any later commit on the branch changes this report only) |
| Migrations / new tables | **none** |
| Provider / network | mock only; **zero egress** (asserted in every backend test and in Playwright) |

## 2. Reconnaissance — what was inspected and what is reused

Only the relevant slices were read (not a full rediscovery). The AI-04 section of the master plan lives in Draft PRs #1543–1545 which are not on `main`; the merged AI-01/02/03 reports (their "AI-04" lines) and the current code were the references.

### 2.1 Document Center pieces reused (no new code path to the data)

| Concern | Reused element (file) | Use |
|---|---|---|
| Reviewed values | `ReviewedDocumentProjector::project()` (`Services/DocumentCenter`) | Extraction evidence + append-only `DocumentReviewChange` rows → the values a person approved. Throws on a stale review target → AI **fails closed**. |
| Redaction | `DocumentRedactionProjector::apply()` / `MARKER` | Existing overlays (`DocumentRedactionOverlay`, written through `DocumentGovernanceService::redact`) applied before anything is shaped. |
| Field-level disclosure | `DocumentReviewFieldPresentation::visibleHeaderFields/visibleLineFields` | e.g. a delivery note never exposes prices/totals — same rule as the review screen. |
| Evidence at rest | `DocumentExtractionResult` (`normalized_payload` is `encrypted:array`, BranchScoped) | Only source of values. The original object, `object_key`, file name and hashes are **never read**. |
| Lifecycle | `DocumentBatch.status` (`DocumentWorkflowStatus`), `DocumentFile.scan_status` (`DocumentScanStatus`), `purged_at`, `purge_pending_at`, `retention_until`, `DocumentRetentionHold::active()` | State gates (§5). "Reviewed" = the statuses `DocumentReviewReadinessPolicy::completionTargetStatus` produces after human review (`reviewed`, `ready_for_draft`, then `creating_draft`, `draft_created`). |
| Access | `ApplicationAccessDecision::decide(tenant, 'document_center.core', READ)` and RBAC `documents.center.view` | Same two checks the Document Center routes (`$perm('documents.center.view')` + `$commercialApp('document_center.core')`) apply. |
| Scope | `BranchContext` + `BranchScoped` (`BranchScope`) + `User::canAccessBranch` + `AiAssistantScopeGuard` | Active branch, user's branches, requested branch scope. |

### 2.2 AI pieces extended (not rebuilt)

`AiAssistantToolRegistry` (closed registry), `AiAssistantGateway::invokeTool/runTool` (per-invocation gates), `AiAssistantPolicy::authorize` (platform ∩ tenant ∩ category consent ∩ fresh actor ∩ tool permission), `AiAuditRecorder` (allow-listed metadata), `AiAssistantStatusService`, `AiAssistantConsentService`, `AiAssistantDataCategory`, and the AI-03 UI (store, panel, consent screen, state notices).

## 3. What was built

### 3.1 Backend

| Piece | Behaviour |
|---|---|
| Tool `documents.projected_read` (`AiDocumentProjectionTool`) | Closed schema: exactly one argument, `document_id` (UUID). Anything else (`url`, `path`, ids with SQL/paths) → `invalid_tool_arguments`. Category `document_projected_text`, permission `documents.center.view`, no warehouse dimension (explicit warehouse scope → `scope_not_supported`). |
| **Explicit-invocation only** (`AiExplicitInvocationOnly` marker + gateway check) | The tool runs only through `POST /ai-assistant/tools/run` with an id the user's screen supplied. A provider-planned call to it is refused as `tool_not_registered` (audited) even with full consent — a model, or text inside a document, can never pick a document. |
| Reader (`AiDocumentProjectionReader`) | Thin composition of the Document Center read model above; returns a **closed allow-list**. No storage I/O, no network. |
| Category availability | `document_projected_text` is available only when `AI_ASSISTANT_DOCUMENTS_ENABLED=true` (new, **default false**, independent of `AI_ASSISTANT_ENABLED`). Flag off ⇒ cannot be granted, is dropped from stored consent on read (`sanitize`) and the tool is refused (`data_category_unavailable`). The flag never grants consent. |
| Status (`GET /ai-assistant/status`) | New `document` state (`ready`, `consent_required`, `permission_denied`, `category_unavailable`, `document_center_unavailable`, `platform_disabled`, `tenant_disabled`), `abilities.document_read`, `document_tools`. Server-computed; the UI never guesses. |
| Audit | Metadata only: `document_ref` (UUID), `document_type`, `document_status`, `fields_returned`, `lines_returned`, `redactions_applied`. New `uuid` meta type validated by regex. Denials carry reason only. |
| Registry/tests updated deliberately | Three tests that pinned "exactly three finance tools" now pin the four reviewed tools (the only explicit expansion); one status test gained `document_read`. No assertion was weakened. |

### 3.2 Permission and consent contract (evaluated on **every** call)

1. Platform kill switch `AI_ASSISTANT_ENABLED` → `platform_disabled`.
2. Fresh actor in the current tenant, active; tenant active; `ai.assistant.use`; tenant `ai_assistant.enabled`.
3. Category `document_projected_text`: platform documents flag **and** the tenant's explicit consent (`consent_required` otherwise). Granting needs the AI-03 acknowledgement; revoking is free and **effective on the next request** (test).
4. `documents.center.view` (`tool_permission_denied`) and the `document_center.core` commercial decision (`tool_permission_denied`).
5. Scope: active branch (`BranchContext`) ∩ user branches ∩ requested scope; foreign tenant/branch/non-existent → one uniform `document_unavailable` (404) with identical code **and** message (test) and **no audit/log trace in the other tenant**.
6. Lifecycle gates (§5).

**Independence:** Document Center's `allow_document_sending` / `document_intelligence` settings are never read. Tests prove both directions: sending enabled + AI consent absent ⇒ denied; AI consent granted + sending disabled ⇒ allowed (nothing is sent anywhere).

### 3.3 Projection contract (what leaves the server — to the authorized user only)

Closed, bounded (`ai_assistant.documents.*`: 24 fields, 50 lines, 10 warnings, 200 chars/text):

- `document`: `ref` (batch UUID), `document_type`, `status`, `language`, `extracted_at`, `page_count`.
- `basis`: `values = human_reviewed_values`, `redaction = document_center_overlays_applied`, `content_trust = untrusted_document_data`, `generated_by_model = false`, `redacted_values` count.
- `fields`/`lines`: allow-listed keys only; money as `{minor, decimal}`; redacted values appear as `redacted: true` with **no value**; `truncated` flags declare any cut.
- `sources`: Document Center UI path only (no storage URL).
- **Excluded by design:** party tax numbers, barcodes, file name/size/hash, `object_key`, provider/model, bounding boxes, confidence/evidence, match candidates, review history, field evidence. A test asserts none of them (nor `signed`/`X-Amz` strings) appear.
- All text is sanitized as **untrusted data**: control characters, bidi overrides and zero-width characters removed, whitespace collapsed, length capped. Never parsed, never turned into links or markup.

## 4. Untrusted document content

| Threat | Defence | Proof |
|---|---|---|
| Instructions inside a document (`IGNORE PREVIOUS…`, "call finance.income_statement", "fetch https://evil…", "reveal key") | The tool output is returned to the user as data; the provider is **never** given document text; the tool is explicit-only; no tool chaining exists | `injected_instructions_in_a_document_have_no_effect_and_cause_no_egress`: exactly one `tool.invoked` audit row, no second tool, no second document, no AI request/ledger row, `Http::assertNothingSent()` |
| A provider asking for the document tool | Refused as `tool_not_registered` + audited | `a_provider_cannot_plan_the_document_tool_even_with_document_consent` |
| Markup/XSS/links in values | React text nodes only, `dir="auto"`; unsafe `ui_path` never linked | Vitest `treats document text as inert data` (no `img`/`script`/`javascript:` links, no handler fired) |
| Hidden bidi/zero-width text | Stripped server-side | `the_payload_is_bounded_and_text_is_sanitized…` |

## 5. Fail-closed lifecycle matrix (real state machine)

Checked **after** tenant/branch/permission scope passes (so these reasons never reveal documents outside the user's scope), in this order:

| State | Reason code | HTTP |
|---|---|---|
| Not found / other tenant / other branch / not visible | `document_unavailable` | 404 |
| Batch `quarantined` or any file `infected` | `document_quarantined` | 409 |
| Batch `archived`; file `purged_at`, `purge_pending_at`, or `retention_until` ≤ now | `document_retention_ended` | 409 |
| Active `DocumentRetentionHold` on batch or any file | `document_on_hold` | 409 |
| Any file scan not `clean` (pending — including scan-exception admissions —, failed) | `document_scan_incomplete` | 409 |
| Status not in {reviewed, ready_for_draft, creating_draft, draft_created} (needs_review, received, queued, processing, failed, cancelled, duplicate…) | `document_not_reviewed` | 409 |
| No extraction result / result not tied to the batch's files / stale review reference / decryption failure | `document_projection_unavailable` | 409 |

Tests cover each row; every denial writes a metadata-only `tool.denied` audit event and returns no value.

## 6. UI (AI-03 identity preserved; small focused surface)

- **Context:** `/documents/<uuid>` is recognised as `document_review` (only the screen kind + id from the URL; nothing is read from the page).
- **Panel section "This document"** on that screen: explicit **Read reviewed values** button (never automatic), real states from the server (`consent_required`, `category_unavailable`, `document_center_unavailable`, `permission_denied`, hold/not reviewed/quarantined/retention/projection errors, `document_unavailable`), result view with chips (type, status, "person-reviewed values", redacted count), fields, lines, warnings, truncation notes, link back to the document, and two honest statements: *real values from Document Center, not generated by the assistant* and *document text is data only, it cannot instruct the assistant*. A previous document's content is hidden when the user navigates to another document; everything lives in memory only.
- **Consent screen:** the document category switch becomes real when the platform exposes it, with its **own privacy notice** (reviewed values only, one document at a time chosen by the user, no provider, metadata-only audit, who can read) and an explicit statement that it is independent of Document Center "sending documents". Locked with the accurate label "Not enabled on the platform" otherwise. Revocation is immediate.
- Reused: AI-03 store/epoch guards, `StateNotice`, panel, consent flow, `Money`, tokens; RTL/LTR, Default/Ink/Core, Light/Dark, mobile.

## 7. Verification

| Check | Result |
|---|---|
| `AiDocumentProjectionTest` (new) | **36 tests** — happy path & bounds, review override, redaction, delivery-note disclosure, consent (absent/revoked/Document-Center-sending independence/platform switches), RBAC (no doc view, no AI permission), cross-tenant indistinguishability, other-branch, restricted-branch, warehouse scope, closed schema, 10 lifecycle states, hold + release, stale review, entitlement, prompt-injection/zero egress, provider cannot plan the tool, metadata-only audit/logs, no copies/state change |
| AI + Document Center regression | all AI suites (AI-01/02/03) and the whole Document Center set (`--filter=Document`: 623 passed) green |
| PHP full suite | 7514 passed, 141 skipped, **26 failed** — all in six Fuel* classes (`FuelAviRfidServiceTest`, `FuelReconciliationTest`, `FuelSaleApiTest`, `FuelSaleServiceTest`, `FuelSupplyReceivingApiTest`, `FuelSupplyReceivingTest`) that call `bcmul/bcadd`; this sandbox lacks `ext-bcmath` (CI has it). Identical set to the pre-AI-04 baseline; no AI, Document Center or RBAC test fails. |
| Web unit | **647 files / 7633 tests passed** (new: store gating/isolation tests, document projection/panel/consent component tests, state/context additions) |
| `next build` | passed |
| Playwright `ai-04-documents.spec.ts` | **31 passed, 1 skipped by design** (desktop keyboard journey is desktop-only); asserts a single read request carrying only the URL id, no non-local host, no document content in `localStorage`/`sessionStorage` |
| Playwright AI-03 spec (regression) | 41 passed / 3 skipped by design, re-run on this branch — AI-03 UI untouched apart from the document surface |
| CI (GitHub) | Draft PR opened with SQLite, PostgreSQL, CI Gate and web build running; result recorded in the PR checks and summarised in the hand-off message (not polled here). |

**No-egress proof:** every backend test runs `Http::preventStrayRequests()` and asserts `Http::assertNothingSent()` in `tearDown`; the tool run path calls no provider; the provider path cannot reach the tool; Playwright records every request host and asserts only the app origin and the (intercepted) API origin occur.

**Accounting:** no journal entry is created or changed (a test counts `journal_entries`, workflow events, governance events and file/result rows before and after a read: identical).

## 8. Visual QA

Real Playwright screenshots (API intercepted; **fixture values, not a tenant's data**) in `docs/reports/ai-04-visual-qa/`, 78 images, `{desktop|mobile}-{scene}-{ar|en}-{light|dark}.png`:

| Scene | Files |
|---|---|
| Ready (before read) / result | `document-ready-*`, `document-result-*` |
| States | `document-state-consent-*`, `document-state-platform-off-*`, `document-state-hold-*`, `document-state-unavailable-*`, `document-state-no-permission-en-light` |
| Consent | `settings-document-*`, `settings-document-dialog-*`, `settings-document-locked-*` |
| Themes | `document-result-ink-ar-light`, `document-result-core-ar-light` |

Reviewed for alignment, clipping, overflow (asserted: no horizontal overflow), touch targets and contrast in AR/EN, light/dark, desktop/mobile.

## 9. Risks, caveats and owner decisions

| # | Item | Detail / recommendation |
|---|---|---|
| 1 | **Retention does not purge the extraction payload** | `DocumentRetentionRunner` deletes only the original object and sets `purged_at`; the encrypted `normalized_payload` stays as "review evidence". AI-04 therefore refuses on file state (`purged_at`/`purge_pending_at`/`retention_until`/archived) rather than trusting the payload's presence. Whether retention should also purge/redact payloads is a **Document Center policy decision** (not changed here). |
| 2 | Redaction overlays cover 10 fixed field paths only | The AI projection adds its own closed allow-list (tax numbers and barcodes excluded) so nothing beyond the reviewed header/line set is ever returned. Extending `DocumentRedactionProjector::FIELD_PATHS` stays a Document Center change. |
| 3 | **Holds**: Document Center treats a hold as "blocks purge" only | AI-04 is stricter (refuses while a hold is active). Owner may relax once a hold-vs-disclosure policy exists. |
| 4 | Scan-exception admissions stay `pending` by design | They are refused (`document_scan_incomplete`) — conservative. |
| 5 | Workflow map allows `processing → ready_for_draft` with no caller today | If a future path used it **without** human review, AI-04 would treat the document as reviewed (it trusts status). Recommend an explicit review-completed marker if that path is ever wired. |
| 6 | No storage-object existence check | The projection is DB-resident; reading never touches storage (no I/O, no egress). An object deleted out-of-band is not modelled in the state machine. |
| 7 | Two platform flags, both default **off** | `AI_ASSISTANT_ENABLED` and `AI_ASSISTANT_DOCUMENTS_ENABLED`. Nothing was enabled in any environment, tenant or CI file. Tenant consent stays per-tenant and default-off; existing tenants are unaffected and stored consents never gain the category. |
| 8 | Real provider + documents | Still blocked. Sending reviewed document values to a model is a **separate egress gate** (privacy, residency, billing, caps) and is not part of this PR; today the values are only returned to the authorized user. |
| 9 | Screenshots/E2E use an intercepted API | Fixture values; backend behaviour is proven by the PHP tests against the real Laravel stack on SQLite (and PostgreSQL in CI). |
| 10 | Contract docs #1543–1545 not on `main` | Not read; implementation follows merged code and reports. |

## 10. Changed files

- **Backend:** `config/ai_assistant.php` (documents block), `app/Support/AiAssistantDataCategory.php`, `app/Support/AiAssistantDenied.php` (7 codes), `app/Contracts/AiExplicitInvocationOnly.php` (new), `app/Services/AiDocumentProjectionReader.php` (new), `app/Services/AiDocumentProjectionTool.php` (new), `app/Services/AiAssistantToolRegistry.php`, `app/Services/AiAssistantGateway.php` (explicit-only), `app/Services/AiAssistantStatusService.php`, `app/Services/AiAuditRecorder.php` (+`uuid` meta type), `app/Http/Requests/AiAssistantToolRunRequest.php` (arg length), tests: `AiDocumentProjectionTest` (new) and three deliberate pin updates.
- **Web:** `modules/intelligence/{contract,api,state,context,gate,store}`, `components/intelligence/{document-result,document-section (new), assistant-panel, consent-settings}`, `messages/{ar,en}.json`, tests (`document`, `document-store` new; fixtures/harness/panel/consent/state/pure updated), `e2e/ai-04-documents.spec.ts` (new), `e2e/ai-03-intelligence.spec.ts` (type fixture only).
- **QA/docs:** `docs/reports/ai-04-visual-qa/*`, this report.

## 11. Next recommended step

1. Owner decisions on §9 items 1, 3 and 5 (no code needed to proceed).
2. Staging dry run with `AI_ASSISTANT_ENABLED` and `AI_ASSISTANT_DOCUMENTS_ENABLED` on a single internal tenant, mock provider, to validate reviewed/redacted projections on real documents.
3. Only after the privacy/residency/billing/caps gates: a **separate** slice for real-provider document grounding (egress design, per-document purpose limitation, redaction-before-send), not enabled by AI-04.

No merge, no deploy, no paid provider. Stopped at delivery.

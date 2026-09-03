# AWJ / نبراس — Gemini Document Extraction Pilot — Implementation Report

**Task:** Gemini Document Extraction Pilot (first production-shaped provider path on the existing Document Intelligence foundation)
**Branch:** `claude/document-intelligence-foundation-japfgd`
**Base SHA:** `b7638d8edf3c676771e67b2dc1c39f5f56644154` (`main` after PR #630 merge)
**Scope:** Extraction + human review only. **No** accounting/inventory posting, **no** ZATCA/numbering changes, **no** entitlement/plan/allowlist gating, **no** physical retention execution, **no** merge/deploy. No live Gemini key used.

---

## 1. Executive Summary

The Gemini provider path was found **already implemented end-to-end** on `main`: a provider-independent extraction abstraction (`DocumentExtractionProvider` + registry), a production-shaped `GoogleGeminiDocumentExtractionProvider` (schema-constrained structured output, secret header, error mapping, usage metadata), a queue-based lifecycle (`ExtractDocumentFile` → attempts → results → workflow → `needs_review`), a secure platform integration (`document_ai`) with encrypted+masked credentials and a connection test, and the platform admin UI + i18n.

The single decisive gap against this task's **§7 processing gate** was that the extraction pipeline consulted only the **platform** engine/network/provider policy and **never consulted PR #630's per-tenant `DocumentIntelligencePolicy`** (`processing_enabled` + `allowed_document_types`). A document could therefore reach the provider without the tenant having enabled intelligent processing or allowed that type.

This PR closes that gap with a minimal, in-scope change: the extraction gate now requires the tenant's #630 decision **in addition to** the platform policy, at both the queue step and (defensively) inside the worker. It also strengthens the shared, provider-independent extraction instruction for handwriting/provenance/anti-fabrication (directly serving the delivery-note pilot goal), and adds focused tests for the gate, delivery-note handwritten extraction through the real (mocked) Gemini path, fail-closed races, and secret isolation. No new settings, upload, review, or provider systems were created.

---

## 2. Existing State Found

| Area | Already present on `main` (base b7638d8) |
|---|---|
| Provider abstraction | `App\Contracts\DocumentExtractionProvider` + `DocumentExtractionProviderRegistry` (openai / anthropic / google_gemini). |
| Gemini provider | `GoogleGeminiDocumentExtractionProvider`: real `v1beta/models/{model}:generateContent`, `x-goog-api-key` header (secret never in URL), `responseMimeType: application/json` + `responseSchema`, 401/403/429/5xx mapping, usage metadata. |
| Extraction lifecycle | `DocumentExtractionService::queueExtractions/process`, `ExtractDocumentFile` job (unique, bounded, context-restoring), attempts, usage events, versioned `DocumentExtractionResult`, workflow → `needs_review`. |
| Structured validation | `DocumentExtractionNormalizer` validates provider output server-side, minor-unit money, per-field `field_evidence` (confidence/source/page/bbox), keeps nulls (no fabrication), fails safe on malformed JSON. |
| Platform integration | `document_ai` key in `PlatformIntegrationService`; `configuration` is `encrypted:array` + `$hidden`; secrets masked (`••••••••XXXX`), never re-returned; `clear_api_key`; central per-provider `model`; primary/fallback; connection test with `last_test_status`; password re-auth; audit events. |
| Network gate | `DocumentProviderNetworkGate` (`document_center.ai.provider_network_enabled`, default **false** → fail-closed). |
| Platform admin UI + i18n | `web/src/app/platform/integrations/` (incl. `providerGoogleGemini`, ai-provider actions/tests). |
| Tenant settings (#630) | `DocumentIntelligencePolicy` (`processing_enabled`, `allowed_document_types`, `shouldProcessDocumentType`, retention modes) + `GET/PUT /document-intelligence-settings`. |
| Retention | Four-mode policy + `DocumentRetentionPlanner` safety; physical execution deferred. |

---

## 3. Gap Analysis

| # | Requirement | Status on base | Action in this PR |
|---|---|---|---|
| §7.2 | Tenant `processing_enabled` controls actual use | **Not wired** into extraction | **Wired** in `queueExtractions` + `process` |
| §7.3 | Document type in tenant `allowed_document_types` | **Not wired** | **Wired** via `shouldProcessDocumentType()` |
| §7 (last) | AI-disabled docs remain accessible | held (extraction just skipped) | preserved + tested |
| §9/§10 | Delivery-note handwriting / provenance / anti-fabrication | contract supported it; prompt did not request it explicitly | **Instruction strengthened** (printed/handwritten/mixed/unknown + no-fabrication) |
| §21 | Tenant isolation / secret isolation for the new path | broadly tested | **Added** gate + secret-isolation tests |
| §5/§6/§8/§11/§12/§19 | Platform integration, provider independence, PI/DN extraction, structured output, central model, admin UX | **Already present** | reused as-is (no change) |

Everything else the task lists was already satisfied by the foundation and required no change.

---

## 4. Changes Made

- **Platform administration / integrations:** none (existing `document_ai` integration reused).
- **Provider abstraction:** none (existing registry reused).
- **Gemini provider:** none (existing implementation reused).
- **Processing / jobs:** `DocumentExtractionService` now enforces the tenant #630 gate.
  - `queueExtractions()`: returns 0 (does not queue) unless `DocumentIntelligencePolicy::forTenant()->shouldProcessDocumentType($batch->document_type)`.
  - `process()`: re-checks the same gate inside the worker and fails closed (`extraction_not_permitted`) with **no** provider call if the tenant disabled processing or removed the type between queue and run.
  - New private helper `tenantAllowsExtraction()` — the gate is independent of platform policy and of retention.
- **Extraction contracts:** `DocumentExtractionNormalizer::instruction()` extended (provider-independent) to (a) note printed+handwritten Arabic/English mixed content, (b) request per-field `source` of exactly printed/handwritten/mixed/unknown with `unknown` when unsure, (c) forbid fabrication (null + lower confidence instead of guessing). Schema/parsing unchanged.
- **Purchase invoice / delivery note:** no contract changes; both flow through the same real provider path. The gate + instruction make delivery-note handwriting reviewable.
- **Review Workspace:** unchanged (real extraction already feeds it).
- **APIs:** none added/changed.
- **i18n:** none needed (platform + tenant strings already present).
- **Security / tenant isolation:** gate reads the tenant decision under restored tenant context inside jobs; added isolation tests.
- **Diagnostics:** reused existing attempts/usage/audit; the tenant skip produces no attempt and no provider traffic.
- **Tests:** 1 new suite + adaptation of the existing extraction suite (see §11).

---

## 5. Files Changed

| File | Purpose |
|---|---|
| `app/Services/DocumentCenter/DocumentExtractionService.php` | Enforce the tenant #630 gate at queue + worker (fail-closed) |
| `app/Services/DocumentCenter/DocumentExtractionNormalizer.php` | Strengthen shared instruction: handwriting/provenance/anti-fabrication |
| `tests/Feature/GeminiExtractionTenantGateTest.php` **(new)** | Gate on/off, type gate, delivery-note handwritten extraction via mocked Gemini, fail-closed race, secret isolation |
| `tests/Feature/DocumentExtractionProviderTest.php` | Adapt `authorizedTenant()` to enable the now-required tenant #630 preconditions (not a weakening — it configures the new gate) |

---

## 6. Database Changes / Defaults / Backward Compatibility

**No migrations.** The gate reuses the existing PR #630 `tenants.settings.document_intelligence` keys and the existing `platform_integration_settings.document_ai` row. Defaults preserve current behavior: tenant `processing_enabled=false` and `allowed_document_types=[]` by default, so extraction stays off until a tenant explicitly opts in — matching the fail-closed platform network gate. No entitlement tables were added.

---

## 7. Gemini Configuration

- **Configuration location:** platform integration key `document_ai`, provider `google_gemini`, managed only through the existing higher-level platform admin (`/api/platform/integrations`), never tenant-facing.
- **Secret protection:** `configuration` cast `encrypted:array` and `$hidden`; API key lives under `providers.google_gemini.api_key`, masked to `••••••••XXXX` on read, never re-returned in plaintext, cleared via `clear_api_key`, and sent to Google only as the `x-goog-api-key` header (never in the URL/query). Never logged or committed. Confirmed by tests (raw DB row and normalized payload contain no secret).
- **Selected default model & rationale:** recommended default **`gemini-2.5-flash`** — a current Gemini model with strong image/document understanding, native Arabic + English (incl. handwriting), first-class structured output (`responseSchema`), and the best latency/cost balance for a pilot (vs. `-pro`). The model is configured **centrally** per provider in the platform integration; extraction never hard-codes a model and never silently falls back — an explicit non-empty model is required (`validateConfiguration`), which is safer for a pilot. Verify the exact model id against the live Gemini API at real-pilot time.
- **Provider enable/disable:** platform `engine_enabled` + per-provider `enabled`/`allow_document_sending`; connection test writes `last_test_status` only.
- **Separation from tenant settings:** platform controls the provider/credential/model; tenants control only #630 `processing_enabled` / `allowed_document_types` / retention. The two are enforced together in the gate but stored and administered separately.
- **No real secret** appears anywhere in this PR.

---

## 8. Tenant Eligibility

**All tenants are eligible for Gemini Document Intelligence by default in this phase; no entitlement, allowlist, plan, credit, or per-tenant provider-eligibility gating was implemented.** Actual use is governed solely by the existing #630 tenant settings (processing on/off + allowed types + retention) on top of the platform provider being enabled/operational.

---

## 9. Extraction Safety

- **Structured validation:** provider output is schema-constrained (Gemini `responseSchema`) and re-validated server-side by `DocumentExtractionNormalizer` before any trusted structure is persisted; malformed/invalid output raises a safe, non-retryable-or-retryable `DocumentProviderException` and never becomes a trusted value.
- **Confidence / review:** per-field `field_evidence` (confidence basis points + source) and per-line confidence/source are preserved; batches move to `needs_review` (no silent confirmation).
- **Missing values / anti-fabrication:** nulls are preserved; the instruction now explicitly forbids guessing and requires lowering confidence instead. Tested with a handwritten delivery note whose customer code is missing (stays `null`).
- **Untrusted evidence:** AI output remains untrusted extracted evidence until human review; no posting occurs.

---

## 10. Delivery Document Readiness

`delivery_note` is a first-class type and now flows through the real (mocked-in-CI) Gemini path when the tenant allows it. Handwritten/mixed/unknown provenance and handwritten numbers are representable and reviewable (tested). No stock movement, accounting entry, or delivery-note resulting-record workflow is created — that mapping onto AWJ's existing delivery-note domain remains a documented future integration point, deliberately out of scope here.

---

## 11. Tests — Commands & Results

Environment: repo is core-only; `setup.sh` builds a full Laravel app (SQLite) to run tests.

| Command | Result |
|---|---|
| `php artisan test --filter=GeminiExtractionTenantGateTest` | **5 passed (48 assertions)** |
| `php artisan test --filter=DocumentExtractionProviderTest` | **8 passed (80 assertions)** — existing suite green under the new gate |
| `php artisan test --filter='Document\|PlatformIntegration\|Gemini'` | **274 passed**, 1 skipped, 1 failed (env-only: `pdfinfo` missing) |
| `php artisan test` (full) | **2194 passed**, 1 skipped, **28 failed — all environmental/harness, none from this diff** |

New gate coverage: processing-disabled → no provider call & doc stays accessible; type-not-allowed → skipped; allowed delivery note → reaches Gemini, handwritten/uncertain fields represented, missing not fabricated, batch → `needs_review`, no journal/stock rows; disable-after-queue → worker fails closed with no provider call; tenant token cannot reach platform integrations and sees no secret.

The 28 full-suite failures are the same pre-existing environment/harness gaps, unrelated to this change:
- **24 ×** `Fuel*` → `Call to undefined function bcmul()` (the `bcmath` PHP extension is not installed in this sandbox; CI installs it).
- **3 ×** `ZatcaSubmission*` → `Class "App\Jobs\Accounting\SendZatcaSubmission" not found` (pre-existing `setup.sh` gap: it copies `app/Jobs/DocumentCenter/` but not `app/Jobs/Accounting/`; affects `main` identically).
- **1 ×** `DocumentCenterSecureIntakeTest` (valid-PDF page count) → `pdfinfo`/poppler-utils not installed locally (CI installs `poppler-utils`).

None of my changed files are in the Fuel, ZATCA-submission, or PDF-intake paths.

---

## 12. Build / CI

No frontend changes were made in this PR (the platform AI integration UI and i18n already exist on `main`), so the web build is unchanged from `main`. `.github/workflows` unchanged; CI installs `bcmath`, `poppler-utils`, and `libxml2-utils`, and the Accounting job class is present in CI, so the local-only failures above are expected to pass there. CI requires **no** live Gemini key or external Gemini network call (tests mock the HTTP client; the network gate defaults to false).

---

## 13. Safety Review

| Concern | Impact |
|---|---|
| **Accounting** | None. No ledger postings, no financial calculations; draft-only boundary untouched. |
| **Inventory** | None. No stock movements. |
| **ZATCA** | None. No ZATCA/numbering changes. |
| **Tenant isolation** | Strengthened. Extraction now additionally requires the tenant's own decision; jobs restore tenant/branch context before reading it; tests assert cross-tenant/secret isolation. |
| **Permissions** | Unchanged. Platform integration remains platform-admin-only; tenant token is blocked (403) from platform integrations. |
| **Secrets** | Gemini credential stays server-side, encrypted, masked, never returned/logged/committed; verified by tests. |
| **Storage** | Unchanged. Originals read from existing Document Center storage; no second upload path; no public URLs. |
| **Backward compatibility** | Preserved. No migrations; #630 defaults keep extraction off until opt-in; existing extraction suite green after adapting its setup to the new required precondition. |

---

## 14. Risks / Remaining Work

- **Real-world accuracy must be evaluated using Safwan's sample invoices and handwritten delivery documents** in a controlled pilot after review; extraction quality on skewed/low-contrast/handwritten Arabic is unproven until then.
- Retention physical deletion / attachment-copy execution remains **deferred** (policy/state only).
- Delivery-note resulting-record workflow remains **deferred** (documented integration point only).
- Entitlement/billing/allowlist intentionally **deferred** (all tenants eligible in the pilot).
- Manual pilot harness (§24): not added — the existing queue-based path plus the platform connection test already provide `original → Gemini → Review Workspace` without a debug endpoint; adding one was judged unnecessary surface area for this phase.
- Model id (`gemini-2.5-flash`) should be re-verified against the live Gemini API at pilot time.

---

## 15. Git Information

- **Branch:** `claude/document-intelligence-foundation-japfgd`
- **Base SHA:** `b7638d8edf3c676771e67b2dc1c39f5f56644154`
- **Head SHA:** `82836f434dfa26637ec1384ace7f905fdad94b13`
- **PR:** [#632](https://github.com/safwan5001-source/Nebrax/pull/632) — opened for review, **not merged, not deployed**

---

## 16. Recommended Next Step

A **controlled real-document pilot/evaluation** after review: with a real Gemini key provided by Safwan (never committed), the network gate enabled in a safe environment, and a small labelled set of real purchase invoices and handwritten delivery notes, measure field-level accuracy, confidence calibration, and review-time savings. Do not enable production credentials without Safwan's explicit authorization. Do not implement automatically.

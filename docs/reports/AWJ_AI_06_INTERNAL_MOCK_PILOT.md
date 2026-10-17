# AWJ AI-06 — Internal Mock Pilot (readiness verification)

Scope: prepare and verify a hands-on internal pilot of AWJ Intelligence with the deterministic **mock** provider on the current environment (demo data). **No Railway change, no variable change, no provider, no merge, no deploy, no migration, no company data touched.** Verification used isolated test databases with synthetic data, Playwright with an intercepted API, and read-only Railway metadata (variable **names** only).

## 1. Verdict

| Target | Verdict | Condition |
|---|---|---|
| **Internal mock pilot — finance tools** (income statement, receivables aging, payables aging) on the current environment | **CONDITIONAL GO** | (C1) Owner confirms the environment holds **demo tenants only** — there is no per-tenant allowlist, so once the platform flag is on, *any* tenant owner/admin can opt in themselves (§5-F1). (C2) Owner approves the single Railway variable change and the redeploy it causes (§6). |
| Internal mock pilot — **document reading** | **GO for code, NO-GO for the pilot until data exists** | Needs the second flag, tenant consent, a *human-reviewed* demo document with a clean scan. Not verifiable from here (§4.4, §6 phase B). |
| Live paid provider | **NO-GO** (unchanged from AI-05) | Not implemented; privacy/residency, billing owner, numeric caps and approval absent. |

No defect requiring a code fix was found. The only code added is a pilot-journey test (no production code changed).

## 2. Baseline

| Item | Value |
|---|---|
| Base (`main`, verified live, not advanced) | `6258840b7fef68fbc533f78176006c0cd7b1ad9d` (AI-04, #1554) |
| Branch | `feat/ai-06-internal-mock-pilot-20261017` (Draft PR) |
| Head | `@@HEAD@@` |
| Environment tested | PHP 8.3 / SQLite via the assembled Laravel app; Vitest; Playwright Chromium (intercepted API). PostgreSQL and bcmath-dependent suites run in CI only. |
| Not tested | physical devices, real keyboard/Android Back, real provider, production data, load. |

## 3. Gateway and flags — current state (requirement 1)

| Item | State | Evidence |
|---|---|---|
| `AI_ASSISTANT_ENABLED` on `nibras-api` / `awj-scheduler` | **VERIFIED OFF by absence** (variable not defined → code default `false`) | Railway `get-service-config`, variable names only (36 and 13 names, no AI flag); values never read |
| `AI_ASSISTANT_DOCUMENTS_ENABLED` | **VERIFIED OFF by absence** (same) | same |
| `AI_ASSISTANT_PROVIDER` | not defined → default `mock`; any other value fails closed (`provider_unavailable`), no network | `config/ai_assistant.php`, `AiPaidProviderDisabledTest` |
| Deployed code | all 5 production services run `6258840` (AI-01…AI-04 live, dormant) | Railway `list-deployments` |
| Railway source/branch | still `main` for all five; **A4 (gate cutover) not done**; `production` git branch exists at `6258840` | Railway `describe-environment`, `git ls-remote` |
| AI tables exist in production | yes — `ai:prune-records` ran **DONE** at 2026-10-17 03:40 UTC (it queries `ai_audit_events`/`ai_requests`; a missing table would fail) | scheduler log filter |
| AI traffic in production | not assessable (HTTP log filter returned nothing even for `/api/auth`, so absence is not evidence) | — |
| UI exposure while platform is OFF | sidebar shows "Intelligence" to roles with `ai.assistant.use`; the page shows an honest "platform disabled" state and makes no chat/finance request | `sidebar.tsx:321`, e2e platform-off screenshots |

## 4. Requirements to run the mock (requirement 2)

### 4.1 Layers that must all pass, on **every** call (fresh actor each time)

| # | Layer | What it takes | Where |
|---|---|---|---|
| 1 | Platform switch | `AI_ASSISTANT_ENABLED=true` (the only variable needed for finance; provider defaults to `mock`) | Railway, `nibras-api` (read by `config:cache` → **needs a redeploy/restart**) |
| 2 | Tenant opt-in | Settings → Intelligence: *enabled* + acknowledgement of the privacy notice | owner/admin (`ai.consent.manage`) |
| 3 | Category consent | `assistant_messages` (chat) and `financial_summary` (finance tools) — independently | same screen |
| 4 | User permission | `ai.assistant.use` — owner/admin (`*`) and the **default accountant** have it; staff/custom roles do not unless granted | RBAC |
| 5 | Tool permission | finance tools additionally need `reports.view` (partner names need `partners.view`); documents need `documents.center.view` | RBAC, re-checked per call |
| 6 | Tenant currency | **SAR only** (`currency_unsupported` otherwise) | tenant record |
| 7 | Active subscription | normal API subscription middleware | existing |

### 4.2 Budgets

None are needed for the mock: it is `billable=false` **by design**, so no cap/budget row is created or consulted, and tool runs create no request/budget record (tested: `a_tool_run_never_calls_a_provider_nor_creates_a_request_or_budget_record`). A billable provider would require platform **and** tenant caps (zero/missing = refused) — not part of this pilot, and **not** tested through a real adapter.

### 4.3 What the owner sees if a layer is missing (honest states)

`permission_denied` · `platform_disabled` · `tenant_disabled` · `consent_required` · `currency_unsupported` · `category_unavailable` (documents) · `document_center_unavailable` — all produced by the server status endpoint; the UI makes no request unless status is `ready`.

### 4.4 Documents (extra)

Second flag `AI_ASSISTANT_DOCUMENTS_ENABLED=true` + tenant consent `document_projected_text` (cannot be granted while the flag is off: 422) + `documents.center.view` + Document Center entitlement + a document that is **human-reviewed** (immutable `review_completed` evidence tied to the latest extraction), scan `clean`, not held/quarantined/expired/archived. The scheduler (`documents:sweep-scans`, healthy) and `awj-clamav` (online) exist in production. Whether a suitable demo document exists is **unknown**.

## 5. Findings

| ID | Severity | Finding | Recommendation |
|---|---|---|---|
| F1 | **Medium (pilot gating)** | No per-tenant allowlist: the platform flag is global. With it on, every tenant's owner/admin can enable the mock from Settings. Harmless technically (no egress, read-only, "Demo" label) but it is product exposure. | Pilot only if the environment is demo-only (C1); otherwise a small follow-up PR adds an optional `AI_ASSISTANT_PILOT_TENANT_IDS` allowlist (not done: design change, out of scope). |
| F2 | Low | The Railway variable change redeploys `nibras-api`; with no gate yet, the boot runs `migrate --force` for whatever commit is built. Today `main` = deployed commit and PR #1555/#1556 are docs/CI-only, so **no migration is pending** — verify again at the time. | Make the change right after confirming `main == deployed SHA` (runbook §9), or after gate cutover A4. |
| F3 | Info (UX copy) | Canvas shows a "From assistant" chip beside the period while the sentence below says the figures come straight from the reports. Clear enough, but the chip could read "Read from reports". | Optional copy tweak; not a defect. |
| F4 | Info | AI-05 follow-ups still open: prune output to `/dev/null`, lazy reservation reaper, app-level audit immutability (all irrelevant to an unbillable mock). | Before any billable provider. |
| F5 | Info | One Playwright mobile case flaked once in AI-05; this run 72/72 passed (4 skipped by design). | Monitor. |

No Critical/High functional or security defect found; **no code fix was needed or made.**

## 6. Safe activation — **requires explicit owner approval; none was executed**

Phase A — finance (recommended first):
0. Confirm C1 (demo-only environment) and that `main` equals the deployed SHA with no pending migration.
1. Railway → `nibras-api` → Variables: add `AI_ASSISTANT_ENABLED=true` (nothing else; do **not** set `AI_ASSISTANT_PROVIDER` or the documents flag). Railway redeploys; wait for health `SUCCESS`.
2. As owner: *Intelligence → Settings*: enable, tick *Chat* and *Financial summaries*, accept the notice. Status must read `mock · ready · ready`, documents `category_unavailable`.
3. Run each report in the Canvas for a known period; compare with *Reports* (income statement; customer/supplier aging) — figures must match to the halala; the aging cards must show the "current balance, not historical" warning for a past `as_of`.
4. Read the audit trail (`GET /api/ai-assistant/audit-events`, needs `ai.audit.view`, owner/admin): metadata only (no names/amounts/prompt text).
5. Exit criteria: all matches, no unexpected error states, no external host in the browser network log, ledger untouched (spot-check entry counts).

Phase B — documents (only after approval and a demo document reviewed by a person): add `AI_ASSISTANT_DOCUMENTS_ENABLED=true`, grant `document_projected_text`, open the reviewed document's review screen and use *Read reviewed values*; confirm redaction and that an unreviewed/other-branch/other-tenant document is refused.

**Rollback (instant, no data impact):** remove `AI_ASSISTANT_ENABLED` (or set `false`) → redeploy → every call returns `platform_disabled`; tenant consent rows stay inert. Also: owner can switch the tenant off in Settings (revokes all categories immediately).

## 7. Evidence — requirements 3–6

### 7.1 Finance vs `ReportService` (requirement 3)

New journey test `AiInternalMockPilotTest` (pilot-day flow through the real HTTP endpoints, mixed demo data: 3 customers, 2 suppliers, 5 invoices incl. due-date and no-due-date cases, 3 purchases, 1 expense):

| Check | Result |
|---|---|
| Before opt-in → status `tenant_disabled`, tool run **403** | pass |
| Owner enables through `PUT /ai-assistant/settings` with acknowledgement → `mock · ready · ready`; documents `category_unavailable` | pass |
| Income statement revenue/expense/net equal `ReportService::incomeStatement` (minor units, SAR) | pass |
| Receivables **and** payables aging: every bucket total and every per-partner total equal `ReportService::aging` | pass |
| Past `as_of` carries the "not historical" warning | pass |
| Role matrix: owner ✔, accountant ✔, staff ✘ (403), accountant cannot change consent (403); withdrawing `financial_summary` stops tools at once | pass |
| Document tool closed while the second flag is off (`data_category_unavailable`); category cannot be granted (422) | pass |
Plus the existing parity suites (`AiFinanceToolsTest`: inclusive date boundaries, every aging bucket boundary, labels, SAR guard, partner-name permission).

### 7.2 Documents (requirement 4)

`AiDocumentProjectionTest` (52 tests, re-run): reviewed values win over extracted; redaction overlays applied and original never returned; bounded/sanitised text; cross-tenant indistinguishable from missing (uniform 404); other-branch and restricted-branch refused; no document-center view / no AI permission refused; quarantine, infected, scan pending/failed, purged, retention-ended, archived, active hold all refused with stable codes; **review-evidence gate** (missing, stale, system-actor, direct `processing→ready_for_draft`, real `DocumentReviewService` path) enforced; prompt-injection text inert; provider cannot plan the tool.

### 7.3 UI / UX (requirement 5)

Vitest `modules/intelligence` + `components/intelligence`: **203/203**. Playwright `ai-03-intelligence` + `ai-04-documents`: **72 passed, 4 skipped by design, 0 failed** — panel, Financial Intelligence Canvas, consent/settings, document surface; desktop and mobile; Arabic (RTL) and English (LTR); Light/Dark; Default/Ink/Core; no horizontal overflow; one read request carrying only the URL id; no non-local host; nothing persisted in browser storage. Screenshots were inspected visually this run (desktop AR-light income statement, mobile AR-dark receivables aging with the historical-balance warning, mobile EN-light canvas, mobile EN-dark document result with redaction and "Demo" label): layout, RTL alignment, KPI hierarchy, evidence/scope panel and states are consistent. **Not tested:** physical devices, hardware keyboard, Android Back, screen readers.

### 7.4 Egress and accounting integrity (requirement 6)

| Check | Result |
|---|---|
| `Http::preventStrayRequests()` + `Http::assertNothingSent()` in every AI test incl. the new journey | pass |
| Static scan of `app/Services/Ai*`, `MockAiAssistantProvider`, `Ai*` controllers/support: no HTTP client, curl, sockets, `file_get_contents(url)` | none found |
| Web `intelligence` module: no absolute URLs; Playwright asserts only app and intercepted API origins | pass |
| Non-`mock` provider value → fails closed, no network, no secret read | pass (`AiPaidProviderDisabledTest`) |
| Ledger fingerprint (entry count, line count, Σdebit, Σcredit, id hash) identical before/after all three tools + chat | pass (new test) |
| Assistant code has no reference to `LedgerService`/journal tables | none found |
| Audit rows contain no partner name, amount or prompt text | pass (new test) |
| Security/accounting invariants (RBAC, tenant isolation, application access, branch guard, document isolation matrix, ledger, reports, document review/redaction/retention/governance) | **106 passed** |

## 8. Tests run

| Suite | Result |
|---|---|
| `AiInternalMockPilotTest` (new, 3 tests / 59 assertions) | pass |
| AI suites (`AiInternalMockPilotTest\|AiDocumentProjectionTest\|AiAssistant*\|AiFinance*\|AiAudit*\|AiMetering*\|AiPaid*`) | **201 passed, 1 skipped** (2452 assertions) |
| Invariants (see 7.4) | 106 passed |
| Vitest AI | 203 passed |
| Playwright AI-03 + AI-04 | 72 passed, 4 skipped, 0 failed |
| Full PHP suite | not re-run (no production code changed); AI-04 full run and green CI on `6258840` relied on |
| CI on this PR | `@@CI@@` |

## 9. Remaining work and risks

| # | Item | Owner |
|---|---|---|
| 1 | Decide C1/C2 and approve Phase A; execute §6 | Owner |
| 2 | Optional tenant allowlist before enabling on a shared environment (F1) | Engineering (small PR) |
| 3 | Gate cutover A2/A4 from the infra review (staging/production separation) — still pending | Owner |
| 4 | Provide a human-reviewed demo document for Phase B | Owner |
| 5 | Physical-device pass (keyboard, Android Back, screen reader) | QA/Owner |
| 6 | Live provider track (privacy/residency, billing owner, numeric caps, price table, real-adapter billing + egress tests) | Owner + Engineering, separate approval |

Risks: shared-environment exposure (F1); redeploy side effects until the gate exists (F2); documents phase depends on unknown demo data; real-provider behaviour entirely unverified.

## 10. Changed files

`tests/Feature/AiInternalMockPilotTest.php` (new) · `docs/reports/AWJ_AI_06_INTERNAL_MOCK_PILOT.md` (new). No production code, config, schema, Railway or tenant data changed. Screenshots regenerated by the Playwright run were discarded, not committed.

## 11. GO / NO-GO

**CONDITIONAL GO — internal mock pilot, finance tools, current (demo) environment**, subject to C1 and C2 and the §6 steps. **NO-GO** for paid providers and for the documents phase until a reviewed demo document and explicit approval exist. Stopped here for owner decision.

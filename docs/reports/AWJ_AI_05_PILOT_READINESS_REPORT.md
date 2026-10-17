# AWJ AI-05 — Pilot Readiness & Security Verification (mock-only)

Scope: evidence-based GO / NO-GO for the merged AI-01 → AI-04 foundation. **Verification only.** No feature enablement, no tenant/setting writes, no schema change, no provider call, no merge, no deploy. Production was inspected **read-only** (service/deployment status and one scheduler log filter; environment-variable values were deliberately **not** read).

## 1. Verdict

| Target | Verdict | One-line reason |
|---|---|---|
| **Offline mock** (local / CI / isolated test DB, synthetic data) | **GO** | All 7 gates pass in focused tests; no security finding above Low. |
| **Staging mock** (flags ON for one synthetic tenant, mock provider) | **CONDITIONAL GO** | Code is ready, but **no staging environment exists** (single Railway `production` environment) and `main` auto-deploys to it before CI finishes. Needs owner approval for a separate environment (§7) — flags must **not** be turned on in production for a pilot. |
| **Live paid provider** | **NO-GO** | Not implemented by design (only `mock` resolves); privacy/residency review, billing owner, numeric caps, price table, real-adapter billing tests and explicit approval are all absent. Real-provider billing/egress has **never** been exercised. |

## 2. Baseline and environments

| Item | Value |
|---|---|
| Base (`main`, verified live, had not advanced) | `6258840b7fef68fbc533f78176006c0cd7b1ad9d` (AI-04, PR #1554) |
| Branch / PR | `docs/ai-05-pilot-readiness-20261017` — docs-only Draft PR (this report only) |
| Head | `7a1992dd24ce8fda338781f92287165617ec02f2` (report commit on top of Base; any later commit changes this report only) |
| `main` CI for Base | run 39018270846 — **success** (completed 08:58 UTC) |
| Test envs used | PHP 8.3 / SQLite in-memory via the assembled Laravel app (`/home/user/nibras-app`); Vitest (jsdom); Playwright Chromium with **intercepted API** (fixture data). PostgreSQL and `bcmath`-dependent Fuel tests run only in CI (sandbox lacks `ext-bcmath`). |
| Not tested | physical devices, Safari/Firefox, Android Back, real keyboards on hardware, any real provider, real production data, load/soak. |

## 3. Evidence by gate

Status: ✅ verified by test/source · 🟡 verified with a limitation · ❓ unknown (not verifiable from here).

### Gate 1 — Switches and entitlement

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| `AI_ASSISTANT_ENABLED` and `AI_ASSISTANT_DOCUMENTS_ENABLED` default **false**; provider default `mock` | `config/ai_assistant.php:20,24,44`; shipped-defaults test passes | `AiAssistantGatewayTest::the_shipped_defaults_are_off_and_mock` | ✅ |
| Platform off blocks even a fully opted-in tenant; tenant-not-enabled / missing consent / consent without enabled denied | all denied with stable reason codes | `AiAssistantGatewayTest` (kill switch, never-opted-in, no-consent, consent-without-enabled) | ✅ |
| Documents category cannot be granted or used while its own platform switch is off; never auto-enabled by bulk grant | 422 on grant; status reports `category_unavailable` | `AiDocumentProjectionTest` (platform switches ×2, status honesty) | ✅ |
| Document Center "sending" consent neither grants nor implies assistant consent (and vice-versa) | independent in both directions | `…document_center_sending_consent_never_implies_ai_consent…`, `AiAssistantUiApiTest` | ✅ |
| Revocation effective on the very next call; disabling revokes all categories | pass | `AiAssistantUiApiTest`, `AiAssistantGatewayTest` | ✅ |
| Honest UX for disabled / not-enabled / no-consent / unavailable / error | one state per server reason, no chat/finance request unless status is ready | Vitest (203 tests, 9 files), Playwright | ✅ |
| **Effective flag values in production** | Code defaults are OFF; Railway variable values were not read | — | ❓ owner must confirm `AI_ASSISTANT_ENABLED` / `AI_ASSISTANT_DOCUMENTS_ENABLED` are unset or `false` on `nibras-api` and `Nebrax` |

### Gate 2 — Tenant / actor isolation

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| Fresh re-authorization per request **and** per tool invocation | permission revoked / consent withdrawn between planning and execution is effective immediately; deactivated actor/tenant denied | `AiAssistantGatewayTest` (4 tests), `AiFinanceToolsTest::reports_view_revoked_after_planning…` | ✅ |
| Cross-tenant: no read, no audit/consent leakage; client cannot choose tenant/actor/provider/tool/sql/url | rejected or never resolved | `AiAssistantGatewayTest`, `AiAuditTest::a_tenant_only_ever_reads_its_own_events…`, `AiAssistantUiApiTest::status_never_shows_another_tenants_consent` | ✅ |
| Branch / warehouse permissions; forbidden ids fail closed (reject, not silently drop) | pass | `AiAssistantGatewayTest` (restricted branch / warehouse) | ✅ |
| Unrestricted actor keeps `[]`/`all` semantics but cannot name another tenant's ids | pass | `…unrestricted_actor_keeps_unrestricted_semantics…`, `…cannot_name_another_tenants_branch…` | ✅ |
| Field permissions: partner names withheld without `partners.view` while totals stay | pass | `AiFinanceToolsTest::partner_names_are_withheld…` | ✅ |
| Existing invariants (RBAC, tenant isolation, branch guard, ledger, reports, document isolation matrix) unaffected | 106 tests / 1031 assertions pass | `ApiRbacTest`, `ApiTenantIsolationTest`, `ApplicationAccess*`, `BranchIsolationGuardTest`, `DocumentCenterIsolationMatrixTest`, `LedgerTest`, `Report*`, `DocumentReview*/Redaction*/Retention*/Governance*` | ✅ |

### Gate 3 — Finance tools

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| Closed allow-list: only `finance.income_statement`, `finance.receivables_aging`, `finance.payables_aging` (+ `documents.projected_read`, explicit-only); provider cannot plan an unregistered tool; >3 planned calls rejected | pass | `…shipped_tool_registry_is_closed…`, `…tool_call_planned_by_the_provider_is_rejected…`, `…too_many_planned_tool_calls…` | ✅ |
| Amounts equal `ReportService` exactly (inclusive dates, every aging bucket boundary), integer minor units, explicit SAR, no float | pass | `AiFinanceToolsTest` (income statement, both aging tools, money-minor-units) | ✅ |
| Period / basis / timezone / source link labelled; aging `as_of` flagged "not historical" on both aging tools; non-SAR tenant refused before any read | pass | `AiFinanceToolsTest` (labels, not-historical ×2, non-SAR) | ✅ |
| No generated SQL, no posting, no warehouse filter misleading finance | no write path; warehouse scope refused explicitly for tools without a warehouse dimension; sources contain no provider/network client | `AiAssistantGatewayTest::the_assistant_sources_contain_no_network_or_provider_client_code`, `AiDocumentProjectionTest::a_warehouse_scope_is_refused_explicitly…`, `…reading_creates_no_copies_and_changes_no_document_center_state` | ✅ |

### Gate 4 — Budget / audit / egress

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| Atomic platform **and** tenant caps; zero / missing cap denies; no unlimited default | single conditional update per budget row; interleaved reservations never exceed cap | `AiMeteringTest` (cap, zero-cap, atomicity tests) | ✅ |
| Idempotency / retry: replay without second charge; in-flight duplicate and key reuse refused; keys tenant-scoped; only hashes stored | pass | `AiMeteringTest` (idempotency tests) | ✅ |
| Stale reservation cleanup | `reapStale()` settles abandoned reservations with the failure policy, **but only lazily** (called from `AiRequestLedger` when a request hits a cap) — **not scheduled** | `AiMeteringTest::an_abandoned_reservation_is_reaped…`, `AiRequestLedger.php:44` | 🟡 see F3 |
| Metadata-only audit; denials carry stable code only; fail-closed if the pre-egress audit cannot be written | pass | `AiAuditTest` | ✅ |
| Immutable "through the application" | Eloquent `updating`/`deleting` throw; **no DB trigger / revoke**; retention command deletes via query builder by design | `AiAuditEvent::booted`, `PruneAiRecords`, `AiAuditTest::audit_events_are_append_only_through_the_model` | 🟡 see F4 |
| Retention scheduled; 30-day floor in code | scheduled `dailyAt 03:40`; **production `awj-scheduler` ran `ai:prune-records` at 2026-10-17 03:40 UTC — DONE (96 ms)**; stdout goes to `/dev/null`, so deleted counts are not observable | `routes/console.php:91`, Railway scheduler log (read-only filter) | ✅ (counts unobservable) |
| No provider egress | `Http::preventStrayRequests()` + `assertNothingSent()` in every AI test; any non-`mock` provider fails closed without network or secret; encrypted integration secrets untouched | `AiPaidProviderDisabledTest`, `AiAssistantGatewayTest`, `AiMeteringTest::the_metering_sources_contain_no_network_or_provider_client_code` | ✅ |
| **Billing statement** | `mock` is `billable=false` **by design** and is the only provider exempt from budgets. **Production billing has not been tested through a real adapter** (none exists); the price table lists no real provider. | `config/ai_assistant.php` pricing block | ❗ not claimed |

### Gate 5 — Documents

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| Explicit document-id only; never model-selected or provider-planned; injected instructions inert | pass; id is a UUID, closed schema, URL-sourced in the UI | `…provider_cannot_plan_the_document_tool…`, `…injected_instructions_in_a_document_have_no_effect…`, `…unknown_arguments_malformed_ids_and_paths_are_rejected` | ✅ |
| Reviewed + redacted + bounded projection; tax numbers/barcodes excluded; text sanitized | pass | `AiDocumentProjectionTest` (reviewed value wins, overlays, bounds/sanitization, delivery-note field rules) | ✅ |
| Independent document-category consent; RBAC (`documents.center.view` + `ai.assistant.use`); commercial entitlement | pass | consent ×3, role ×2, entitlement tests | ✅ |
| Reliable `review_completed` evidence tied to the **latest** extraction result and review version | immutable human `review_completed` action + matching workflow event; stale (newer extraction / later edit), missing, system-actor and direct `processing → ready_for_draft` all refused; real `DocumentReviewService` path accepted incl. reopen + re-completion | review-evidence tests (AI-04 hardening, `AiDocumentProjectionTest`) | ✅ |
| Quarantine / infected / scan pending-failed (incl. scan-exception admissions) / hold / retention-ended / purged / archived refused; uniform 404 outside tenant/branch | pass (10 lifecycle states, hold + release) | lifecycle matrix, hold test | ✅ |
| No copies, no Document Center state change, no accounting entry | row counts before/after identical | `…reading_creates_no_copies…` | ✅ |

### Gate 6 — UI / UX

| Expected | Observed | Evidence | Status |
|---|---|---|---|
| Panel, Canvas, consent/settings, document surface; AR/EN RTL/LTR; Light/Dark; Default/Ink/Core; mobile | Playwright: **71 passed, 4 skipped by design, 1 failed (flake, see F7)** over 76 cases (`ai-03-intelligence`, `ai-04-documents`); Vitest **203/203** | `web/e2e/ai-0{3,4}-*.spec.ts`, `web/src/{modules,components}/intelligence` | ✅ |
| Semantic loading/empty/error states, financial evidence, Demo/read-only labeling, no horizontal overflow, single read request carrying only the URL id, no document content in `localStorage`/`sessionStorage`, no non-local host | asserted in specs | same | ✅ |
| Physical-device keyboard / Android Back / real screen readers | **not tested** | — | ❓ unverified |

### Gate 7 — Operational readiness

| Item | Observed | Source | Status |
|---|---|---|---|
| Railway environments | **one**: `production` (project `أَوْج AWJ`) — **no staging** | `list-services`, `environment-status` (read-only) | ❗ F1 |
| Production auto-deploy | `nibras-api`/`Nebrax`/`storefront`/`awj-scheduler`/`awj-preview-host` deployed `main` @ `6258840` **at 08:40:51 UTC — the same second PR #1554 merged — while `main` CI was still running (finished 08:58)**. Deploy does not wait for CI. | `list-deployments`, workflow run 39018270846 | ❗ F1 |
| AI-04 code state in production | **Live** (`nibras-api` deployment `90b03633…`, commit `6258840`), flags presumed OFF (❓ F2) | `list-deployments` | ❓ |
| Scheduler | `awj-scheduler` cron service healthy (last run 08:45 UTC succeeded); runs `schedule:run`; `ai:prune-records` and `documents:sweep-scans` are in `routes/console.php`. The web container itself runs **no** scheduler/queue (`entrypoint.sh`: Apache only, `QUEUE_CONNECTION=sync`). | `environment-status`, `entrypoint.sh`, `Dockerfile` | ✅ prod / ❗ must be replicated for staging |
| Scan pipeline | `awj-clamav` online; `documents:sweep-scans` every 10 min via the scheduler; without it documents stay `scan_incomplete` (fails closed) | `environment-status`, `routes/console.php` | ✅ |
| Storage assumptions | Projection is DB-resident (encrypted `normalized_payload`); AI-04 never touches object storage | AI-04 report §9.6 | ✅ |
| Encrypted provider config | gateway never reads provider secrets; only `mock` resolves; secrets stay encrypted/unchanged | `AiAssistantGatewayTest::platform_integration_secrets_stay_encrypted…` | ✅ |
| Env-flag locations | `AI_ASSISTANT_ENABLED`, `AI_ASSISTANT_DOCUMENTS_ENABLED`, `AI_ASSISTANT_PROVIDER` are read in `config/ai_assistant.php`; `entrypoint.sh` runs `config:cache`, so **any change needs a redeploy/restart** | `config/ai_assistant.php`, `deploy/entrypoint.sh` | ✅ |
| Isolated staging tenant without touching production | **Not possible today.** A tenant in the production DB is production data and the flag is platform-wide. A separate environment/DB is required (§7). | — | ❗ |

## 4. Security & readiness findings

| ID | Severity | Finding | Impact today | Recommendation |
|---|---|---|---|---|
| F1 | **High (process)** | No staging environment; every merge to `main` auto-deploys to the only (production) environment without waiting for CI. | None for AI (flags default OFF), but any future flag flip or defect reaches production directly; a pilot cannot be isolated. | Owner decision: create a `staging` environment (own DB, no production data) **or** set `checkSuites` / a deploy branch so production deploys only after green CI. |
| F2 | Medium (unknown) | Effective production values of `AI_ASSISTANT_ENABLED` / `AI_ASSISTANT_DOCUMENTS_ENABLED` were not read (variables API returns plaintext secrets). | If either were `true` in Railway, the mock assistant would be callable for opted-in tenants; no tenant is opted in by default. | Owner confirms in the Railway dashboard (or a values-masked check) that both are unset/`false`. |
| F3 | Low | Stale-reservation reaper is lazy (only on a cap hit) and `reserved` rows are exempt from pruning. | Mock never reserves budget, so no effect. | Before any billable adapter: schedule `reapStale()` (e.g. every 5 min) and alert on `reserved` older than the TTL. |
| F4 | Low | Audit immutability is application-level only (Eloquent events); raw SQL / query-builder writes and the prune command bypass it; no DB trigger or privilege separation. | Matches the stated design ("immutable-through-application"). | Before live provider: DB-level protection (revoke UPDATE/DELETE for the app role or trigger) with the prune job under a separate role. |
| F5 | Low | `ai:prune-records` output is sent to `/dev/null` by the scheduler, so deleted counts are invisible. | Only "DONE" is observable. | Send output to container stdout like `documents:sweep-scans` does. |
| F6 | Info | Retention does not purge the encrypted extraction payload (Document Center policy); AI refuses on file state, not payload presence. | Disclosure already blocked. | Owner policy decision (already recorded in AI-04 report). |
| F7 | Info | One Playwright case (`[mobile] ai-04-documents › en·light › settings…`) timed out waiting for the document switch in the 76-case run; **12/12 passes on isolated re-run**. Dev-server logs also show pre-existing `next-intl INVALID_KEY` warnings for `appBuilder`/`developer` namespaces (not AI). | Flake only; not reproducible. | Track; raise the timeout if it recurs in CI. |
| F8 | Info | Physical-device keyboard / Android Back / assistive-tech runs not performed. | UX confidence limited to emulated Chromium. | Manual checklist in §7. |

No Critical findings. No defect requiring a code change was found, so **no code PR was opened**.

## 5. Tests run

| Suite | Result |
|---|---|
| `AiDocumentProjectionTest\|AiAssistant*\|AiFinance*\|AiAudit*\|AiMetering*\|AiPaid*` | **198 passed, 1 skipped** (2393 assertions) |
| Security / accounting invariants (RBAC, tenant isolation, application access, branch guard, document isolation matrix, ledger, reports, document review/redaction/retention/governance) | **106 passed** (1031 assertions) |
| Vitest `modules/intelligence` + `components/intelligence` | **203 passed** (9 files) |
| Playwright `ai-03-intelligence` + `ai-04-documents` (Chromium, intercepted API) | 71 passed · 4 skipped (by design) · 1 flake (re-run 12/12) |
| CI on Base (`6258840`, run 39018270846) | success; PR #1554 head `f6a53fb` had SQLite, PostgreSQL, CI Gate and web build green |
| Full PHP suite | not re-run — AI-04 full run (7530 passed; 26 failures only in six `bcmath`-dependent Fuel classes in this sandbox) and green CI on Base were relied on |

## 6. Prioritised actions

| # | Action | Owner | Prerequisite |
|---|---|---|---|
| 1 | Confirm production flags are OFF (F2) | Owner | Railway dashboard access |
| 2 | Decide staging approach (F1): new `staging` environment **or** gate production deploys on CI | Owner | cost/infra approval |
| 3 | If staging approved: provision per §7 (separate DB, own variables, own scheduler + ClamAV) | Engineering | #2 |
| 4 | Redirect `ai:prune-records` output to stdout (F5) | Engineering | small PR, no schema |
| 5 | Schedule `reapStale()` + DB-level audit protection (F3/F4) | Engineering | before any billable adapter |
| 6 | Physical-device checklist (keyboard, Android Back, screen reader) | QA/Owner | staging build reachable from a device |
| 7 | Live-provider track: privacy/residency review, billing owner, numeric platform & tenant caps, price table, real-adapter billing + egress tests | Owner + Engineering | explicit approval; separate task |

## 7. Staging mock dry-run plan — **NOT executed; requires explicit owner approval**

**Why not production:** one environment only; flags are platform-wide; merges deploy before CI; a tenant there is real data.

**Approach (recommended):** a new Railway environment `staging` in project `أَوْج AWJ`.

1. **Isolation (hard requirements).** Own Postgres service; `DB_*` variables must point to the staging DB (cloning an environment may copy variable *references* — verify they do not reference `nibras-db` of production). No production data import. Own `APP_KEY`. R2/storage variables absent or pointed at a test bucket. Own `awj-scheduler` (cron `*/5 * * * * php artisan schedule:run`) and, for the document phase, own ClamAV (or accept that documents stay `scan_incomplete`). Staging web/API on a non-production hostname.
2. **Flags (staging only), phase A — finance:** `AI_ASSISTANT_ENABLED=true`, `AI_ASSISTANT_PROVIDER=mock`, `AI_ASSISTANT_DOCUMENTS_ENABLED=false`. Phase B — documents: add `AI_ASSISTANT_DOCUMENTS_ENABLED=true`. No budget rows needed (mock is unbillable). **No** provider keys of any kind. Redeploy after each change (`config:cache`).
3. **Test tenant:** one synthetic tenant created in staging; one owner, one accountant, one restricted-branch user, one user without `ai.assistant.use`; a second synthetic tenant for isolation checks. Synthetic invoices/purchases and one synthetic Document Center batch reviewed by a human user.
4. **Checks:** status endpoint states; consent opt-in/revoke; the three finance tools vs. `ReportService` totals; document read refused before review / after edit / on hold / in other branch; audit list shows metadata only; `ai:prune-records` scheduled; browser + physical device pass (AR/EN, Light/Dark, Ink/Core, keyboard, Android Back); network log shows no external host.
5. **Rollback:** set `AI_ASSISTANT_ENABLED=false` and `AI_ASSISTANT_DOCUMENTS_ENABLED=false` → redeploy (gateway returns `platform_disabled` immediately; tenant consent rows are inert). If anything unexpected: delete the `staging` environment (no production resource is shared if step 1 holds). Production is never touched.
6. **Approvals needed before step 1:** (a) new infrastructure/cost; (b) confirmation that cloned variables are re-pointed; (c) the named staging test tenant; (d) a go/no-go owner on the checks.

## 8. Files changed, branch, SHAs, risks

- **Files changed:** `docs/reports/AWJ_AI_05_PILOT_READINESS_REPORT.md` only. No code, schema, config, tenant setting or environment variable was changed anywhere.
- **Branch / PR:** `docs/ai-05-pilot-readiness-20261017` → Draft PR (docs-only). **Do not merge automatically.** Note: merging to `main` triggers a production redeploy (F1) even for a docs-only change.
- **Base:** `6258840b7fef68fbc533f78176006c0cd7b1ad9d` · **Head:** `7a1992dd24ce8fda338781f92287165617ec02f2` (report-only; later commits touch this file only).
- **Remaining risks:** F1–F8 above; production flag values unknown (F2); physical-device UX untested; real-provider billing/egress and live-provider privacy/residency entirely unverified.
- **Next action:** owner review of this report; decide #1 and #2 in §6.

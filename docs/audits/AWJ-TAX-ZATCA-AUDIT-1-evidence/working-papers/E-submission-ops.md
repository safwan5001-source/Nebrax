> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`.

# Stream E — ZATCA submission chain (Clearance/Reporting) & production readiness

Audit: AWJ-TAX-ZATCA-AUDIT-1 · Repo `<repo>` @ `0534ef16543b01c69b416b58897337e012a9d1ab` · Date 2026-10-10 · Auditor: Stream E
Prefixes: `SUB-` (submission chain) · `OPS-` (operations/readiness/observability)
All HTTP in probes was faked (`Http::fake()`); **no ZATCA endpoint was contacted**; synthetic data only.

---

## 1. Scope & method

### 1.1 Files read in full (line counts from `wc -l`)

| Area | File | Lines |
|---|---|---|
| Config | `config/zatca.php` | 64 |
| Services | `app/Services/Accounting/ZatcaSubmissionService.php` | 149 |
| | `app/Services/Accounting/ZatcaSubmissionDispatcher.php` | 120 |
| | `app/Services/Accounting/ZatcaSubmissionQueue.php` | 57 |
| | `app/Services/Accounting/ZatcaHttpTransport.php` | 138 |
| | `app/Services/Accounting/ZatcaSubmissionEndpointResolver.php` | 39 |
| | `app/Services/Accounting/ZatcaTransportCredentialResolver.php` | 55 |
| | `app/Services/Accounting/ZatcaTransportCredential.php` | 14 |
| | `app/Services/Accounting/ZatcaTransportReadiness.php` | 70 |
| | `app/Services/Accounting/ZatcaTransportResult.php` | 19 |
| | `app/Services/Accounting/ZatcaSigningReadiness.php` | 53 |
| | `app/Services/Accounting/ZatcaNotificationBridge.php` | 128 |
| | `app/Services/Accounting/ZatcaService.php` | 316 |
| | `app/Services/Accounting/ZatcaCredentialService.php` | 147 |
| | `app/Services/Accounting/ZatcaSignedInvoiceFinalizer.php` | 132 |
| | `app/Services/Accounting/ZatcaSigningCredentialResolver.php` | 62 |
| | `app/Services/Accounting/ZatcaSignaturePolicyResolver.php` | 46 |
| | `app/Services/Accounting/ZatcaPhaseTwoQrEncoder.php` (lines 20-100) | 104 |
| | `app/Services/Accounting/ZatcaCredentialMaterialValidator.php` (lines 45-80) | 372 |
| | `app/Services/Accounting/InvoiceService.php` (lines 425-460, 880-1062) | — |
| Jobs/Models | `app/Jobs/Accounting/SendZatcaSubmission.php` | 55 |
| | `app/Models/ZatcaSubmissionAttempt.php` | 111 |
| | `app/Models/ZatcaCredential.php` | 30 |
| Support | `app/Support/ZatcaSubmissionConflict.php` | 9 |
| | `app/Support/ZatcaIcvScope.php` | 104 |
| | `app/Support/Rbac.php` (20-100), `app/Support/Settings.php` (215-250), `app/Support/ApplicationCatalog.php` (80-110), `app/Support/NotificationActions.php` (24-34), `app/Support/WebhookEventCatalog.php` | — |
| HTTP | `app/Http/Controllers/Api/ZatcaSubmissionController.php` | 129 |
| | `app/Http/Controllers/Api/ZatcaSettingsController.php` | 50 |
| | `app/Http/Controllers/Api/ZatcaCredentialController.php` | 30 |
| | `app/Http/Requests/UpdateZatcaSettingsRequest.php` | 51 |
| | `app/Http/Requests/UpdateZatcaCredentialRequest.php` | 34 |
| | `app/Http/Controllers/Api/InvoiceController.php` (120-395) | 395 |
| | `app/Http/Controllers/Api/PosController.php` (200-235), `PublicInvoiceController.php` (1-80), `app/Http/Resources/InvoiceResource.php`, `PublicInvoiceResource.php` | — |
| Routes | `routes/api.php` (349-376, 655-690, 1585-1590), `routes/api_public.php`, `routes/console.php` (72) | — |
| Migrations | `2025_01_01_000012`, `000013`, `000129`, `000130`, `000131`, `000132`, `000133` | 24/26/31/43/34/24/23 |
| Console | `app/Console/Commands/GrantLegacyReachableZatcaCommand.php` | 107 |
| Web | `web/src/app/(app)/sales-settings/einvoice/page.tsx` | 284 |
| | `web/src/app/(app)/invoices/[id]/page.tsx` (255-300, 500-530, 600-700, 900-912), `web/src/app/(pos)/pos/page.tsx` (1425-1450, 1726), `web/src/components/pos/pos-invoice-details.tsx`, `web/src/modules/documents/components/sections/doc-qr.tsx`, `web/src/modules/invoices/services/invoice-pdf.ts`, `web/src/lib/notifications.ts`, `web/src/messages/{ar,en}.json` (zatca keys) | — |
| Deploy | `.github/workflows/ci.yml` (221), `Dockerfile` (57), `deploy/assemble.sh` (114), `deploy/entrypoint.sh` (99), `deploy/DEPLOY.md` (171), `render.yaml` (65), `HOW_TO_RUN.md` (ZATCA section 77-89), `setup.sh` (grep) | — |
| Docs | `docs/autonomous-engineering/*` (grep: ZATCA appears only as a flaky-test note), `docs/agent-workspace/DECISIONS.md` (66-87), `docs/plans/alerts-notifications/AWJ_NOTIFICATIONS_PR_NOTIF_4_IMPLEMENTATION_REPORT.md` (70-95) | — |
| Tests | `ZatcaSubmissionAttemptTest` (175), `ZatcaSubmissionDispatcherTest` (141), `ZatcaSubmissionRecoveryTest` (150), `ZatcaHttpTransportTest` (142), `ZatcaTransportCredentialResolverTest` (89), `ZatcaNotificationBridgeTest` (249), `GrantLegacyReachableZatcaCommandTest` (163), `ZatcaSigningReadinessTest` (103), `ZatcaSignedInvoicePostingTest` (grep), `tests/Feature/InteractsWithApi.php` (108) | — |
| Framework (harness vendor, for behaviour facts) | `Illuminate/Http/Client/PendingRequest.php` (895-960, 1036-1047), `GuzzleHttp/Handler/CurlFactory.php` (1082-1088), `GuzzleHttp/RedirectMiddleware.php` (30-36, 180-223), `GuzzleHttp/Client.php:342`, `config/queue.php`, `config/cache.php`, `phpunit.xml` | — |
| Official (R1/R2 work areas) | `<audit-workspace>/official/R2-work/text/DEVELOPER-PORTAL-MANUAL.txt` (Nov 2022), `E-Invoicing_Detailed__Guideline.txt`, `E-invoicing-Detailed-Technical-Guideline.txt`, `Fatoora_Portal_User_Manual_English.txt`, `portal-i18n-api-strings.txt`, `data-dictionary-2023-condensed.txt`, `R2-sdk-howto.md`, `R2-work/run-sign/simp_request.json` | — |

The registers `R1-regulatory-register.md` / `R2-technical-register.md` did **not** exist at the time of writing; official citations below point at the extracted texts in `<audit-workspace>/official/*-work/text/` (file:line). Items not found in those texts are tagged `[official-ref to confirm]`.

### 1.2 Existing tests run (targeted filter, isolated DBs)

```
cd <harness>
DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/E-run1.sqlite php artisan test --filter='ZatcaSubmissionAttemptTest|ZatcaSubmissionDispatcherTest|ZatcaSubmissionRecoveryTest|ZatcaHttpTransportTest|ZatcaTransportCredentialResolverTest|ZatcaNotificationBridgeTest|GrantLegacyReachableZatcaCommandTest|ZatcaSigningReadinessTest'
   → Tests: 40 passed (231 assertions)              [log: <audit-workspace>/logs/E-existing-sqlite.txt]
DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_e DB_USERNAME=audit DB_PASSWORD=audit php artisan test --filter='<same>'
   → Tests: 40 passed (231 assertions)              [log: <audit-workspace>/logs/E-existing-pgsql.txt]
```

### 1.3 Probes written and run (all HTTP faked)

| Probe | Command | Result |
|---|---|---|
| `<audit-workspace>/probes/E/ZatcaSubmissionChainProbeTest.php` (15 tests: P01–P15) | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/E-probe.sqlite php artisan test <audit-workspace>/probes/E/ZatcaSubmissionChainProbeTest.php` | 15 passed (108 assertions) — `<audit-workspace>/logs/E-probe-sqlite.txt` |
| same on PostgreSQL 16 | `DB_CONNECTION=pgsql … DB_DATABASE=audit_e php artisan test <audit-workspace>/probes/E/ZatcaSubmissionChainProbeTest.php` | 15 passed (108 assertions) — `<audit-workspace>/logs/E-probe-pgsql.txt` |
| `<audit-workspace>/probes/E/pg_concurrency_probe.php` (standalone CLI, `pcntl_fork`, real concurrent PG transactions, scenarios A–F) | `DB_CONNECTION=pgsql … DB_DATABASE=audit_e APP_ENV=testing CACHE_STORE=array QUEUE_CONNECTION=sync php <audit-workspace>/probes/E/pg_concurrency_probe.php` | all scenarios ran — `<audit-workspace>/logs/E-pg-concurrency.txt` |

Key probe outputs (verbatim excerpts from the logs; `[E-PROBE]`/`[E-PG]` lines):

```
P01 URL=https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation/invoices/clearance/single
P01 body keys=["invoiceHash","invoice"]            ← no "uuid"
P01 accept-version=["v2"] accept-language=["en"]   clearance-status header present? NO
P01 DB::transactionLevel() while HTTP in flight = 2
P01 invoice snapshot unchanged? xml=true hash=true qr=true    zatca_cleared_xml stored? true
P01 GET /invoices/{id}/zatca keys=[qr,hash,uuid,icv,previous_hash,xml,document_type,submission_type] (cleared xml exposed? NO)
P01 next invoice ICV=2 PIH==hash(prev zatca_xml)? true  PIH==hash(prev cleared_xml)? false
P02 reportingStatus=NOT_REPORTED (200 json) => status=accepted code=NOT_REPORTED
P02 text/html body (200)                    => status=accepted code=http_200
P02 empty body (200)                        => status=accepted code=http_200
P02 clearance 200 html => status=failed code=invalid_clearance_response retryable=true
P02 clearance 200 NOT_CLEARED+xml => status=accepted code=NOT_CLEARED
P02 clearance 202 CLEARED without clearedInvoice => status=failed code=invalid_clearance_response retryable=true
P03 202 accepted REPORTED | 400 rejected NOT_REPORTED (notif 1) | 401/403/404/409/413/422 rejected http_NNN (notif 1 each) | 429/500/502/503 failed retryable (notif 1 each)
P04 timeout => status=failed code=connection_failed http=NULL retryable=true recorded=1
P04 attempt#2 status=accepted attempt_number=2 identical body resent? true
P05 TLS-style RequestException => status=failed code=submission_preflight_failed retryable=false
P06 dispatch x2 + job handle: sent=1 ; job config: tries=1 timeout=45 uniqueFor=300 failOnTimeout=true failed()? false middleware()? false
P07 after POST store: queue_dispatch_performed=true jobs rows=1 status=pending ; after 6 min re-dispatch: jobs rows=2 queue_count=2 ;
    queue:work x2 → status=accepted sent=1 jobs left=0 failed_jobs=0
P08 readiness with database queue & NO worker: {"ready":true,...,"blockers":[]} ; 3 days later: pending attempts=1 ; no tenant-wide listing route
P09 attempt created under simulation, dispatched after switch: URL=…/core/invoices/reporting/single ; after simulation acceptance, production resubmission => 409
P10 rejected invoice ICV=1 next ICV=2 next PIH==hash(rejected xml)? true ; resubmission resends identical XML => rejected
P11 staff POST submissions 403 · accountant POST submissions 202 · accountant PUT zatca-settings 403 · owner PUT active_environment=production (no prod credential) 200 → posting then fails: "بيانات اعتماد ZATCA لبيئة production غير مهيأة."
P12 302 then 200 html: requests=["POST …/reporting/single","GET …/maintenance"] => status=accepted code=http_200
P13 flag=false: POST store meta {queue_dispatch_performed:false} jobs=0 ; POST dispatch => 422 (generic message, blockers not listed)
P14 enqueue without credential => RuntimeException "نقل ZATCA غير جاهز…" ; dispatcher without credential => failed submission_preflight_failed retryable=false
P15 job threw outside dispatcher: attempt status=pending failed_jobs=1 notifications=0
[E-PG] A: 6 concurrent requestManual(distinct keys) → attempts in DB = 1, created=1 conflicts=5
[E-PG] B: 6 concurrent requestManual(same key) → distinct attempt ids returned=1 rows=1
[E-PG] C: 4 concurrent dispatch() of one attempt → total HTTP sends = 1, final status=accepted
[E-PG] D: raw duplicate (invoice_id,attempt_number) → UniqueConstraintViolationException ; raw duplicate (tenant_id,idempotency_key_hash) → UniqueConstraintViolationException
[E-PG] E: raw second PENDING attempt for an invoice with an accepted attempt → INSERTED (no DB constraint; service lock only)
[E-PG] F: model delete → LogicException (permanent audit record) ; raw DB delete possible → yes
```

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

| # | Control | Evidence |
|---|---|---|
| PC-1 | **Endpoint pinning / SSRF guard.** Only the two published FATOORA hosts/paths per environment are accepted; `developer` has no endpoint and fails closed. | `app/Services/Accounting/ZatcaSubmissionEndpointResolver.php:10-38`; `config/zatca.php:45-54` matches `Fatoora_Portal_User_Manual_English.txt:373-397`; `ZatcaHttpTransportTest::it_fails_closed_for_developer_or_untrusted_endpoint_configuration` |
| PC-2 | **Transport credential discipline.** Resolved per active environment, no cross-env fallback; `stage === 'production'` required (compliance CSID rejected); expiry enforced; secrets `encrypted:array` + `$hidden`; API returns booleans only. | `ZatcaTransportCredentialResolver.php:22-53`; `ZatcaCredential.php:15,20`; `ZatcaCredentialService.php:124-146`; `ZatcaTransportCredentialResolverTest` (3 tests, PG+sqlite green) |
| PC-3 | **Authentication header & basic request shape.** `Authorization: Basic base64(csid:secret)`, `accept-version: v2`, `accept-language: en`, JSON body with `invoiceHash` + base64 `invoice`; TLS verification left at Guzzle default (`verify=true`; no `withoutVerifying`). Matches Developer Portal manual wording (`DEVELOPER-PORTAL-MANUAL.txt:1371-1373, 1951-1968, 2008-2027`). | `ZatcaHttpTransport.php:25-38`; probe P01 |
| PC-4 | **No transport-level auto-retry** (`retry(0, 0, throw:false)`), so the HTTP layer never double-submits by itself. | `ZatcaHttpTransport.php:34`; `vendor/.../helpers.php retry()` single attempt with `$times=0` |
| PC-5 | **Idempotent attempt creation.** `Idempotency-Key` header mandatory (≤128), stored as sha256; unique `(tenant_id, idempotency_key_hash)` and `(invoice_id, attempt_number)` exist on PostgreSQL (catalog dump in `E-pg-concurrency.txt`); same key ⇒ same attempt; key reuse across invoices ⇒ 409; creators serialised by `lockForUpdate` on the invoice (**PG: 6 concurrent creators ⇒ 1 row + 5 conflicts; 6 same-key creators ⇒ 1 row**). | `ZatcaSubmissionService.php:22-27,31,43-58,60-84`; migration `000130:32-33`; `ZatcaSubmissionAttemptTest` (8 tests); PG scenarios A, B, D |
| PC-6 | **Dispatch idempotency.** Attempt row locked `FOR UPDATE`; terminal attempts short-circuit; **4 concurrent dispatchers on PG ⇒ exactly 1 HTTP send**; double dispatch / job re-run never resend. | `ZatcaSubmissionDispatcher.php:23-27`; PG scenario C; probe P06; `ZatcaSubmissionDispatcherTest::reporting_dispatch_persists_a_sanitized_final_result_once` |
| PC-7 | **Attempt immutability & single terminal transition** enforced in the model (`creating`/`updating`/`deleting` guards) and in `complete()` (pending-only, status whitelist). | `ZatcaSubmissionAttempt.php:59-100`; `ZatcaSubmissionService.php:99-114`; `ZatcaNotificationBridgeTest::completing_the_same_attempt_twice_is_rejected…`; PG scenario F (model) |
| PC-8 | **Snapshot assertion before any network call**: XML hash must equal `request_hash`, invoice must be posted, document type must match submission type. | `ZatcaSubmissionDispatcher.php:76-97`; `ZatcaSubmissionDispatcherTest::a_changed_snapshot_fails_before_network_access` |
| PC-9 | **Cleared XML stored separately; submission snapshot and PIH chain untouched.** `zatca_cleared_xml` is written; `zatca_xml/hash/qr/uuid` unchanged; next invoice's PIH = hash of previous `zatca_xml` (not the cleared copy); rejected invoices keep their ICV/hash and remain in the chain — this is exactly what ZATCA requires (`E-invoicing-Detailed-Technical-Guideline.txt:1596-1603, 2405-2425, 2447-2451, 2462-2466`). | migration `000132:11-15`; `ZatcaSubmissionDispatcher.php:39-53`; probes P01, P10; `ZatcaService.php:69-75,140-151` |
| PC-10 | **Response-payload hygiene.** Secrets/certificates/`invoice`/`clearedInvoice` keys stripped, strings `strip_tags` + 4000-char cap, ≤100 keys, depth ≤6; `response_message` stripped and capped at 2000; `response_code` capped at 120. | `ZatcaHttpTransport.php:114-137`; `ZatcaSubmissionService.php:120-125`; `ZatcaHttpTransportTest::it_posts_the_official_v2_contract_without_leaking_credentials`; probe P03 (400 payload keeps `validationResults.errorMessages[].message` = "bad xml") |
| PC-11 | **Notification bridge** (PR-NOTIF-4): rejected/failed only, `DB::afterCommit`, delivery failure isolated, `dedupe_key` per attempt, recipients = active users with `invoices.manage` ∩ branch visibility, only `response_code` surfaced. | `ZatcaNotificationBridge.php:36-55,57-109,118-127`; `ZatcaNotificationBridgeTest` (9 tests green) |
| PC-12 | **Dispatch is opt-in and fail-closed at the queue boundary.** `ZATCA_SUBMISSION_DISPATCH_ENABLED` defaults `false`; readiness blocks `sync`/`null` queue connections, missing credential, missing endpoint; `afterCommit()` dispatch; `ShouldBeUnique` (300 s) + 5-minute re-queue cooldown; **real `database` queue round-trip verified with `queue:work --once`** (stale duplicate job ⇒ no second send). | `config/zatca.php:58`; `ZatcaTransportReadiness.php:22-60`; `ZatcaSubmissionQueue.php:17-56`; `SendZatcaSubmission.php:17-35`; `ZatcaSubmissionRecoveryTest` (4); probes P07, P13, P14 |
| PC-13 | **RBAC & application gate.** `zatca.view` (read), `invoices.manage` (create/dispatch), `company.manage` (settings/credentials), `EnsureApplicationActive:compliance.zatca`, throttles; staff cannot submit; accountant cannot change settings/credentials. | `routes/api.php:678-684,1585-1590`; `Rbac.php:36,43`; probe P11 |
| PC-14 | **Credential save hardening.** Password re-auth, application state re-check under tenant lock, CSID chain must validate to the configured per-environment CA bundle, derived public key/chain stored with the secret, production save requires UI confirmation. | `ZatcaCredentialService.php:31-33,43-50,88-117`; `ZatcaCredentialMaterialValidator.php:55-73`; `ZatcaCredentialTest`; `web/.../einvoice/page.tsx:228-231` |
| PC-15 | **Fail-closed signing.** Once any credential row exists, posting with an active environment lacking a credential/policy rolls back the whole posting transaction. | `ZatcaService.php:85-105`; `ZatcaSignedInvoicePostingTest:62-100`; probe P11 |
| PC-16 | **Infra bits that are present**: `xmllint` (required by `ZatcaXmlCanonicalizer.php:16,35`) is installed by `Dockerfile:8` (`libxml2-utils`) and `ci.yml:93`; `jobs`/`failed_jobs`/`job_batches` tables come from the Laravel 11 skeleton migration `0001_01_01_000002_create_jobs_table.php`, which `deploy/assemble.sh:103-105` does not delete; CI runs the suite on sqlite **and** PostgreSQL 16 (`ci.yml:22,28-41`). | as cited |

---

## 3. Findings (P0 → P3)

### SUB-01 — Standard (B2B) invoices are issued, printed and shared before — and independently of — Clearance; no lifecycle state distinguishes "posted" from "cleared"
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** Sales invoicing (standard tax invoice) → printing/PDF/share/POS receipt → customer.
- **Official requirement:** E-Invoicing Detailed Guideline §6.4: "Each Tax Invoice generated electronically must be cleared by the Authority as a prerequisite for sharing them with the buyers and for such Electronic Invoice to be regarded as legal and valid … are stamped by the Authority and returned to the taxpayer to be shared with the buyer" (`<audit-workspace>/official/R2-work/text/E-Invoicing_Detailed__Guideline.txt:1010-1018`); FAQ "For the Tax Invoice (B2B), the QR Code string will be generated by ZATCA at the time of Clearance (along with ZATCA's stamp). Taxpayers are expected just to visualize the QR Code based on the QR Code string received from ZATCA" (`…:2080-2085`); Technical Guideline FAQ: "non-cleared invoice is not considered as a valid Tax Invoice from ZATCA's perspective" (`E-invoicing-Detailed-Technical-Guideline.txt:2764-2778`).
- **Actual behavior:** `InvoiceService::post()` sets `status='posted'` and writes the locally built `zatca_qr/zatca_xml/zatca_hash` in one transaction (`InvoiceService.php:1035-1056`); nothing in the system waits for or checks clearance. Every customer-facing path consumes the local artifacts: `InvoiceResource` exposes `zatca.qr` (`InvoiceResource.php:128-137`), `GET /invoices/{id}/zatca` returns the local QR/XML (`InvoiceController.php:341-359`), the web invoice page prints/PDFs/shares/thermal-prints from `/invoices/{id}/zatca` (`web/src/app/(app)/invoices/[id]/page.tsx:281,511-525,626,673,685,902-909`), POS returns the receipt QR in the checkout response (`PosController.php:200-229`; `web/src/app/(pos)/pos/page.tsx:1430-1433,1726`). There is no `cleared/issued` state: `invoices` has no `zatca_submission_status`/`zatca_cleared_at` columns (probe P08 asserts absence), `GET /invoices/{id}` carries no clearance field (probe P01). Submission itself is a separate, manual, flag-gated API action (SUB-05). See Appendix C for the full path inventory: **no path consults ZATCA status**.
- **Expected behavior:** A standard invoice must not be released to the buyer (print/PDF/share/API exposure as a tax invoice) until Clearance succeeds; the released artifact must be the ZATCA-stamped XML/QR; a distinct lifecycle state (e.g. `posted` → `clearance_pending` → `cleared` / `clearance_rejected`) must gate every release path.
- **Evidence:** file:line refs above; probe P01 (`zatca_cleared_xml` stored but QR on invoice unchanged, cleared XML never exposed); Appendix C.
- **Impact:** Regulatory — every B2B invoice issued by AWJ today is, from ZATCA's perspective, not a valid tax invoice (local QR without ZATCA stamp); penalty exposure for the tenant; buyers cannot verify the QR against ZATCA.
- **Recommendation:** Introduce an explicit e-invoice lifecycle on `invoices` (or a 1:1 status table) driven only by `ZatcaSubmissionService::complete()`; gate `InvoiceResource.zatca`, `GET …/zatca`, print/PDF/share/thermal, POS receipt for `standard` documents on `cleared`; on `cleared`, serve the QR extracted from `zatca_cleared_xml`; keep simplified invoices printable immediately (reporting model) but show reporting state.
- **Regression tests required:** standard invoice: posted → `/zatca` returns 409/"not cleared" and resource has `clearance_status`; after faked 200 clearance → QR equals the one inside `clearedInvoice`; POS/standard cannot print before clearance; simplified unaffected.
- **Dependencies:** SUB-04, SUB-05, OPS-01.

### SUB-05 — No automatic/scheduled submission, no UI, no 24-hour deadline tracking: simplified (B2C/POS) invoices can only be reported by hand-crafted API calls per invoice
- **Severity:** P0
- **Status:** NOT IMPLEMENTED
- **Business process:** Simplified tax invoices (POS, cash sales) → Reporting within 24 h.
- **Official requirement:** "Taxpayers must submit the Simplified Tax Invoices in XML format … to FATOORA Platform for 'Reporting' within 24 hours of generation using APIs" (`E-Invoicing_Detailed__Guideline.txt:554-558`, also `:2075-2077`); Technical Guideline 4.3.1 (`E-invoicing-Detailed-Technical-Guideline.txt:1612-1626`); if not shared within 24 h the seller must notify ZATCA via a dedicated form (`E-Invoicing_Detailed__Guideline.txt:1630-1636`).
- **Actual behavior:** The only entry points are `POST /invoices/{id}/zatca/submissions` (needs an `Idempotency-Key` header, throttled 10/min) and `POST …/{attemptId}/dispatch` (`routes/api.php:681-684`; `ZatcaSubmissionController.php:34-100`). Nothing calls them automatically: no observer/event on posting (`InvoiceService::post` has no submission hook), no scheduler entry (`routes/console.php:1-72` has no ZATCA command), `source='automatic'` is allowed by the model (`ZatcaSubmissionAttempt.php:63`) but never produced, and the `submission_mode` setting is stored only ("عقدان محفوظان لطبقة orchestration القادمة", `ZatcaSettingsController.php:16-18`; `Settings.php:241-243`; grep: no reader). **No web/mobile UI calls the submission endpoints** (grep `zatca/submissions` in `web/src`, `mobile/`: none); the settings UI even offers "automatic" and says "Automatic mode will still allow a manual retry" (`web/src/messages/en.json:5987-5991`) although nothing implements it. No deadline column, no backlog query, no alert before breach (probe P08: 3-day-old pending attempt, no listing route).
- **Expected behavior:** Posting a simplified invoice (and POS checkout) must enqueue reporting automatically (or at least schedule it) with a per-invoice deadline (`issued_at + 24h`), a sweep that retries/escalates before the deadline, and an operator backlog view.
- **Evidence:** refs above; probe P08; grep results in §1.
- **Impact:** Regulatory — at POS volumes the 24-hour rule cannot be met; the feature is unusable in production as shipped (per invoice: manual API call with a unique key; 10/min throttle).
- **Recommendation:** Implement the orchestration layer the settings already promise: on `posted` (simplified) create an `automatic` attempt and enqueue when ready; add `zatca_reporting_due_at`; add `zatca:sweep` scheduled command (pending/failed-retryable, deadline alerts, stuck-queued recovery); add a submissions UI (status badge on invoice, backlog list, retry).
- **Regression tests required:** posting a simplified invoice with `submission_mode=automatic` creates an `automatic` pending attempt and pushes a job; sweep re-queues stale `queued_at`; deadline notification fires at T-x hours; throttle does not apply to the automatic path.
- **Dependencies:** OPS-01 (worker), OPS-02 (observability).

### SUB-02 — Acceptance is inferred from HTTP status alone (200/202 ⇒ `accepted`), the response status field is never checked, and redirects are followed — a non-ZATCA 200 (HTML/empty/302→200) is recorded as a permanent, irreversible acceptance
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Reporting/Clearance result interpretation.
- **Official requirement:** Response object contains a status (`status`/`reportingStatus`/`clearanceStatus`) plus warnings/errors (`DEVELOPER-PORTAL-MANUAL.txt:1973-1983, 2030-2040`); documented codes include **303 "See Other"** (standard invoice sent to Reporting while clearance is enabled / clearance disabled) (`…:2050-2062, 2071-2081, 1247-1266`). `[official-ref to confirm]` exact field names of the current API (`reportingStatus: REPORTED|NOT_REPORTED`, `clearanceStatus: CLEARED|NOT_CLEARED`).
- **Actual behavior:** `normalize()` sets `$accepted = in_array($httpStatus, [200, 202])` and only reads `clearanceStatus/reportingStatus/status` to fill the audit `response_code` (`ZatcaHttpTransport.php:83-86,102-111`). Probe P02: `200 {reportingStatus: NOT_REPORTED}` ⇒ `accepted`; `200 text/html` ⇒ `accepted (http_200)`; empty 200 ⇒ `accepted`; clearance `200 {clearanceStatus: NOT_CLEARED, clearedInvoice: <xml>}` ⇒ `accepted`. Redirects are followed by default (Guzzle `allow_redirects` max 5, Laravel sets nothing: `GuzzleHttp/Client.php:342`, `RedirectMiddleware.php:30-36`); probe P12: `302 → GET …/maintenance → 200 html` ⇒ `accepted (http_200)`. A ZATCA 303 **with** a `Location` header would be followed the same way; without it, 303 is recorded as `rejected`/`http_303` (not retryable) although it means "use the other endpoint". Once `accepted`, the attempt is immutable and `requestManual` refuses any further attempt (409, `ZatcaSubmissionService.php:52-54`), so the error cannot be corrected without DB surgery.
- **Expected behavior:** Treat as accepted only `200/202` **and** JSON with `reportingStatus=REPORTED` / `clearanceStatus=CLEARED` (and, for clearance, a parseable `clearedInvoice`); disable redirects (`withOptions(['allow_redirects' => false])`); classify 303 explicitly (routing error, retryable after reconfiguration); classify any other 2xx/3xx/non-JSON as `unknown`/`failed`, never `accepted`.
- **Evidence:** probes P02, P12; `ZatcaHttpTransport.php:71-99`; positive control for clearance: non-XML body ⇒ `failed invalid_clearance_response` (`ZatcaSubmissionDispatcher.php:39-49`, probe P02).
- **Impact:** Regulatory/operational — an invoice can be permanently marked reported/cleared while ZATCA never received it (captive portal, WAF, proxy, maintenance page, gateway 303), silently breaching the 24-hour rule with no retry path.
- **Recommendation:** as in "Expected"; add a `unknown` terminal-but-reopenable state; allow a privileged "reopen/mark not-accepted" action with audit.
- **Regression tests required:** the P02/P12 matrix with inverted expectations; redirect ⇒ `failed`; 303 ⇒ distinct code; JSON status mismatch ⇒ not accepted.
- **Dependencies:** SUB-06.

### SUB-03 — Request contract diverges from the official SDK-generated request: no `uuid` in the body and no `Clearance-Status` header for clearance
- **Severity:** P1
- **Status:** VERIFIED DEFECT (divergence) — live acceptance NOT VERIFIED
- **Business process:** HTTP request to `/invoices/reporting/single` and `/invoices/clearance/single`.
- **Official requirement:** The official SDK (238-R3.4.8) `-invoiceRequest` emits `{"invoiceHash","uuid","invoice"}` with `uuid = cbc:UUID` (`<audit-workspace>/official/R2-sdk-howto.md:128,131`; `<audit-workspace>/official/R2-work/run-sign/simp_request.json` keys `['invoice','invoiceHash','uuid']`). The Nov-2022 Developer Portal manual FAQ shows a two-field example and defers to "the Integration Sandbox section" (`DEVELOPER-PORTAL-MANUAL.txt:1958-1968, 2015-2027`). Sandbox API model lists `uuid` as required and the Clearance API a `Clearance-Status: 1` header `[official-ref to confirm]`.
- **Actual behavior:** Body is `['invoiceHash' => …, 'invoice' => base64(xml)]` only (`ZatcaHttpTransport.php:35-38`; probe P01 `body keys=["invoiceHash","invoice"]`); headers are `accept-version`, `accept-language`, `Authorization`, `Content-Type`, `Accept` — no `Clearance-Status` (probe P01 "clearance-status header present? NO"). The existing test asserts exactly this two-field body (`ZatcaHttpTransportTest.php:48-58`), so the gap is enshrined. `accept-version: v2` matches the manual's literal text (`DEVELOPER-PORTAL-MANUAL.txt:1373`); case-sensitivity vs the Swagger's `V2` is NOT VERIFIED.
- **Expected behavior:** Send `uuid` (= `invoices.zatca_uuid`, which equals `cbc:UUID`) and `Clearance-Status: 1` on clearance calls, per the current API reference.
- **Evidence:** as above.
- **Impact:** Regulatory/operational — probable `400` on every live submission (if `uuid` is enforced), i.e. zero successful submissions in production until fixed.
- **Recommendation:** Add `uuid` to the body (and assert it equals the `cbc:UUID` inside the XML); add `Clearance-Status: 1` for clearance; verify against the sandbox API reference before enabling dispatch.
- **Regression tests required:** request body/headers assertion updated; uuid mismatch with XML ⇒ preflight failure.
- **Dependencies:** none.

### SUB-04 — The ZATCA-returned cleared XML (stamp + QR) is stored but never used: customers always receive the locally generated QR; credit/debit notes have no ZATCA artefacts at all
- **Severity:** P1
- **Status:** PARTIALLY IMPLEMENTED (cleared XML persisted) / NOT IMPLEMENTED (consumption; notes)
- **Business process:** Standard invoice output after clearance; sales returns (credit notes).
- **Official requirement:** Clearance "applies a cryptographic stamp from ZATCA side and generates a QR Code string. After that the XML is returned back" (`DEVELOPER-PORTAL-MANUAL.txt:2000-2003`); taxpayers "visualize the QR Code based on the QR Code string received from ZATCA" (`E-Invoicing_Detailed__Guideline.txt:2080-2085`); Clearance/Reporting apply to "credit note, or debit note" as well (`DEVELOPER-PORTAL-MANUAL.txt:1940-1946, 1995-1998`; `E-Invoicing_Detailed__Guideline.txt:1017-1018`).
- **Actual behavior:** `zatca_cleared_xml` is written by the dispatcher (`ZatcaSubmissionDispatcher.php:51`) and then has **no reader** anywhere (grep `zatca_cleared_xml|cleared_xml` in `app/`, `web/src`: only the model fillable and the dispatcher). The QR on a standard invoice is the locally computed phase-2 QR (tags 1-8; `ZatcaSignedInvoiceFinalizer.php:47-62`, `ZatcaPhaseTwoQrEncoder.php:59-71`) and never replaced (probe P01: `qr=true` unchanged after clearance). `ReturnDocument`/`return_lines` have no `zatca_*` columns (probe P10 asserts `return_documents.zatca_xml/zatca_uuid` absent; grep `zatca` in `ReturnService.php`: none); `requestManual()` accepts only `Invoice` (`ZatcaSubmissionService.php:20`); the XML builder hard-codes `InvoiceTypeCode 388` (`ZatcaService.php:272`).
- **Expected behavior:** After a successful clearance the invoice's customer-facing QR/XML must be the ZATCA-stamped version; credit/debit notes must be generated (381/383), chained (ICV/PIH) and submitted through the same chain.
- **Evidence:** as above.
- **Impact:** Regulatory — B2B outputs carry a non-ZATCA QR; sales returns are never reported/cleared (credit notes for B2C must also be reported within 24 h).
- **Recommendation:** Extract the QR (`AdditionalDocumentReference[ID='QR']`) from `zatca_cleared_xml` and expose it as the invoice QR once cleared; expose the cleared XML for download/archival; extend the document/submission model to `ReturnDocument` (document type 381/383, `BillingReference`).
- **Regression tests required:** cleared QR extraction; return document XML + attempt creation; chain continuity across invoices and notes.
- **Dependencies:** SUB-01; XML-stream findings on 381/383.

### SUB-07 — A rejected invoice cannot be corrected: resubmission resends the identical rejected XML; no "re-issue after rectification" flow exists
- **Severity:** P1
- **Status:** NOT IMPLEMENTED
- **Business process:** Handling of `rejected` (HTTP 400) clearance/reporting results.
- **Official requirement:** "if clearing fails (Response is 400 Error), then the taxpayer must submit another invoice for clearance after rectifying the errors … Rejected document's hash and counter value should not be changed or updated" (`E-Invoicing_Detailed__Guideline.txt:2115-2121`); "The new invoice should include its own new unique hash, UUID, invoice counter value and timestamp" (`E-invoicing-Detailed-Technical-Guideline.txt:2736-2746` simplified, `2764-2778` standard — date updated for standard); rejected documents may appear in VAT returns (`…:2493`).
- **Actual behavior:** The posted invoice is immutable (`InvoiceController.php:270-272`); `zatca_xml` is frozen; a new attempt after `rejected` re-sends byte-identical XML (`ZatcaSubmissionService.php:48-71` + `assertSnapshot` requires the same hash; probe P10 "resubmission of rejected invoice resends identical XML ⇒ rejected"). There is no "correct & re-issue" action; the only workaround is `duplicate()` → edit → post (new ICV/UUID), while the rejected original remains a posted, printed, ledger-bearing invoice that can only be neutralised by a credit note that itself is not ZATCA-covered (SUB-04). Nothing marks the invoice as "rejected by ZATCA" for the user (no UI, SUB-05/OPS-02).
- **Expected behavior:** A guided correction flow: mark invoice `zatca_rejected`, block its release (standard), create the corrected replacement document with new UUID/ICV/hash (PIH = last generated), and record the linkage; block re-sending identical XML after a 400 (only `failed`/retryable results should be re-sent as-is).
- **Evidence:** probe P10; refs above.
- **Impact:** Regulatory/operational — rejected B2B invoices stay in circulation; operators can only loop on identical rejections.
- **Recommendation:** as in "Expected"; distinguish `rejected` (needs correction) from `failed` (retry as-is) in the API/UI; prevent `requestManual` after `rejected` unless an explicit override.
- **Regression tests required:** after 400, same-XML resubmission is refused; correction creates a new document with ICV+1 and PIH of the last generated document.
- **Dependencies:** SUB-01, SUB-04.

### OPS-01 — Production deployment has no queue worker or scheduler and pins `QUEUE_CONNECTION=sync`; readiness cannot detect an absent worker, so enabling dispatch with a `database`/`redis` queue strands every attempt as `pending` forever
- **Severity:** P1
- **Status:** VERIFIED DEFECT (repo deploy artifacts) / production state NOT VERIFIED
- **Business process:** Dispatch of `SendZatcaSubmission` jobs in production.
- **Official requirement:** n/a — internal reliability invariant (24-hour rule indirectly, see SUB-05).
- **Actual behavior:** `Dockerfile:47-53` sets `QUEUE_CONNECTION=sync`, `CACHE_STORE=file`; `deploy/entrypoint.sh:98` runs only `apache2-foreground`; `render.yaml:13-20` defines one web service; no `queue:work`, `schedule:run`, Horizon or supervisor anywhere (`grep` over `render.yaml`, `Dockerfile`, `deploy/`, `.github/workflows`: none). `routes/console.php:38-46,63-71` itself documents "لا عامل خلفي (`QUEUE=sync`)… لا يشغّل `schedule:run` ولا cron". With `sync`, readiness correctly blocks (`unsafe_queue_connection`, probe P08/P13). But if an operator sets `ZATCA_SUBMISSION_QUEUE_CONNECTION=database` to satisfy readiness, `inspect()` reports `ready:true` with **no worker check** (probe P08 `{"ready":true,…,"blockers":[]}`), jobs are written to `jobs` and never consumed, attempts stay `pending` with `queue_count≥1` (probe P08: still pending after 3 days), and no alert exists. `ZATCA_SUBMISSION_DISPATCH_ENABLED` / `_QUEUE_CONNECTION` / `_QUEUE` / `ZATCA_SIGNATURE_POLICY_*` appear in no deploy artifact (`grep ZATCA_` over `render.yaml`, `Dockerfile`, `deploy/`, `.github/`: none; only CA-bundle vars in `HOW_TO_RUN.md:83-85`). The job's `timeout=45` (`SendZatcaSubmission.php:22`) needs `pcntl`, which `Dockerfile:13` does not install (NOT VERIFIED in the base image).
- **Expected behavior:** A dedicated worker process (`queue:work --queue=zatca`) and `schedule:run` in the deployment (separate Render/Railway service or supervisor), readiness that verifies a live worker (heartbeat) and a stuck-job sweep, and all ZATCA env vars documented/provisioned.
- **Evidence:** refs above; probes P07 (what a worker *would* do), P08.
- **Impact:** Operational/regulatory — in the shipped deployment no submission can ever be transmitted; enabling the flag creates a silent backlog.
- **Recommendation:** Add worker + scheduler services; add a worker heartbeat (cache key refreshed by the worker) checked by `ZatcaTransportReadiness`; add a sweep for `pending` with `queued_at` older than N minutes; add `pcntl` to the image; document env vars in `deploy/DEPLOY.md`/`render.yaml`.
- **Regression tests required:** readiness reports `worker_unavailable` when heartbeat is stale; sweep re-queues stale attempts; integration smoke in CI running `queue:work --once` (as probe P07).
- **Dependencies:** SUB-05, OPS-02.

### OPS-02 — No operator observability: no tenant-wide attempt list/counts, no dispatch/result logging, no metrics, no UI; failures reach operators only as in-app bell notifications that open an invoice page that shows nothing about ZATCA submission
- **Severity:** P1
- **Status:** NOT IMPLEMENTED (UI/backlog/logging) · PARTIALLY IMPLEMENTED (per-invoice API + notifications)
- **Business process:** Day-to-day monitoring of reporting/clearance backlog and failures.
- **Official requirement:** n/a — internal invariant; indirectly the 24-hour rule and "share e-invoice and re-submit once issue fixed" guidance (`E-Invoicing_Detailed__Guideline.txt:1480-1495`).
- **Actual behavior:** The only read API is per invoice (`GET /invoices/{id}/zatca/submissions`, `ZatcaSubmissionController.php:22-31`); there is no tenant-wide listing/filter/count route (probe P08: `/api/zatca/submissions` and `/api/zatca-submissions` → 404). The chain writes **no log lines** on dispatch/accept/reject/fail (grep `Log::` in all `Zatca*` files: only `ZatcaNotificationBridge.php:48` for notification failure). No metrics. The notification action `view_zatca_submission` maps to the invoice page (`NotificationActions.php:28-31`, `web/src/lib/notifications.ts:74-76`), which has no submission panel (grep: none). Re-dispatch actor is not recorded (only `queue_count`/`queued_at`, `ZatcaSubmissionAttempt.php:28-29`). `response_message` is a fixed Arabic string, not ZATCA's message (`ZatcaHttpTransport.php:92-94`); ZATCA's own text is only inside `response_payload.validationResults`.
- **Expected behavior:** Tenant-wide submissions index with status filters/counts (pending/queued/failed/rejected/overdue), per-invoice status badge, structured logs on every state change (tenant, invoice, attempt, env, http status, code), metrics (backlog age, failure rate), audit of who re-queued.
- **Evidence:** refs above; probes P08, P15.
- **Impact:** Operational — breaches and stuck jobs are invisible; support cannot reconstruct what was sent when.
- **Recommendation:** add `GET /zatca/submissions?status=…` (tenant-wide, branch-aware), log + metric hooks in `complete()`/`enqueue()`, `queued_by`, invoice-page ZATCA panel, and a backlog widget on the e-invoice settings page.
- **Regression tests required:** index filters/counts; log assertions on each transition; UI test for the panel.
- **Dependencies:** SUB-05, OPS-01.

### SUB-06 — No "in-doubt" state after a timeout/transport failure; the retry re-sends the identical document with no reconciliation; a 400 on the duplicate would record the invoice as `rejected` although ZATCA holds it
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED (failed/retryable classification exists) / NOT IMPLEMENTED (reconcile)
- **Business process:** Network timeouts, 5xx, 429 during submission.
- **Official requirement:** "Can I submit the same invoice twice? No, ZATCA does not allow the same document to be submitted twice. However, this will not be rejected at the time of submission." (`E-Invoicing_Detailed__Guideline.txt:2087-2089`); for server overload "System should continue re-submitting same invoice until ZATCA servers are responding" (`…:1489-1491`). Exact duplicate-response behaviour of the live API: `[official-ref to confirm]`.
- **Actual behavior:** A read timeout surfaces as `ConnectionException` (Guzzle maps `CURLE_OPERATION_TIMEOUTED` to `ConnectException`, `CurlFactory.php:1082-1088`; Laravel converts it, `PendingRequest.php:940-941`) ⇒ `failed/connection_failed/retryable` (`ZatcaHttpTransport.php:39-48`; probe P04). The attempt is terminal; the only continuation is a new attempt with a new key that re-sends byte-identical `invoiceHash`/`invoice` (probe P04 "identical body resent? true"). There is no `unknown` state, no `reconciled_at`, no lookup of the previous result before re-sending (probe P04 asserts `reconciled_at` column absent). If ZATCA answers the duplicate with 400, AWJ records `rejected` for an invoice ZATCA actually accepted (probe P04 second scenario). Also any non-`ConnectException` transport error (e.g. TLS failure, Guzzle `RequestException` without response) is caught by the dispatcher's `catch (Throwable)` and recorded as `submission_preflight_failed`, `retryable:false` (`ZatcaSubmissionDispatcher.php:63-72`; probe P05) — a transient network problem is labelled a configuration error.
- **Expected behavior:** Distinguish `unknown` (request may have reached ZATCA) from `failed` (certainly not sent); before re-sending after `unknown`, follow ZATCA's documented duplicate semantics (or require operator confirmation); map transport exceptions (`TransferException`/`RequestException` w/o response) to `failed/retryable`.
- **Evidence:** probes P04, P05; refs above.
- **Impact:** Regulatory (duplicate submissions "not allowed") / operational (false `rejected`).
- **Recommendation:** add `unknown` outcome + reconciliation step; narrow the `catch (Throwable)` to configuration exceptions and map Guzzle transfer exceptions to retryable failures.
- **Regression tests required:** timeout ⇒ `unknown`; retry after `unknown` requires reconcile flag; TLS exception ⇒ `failed/retryable`.
- **Dependencies:** SUB-02.

### SUB-08 — Submission attempts carry no environment; an acceptance obtained in `simulation` blocks production submission, and a pending attempt follows whatever environment is active at dispatch time
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Environment switching (simulation → production) and audit of acceptances.
- **Official requirement:** n/a — internal invariant (audit trail must say which ZATCA environment accepted a document).
- **Actual behavior:** `zatca_submission_attempts` has no `environment` column (migration `000130:11-36`; probe P09 asserts absence). The dispatcher resolves credentials/endpoint from the *current* `active_environment` (`ZatcaSubmissionDispatcher.php:33`, `ZatcaTransportCredentialResolver.php:22`): probe P09 shows an attempt created under simulation being POSTed to `…/core/…` after the switch. After a simulation acceptance, `requestManual` refuses any new attempt (409 "مقبولة لدى ZATCA", `ZatcaSubmissionService.php:52-54`; probe P09). The UI only warns on switching (`web/.../einvoice/page.tsx:240-241`).
- **Expected behavior:** Persist `environment` (and credential fingerprint) on each attempt; `assertSnapshot` must refuse dispatch when the active environment differs from the attempt's; "already accepted" must be evaluated per environment; invoices signed under simulation should be flagged as non-production.
- **Evidence:** probe P09; refs above.
- **Impact:** Operational/audit — ambiguous acceptance records; stranded invoices after go-live; accidental production submission of attempts created during testing.
- **Recommendation:** as in "Expected"; block switching `active_environment` while pending attempts exist.
- **Regression tests required:** env mismatch ⇒ preflight failure; acceptance scoped by env.
- **Dependencies:** SUB-10 (chain across environments).

### SUB-09 — HTTP call executed inside an open DB transaction holding a row lock (up to 35 s); a DB disconnect during the call loses an acceptance that ZATCA already recorded
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Dispatcher transaction boundary.
- **Official requirement:** n/a — internal reliability invariant.
- **Actual behavior:** `dispatch()` wraps lock → credential resolution → **HTTP POST (connect 5 s + 30 s read)** → cleared-XML write → `complete()` (nested transaction) in a single `DB::transaction` (`ZatcaSubmissionDispatcher.php:23-73`; `config/zatca.php:61-62`); probe P01 observed `DB::transactionLevel() = 2` while the fake HTTP call ran. If the DB connection drops or the worker is killed between the ZATCA response and commit, the whole transaction rolls back: ZATCA has the document, AWJ shows `pending` (or re-queues after 5 min) and re-sends (SUB-06). On PostgreSQL the attempt row (and, via `complete()`, the same row) stays locked for the HTTP duration; `idle_in_transaction_session_timeout` (if set) would abort it.
- **Expected behavior:** Claim the attempt in a short transaction (state `sending`, lease/heartbeat), perform HTTP outside any transaction, then persist the outcome in a second short transaction; treat a crash between HTTP and persist as `unknown`.
- **Evidence:** probe P01; refs above.
- **Impact:** Operational/regulatory — lost acceptances ⇒ duplicate submissions; lock contention.
- **Recommendation:** introduce `sending` state with `claimed_at`/`lease_until`; move HTTP out of the transaction; sweep expired leases to `unknown`.
- **Regression tests required:** HTTP callback asserts `DB::transactionLevel() === 0`; crash simulation leaves `sending` with lease, sweep moves to `unknown`.
- **Dependencies:** SUB-06.

### SUB-10 — One ICV/PIH chain per tenant regardless of environment: simulation (test) invoices are chained into the production sequence
- **Severity:** P2
- **Status:** NOT VERIFIED (requirement) / VERIFIED (behaviour)
- **Business process:** Go-live after simulation testing.
- **Official requirement:** "Taxpayers must generate documents in a single sequence per EGS that it has onboarded" (`E-invoicing-Detailed-Technical-Guideline.txt:1596-1598`). Whether a simulation onboarding and a production onboarding of the same solution count as one EGS sequence: `[official-ref to confirm]`.
- **Actual behavior:** `ZatcaService::buildFor` derives ICV/PIH from the last invoice with a hash in the tenant (or branch) scope, with no environment dimension (`ZatcaService.php:59-75`); invoices signed with the simulation CSID and those signed with the production CSID share one chain and one `zatca_icv` sequence.
- **Expected behavior:** Decide (with ZATCA guidance) whether production must start a fresh chain; at minimum tag invoices with the signing environment and block mixing.
- **Evidence:** refs above; probe P09 (switching is a settings PUT).
- **Impact:** Regulatory (potential PIH/ICV continuity findings at ZATCA) — uncertain.
- **Recommendation:** store `zatca_environment` on invoices; make chain scope include it or document the decision as an ADR after confirming with ZATCA.
- **Regression tests required:** chain scoping per decision.
- **Dependencies:** SUB-08; cross-stream (XML/signing).

### SUB-11 — Non-rejection HTTP statuses (401/403/404/409/413/422/303) are recorded as `rejected` and notified as "ZATCA rejected this invoice"
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** Result classification and operator messaging.
- **Official requirement:** Documented codes: 200, 202, 303, 400, 500 (`DEVELOPER-PORTAL-MANUAL.txt:2050-2062, 2071-2081`); 413 "Request Entity is too large" (`E-Invoicing_Detailed__Guideline.txt:2093-2096`); 401 = credential problem `[official-ref to confirm]`.
- **Actual behavior:** `$status = accepted ? … : (retryable ? 'failed' : 'rejected')` with `retryable = 408|429|≥500` (`ZatcaHttpTransport.php:84-85`): probe P03 shows 401/403/404/409/413/422 ⇒ `rejected` + one critical notification "رفضت منصة ZATCA هذه الفاتورة" (`ZatcaNotificationBridge.php:80-82`). A revoked/expired CSID (401) therefore reads as an invoice-content rejection, steering operators toward "correct the invoice" instead of "fix credentials".
- **Expected behavior:** Separate `auth_error` (401/403), `routing_error` (303), `too_large` (413), `conflict` (409) from document `rejected` (400 with `validationResults`); notifications should name the category.
- **Evidence:** probe P03.
- **Impact:** Operational — wrong remediation, noisy critical alerts.
- **Recommendation:** explicit status map + `failure_category` column/payload field.
- **Regression tests required:** matrix assertions per category.
- **Dependencies:** OPS-02.

### SUB-12 — An owner/admin can set `active_environment` to an environment without credentials; all invoice posting (including POS) then fails closed tenant-wide, with only a client-side guard
- **Severity:** P2
- **Status:** VERIFIED DEFECT (availability hazard; the fail-closed posting itself is intended)
- **Business process:** E-invoice settings.
- **Official requirement:** n/a — internal availability invariant.
- **Actual behavior:** `UpdateZatcaSettingsRequest` validates `active_environment` only against the enum (`UpdateZatcaSettingsRequest.php:22`); the UI disables options without credentials (`web/.../einvoice/page.tsx:240`) but the server accepts them (probe P11: owner PUT `active_environment=production` without a production credential ⇒ 200). Because a credential row exists for another environment, `ZatcaService::buildFor` takes the signing path and throws (`ZatcaService.php:89-105`; probe P11 "بيانات اعتماد ZATCA لبيئة production غير مهيأة"), so every subsequent posting/POS checkout rolls back until the setting is reverted.
- **Expected behavior:** Server-side validation that the target environment has a `configured`, unexpired credential (and, for production, a production-stage CSID), plus a confirmation step; expose the blocker in readiness.
- **Evidence:** probe P11; `ZatcaSignedInvoicePostingTest:62-83`.
- **Impact:** Operational — a single settings click halts sales.
- **Recommendation:** add the validation to `UpdateZatcaSettingsRequest::withValidator`; log the change.
- **Regression tests required:** PUT with missing credential ⇒ 422.
- **Dependencies:** none.

### OPS-03 — Readiness checks are shallow: no trust-anchor presence, certificate-expiry window, outbound-connectivity, worker-liveness, clock-skew or `xmllint` checks; readiness is evaluated only at enqueue/settings time, never at posting
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Pre-flight before enabling live submission.
- **Official requirement:** n/a — internal invariant (certificate validity and timestamps are prerequisites for acceptance).
- **Actual behavior:** `ZatcaTransportReadiness::inspect()` checks: flag, queue connection name, credential resolvable (stage/expiry/csid/secret), endpoint config (`ZatcaTransportReadiness.php:22-60`). `ZatcaSigningReadiness` checks credential material + signature policy (`ZatcaSigningReadiness.php:28-52`). Not checked: CA bundle readability at runtime (only at credential save, `ZatcaCredentialMaterialValidator.php:55-60`), expiry horizon (only `isFuture()`, `ZatcaTransportCredentialResolver.php:39-41`), worker liveness (OPS-01), outbound DNS/TLS reachability, `xmllint` presence, system clock vs. NTP (signing time/issue time), CSID environment ↔ endpoint consistency beyond the row's own `environment` field. Readiness is consulted in `enqueue()` and the settings page only (`ZatcaSubmissionQueue.php:19-22`; `ZatcaSettingsController.php:40-41`).
- **Expected behavior:** A composite readiness with the above checks, surfaced in the UI and enforced before the flag can be honoured; a certificate-expiry warning window (e.g. 30 days).
- **Evidence:** refs above.
- **Impact:** Operational — late discovery of expired CSIDs, missing bundles, unreachable gateway.
- **Recommendation:** extend `inspect()`; add `expires_within_days` blocker; add synthetic connectivity probe (HEAD/OPTIONS to the gateway host, no invoice) behind explicit opt-in.
- **Regression tests required:** each new blocker code.
- **Dependencies:** OPS-01.

### OPS-04 — Job failures outside the dispatcher leave the attempt `pending` with no notification; recovery relies on an operator noticing `failed_jobs` and manually re-dispatching per invoice; no runbook exists
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED (manual re-dispatch endpoint) / NOT IMPLEMENTED (failed-hook, sweep, runbook)
- **Business process:** Worker crash / job exception recovery; bulk retry.
- **Official requirement:** n/a — internal invariant.
- **Actual behavior:** `SendZatcaSubmission` has `tries=1`, no `failed()` method, no middleware (`SendZatcaSubmission.php:17-55`; probe P06). Probe P15: a job that throws before reaching the dispatcher ends in `failed_jobs` (1 row), the attempt stays `pending`, no notification. Recovery = `POST …/{attemptId}/dispatch` per invoice after the 5-minute window (`ZatcaSubmissionQueue.php:29-33`), throttled 10/min (`routes/api.php:684`); no bulk retry; no documented procedure (grep "runbook|retry|dispatch_enabled" in `docs/`, `deploy/DEPLOY.md`: none). What `ZatcaSubmissionRecoveryTest` proves: a pending attempt can be re-queued once readiness is fixed, `sync` is refused without touching queue audit, a recently-queued attempt cannot be queued twice, and the settings endpoint exposes blockers — it does **not** prove recovery after a crashed worker or a lost job.
- **Expected behavior:** `failed()` hook that records the exception on the attempt (or a `job_failed` marker) and notifies; a scheduled sweep for stale `queued_at`; bulk retry; a runbook (enable flag, worker, env vars, what each status means, how to retry/reconcile).
- **Evidence:** probes P06, P15; refs above.
- **Impact:** Operational — silent stalls; slow recovery at volume.
- **Recommendation:** as in "Expected".
- **Regression tests required:** job exception ⇒ attempt flagged + notification; sweep re-queues; bulk retry endpoint.
- **Dependencies:** OPS-01, OPS-02.

### SUB-13 — "One open attempt per invoice" and "no new attempt after acceptance" are enforced only by the service's row lock, not by the schema
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Data integrity of the attempts table.
- **Official requirement:** n/a — internal invariant.
- **Actual behavior:** Unique indexes exist for `(invoice_id, attempt_number)` and `(tenant_id, idempotency_key_hash)` (PG scenario D), but a second `pending` row for an invoice that already has an accepted attempt can be inserted at the DB level (PG scenario E "INSERTED"); raw deletes are possible (scenario F) — the permanence guarantee is model-level only. Any future write path bypassing `requestManual()` (imports, console commands) would break the invariant silently.
- **Expected behavior:** Partial unique index `(invoice_id) WHERE status = 'pending'` (PostgreSQL) and a DB-level rule/trigger or revoked DELETE privilege for the audit table.
- **Evidence:** PG scenarios D, E, F.
- **Impact:** Low today (single write path, PG-verified serialisation).
- **Recommendation:** add the partial unique index (CI runs PG) and a sqlite-compatible fallback.
- **Regression tests required:** duplicate pending insert fails on PG.
- **Dependencies:** none.

### SUB-14 — Failure notifications fan out one critical alert per failed attempt to every `invoices.manage` user; at POS volumes this is an alert storm; API throttle (10/min) makes manual catch-up impractical
- **Severity:** P3
- **Status:** VERIFIED (design limitation)
- **Business process:** Alerting and manual retry at scale.
- **Official requirement:** n/a.
- **Actual behavior:** `resolveRecipients()` loads all active tenant users and filters by permission on every failure (`ZatcaNotificationBridge.php:118-127`); `type` is per status, `dedupe_key` per attempt (`…:97,106`), so 500 failed POS reports during an outage ⇒ 500 critical notifications per manager. Submission/dispatch endpoints are throttled 10/min (`routes/api.php:682-684`).
- **Expected behavior:** Aggregated digest ("N invoices failed reporting since …"), severity by age vs. 24 h deadline, and a non-throttled bulk retry.
- **Evidence:** refs above.
- **Impact:** Operational.
- **Recommendation:** digest + backlog counter; raise/remove throttle for the automatic path.
- **Regression tests required:** aggregation window behaviour.
- **Dependencies:** OPS-02, SUB-05.

### SUB-15 — Minor contract/hygiene items
- **Severity:** P3
- **Status:** VERIFIED
- **Actual behavior:** (a) the readiness-failure 422 from `POST …/dispatch` returns a generic message without blocker codes (probe P13), while `GET /zatca-settings` lists them; (b) `response_message` is a localized constant rather than ZATCA's message (`ZatcaHttpTransport.php:92-94`); (c) `ZatcaSubmissionController::store` catches and re-throws `PDOException` as a no-op (`ZatcaSubmissionController.php:51-52`); (d) the existing transport test enshrines the two-field body (`ZatcaHttpTransportTest.php:56-57`), so fixing SUB-03 requires changing a test; (e) `accept-version` value case vs. Swagger `V2` NOT VERIFIED.
- **Recommendation:** return blocker codes in the 422; store ZATCA's top-level message; clean up (c); update tests with SUB-03.

---

## 4. NOT VERIFIED / open questions

| Item | Why not verifiable here | How to obtain evidence |
|---|---|---|
| Live acceptance of the request contract (body without `uuid`, no `Clearance-Status`, `accept-version: v2` case) | No live traffic allowed; Nov-2022 manual shows a 2-field example, SDK emits 3 fields | Run one simulation submission with a sandbox CSID in a controlled environment, or confirm against the current Developer Portal API reference (R2 register) |
| Exact live response schema (`reportingStatus`/`clearanceStatus`/`validationResults`) and status codes 401/409/413/429 semantics | Manual (2022) lists 200/202/303/400/500; sandbox strings confirm accepted/warning/rejected categories | R2 register / sandbox Swagger |
| Whether a ZATCA 303 carries a `Location` header (⇒ followed as GET) | documentation silent | sandbox observation |
| Duplicate-submission handling at ZATCA ("not rejected at submission") and its compliance consequence | FAQ only | R1 register / ZATCA support |
| Whether simulation and production must have separate ICV/PIH sequences | guideline speaks of "per EGS onboarded" | R1 register / ZATCA support |
| Production configuration: `ZATCA_SUBMISSION_*`, `ZATCA_SIGNATURE_POLICY_*`, CA bundles, queue/cache drivers, Redis, worker/scheduler presence, `pcntl` in the image | not in repo; sandbox has no production access | inspect the live service env + `php -m` in the running container |
| Behaviour of `idle_in_transaction_session_timeout`/connection drops during the in-transaction HTTP call on the production PostgreSQL | no production DB | DBA review of PG settings |
| `Accept-Version` header value case sensitivity at the gateway | n/a | sandbox observation |

Verified on both engines: unique constraints, `lockForUpdate` serialisation of attempt creation and dispatch (PostgreSQL 16, real concurrent transactions). No partial indexes exist on the attempts table, so no PG-only index behaviour was relevant.

---

## 5. Cross-stream notes

- **XML/signing stream:** (1) credit/debit notes (`ReturnDocument`) have no UBL/ZATCA artefacts and `InvoiceTypeCode` is hard-coded `388` (`ZatcaService.php:272`) — Clearance/Reporting must cover 381/383; (2) ProfileID `reporting:1.0` is used for standard (clearance) documents too (`ZatcaService.php:267`) — check against the XML standard; (3) `uuid` in the request body must equal `cbc:UUID`; (4) simulation and production share one ICV/PIH chain (SUB-10); (5) the QR for standard invoices should come from the cleared XML (SUB-04); (6) resubmission after rejection requires a *new* document with new UUID/ICV/timestamp — immutable `zatca_xml` makes this impossible today (SUB-07).
- **VAT/tax stream:** rejected invoices remain posted in the ledger and the output-VAT account with no ZATCA-aware flag; ZATCA notes rejected invoices still belong in VAT returns (`E-invoicing-Detailed-Technical-Guideline.txt:2493`) — reporting needs the rejection state.
- **POS stream:** POS checkout issues simplified invoices immediately (correct model) but nothing reports them (SUB-05); receipts show the local phase-2 QR — fine for simplified only if reporting follows within 24 h.
- **Security stream:** `ZatcaCredentialService` stores `binary_security_token` (CSID), `secret`, `private_key` in one `encrypted:array` under `APP_KEY` (`ZatcaCredential.php:20`) — key rotation and `entrypoint.sh:59-62` ("generate a temporary APP_KEY if unset") would make all credentials undecryptable; `request_id` is stored but unused.
- **Commerce/public API stream:** the Public API exposes `posted` invoices to integrators with no clearance state (`PublicInvoiceController.php:36-80`, `PublicInvoiceResource.php:32-58`) — consumers cannot tell cleared from uncleared.

---

## Appendix A — State machine (as implemented)

```mermaid
stateDiagram-v2
    [*] --> pending : POST /invoices/{id}/zatca/submissions (requestManual)\nrequires: invoice posted + zatca_xml + document_type; Idempotency-Key;\nno latest attempt in {accepted, pending}; attempt_number = last+1
    pending --> pending : POST …/{attemptId}/dispatch or store-with-flag\n(enqueue: readiness ok, queue_count==0 or queued_at < now-5min)\nqueue_count++, queued_at=now, job pushed afterCommit
    pending --> accepted : worker → dispatcher: HTTP 200/202\n(clearance: + parseable clearedInvoice → invoices.zatca_cleared_xml)
    pending --> rejected : HTTP other 3xx/4xx (except 408/429)
    pending --> failed : 408/429/5xx, ConnectionException,\nany Throwable (preflight), invalid clearance XML
    accepted --> [*] : terminal, immutable; new attempts refused (409)
    rejected --> [*] : terminal; new attempt allowed (identical XML)
    failed --> [*] : terminal; new attempt allowed (identical XML)
```
No `sending`/`unknown`/`reconciling` states; no automatic transitions; `ZatcaSubmissionAttempt` guards: create only as `pending`; update only `pending → {accepted,rejected,failed}` (+ queue audit fields while pending); delete forbidden (model).

End-to-end sequences:
- **(a) Standard invoice (clearance):** draft (`zatca_document_type=standard`) → `POST /invoices/{id}/post` → `InvoiceService::post` (ledger, COGS, `ZatcaService::buildFor`: UUID, ICV, PIH, XML, hash, QR; signed if any credential row exists) → **invoice is immediately printable/shareable** → (manual) `POST …/zatca/submissions` → `pending` → (if `dispatch_enabled` && readiness) `SendZatcaSubmission` on queue `zatca` → `ZatcaSubmissionDispatcher::dispatch` → `ZatcaTransportCredentialResolver` (current env, production CSID) → `POST https://gw-fatoora.zatca.gov.sa/e-invoicing/{simulation|core}/invoices/clearance/single` → 200/202 → `clearedInvoice` decoded/validated → `invoices.zatca_cleared_xml` → `complete(accepted)`; else `complete(rejected|failed)` → `ZatcaNotificationBridge` (afterCommit) → in-app notification.
- **(b) Simplified invoice (reporting):** identical, endpoint `…/invoices/reporting/single`, no cleared-XML handling; POS checkout = create+post in one call, receipt QR returned immediately.

What `ZATCA_SUBMISSION_DISPATCH_ENABLED` controls — every read: `config/zatca.php:58` (definition) → `ZatcaTransportReadiness::inspect()` (`:24`, blocker `dispatch_disabled`, consumed by `ZatcaSubmissionQueue::enqueue` `:19-22` and the settings page) and `ZatcaSubmissionController::store` (`:59`, decides whether a newly created attempt is enqueued at all). `false`: attempts are recorded `pending`, nothing is queued, `dispatch` endpoint returns 422. `true`: new attempts are enqueued when readiness passes; the `dispatch` endpoint can (re)queue. The flag never triggers a submission by itself and is never read by posting, scheduler or UI.

## Appendix B — ZATCA routes → middleware → permission

Group middleware for all of them (`routes/api.php:202,349`): `ForceJsonResponse`, `IdentifyTenantHostname`, `auth:sanctum`, `EnsureUserPrincipal`, `SetTenant`, `SetBranch`, `EnsureActiveSubscription` (observed in the P13 stack trace), then route-level:

| Route | Route middleware | Permission / gate |
|---|---|---|
| `GET /api/invoices/{id}/zatca` (`routes/api.php:678`) | `EnsurePermission:zatca.view`, `EnsureApplicationActive:compliance.zatca` | zatca.view (owner/admin `*`, accountant, staff) |
| `GET /api/invoices/{id}/zatca/submissions` (`:679-680`) | same | zatca.view |
| `POST /api/invoices/{id}/zatca/submissions` (`:681-682`) | `EnsurePermission:invoices.manage`, app gate, `throttle:10,1` | invoices.manage (owner/admin/accountant) |
| `POST /api/invoices/{id}/zatca/submissions/{attemptId}/dispatch` (`:683-684`) | same as above | invoices.manage |
| `GET /api/zatca-credentials` (`:1585`) | `EnsurePermission:company.manage`, app gate | company.manage (owner/admin) |
| `PUT /api/zatca-credentials/{environment}` (`:1586-1588`) | company.manage, app gate, `throttle:5,1` (+ password re-auth in service) | company.manage |
| `GET /api/zatca-settings` (`:1589`) | `EnsurePermission:invoices.view`, app gate | invoices.view (all roles) |
| `PUT /api/zatca-settings` (`:1590`) | company.manage, app gate | company.manage |
| Console `entitlements:grant-legacy-reachable-zatca` | n/a (artisan; hard-coded single tenant UUID, `--apply` required) | ops only |

`EnsureApplicationActive:compliance.zatca`: `disabled` ⇒ 403 all; `suspended` ⇒ GET/HEAD only (`app/Http/Middleware/EnsureApplicationActive.php:23-38`). Probe P11 confirms staff 403 on POST, accountant 202 on POST / 403 on settings, owner 200 on settings.

## Appendix C — Release-gating path inventory (does the path consult ZATCA clearance/reporting status?)

| Path | Consults ZATCA status? | Evidence |
|---|---|---|
| `POST /invoices/{id}/post` → `InvoiceService::post` | **No** — sets `posted` + local QR/XML atomically | `InvoiceController.php:331-338`; `InvoiceService.php:1020-1056` |
| `GET /invoices/{id}` (`InvoiceResource.zatca.qr/hash/uuid/icv`) | **No** | `InvoiceResource.php:128-137` |
| `GET /invoices/{id}/zatca` (QR, XML, hash, PIH) | **No** (returns local snapshot; cleared XML not exposed) | `InvoiceController.php:341-359`; probe P01 |
| Web invoice page: Print / Thermal print / Download PDF / Share (Web Share of generated PDF) / Excel | **No** (QR from `/invoices/{id}/zatca`) | `web/src/app/(app)/invoices/[id]/page.tsx:281,511-525,626,673,685,902-909`; `doc-qr.tsx:20-37`; `invoice-pdf.ts:62-63` |
| POS checkout → immediate receipt with QR | **No** | `PosController.php:200-229`; `web/src/app/(pos)/pos/page.tsx:1430-1433,1726`; `pos-invoice-details.tsx:50` |
| Public API `GET /public/v1/invoices`, `/invoices/{id}` (integrators) | **No** status field; ZATCA fields excluded | `PublicInvoiceController.php:18-80`; `PublicInvoiceResource.php:32-58` |
| Webhooks | N/A — only `invoice.created`; no posted/ZATCA events | `WebhookEventCatalog.php:12-20` |
| Email / WhatsApp / SMS invoice sending | **Not implemented server-side** (no route; `app/Mail` has only `AuthActionMail`) | grep §1; `routes/api.php` |
| Public share link / customer portal | **Not found** | grep `portal\|customer-access` in routes: none |
| Storefront order confirmation | N/A — `CommerceOrder != Invoice`, no invoice document | `storefront/src/components/checkout/awj/Confirmation.tsx:28,168` |
| Mobile app | N/A — no invoice/ZATCA references | grep `mobile/`: none |
| Credit notes (`ReturnDocument`) print/post | **No ZATCA at all** | probe P10; grep `ReturnService.php` |
| Lifecycle state distinct from `posted` | **None** (`invoices.status ∈ {draft,posted,cancelled}`; no `zatca_*_status` columns) | probe P08 assertions; migrations 000012/000013/000129/000132 |

**Answer to Q4:** a standard invoice reaches the buyer (print, PDF, share, POS receipt, public API) before any Clearance in every path; there is no "issued/cleared" state.

## Appendix D — Production-readiness inputs (Q12)

| Item | Configured in repo deploy artifacts? | Must be configured in production |
|---|---|---|
| `ZATCA_SUBMISSION_DISPATCH_ENABLED` | No (default `false`, `config/zatca.php:58`) | Yes — only after everything below |
| `ZATCA_SUBMISSION_QUEUE_CONNECTION` / `ZATCA_SUBMISSION_QUEUE` | No | Yes — a non-`sync` connection (`database`/`redis`) |
| Queue worker for queue `zatca` | **No** (Apache only, `entrypoint.sh:98`; `QUEUE_CONNECTION=sync`, `Dockerfile:53`) | Yes — separate process/service |
| Scheduler (`schedule:run`) | **No** (`routes/console.php` notes it) | Needed once a sweep exists |
| `ZATCA_{DEVELOPER,SIMULATION,PRODUCTION}_CA_BUNDLE` | Documented only (`HOW_TO_RUN.md:83-85`) | Yes — PEM files readable by PHP |
| `ZATCA_SIGNATURE_POLICY_IDENTIFIER/DIGEST` | No (fail-closed, `config/zatca.php:30-33`) | Yes — official values |
| `xmllint` | Yes (`Dockerfile:8`, `ci.yml:93`) | present |
| `pcntl` (job timeouts) | No (`Dockerfile:13`) | recommended |
| `jobs` / `failed_jobs` tables | Yes (skeleton migration kept by `assemble.sh`) | migrated at boot (`entrypoint.sh:70`) |
| Cache store supporting locks (`ShouldBeUnique`) | `CACHE_STORE=file` (`Dockerfile:51`) — file store supports locks per node only | shared store (Redis/database) if >1 worker |
| Production CSID per tenant (stage=production) | Tenant-level data | via `PUT /zatca-credentials/production` |
| Monitoring of backlog/failed jobs | No | required (OPS-02) |
| Runbook | No | required (OPS-04) |

Everything in the right column is **NOT VERIFIED** for the live service.

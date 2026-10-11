> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`. **Superseded after review (PR #1290):** where a paper says the web UI was only read, or implies there is no web test suite, `web-test-results.md` and `web-test-mapping.md` give the results of the Vitest and Playwright runs; where a paper attributes a test failure to the sandbox, `test-results.md` shows the controlled attribution.

# Stream F — Security & multi-tenancy of the VAT / e-invoicing / ZATCA surface (prefix `SEC-`)

Audit AWJ-TAX-ZATCA-AUDIT-1 · repo `<repo>` @ `0534ef16` · harness `<harness>` · date 2026-10-10.
All probes used synthetic secp256k1 CA/leaf material generated in-process; no ZATCA endpoint was contacted (`Http::fake()` only).

---

## 1. Scope & method

### 1.1 Files read in full (line counts from `wc -l`)

| Area | Files |
|---|---|
| Tenancy core | `app/Tenancy/TenantContext.php` (32) · `TenantScope.php` (22) · `BelongsToTenant.php` (25) · `BranchScope.php` (65) · `BranchScoped.php` (23) · `BelongsToBranch.php` (31) · `BranchContext.php` (36) · `CompanyWide.php` (19) · `app/Models/BaseModel.php` (16) · `design-system/foundations/multi-branch-architecture.md` (171) |
| Middleware / auth | `SetTenant.php` (72) · `SetBranch.php` (79) · `EnsurePermission.php` (26) · `EnsureApplicationActive.php` (65) · `EnsureUserPrincipal.php` · `EnsurePlatformAdministrator.php` (34) · `AuthenticateApiClient.php` (96) · `PublicApiTenantGuard.php` (44) · `PublicApiRequestContext.php` (51) · `SlowRequestAttribution.php` (68) · `app/Support/Rbac.php` (258) · `app/Models/User.php` (105) · `app/Models/Tenant.php` (47) · `AuthController.php` lines 90-300 |
| Models / migrations | `Invoice.php` (200) · `InvoiceLine.php` (91) · `ZatcaCredential.php` (30) · `ZatcaSubmissionAttempt.php` (111) · `DocumentRevision.php` (81) · `app/Support/RecordsRevisions.php` (102) · migrations `000012`, `000013`, `000129`, `000130`, `000131`, `000132`, `000133`, `000053` (ICV unique index, grep) · `000002/000005` (FK greps) |
| ZATCA services (all 35 files in `app/Services/Accounting/Zatca*.php`; read fully unless noted) | `ZatcaService.php` (316) · `ZatcaCredentialService.php` (147) · `ZatcaCredentialMaterialValidator.php` (372) · `ZatcaSubmissionService.php` (149) · `ZatcaSubmissionQueue.php` (57) · `ZatcaSubmissionDispatcher.php` (120) · `ZatcaHttpTransport.php` (138) · `ZatcaSubmissionEndpointResolver.php` (39) · `ZatcaSigningCredentialResolver.php` (62) · `ZatcaTransportCredentialResolver.php` (55) · `ZatcaTransportReadiness.php` (70) · `ZatcaSigningReadiness.php` (53) · `ZatcaNotificationBridge.php` (128) · `ZatcaInvoiceSigner.php` (64) · `ZatcaSignedInvoiceFinalizer.php` (132) · `ZatcaXmlEcdsaSigner.php` (222) · `ZatcaXmlCanonicalizer.php` (171) · `ZatcaXadesSignatureAssembler.php` (331) · `ZatcaInvoiceHasher.php` (90) · `ZatcaSignaturePolicyResolver.php` (46) · `ZatcaQrCertificateMaterialExtractor.php` (172) · `ZatcaQrCredentialMaterialResolver.php` (24) · `ZatcaTransportCredential.php` (14) · `ZatcaSigningMaterial.php` (16) · `ZatcaTransportResult.php` (19) · `ZatcaSignedInvoiceQrMaterialExtractor.php` lines 480-534 only (parser) · `ZatcaXadesSignedPropertiesBuilder.php` / `ZatcaXmlDsigSignedInfoBuilder.php` / `ZatcaPhaseTwoQrEncoder.php` grep-only (no XML parsing / no secrets handling) |
| Accounting path | `InvoiceService.php` (1285, full) · `LedgerService.php` lines 36-98, 200-232 · `PaymentService.php` lines 271-391 · `AccountingDateGuard.php` lines 95-115 · `app/Support/GeneratesDocumentNumbers.php` lines 60-180 · `app/Services/TenantApplicationService.php` lines 40-275, 370-419 · `app/Support/Settings.php` (zatca defaults 239-247, `group/get/put` 377-416) · `app/Support/ZatcaIcvScope.php` (104) · `app/Support/ApplicationCatalog.php` lines 85-110 · `app/Jobs/Accounting/SendZatcaSubmission.php` (55) · `app/Console/Commands/GrantLegacyReachableZatcaCommand.php` (107) |
| Controllers / requests / resources | `ApiController.php` (222) · `InvoiceController.php` (395) · `PublicInvoiceController.php` (178) · `ZatcaCredentialController.php` (30) · `ZatcaSettingsController.php` (50) · `ZatcaSubmissionController.php` (129) · `DocumentRevisionController.php` (47) · `UpdateZatcaCredentialRequest.php` (34) · `UpdateZatcaSettingsRequest.php` (51) · `StoreInvoiceRequest.php` (76) · `InvoiceResource.php` (142) · `PublicInvoiceResource.php` (67) |
| Routes / config | `routes/api.php` lines 202-300, 345-392, 671-691, 1403-1404, 1585-1590, 1665-1680 · `routes/api_public.php` lines 60-140 · `config/zatca.php` (64) · `deploy/cors.php` (46) · harness `config/sanctum.php` (`expiration => null`), `config/queue.php` (failed driver `database-uuids`) · `web/src/app/(app)/sales-settings/einvoice/page.tsx` (grep for storage/logging of secrets) |
| Existing tests read | `ZatcaCredentialTest.php` (537) · `ApiTenantIsolationTest.php` (105) · `ApiRbacTest.php` (59) · `PosInvoiceBranchAccessTest.php` (208) · `ZatcaSignedInvoicePostingTest.php` (185) · `ZatcaSubmissionDispatcherTest.php` (141) · `ZatcaSubmissionAttemptTest.php` (first 90) · `InteractsWithApi.php` |

Greps across `app/`: `withoutGlobalScope(s)`, `DB::table/select/statement`, `toBase()`, `unguarded`, `whereRaw`, `->getQuery()`, `Log::|logger(|report(`, `loadXML|LIBXML_|simplexml_load|libxml_disable_entity_loader`, `shell_exec|exec(|passthru|system(|popen(|proc_open`, `withoutVerifying|'verify' => false`, `lockForUpdate` (all anchors), `tokens()->delete`, `is_active`, `createToken`, `qrFor(`, `zatca_xml|zatca_qr|ZatcaCredential` consumers.

### 1.2 Probes written (`<audit-workspace>/probes/F/`) and commands

`SCR=<audit-workspace>`; all run from `<harness>`. Final console output of every probe is saved as `<audit-workspace>/logs/<ProbeClass>.log` (SQLite re-run with `touch <audit-workspace>/db/F-probe-<ProbeClass>.sqlite` first); PostgreSQL runs in `<audit-workspace>/logs/F-pg-chain.log` and `<audit-workspace>/logs/F-pg-race2.log`. Shared helper: `<audit-workspace>/probes/F/SyntheticZatcaMaterial.php` (synthetic CA/leaf generator, credential payloads, secret markers).

| Probe | Command | Result |
|---|---|---|
| `F01CrossTenantZatcaProbeTest` (B attacks A on 19 routes + lists + credentials/settings + X-Branch-Id hijack + Eloquent + Public API) | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/F-probe01.sqlite php artisan test <audit-workspace>/probes/F/F01CrossTenantZatcaProbeTest.php` | PASS 60 assertions — every cross-tenant call 404 |
| same on PostgreSQL | `DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_f DB_USERNAME=audit DB_PASSWORD=audit php artisan test <audit-workspace>/probes/F/F01CrossTenantZatcaProbeTest.php` | PASS 60 assertions |
| `F02RoleMatrixZatcaProbeTest` (owner/admin/accountant/staff/self_service + custom `cashier` role × 9 routes) | sqlite `F-probe02.sqlite` | PASS — matrix in §3 SEC-07 |
| `F03SecretLeakProbeTest` (API responses, validation errors, raw column, revisions, attempt rows, `jobs.payload`, in-process `queue:work --once`, `failed_jobs`, notifications, log file, context reset) | sqlite `F-probe03.sqlite` | PASS 89 assertions — no marker leaked anywhere |
| `F04MassAssignmentImmutabilityProbeTest` | sqlite `F-probe04.sqlite` | PASS — API ignores hostile fields; model-level tampering of issued invoice succeeds (SEC-05) |
| `F05BranchRestrictedZatcaProbeTest` | sqlite `F-probe05.sqlite` **and** PostgreSQL `audit_f` | PASS on both — reads 404, **writes/post/delete 200** (SEC-01) |
| `F06Phase2FailClosedProbeTest` | sqlite `F-probe06.sqlite` | PASS — blast-radius matrix (SEC-03) |
| `F07ReplayAndTokenProbeTest` | sqlite `F-probe07.sqlite` | PASS — replay OK; deactivated user token still valid (SEC-04) |
| `F08PlatformPlaneAndGatingProbeTest` | sqlite `F-probe08.sqlite` | PASS 2 tests — platform token 403 everywhere; gating inconsistency (SEC-08) |
| `icv_race/run.php` (PostgreSQL only; N OS processes post concurrently via `InvoiceService::post`; verifies unique index, ICV uniqueness/sequence, PIH chain, timings) | `php <audit-workspace>/probes/F/icv_race/run.php <workers> <signed 0/1> <withPayment 0/1>` — 5 runs (8/0/1, 8/0/0 ×2, 8/0/1, 8/1/1, 4/1/0) | ICV/PIH always intact; **deadlocks whenever a concurrent payment creation ran** (SEC-02); logs `<audit-workspace>/logs/F-pg-chain.log`, `F-pg-race2.log`; PG server log `/var/log/postgresql/postgresql-16-main.log` lines 309-363 |

### 1.3 Existing tests run

* SQLite (`<audit-workspace>/db/F-existing.sqlite`): `--filter='ApiTenantIsolationTest|ApiRbacTest|BranchIsolationGuardTest|ZatcaIcvScopeTest|ZatcaCredentialTest|ZatcaSubmissionAttemptTest|ZatcaSubmissionRecoveryTest|ZatcaSignedInvoicePostingTest|PosInvoiceBranchAccessTest|ZatcaHttpTransportTest|ZatcaTransportCredentialResolverTest|ZatcaSigningCredentialResolverTest|GrantLegacyReachableZatcaCommandTest|ZatcaNotificationBridgeTest|ZatcaSubmissionDispatcherTest|ZatcaPhase2Test|ZatcaTest'` → **103 passed (864 assertions), 25.5 s**.
* PostgreSQL (`audit_f`): `--filter='ZatcaCredentialTest|ZatcaPhase2Test|ApiTenantIsolationTest|ZatcaSubmissionAttemptTest'` → **32 passed (274 assertions)**.

Harness note: `<harness>/app/Mail/` is absent in the harness copy, so `AuthController::register` logs a reported `AuthActionMail` class-not-found exception (wrapped in try/catch at `AuthController.php:101-106`); registration still returns 201. Not a repo defect.

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

| # | Control | Evidence |
|---|---|---|
| PC-1 | **Tenant isolation of every invoice/ZATCA route.** With a valid tenant-B login and tenant-A UUIDs: `GET/PUT/DELETE /invoices/{id}`, `/post`, `/duplicate`, `/classification`, `/notes`, `/accounting`, `/payments`, `/inventory`, `/zatca`, `/zatca/submissions` (GET/POST), `/zatca/submissions/{attempt}/dispatch` (also with B's own invoice + A's attempt id), `/revisions/invoice/{id}`, `POST /invoices` with A's partner → all **404** (no existence oracle); lists never contain A rows; `GET /zatca-credentials` 0 rows; `/zatca-settings` shows B defaults; B's `PUT` settings/credential leaves A's row untouched; `X-Branch-Id: <A branch>` ignored; Public API key of B → 404 on A's invoice. | F01 on SQLite **and** PostgreSQL; `TenantScope` `app/Tenancy/TenantScope.php:15-21`; `SetTenant.php:43,66-70` (set + `finally` forget, StreamedResponse re-scoped 51-63); resolvers double-filter `->where('tenant_id', $tenantId)` `ZatcaSigningCredentialResolver.php:27-31`, `ZatcaTransportCredentialResolver.php:27-31`; attempt lookup bound to invoice `ZatcaSubmissionController.php:84-86`. |
| PC-2 | All models in scope extend `BaseModel` (TenantScope + UUID keys): `Invoice`, `InvoiceLine`, `ZatcaCredential`, `ZatcaSubmissionAttempt`, `JournalEntry`, `Account`, `DocumentRevision`, `ApiClient`. No `DB::table/select/statement`, `toBase()`, `unguarded` or `withoutGlobalScope(TenantScope)` in ZATCA/invoice/report code; the only `withoutGlobalScopes()` in ZATCA code re-filters by `tenant_id` (`ZatcaNotificationBridge.php:59-70`). | `BaseModel.php:9-16`; grep results §1.1; `BranchIsolationGuardTest` passes. |
| PC-3 | **Credential ownership & validation.** Unique `(tenant_id, environment)`; store locks the tenant row, re-checks app state inside the lock, requires current password; validator enforces EC secp256k1 key ↔ cert public-key match, chain to the per-environment trust anchor, `CA:false`, `digitalSignature`, `clientAuth` EKU, validity window, fingerprint; stage/certificate change requires a complete new secret set. | `database/migrations/2025_01_01_000131_create_zatca_credentials_table.php:25`; `ZatcaCredentialService.php:31-34,39,43-50,61-73,88-92`; `ZatcaCredentialMaterialValidator.php:20-145`; `ZatcaCredentialTest` 11/11 on both engines. |
| PC-4 | **Encryption at rest / no secret egress.** `credentials` cast `encrypted:array` + `$hidden`; raw column is ciphertext; API returns only booleans/fingerprint/curve; 422 validation does not echo input; signed XML, invoice JSON, revisions, attempt rows, `jobs.payload`, `failed_jobs`, notifications and the log file contain none of the secret/request-id/private-key markers; private key only ever used in-memory (`openssl_pkey_get_private`/`openssl_sign`), the only temp file holds invoice XML (0600, unlinked in `finally`). | `ZatcaCredential.php:15-23`; `ZatcaCredentialService::publicMetadata` 124-146; `ZatcaXmlCanonicalizer.php:24-33,69-71`; `ZatcaXmlEcdsaSigner.php:22-36`; F03 (12 surfaces, 89 assertions). |
| PC-5 | **Queue job tenancy.** `SendZatcaSubmission` payload = `tenantId, branchId, attemptId` only (963-byte payload inspected); `handle()` forgets then sets both contexts and forgets again in `finally`; after an in-process `queue:work --once` both singletons are empty; a job carrying tenant B + attempt of A fails with `ModelNotFoundException` under `TenantScope`, lands in `failed_jobs` without secrets/XML and leaves the attempt untouched; `ShouldBeUnique`, `tries=1`, `failOnTimeout`. | `SendZatcaSubmission.php:17-54`; F03 steps 4-7. |
| PC-6 | **Transport hardening.** Endpoint pinned to `https://gw-fatoora.zatca.gov.sa` + exact path per environment, no user/query/fragment; developer env has no endpoint (fails closed); Basic auth only, body `{invoiceHash, invoice}`; no `withoutVerifying`/`verify=>false` anywhere; response sanitizer strips `authorization\|…secret\|privatekey\|certificate*\|invoice\|clearedinvoice`, strips tags, caps size/depth; `response_message` is generic server text. | `ZatcaSubmissionEndpointResolver.php:10-38`; `ZatcaHttpTransport.php:25-38,114-137`; `ZatcaHttpTransportTest` 5/5; F07 outbound assertion; F03 step 5 (`secret`/`authorization` keys absent from stored payload). |
| PC-7 | **Mass assignment.** `POST/PUT /invoices` with `tenant_id`, `status=posted`, `number`, `zatca_*`, totals, `paid_amount`, `journal_entry_id`, per-line `tenant_id/line_tax` → all ignored; totals server-derived (115000). | `StoreInvoiceRequest.php:14-75` (`validated()` allow-list) + explicit attribute maps `InvoiceService.php:97-124,192-211,650-680`; F04. |
| PC-8 | **Replay / duplicates.** `Idempotency-Key` mandatory (missing → 422), unique per tenant (`000130:33`), same key → same attempt (200), new key while pending → 409, accepted invoice → 409, dispatch of finished attempt → 409, re-queue inside 5 min → 409; dispatcher re-run performs **one** HTTP call; request snapshot hash re-checked before any network call. | `ZatcaSubmissionService.php:20-85`; `ZatcaSubmissionQueue.php:24-33`; `ZatcaSubmissionDispatcher.php:24-27,76-97`; F07; `ZatcaSubmissionAttemptTest` 8/8, `ZatcaSubmissionRecoveryTest` 4/4. |
| PC-9 | **ICV / PIH under concurrency (PostgreSQL).** Unique index `invoices_tenant_id_zatca_icv_unique(tenant_id, zatca_icv)` present; posting serializes on the tenant row (`lockForUpdate`); 8 concurrent posters ×2 runs (unsigned) and 4 concurrent signed posters: ICVs `1..N` unique & sequential, every `zatca_previous_hash` equals the hasher output of the previous XML, every stored hash matches its XML. `ZatcaIcvScope` branch mode is fail-closed (no `branches.vat_number`, no branch-aware unique index) and API rejects enabling it. | `2025_01_01_000053_branch_scoped_document_numbering.php:69`; `ZatcaService.php:59-75,140-151`; `ZatcaIcvScope.php:54-103`; race logs `F-pg-race2.log` runs 1-2 & 5; `ZatcaIcvScopeTest` 10/10. |
| PC-10 | **Branch read boundary.** Restricted user: `GET /invoices/{other}`, `/zatca`, `/zatca/submissions`, `POST /zatca/submissions`, `/duplicate` → 404; `?branch=all` and `X-Branch-Id: other` do not widen scope; header validated via `TenantScope` + `canAccessBranch`. | `ApiController::scopeToActiveBranch` 53-71; `SetBranch.php:46-55`; `User.php:60-81`; F05 (both engines); `PosInvoiceBranchAccessTest` 7/7. |
| PC-11 | **Platform plane separation.** Platform-admin token → 403 on `/invoices`, `/invoices/{id}/zatca`, `/zatca-credentials`, `/zatca-settings`, 401 on Public API; tenant owner → 403 on `/platform/*`; `GET /platform/tenants/{id}` payload (460 B) has no settings/credential/XML; no platform controller references `Invoice`/`ZatcaCredential`. | `EnsurePlatformAdministrator.php:19-32`; `SetTenant.php:31-33`; F08. |
| PC-12 | **XML / process safety.** All ZATCA parsers use `LIBXML_NONET` and reject `doctype` (hasher 75-82, assembler 220-223, finalizer 117-124, extractor 506-516, canonicalizer 158-165); xmllint invoked with `proc_open` argv array (no shell) and `--nonet`; `ZatcaSubmissionDispatcher::clearedXml` size-caps and uses `LIBXML_NONET` (see SEC-11 for its doctype gap). | file:line as listed. |
| PC-13 | **Token lifecycle basics.** Tokens issued with 7-day expiry; logout revokes current token; password reset revokes all; role downgrade is effective on the very next request (no caching). | `AuthController.php:33,288-291,271-276,239`; F07. |
| PC-14 | **Rate limits.** `throttle:10,1` on submission create/dispatch, `throttle:5,1` on credential PUT, `throttle:5,1` login. | `routes/api.php:682,684,1588,211`. |
| PC-15 | **Public API minimal surface.** `PublicInvoiceResource` excludes all ZATCA/journal/template/branch fields; tenant derived from API client only; `PublicApiTenantGuard` fails closed. | `PublicInvoiceResource.php:9-66`; `AuthenticateApiClient.php:57-81`; F01 public-API step. |
| PC-16 | **Notification bridge** carries only `response_code`; recipients = active users with `invoices.manage` and branch visibility. | `ZatcaNotificationBridge.php:83-88,118-127`; `ZatcaNotificationBridgeTest` 9/9. |
| PC-17 | **Legacy ZATCA grant command** is single-tenant hard-coded, requires `--apply`, refuses non-legacy tenants, routes through `EntitlementGrantService`. | `GrantLegacyReachableZatcaCommand.php:18,36-66`; its test 4/4. |

---

## 3. Findings

### SEC-01 — Branch-restricted user can edit, delete and **issue** (post → ICV/QR/XML) invoices of branches outside their assignment; the revisions feed hands them the UUIDs
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Invoice issuance / e-invoice generation under multi-branch user restriction (`branch_user`).
- **Official requirement:** n/a – internal invariant (CLAUDE.md rule 5 "عزل الفروع إلزامي"; `InvoiceController::show` R3 contract "معرفة UUID وحدها لم تعد تكفي"; `ApiController::assertRecordAccessible` doc 139-149).
- **Actual behavior:** For a user assigned only to branch MAIN, reads of an OTHER-branch invoice are 404, but `PUT /invoices/{other}` → 200 (notes changed to `MODIFIED-BY-RESTRICTED`, lines rebuilt), `PUT /invoices/{other}/classification` → 200, `POST /invoices/{other}/post` → **200 and the invoice was issued with `zatca_icv=2`**, `DELETE /invoices/{other2}` → 200 (row gone). `GET /revisions?limit=50` (tenant-wide feed, `invoices.view`) lists the OTHER-branch draft's `document_id`/`document_number`, and `GET /revisions/invoice/{other}` → 200, so the attacker does not even need to guess UUIDs. Identical on SQLite and PostgreSQL.
- **Expected behavior:** Write/issue/delete routes apply the same branch boundary as reads (404), and the revisions feed/index respect `allowedBranchIds()`.
- **Evidence:** `app/Http/Controllers/Api/InvoiceController.php:275` (`update`), `:299` (`updateClassification`), `:325` (`destroy`), `:333` (`post`) use bare `Invoice::findOrFail($id)` whereas reads use `visibleInvoice()` `:382-385`; `assertWarehouseAllowed(..., false)` returns before any branch check when no warehouse is sent `ApiController.php:102-104`; `DocumentRevisionController.php:24-31` (feed, no branch filter) and `:39` (index, tenant-only `findOrFail`). Probe F05 output: `PUT … -> 200`, `POST …/post -> 200`, `DELETE … -> 200`, `other.draft after attack: status=posted … zatca_icv=2 deleted(draft2)=true`, `GET /revisions feed exposes other-branch draft id -> YES`.
- **Impact:** Security/regulatory — a branch-restricted cashier can issue tax invoices (ICV consumed, QR/XML generated, journal posted) and delete drafts in branches they are not authorised for; audit trail attributes it to them but the control is defeated.
- **Recommendation:** Route `update/updateClassification/destroy/post` through `visibleInvoice()` (or `assertRecordAccessible($invoice->branch_id, [...])` right after `findOrFail`); filter `DocumentRevision` feed/index with `scopeToActiveBranch` on the underlying document's `branch_id` (or hide rows whose document is not visible). Apply the same review to quotes/credit-notes/returns controllers.
- **Regression tests required:** Extend `PosInvoiceBranchAccessTest` with `PUT/DELETE/POST post/classification` → 404 for a restricted user; revisions feed must not list foreign-branch documents.
- **Dependencies:** none.

### SEC-02 — PostgreSQL deadlocks during concurrent invoice posting (lock-order inversion partner-row → tenant-anchor vs tenant-anchor → FK on partner)
- **Severity:** P1
- **Status:** VERIFIED DEFECT (PostgreSQL; not observable on SQLite)
- **Business process:** Concurrent posting of credit invoices while other documents referencing the same customer are created in the same tenant.
- **Official requirement:** n/a – internal invariant (CLAUDE.md rules 1/3: every posting is a balanced, immutable, single transaction; ICV chain must be reliably assignable).
- **Actual behavior:** `InvoiceService::post` locks the invoice row, then the **partner row** `FOR UPDATE` (`assertWithinCreditLimit`, even when `credit_limit = 0`), and only then the **tenant anchor** (`AccountingDateGuard::lockAnchor` inside `LedgerService::post`, re-taken by JE numbering and `ZatcaService`). Any transaction that takes the tenant anchor first and then inserts a row with a FK to that partner (PostgreSQL takes `KEY SHARE` on the referenced partner row) forms a cycle. Reproduced with `PaymentService::create` in a tenant-anchored numbering context (`Payment::create` → `GeneratesDocumentNumbers::lockNumberingAnchor(null)` → tenant lock → `INSERT payments … partner_id`): runs with 8 posters + 1 payment creator → **5 of 7 and 4 of 7 invoice posts failed with `SQLSTATE[40P01] deadlock detected`** (PG victims cascade). Invoice-only runs (8 posters ×2, 4 signed posters) never deadlocked. Victims roll back cleanly (invoice stays `draft`, ICV chain intact) but the API returns **500** (`QueryException` is a `PDOException`, rethrown by `ApiController::domain` `:25-26`); `DB::transaction()` is used with the default single attempt, so there is no automatic deadlock retry.
- **Expected behavior:** Consistent lock ordering (anchor first) or no partner `FOR UPDATE` before the anchor; posting transactions retry on `DeadlockException`.
- **Evidence:** Lock sites: `InvoiceService.php:889` (invoice), `:1150` (partner `lockForUpdate`, reached before `:1004` ledger post for unpaid credit invoices; early returns `:1137-1146` only for cash / is_paid), `LedgerService.php:59` → `AccountingDateGuard.php:112-115` (tenant), `GeneratesDocumentNumbers.php:153-170` (tenant anchor when no branch / CompanyWide), `ZatcaService.php:62-64` (tenant). FK: `2025_01_01_000005_create_payments.php:19` (`partner_id … constrained('partners')`). PG server log `/var/log/postgresql/postgresql-16-main.log` lines 309-315 & 345-363: `Process 22764: select * from "tenants" … for update` ⟷ `Process 22771: insert into "payments" (…)`, and `select * from "partners" … for update` waiters; race logs `<audit-workspace>/logs/F-pg-chain.log` (first run: 2 deadlocks) and `F-pg-race2.log` (unsigned+payment: 5 failures; signed+payment: 4 failures; invoice-only: 0 failures ×3).
- **Impact:** Operational/financial — intermittent 500s on invoice posting / POS checkout under concurrency; users retry and may double-submit; throughput collapses as victims serialize. Production triggers (not individually reproduced): any transaction holding the tenant anchor before inserting/updating partner-referencing rows — e.g. `DeliveryNoteSalesInvoiceDraftBuilder::assertInvoicePlanAvailable` (`:239-241` locks tenant, then `:216` creates the draft invoice referencing the partner), CLI/queue/scheduler contexts without `BranchContext` (tenant-anchored numbering for every `BelongsToBranch` document), and the symmetric `InventoryState` ordering (`InventoryService.php:496` locks stock state rows before ledger posting while invoice posting locks them after the anchor).
- **Recommendation:** Take the tenant anchor as the **first** lock in `InvoiceService::post` (or replace the partner `FOR UPDATE` by the anchor, which already serialises the tenant); audit all services for "anchor-after-other-rows" patterns; wrap posting transactions with `DB::transaction($fn, 3)` so `DeadlockException` retries; map `DeadlockException` to a 409/503 with retry semantics instead of 500.
- **Regression tests required:** PostgreSQL-only CI job that runs N concurrent posts + concurrent payment/draft creation for the same partner (reuse `icv_race/run.php` design) and asserts zero `40P01`; unit test asserting lock order via query log.
- **Dependencies:** SEC-09 (same anchor).

### SEC-03 — Phase-2 fail-closed design halts **all** invoicing of the tenant on CSID expiry / environment switch / key rotation / chain gap, with no administrative recovery path
- **Severity:** P1
- **Status:** VERIFIED DEFECT (design gap + two robustness bugs)
- **Business process:** Invoice posting (API, POS, recurring, delivery-note invoicing) after the first ZATCA credential is stored.
- **Official requirement:** ZATCA e-invoicing requires continuous issuance; CSID renewal is a routine lifecycle event [official-ref to confirm: ZATCA "Fatoora portal user manual — Renew CSID"]. Internal: fail-closed is intended (`ZatcaService.php:85-88` comment).
- **Actual behavior:** Once any `zatca_credentials` row exists (`ZatcaService.php:89`), every post requires signing. Probe F06 matrix: (a) `active_environment` switched to an environment without credential → 422 for every new invoice; (b) credential `expires_at` in the past → 422; (c) tenant disables the ZATCA application → state becomes `suspended` but posting is still blocked while the credential is invalid, and when valid again **signing continues regardless of application state** (`(c2) … POSTED icv=3 signed=yes`, `GET /invoices/{id}/zatca` 200 while suspended); (d) deployment signature-policy env missing → 422; (e) previous invoice's `zatca_xml` NULL → 422 "تعذر متابعة سلسلة ZATCA" (chain cannot continue, forever, for that tenant); (f) APP_KEY rotated without previous keys → posting 422 "The MAC is invalid.", **`GET /zatca-credentials` → 500** (uncaught `DecryptException` in `publicMetadata`), settings readiness reports `credential_unavailable`; (g) **no route deletes a credential** (`routes/api.php:1585-1588` only GET/PUT) and `UpdateZatcaSettingsRequest` accepts switching to an environment with no credential. The owner's only exit is uploading a valid credential for the active environment.
- **Expected behavior:** Explicit, audited "signing on/off / revert to Phase-1" control (or credential delete) for `company.manage`; expiry warnings and a readiness check before accepting an `active_environment` switch; `APP_PREVIOUS_KEYS` support and a graceful decrypt failure in `publicMetadata`; a guarded repair command for broken chains.
- **Evidence:** `ZatcaService.php:89-105,140-151`; `ZatcaSigningCredentialResolver.php:22-38`; `ZatcaCredentialService.php:124-146` (reads `$credential->credentials` unguarded); `ZatcaSignaturePolicyResolver.php:12-17`; `UpdateZatcaSettingsRequest.php:19-23`; `TenantApplicationService::disable` 370-419 (status only); probe output `<audit-workspace>/logs/F06Phase2FailClosedProbeTest.log` (18 `[F]` lines: `(a)…BLOCKED … 422`, `(b) credential expired => BLOCKED`, `(c2) app suspended, credential valid again => POSTED icv=3 signed=yes`, `(e) … XML الفاتورة السابقة غير محفوظ`, `(f) … DecryptException: The MAC is invalid.`, `GET /zatca-credentials after key rotation -> 500`).
- **Impact:** Operational/regulatory — a predictable event (certificate expiry, ops key rotation, an admin picking the wrong environment) stops issuance of every tax invoice and every POS sale for the tenant; the HTTP error text is cryptic for (f).
- **Recommendation:** As in "Expected behavior"; additionally alert N days before `expires_at` (readiness already computes it), and make `GET /zatca-credentials` catch `DecryptException` and report `undecryptable`.
- **Regression tests required:** credential delete/disable path restores Phase-1 posting; `GET /zatca-credentials` after key rotation returns 200 with status flag; settings PUT to an unready environment is rejected or warned.
- **Dependencies:** SEC-06 (environment switch semantics).

### SEC-04 — Deactivated user (`is_active = false`) keeps full API access with existing tokens
- **Severity:** P2
- **Status:** VERIFIED DEFECT
- **Business process:** User off-boarding / emergency deactivation.
- **Official requirement:** n/a – internal (access control hygiene).
- **Actual behavior:** After `is_active` is set to false, the user's existing Sanctum token still returns 200 on `GET /invoices`, `GET /invoices/{id}/zatca`, `GET /me` (tokens live 7 days). Only login/handoff check `is_active` (`AuthController.php:151,188`); `auth:sanctum`, `EnsureUserPrincipal`, `SetTenant` (`:29-43`) and `EnsurePermission` never do, and `UserController` deactivation does not revoke tokens (`tokens()->delete` only in password reset / password change `AuthController.php:239`, `AccountSettingsController.php:182`). Soft-deleting the user does revoke (401) and role downgrade applies immediately.
- **Expected behavior:** Deactivation revokes tokens (or the middleware rejects inactive users on every request).
- **Evidence:** F07: `user is_active=false, existing token: GET /invoices/{id}/zatca -> 200 ; GET /invoices -> 200 ; GET /me -> 200`; `user soft-deleted … -> 401`.
- **Impact:** Security — a dismissed employee or compromised account keeps reading signed invoices and (with `invoices.manage`) issuing/submitting for up to 7 days.
- **Recommendation:** Check `is_active` in `SetTenant`/`EnsureUserPrincipal`; delete tokens in the deactivation path.
- **Regression tests required:** deactivated user → 403 on next request; tokens count 0 after deactivation.
- **Dependencies:** none.

### SEC-05 — Issued-document snapshot is not protected at model/DB level; stored XML/hash can diverge from live data undetected
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Integrity of posted invoices and their ZATCA artifacts (XML, hash, QR) after issuance.
- **Official requirement:** ZATCA e-invoicing: the issued e-invoice must be stored unaltered and tamper-evident [official-ref to confirm: ZATCA E-Invoicing Implementation Resolution Art. "Integrity"/Security features; Detailed Guidelines §tamper-proofing]. Internal: CLAUDE.md "القيود immutable بعد الترحيل".
- **Actual behavior:** API-level guards are correct (PUT/DELETE/re-POST of a posted invoice → 422; hostile fields ignored). But at model level nothing prevents it: `Invoice::$fillable` includes `tenant_id`, `status`, totals, `journal_entry_id`, `zatca_qr/hash/uuid/icv/previous_hash/xml/cleared_xml` (`Invoice.php:25-37`); `InvoiceLine::booted()` only guards delivery-note links (`:33-45`); probe tampered a posted invoice's line (`unit_price`,`description`), header totals (`total=1`), partner name and tenant name/VAT: all persisted, API now shows `total=0.01` and the new partner name while the stored XML still says `1150.00` with the original names; `zatca_xml`/`zatca_hash` themselves are updatable after posting (also used legitimately by `ZatcaSubmissionDispatcherTest.php:102`). No periodic/at-read verification that `hash(zatca_xml) == zatca_hash` or that XML totals match the row. The revision log is detective only and partial: it recorded the header tampers (`total`, `subtotal`, `tax_amount`, `zatca_hash` — 4 entries observed) but deliberately ignores `zatca_xml/qr/previous_hash` (`RecordsRevisions.php:28-30`) and `InvoiceLine` carries no `RecordsRevisions` at all, so line-level tampers leave no trace. Only `ZatcaSubmissionAttempt.request_hash` detects XML change before transmission.
- **Expected behavior:** Posted invoices/lines reject edits outside an allow-list (payment tracking, `zatca_cleared_xml`, classification, template refs); DB-level protection (trigger or revoked UPDATE on `zatca_xml/zatca_hash` for posted rows); an integrity check job/endpoint; seller/customer snapshot fields used by printing.
- **Evidence:** F04 output lines "OBSERVATION after model-level tamper …" and "Invoice model accepts direct update of zatca_xml/zatca_hash after posting"; file refs above.
- **Impact:** Regulatory/financial — any code path, console command, bulk import or DBA action can silently alter an issued invoice; printed/API data can contradict the signed XML with no alarm.
- **Recommendation:** Model `updating` guard on `Invoice`/`InvoiceLine` when `status === 'posted'`; drop `tenant_id`/`zatca_*`/`status` from `$fillable` (use `forceFill` in services); nightly `zatca:verify-chain` (hash + PIH + totals) with alerts; snapshot seller/buyer identity on the invoice.
- **Regression tests required:** model-level update of a posted invoice line throws; `zatca_xml` update throws unless via dispatcher/clearance path; chain verify command detects a tampered row.
- **Dependencies:** cross-stream (printing re-derivation, see §5).

### SEC-06 — Environment of a submission is not recorded; simulation and production share one ICV/PIH chain and the same `zatca_*` columns
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Simulation → production cut-over; audit of what was sent where.
- **Official requirement:** ICV/PIH chain integrity per EGS unit/production CSID [official-ref to confirm: ZATCA Detailed Technical Guidelines — ICV & PIH; onboarding/simulation guidance on counters]. Internal: environments "لا ينتقل إلى بيئة أخرى" (`Settings.php:244-246`).
- **Actual behavior:** `zatca_submission_attempts` has no `environment`/`endpoint`/`csid_fingerprint` column (`000130:11-36`; model `ZatcaSubmissionAttempt.php:17-35`); the dispatcher resolves the environment **at send time** from mutable `Settings` (`ZatcaSubmissionDispatcher.php:30-37` → `ZatcaTransportCredentialResolver.php:22`), so after an `active_environment` change the audit record cannot show whether an accepted attempt went to simulation or production. `ZatcaService` keeps one chain for the tenant (`:59-75`) regardless of environment, so documents signed with a developer/simulation CSID occupy ICVs and PIH links of the chain that will later be reported to production. Cross-environment credential misuse is prevented only if the three trust-anchor bundles differ in deployment (`config/zatca.php:14-18`, validator `:55-73`) — NOT VERIFIED here.
- **Expected behavior:** Persist environment + credential fingerprint + endpoint on each attempt; decide (per official guidance) whether the production chain must restart / be segregated from simulation output, and enforce it.
- **Evidence:** file refs above; F01/F06 show `active_environment` switchable at any time via `PUT /zatca-settings`.
- **Impact:** Regulatory/audit — inability to prove submission target; possible chain/ICV disputes at production onboarding.
- **Recommendation:** Add `environment`, `certificate_fingerprint`, `endpoint` columns (immutable identity fields) to attempts; store `signing_environment` on the invoice; block environment switch while pending attempts exist; document the cut-over procedure.
- **Regression tests required:** attempt row records environment; switching environment with pending attempts is rejected.
- **Dependencies:** SEC-03.

### SEC-07 — Separation of duties: ZATCA transmission is granted by `invoices.manage` alone; settings metadata readable by every `invoices.view` holder
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Authorisation model for legally significant submission.
- **Official requirement:** n/a – internal (hr-users-architecture: configurable roles; least privilege).
- **Actual behavior:** Role matrix (F02):

  | route | owner | admin | accountant | staff | self_service | cashier (`invoices.view`+`invoices.manage` only) |
  |---|---|---|---|---|---|---|
  | GET invoices/{id}/zatca (`zatca.view`) | 200 | 200 | 200 | 200 | 403 | **403** |
  | GET …/zatca/submissions | 200 | 200 | 200 | 200 | 403 | 403 |
  | POST …/zatca/submissions (`invoices.manage`) | 202 | 409* | 409* | 403 | 403 | **409*** (allowed) |
  | POST …/submissions/{id}/dispatch | 404* | 404* | 404* | 403 | 403 | **404*** (allowed) |
  | GET zatca-credentials (`company.manage`) | 200 | 200 | 403 | 403 | 403 | 403 |
  | PUT zatca-credentials/{env} | 422* | 422* | 403 | 403 | 403 | 403 |
  | GET zatca-settings (`invoices.view`) | 200 | 200 | 200 | 200 | 403 | 200 |
  | PUT zatca-settings (`company.manage`) | 200 | 200 | 403 | 403 | 403 | 403 |
  | POST invoices/{draft}/post | 200 | 200 | 200 | 403 | 403 | 200 |

  (* = passed RBAC; 409/404/422 come from later business validation.) A custom role that cannot even read the QR/XML (`zatca.view` missing) can create and dispatch submissions. `GET /zatca-settings` returns `transport_readiness.queue_connection`, `environment`, blockers to any `invoices.view` user (`ZatcaSettingsController.php:30-44`).
- **Expected behavior:** Dedicated `zatca.submit` (and optionally `zatca.manage`) permissions, defaulting to accountant/admin; infra readiness details limited to `company.manage`.
- **Evidence:** `routes/api.php:678-684,1585-1590`; `Rbac.php:19-50,56-79`; F02 output.
- **Impact:** Security/regulatory — cashier-level accounts can trigger irreversible reporting/clearance; mild infra disclosure.
- **Recommendation:** Add `zatca.submit` to `Rbac::PERMISSIONS`, seed it for accountant/admin, gate both POST routes; split settings `meta` by permission.
- **Regression tests required:** role matrix test asserting 403 for roles without `zatca.submit`.
- **Dependencies:** none.

### SEC-08 — Application gating of `compliance.zatca` is inconsistent (artifacts still generated/exposed while "disabled"; signing/transmission ignore "suspended")
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Tenant enable/disable of the ZATCA capability (post-cutover tenants start `disabled`).
- **Official requirement:** n/a – internal (`EnsureApplicationActive` contract; `ENFORCEMENT_CUTOVER_AT` `TenantApplicationService.php:51,140-160`).
- **Actual behavior:** With the app `disabled`, `/invoices/{id}/zatca`, credentials and submissions are 403, yet posting still generates and returns `zatca.qr/hash/uuid/icv` in `InvoiceResource` (`:128-139`), and `suspended` (credential exists) neither stops signing (`ZatcaService.php:89` checks row existence, not app state) nor transmission readiness.
- **Expected behavior:** One consistent semantic: either the capability only gates UI/transmission (then say so and keep QR Phase-1 mandatory), or `disabled/suspended` also stops signing/transmission.
- **Evidence:** F08 test 2 (`GET /invoices/{id}/zatca -> 403 … zatca.qr present=true icv=1`); F06 (c2).
- **Impact:** Operational confusion; low security impact.
- **Recommendation:** Document that Phase-1 QR/ICV is mandatory and independent; make signing/transmission consult `statusFor('compliance.zatca')`.
- **Regression tests required:** suspended app → no transmission readiness.
- **Dependencies:** SEC-03.

### SEC-09 — Tenant anchor row is held across external processes (xmllint/openssl) for every post, serialising all ledger postings of the tenant
- **Severity:** P3
- **Status:** VERIFIED IMPLEMENTED (design) / observation
- **Business process:** Throughput of posting under load.
- **Official requirement:** n/a – internal.
- **Actual behavior:** ICV chain correctness requires serialisation, but the lock used is the **same** tenant row as `AccountingDateGuard` (every ledger post), document numbering and credential/app-state writes. Measured on PostgreSQL: signed post baseline 107-129 ms vs unsigned 60-85 ms; 4 concurrent signed posts complete in 170/345/487 ms (queueing); a concurrent payment `post()` waited 35-214 ms. ~5 `xmllint` process spawns per signed post happen under the lock.
- **Expected behavior:** A dedicated per-tenant ICV anchor (e.g. `zatca_counters`) so unrelated postings do not queue behind signing; keep the chain serialised.
- **Evidence:** `ZatcaService.php:62-64`; `AccountingDateGuard.php:112-115`; `GeneratesDocumentNumbers.php:153-170`; `F-pg-race2.log` timings.
- **Impact:** Operational (latency, DoS amplification by large invoices).
- **Recommendation:** As above; keep `lockForUpdate` on the new anchor inside the posting transaction.
- **Regression tests required:** PG perf smoke (optional).
- **Dependencies:** SEC-02.

### SEC-10 — Re-queue window and job uniqueness expire together (5 min), allowing a duplicate job for one pending attempt
- **Severity:** P3
- **Status:** VERIFIED IMPLEMENTED (safe) / observation
- **Business process:** Manual re-dispatch of a stuck attempt.
- **Official requirement:** n/a.
- **Actual behavior:** `ZatcaSubmissionQueue` rejects re-queue only within 5 minutes (`:29-33`) and `SendZatcaSubmission::$uniqueFor = 300`; after 6 minutes a second job is pushed (`queue_count=2`, F07) while the first may still be queued. The worker row-lock + `status !== pending` check makes the second a no-op, and a mid-flight first job blocks the second on the lock, so no double transmission was observed (F07: one HTTP call).
- **Expected behavior:** Keep as is but surface `queue_count>1` in UI; consider job-level dedupe keyed on `queued_at`.
- **Evidence:** F07 "re-dispatch … after 6 min -> 202 queue_count=2".
- **Impact:** Low.
- **Recommendation:** Optional.
- **Regression tests required:** none beyond existing.
- **Dependencies:** none.

### SEC-11 — Cleared-XML parser does not reject DOCTYPE; cleared XML never integrity-checked
- **Severity:** P3
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Clearance response handling.
- **Official requirement:** n/a (defensive parsing).
- **Actual behavior:** `ZatcaSubmissionDispatcher::clearedXml` loads the response with `LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_NOCDATA` (`:109-118`) and size caps, but unlike every other ZATCA parser does not reject `doctype`; `zatca_cleared_xml` is stored without checking that its hash/UUID matches the submitted invoice. No `LIBXML_NOENT`, so XXE/entity expansion is not exploitable today; inconsistency only.
- **Expected behavior:** Same `parseSecurely` contract (reject doctype, require UBL namespace) and a UUID/hash cross-check before storing.
- **Evidence:** file:line above; compare `ZatcaSignedInvoiceFinalizer.php:111-131`.
- **Impact:** Low.
- **Recommendation:** Reuse the finalizer's `parseSecurely`; verify `cbc:UUID` equals `zatca_uuid`.
- **Regression tests required:** cleared XML with DOCTYPE rejected.
- **Dependencies:** none.

### SEC-12 — CORS allows any origin when `FRONTEND_URL` is unset
- **Severity:** P3
- **Status:** NOT VERIFIED (deployment) / code observation
- **Business process:** Browser access to the API.
- **Official requirement:** n/a.
- **Actual behavior:** `deploy/cors.php:32-39` falls back to `allowed_origins => ['*']` with `supports_credentials => false`; Bearer tokens (no cookies) make this mostly safe, but any site can issue authenticated requests if it obtains a token.
- **Expected behavior:** Pin origins in production.
- **Evidence:** file ref.
- **Impact:** Low.
- **Recommendation:** Make `FRONTEND_URL` mandatory in production config validation.
- **Regression tests required:** none.
- **Dependencies:** none.

### SEC-13 — Raw exception text (temp paths, decrypt errors) returned in 422 bodies
- **Severity:** P3
- **Status:** VERIFIED DEFECT (hygiene)
- **Business process:** Error handling of posting.
- **Official requirement:** n/a.
- **Actual behavior:** `ApiController::domain` returns `$e->getMessage()` for any `RuntimeException` (`:34-36`): `ZatcaXmlCanonicalizer` embeds xmllint stderr (incl. `/tmp/zatca-c14n-*` paths) (`:56-61`), `DecryptException` yields "The MAC is invalid." (F06 f). No secrets, but internal paths/config state are disclosed to `invoices.manage` users.
- **Expected behavior:** Map infrastructure exceptions to stable codes/messages.
- **Evidence:** F06 output; file refs.
- **Impact:** Low.
- **Recommendation:** Catch `DecryptException`/canonicalizer failures in `ZatcaService` and rethrow a coded business error.
- **Regression tests required:** error body has no `/tmp` path.
- **Dependencies:** SEC-03.

---

## 4. NOT VERIFIED / open questions

1. **Production configuration** (sandbox cannot see it): distinct `ZATCA_*_CA_BUNDLE` per environment (cross-environment CSID misuse hinges on it, SEC-06); `APP_PREVIOUS_KEYS` usage; `QUEUE_CONNECTION`/worker isolation (readiness blocks `sync`/`null` only); `FRONTEND_URL` for CORS; `zend.exception_ignore_args` (failed-job traces could expose truncated argument strings; the ZATCA job path passes objects, so exposure looks nil); log shipping/retention of `laravel.log`.
2. **Deadlock exposure in the exact HTTP interleavings** (SEC-02): reproduced via service-level processes with tenant-anchored numbering; the listed production candidates (delivery-note draft builder, scheduler/CLI document creation, inventory-state ordering) were inferred from lock sites, not executed. A PG-only CI harness is the way to settle it.
3. **Official position on ICV/PIH chain continuity across simulation → production** (SEC-06) — needs the R1/R2 registers (not present in `<audit-workspace>/official/` at audit time).
4. **Web UI secret handling**: static read of `web/src/app/(app)/sales-settings/einvoice/page.tsx` shows secrets held only in React state and posted once (lines 69, 154-156, password-type inputs; no `localStorage`/`console` usage); not executed.
5. **SQLite row locking**: SQLite ignores `lockForUpdate`; all locking conclusions come from the PostgreSQL runs.
6. **`GET /revisions` branch leak** was proven for invoices only; other document types in `DocumentRevision::TYPES` likely behave the same (same controller) — not probed.

---

## 5. Cross-stream notes

* **Hash-chain stream:** migration `2025_01_01_000053_branch_scoped_document_numbering.php:121-141` renumbers duplicate ICVs in the column while the embedded `<cbc:UUID>` inside `cac:AdditionalDocumentReference[ID='ICV']` keeps the old value → column/XML divergence on affected legacy rows. Also `previousInvoiceHash` re-hashes the stored XML (not the stored hash) — any XML tamper (SEC-05) silently rewrites the chain's PIH for the next invoice.
* **Document rendering/print stream:** API/print read live `partner`/`tenant` relations while the XML holds issue-time snapshots (F04 observation); confirm what the PDF/thermal templates render for seller/buyer identity and QR (they should use `zatca_qr` as stored, never regenerate).
* **Transport/clearance stream:** `zatca_cleared_xml` not cross-checked against the submitted hash/UUID (SEC-11); `response_message` for 4xx is a generic string — ZATCA validation errors survive only inside `response_payload.validationResults` (html-stripped, 4000-char cap).
* **Compliance-content stream:** manual `submission_mode` is the only implemented mode; simplified-invoice 24-hour reporting deadline enforcement is not a security matter but SEC-07's permission design should anticipate automatic submission.
* **Catalog/entitlements stream:** `ENFORCEMENT_CUTOVER_AT` grandfathering means a pre-cutover tenant with no state row is `enabled` for `compliance.zatca`, while a new tenant is `disabled` until explicit enable — the UI must guide enablement before Phase-2 onboarding (SEC-08).

---

## Appendix A — Route → middleware → permission (tenant API, all under `routes/api.php:349` group `auth:sanctum` → `EnsureUserPrincipal` → `SetTenant` → `SetBranch`, then `:382` `EnsureActiveSubscription`; `$perm` = `EnsurePermission:<p>`, `$app` = `EnsureApplicationActive:<key>`)

| Method & route (`routes/api.php` line) | Extra middleware | Permission | Branch scope in controller | Rbac default holders |
|---|---|---|---|---|
| GET `invoices` (671) | — | `invoices.view` | `scopeToActiveBranch` | owner, admin, accountant, staff |
| GET `invoices/{id}` (672) | — | `invoices.view` | `scopeToActiveBranch` | same |
| GET `invoices/{id}/payments` (673) | — | `payments.view` | `visibleInvoice` | same |
| GET `invoices/{id}/accounting` (674) | — | `reports.view` | `visibleInvoice` | same |
| GET `invoices/{id}/inventory` (675) | — | `products.view` | `visibleInvoice` | same |
| GET `invoices/{id}/notes` (676) · GET `…/notes/{n}/attachments/{a}/download` (677) | — | `invoices.view` | `visibleInvoice` | same |
| GET `invoices/{id}/zatca` (678) | `$app('compliance.zatca')` | `zatca.view` | `visibleInvoice` | owner, admin, accountant, staff |
| GET `invoices/{id}/zatca/submissions` (679-680) | `$app('compliance.zatca')` | `zatca.view` | `visibleInvoice` | same |
| POST `invoices/{id}/zatca/submissions` (681-682) | `$app('compliance.zatca')`, `throttle:10,1` | `invoices.manage` | `visibleInvoice` | owner, admin, accountant (+ any custom role with `invoices.manage`) |
| POST `invoices/{id}/zatca/submissions/{attemptId}/dispatch` (683-684) | `$app('compliance.zatca')`, `throttle:10,1` | `invoices.manage` | `visibleInvoice` + attempt bound to invoice | same |
| POST `invoices` (685) | `EnforcePlanLimit:invoices` | `invoices.manage` | branch from context | same |
| POST `invoices/{id}/notes` (686) | — | `invoices.manage` | `visibleInvoice` | same |
| POST `invoices/{id}/duplicate` (687) | `EnforcePlanLimit:invoices` | `invoices.manage` | `visibleInvoice` | same |
| PUT `invoices/{id}/classification` (688) | — | `invoices.manage` | **none** (SEC-01) | same |
| PUT `invoices/{id}` (689) | — | `invoices.manage` | **none** (SEC-01) | same |
| DELETE `invoices/{id}` (690) | — | `invoices.manage` | **none** (SEC-01) | same |
| POST `invoices/{id}/post` (691) | — | `invoices.manage` | **none** (only indirect warehouse check) (SEC-01) | same |
| GET `revisions` (1403) · GET `revisions/{type}/{id}` (1404) | — | `invoices.view` | **none** (SEC-01) | owner, admin, accountant, staff |
| GET `zatca-credentials` (1585) | `$app('compliance.zatca')` | `company.manage` | n/a (CompanyWide) | owner, admin |
| PUT `zatca-credentials/{environment}` (1586-1588) | `$app('compliance.zatca')`, `throttle:5,1`, `current_password` re-auth | `company.manage` | n/a | owner, admin |
| GET `zatca-settings` (1589) | `$app('compliance.zatca')` | `invoices.view` | n/a | owner, admin, accountant, staff |
| PUT `zatca-settings` (1590) | `$app('compliance.zatca')` | `company.manage` | n/a | owner, admin |
| Public API GET `v1/invoices`, `v1/invoices/{id}` (`api_public.php:93-95`) | `AuthenticateApiClient` → `PublicApiTenantGuard` → audit → rate limit → `EnsureActiveSubscription` → `EnsureApiScope:invoices:read` | API-key scope | tenant-wide, no ZATCA fields | API clients |
| Public API POST `v1/invoices` (`api_public.php:137-138`) | … + `EnsureApiScope:invoices:write`, `EnforceApiIdempotency`, `EnforcePlanLimit` | API-key scope | branch from body (owned) | API clients (draft only) |
| Platform `platform/*` (276-300) | `auth:sanctum` + `EnsurePlatformAdministrator[:platform:manage]` | token ability | no tenant context; cannot reach tenant routes (403) | platform admins |

Queue/worker plane: `SendZatcaSubmission` (ids only) → `ZatcaSubmissionDispatcher` → `ZatcaTransportCredentialResolver` (tenant from context, `stage=production`, unexpired) → `ZatcaHttpTransport` (pinned host) — no HTTP exposure.

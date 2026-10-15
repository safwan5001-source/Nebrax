# TAX-ZATCA Horizon — Reconciliation audit (existing implementation vs master backlog)

STATUS: **READ-ONLY AUDIT — documentation only.** Prepared 2026-10-14. Authorises nothing: no implementation, merge, deploy, ZATCA traffic or accounting-policy change.
Audited code/CI state: `main` @ `76b05f69a32fb7d2c5d741708661261dfc01d6cf` (REM-06 merge, PR #1473). Base of the PR that adds this file: `main` @ `5ef2bb9e2630100462bc96f04d7c519bba0f2c86` — the only commit in between is AC-UX-11 (#1492, `web/` only; no backend, ZATCA or accounting file).
Companions: `TAX-HZ-00-REMEDIATION-BACKLOG.md` (plan), `TAX-HZ-00-AWJ-GAP-ASSESSMENT.md` (code assessment @ `4781a45`), `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md`, `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md`.

> **Not legal or tax advice. Nothing here states or implies that AWJ complies with ZATCA Phase 1 or Phase 2, is certified, approved, filing-ready or production-ready.** "COMPLETE" means a task's own acceptance criteria are met by merged code and tests; it is not a compliance statement. A merged PR is not evidence of deployment: **production deployment and operational verification of every item below are NOT VERIFIED** (no production access).

**How to read the percentages in §9.** They measure progress on the *remediation backlog* only, weighted by the plan's own effort estimates. They are **not** overall AWJ ERP completion, **not** overall ZATCA implementation completion, and **not** a compliance or readiness measure.

---

## 1. Executive summary

1. **Substantial ZATCA work predates the backlog.** 23 merged PRs between #503 and #593 whose titles mention ZATCA (plus #371 and #681 outside that range) built most of the pipeline: invoice classification, C14N 1.1 hashing, ECDSA/XAdES signing components, Phase 2 QR, encrypted per-tenant credentials, readiness gates, a pinned HTTP transport, a durable attempt log, a queue/dispatcher and a tenant connection workspace. `main` holds 30 `Zatca*` service classes (`app/Services/Accounting`) and 31 `Zatca*` test files. The backlog corrects and completes this pipeline; it does not rebuild it. (The count is by title keyword; a ZATCA-related PR without the word in its title would be missed.)
2. **Backlog progress.** Of the canonical 40 tasks (REM-00A, REM-00B, REM-01…REM-38): **9 COMPLETE** (REM-01, 02, 03, 04, 05, 06, 08, 11, 37), **3 PARTIAL** (REM-09, 26, 34), **4 NOT IMPLEMENTED** (REM-00B, 07, 21, 38), **24 BLOCKED**. Separately, of the 10 TAX-HZ-00 additions (TAX-E01…E03, TAX-N01…N07): **1 COMPLETE** (TAX-N01), 1 PARTIAL, 3 NOT IMPLEMENTED, 4 BLOCKED, 1 NEEDS VERIFICATION. All completions were merged on 2026-10-11 … 2026-10-14.
3. **ZATCA document compliance is not demonstrated.** AWJ-generated XML fails the official SDK's XSD, EN16931 and KSA stages (REM-11 baseline: 3 AWJ fixtures, all expected-fail; the SDK's 19 bundled samples pass). The XML body is a skeleton, the signature form, QR tag 7 and the first-document previous hash are non-conformant per AUDIT-1, there are no e-invoice credit/debit notes, no CSR/OTP/CSID onboarding, and the issue time comes from the draft's `created_at`. **Official SDK validation of AWJ-generated compliant documents has not been demonstrated.**
4. **What gates the critical path is decisions, not code.** ADR-A/I/B (and C, D, E, F, G, H, J) do not exist as files; D-06 (ZATCA clarification) and D-07 are unsent/unanswered. 24 of 40 tasks are BLOCKED.
5. **Transmission is dormant.** `ZATCA_SUBMISSION_DISPATCH_ENABLED` defaults to `false`, and the shipped image sets `QUEUE_CONNECTION=sync`, which transport readiness rejects. The transmission defects listed in §6 therefore cannot fire in the shipped configuration.
6. **Live (non-dormant) exposures** are in §6: Phase 1 QR time/TLV, the Fiscal Close VAT line after a remap, pinned standalone credit notes, and landing-page copy.

---

## 2. Verified repository baseline

| Item | Evidence |
|---|---|
| `origin/main` at audit time | `76b05f69a32fb7d2c5d741708661261dfc01d6cf` (PR #1473, merged 2026-10-14T21:12:06Z by the repository owner) |
| `origin/main` at PR time | `5ef2bb9e2630100462bc96f04d7c519bba0f2c86` (AC-UX-11 #1492, web only) |
| Post-merge `CI` run on `76b05f6` | Run `38638390150` (#9596, attempt 1): `php artisan test (L11, sqlite)` ✅ and `php artisan test (L11, pgsql)` ✅ |
| SDK conformance (advisory) | Last run `38536790270` ✅ on `38e259c`. Path-filtered `push`; not triggered by #1473 (no ZATCA path touched) |
| Delta vs the TAX-HZ-00 code assessment (`4781a45` → `76b05f6`, 87 commits) | `git log` shows **no change** to `ZatcaService`, `ZatcaHttpTransport`, `ZatcaCredentialMaterialValidator`, `ZatcaCredentialService`, `ApplicationCatalog`, `Invoice`, `FiscalCloseService`, `LedgerService`, `PurchaseService`, `InvoiceLinePrecision`, `Dockerfile`, `render.yaml`, `deploy/`. `ReportService` changed (REM-05). Code findings in the HZ-00 assessment for those files were re-checked by targeted grep (§3, §6) and still hold |
| Not run in this work | No test suite, no migration, no database operation, no ZATCA call, no SDK run. Status rests on code reads, `git log`, GitHub PR/CI metadata |
| Sources read | Backlog, HZ-00 gap assessment, Master Plan, Task Queue, remediation plan §2/§8, REM-11 and REM-06 reports, `CLAUDE.md` |

---

## 3. Canonical 40-task reconciliation matrix

Classifications: COMPLETE · PARTIAL · NOT IMPLEMENTED · BLOCKED · NEEDS VERIFICATION. "SDK" = the official offline SDK must be the acceptance oracle. Production deployment is **NOT VERIFIED for every row** and is not repeated.

### Tier 0 — evidence and decisions

| Task | Status | Evidence | Missing | Dependencies / decisions | SDK |
|---|---|---|---|---|---|
| REM-00A Production evidence + residency | **BLOCKED** | `render.yaml` shows intent only (frankfurt, local disk, retention 365); no `ZATCA_*` in `render.yaml`/`Dockerfile`/`deploy/` | Evidence items 1–6, ADR-H | D-08, D-10, production access | No |
| REM-00B ADR package A–J | **PARTIAL (documentation only, 2026-10-15)** | ADR-A/I/B direction recorded as `docs/decisions/ADR-0001/0002/0003` (direction approved; **regulatory gates and tax-adviser sign-off open**). Still no file for C, D, F, G, H, J; ADR-E decision exists only in the REM-02 PR/report; `ADR-E2` PROPOSED | C, D, E (formal), F, G, H, J; all open gates of A/I/B; tax-adviser sign-off | D-05 | No |

### Tier 1 — financial and security

| Task | Status | Evidence (PR · merge SHA · post-merge `CI` run) | Remaining / caveat | SDK |
|---|---|---|---|---|
| REM-01 Returns: VAT from source line | **COMPLETE** | #1291 · `999e06c52cd9e7dba3d8e16b3be00fc8d9ad9fa0` · `ReturnSourceAllocator`, `ReturnSourceVatAccuracyTest` | Finance review via `returns:vat-discrepancies` not run (production) | No |
| REM-02 Credit-note VAT basis + cap | **COMPLETE** | #1304 · `56fcac621411a10506ed626f43b4d5a99b2ed798`; print follow-ups #1315 `3209fcb77cc4e02b729bb74c34adf7e131869a1b`, #1320 `265974693502bc734ff0e9dbd12123bf3f345b51` | D-11 (tenants pinned to `allow_standalone_credit_notes=true` keep uncapped standalone notes); ADR-E not filed as an ADR; price-adjustment notes (ADR-E2) undecided | No |
| REM-03 / 03b Active-branch enforcement | **COMPLETE** | #1403 · `c589ced1dcbad88ef023d8be6ead34bc58f489f0` (CI #9327 ✅); #1410 · `322c20cf009e0f1c917566e4930b689764651b60` (CI #9351 ✅) | Read endpoints and `ReturnableController` excluded by design | No |
| REM-04 PostgreSQL posting deadlock | **COMPLETE** | #1450 · `899bcba4f3ecfbe4bf504c2276db2dc817daff42` (CI #9456 ✅); follow-up #1461 · `51851c04ae11ac90c14e223bc44456765d0dc535` (CI #9515 ✅) | Theoretical `InventoryService` lock-order case needs an owner-approved design (not done) | No |
| REM-05 VAT role eligibility + role-based report | **COMPLETE** | #1457 · `a8a950508d533805530c324d51595fe46cdaa682` (CI #9532 ✅) | Operator audit of remapped tenants not run | No |
| REM-06 Semantic VAT routing | **COMPLETE** | #1473 · `76b05f69a32fb7d2c5d741708661261dfc01d6cf` (CI #9596 ✅ sqlite + pgsql) | Owner's Option A (fail closed on missing/inactive mapping) supersedes the card's "unmapped fallback preserved". **Fiscal Close VAT line still reads only the current role account** (disclosed, not reconciled). Non-VAT hard-coded accounts remain | No |
| REM-07 Immutability of posted docs/journals | **NOT IMPLEMENTED** | `Invoice` `$fillable` includes `status` and `zatca_*`; `JournalEntry`/`JournalLine` have no model guards | Writer inventory, guards, verify command. No unmet dependency (ready) | No |
| REM-08 Deactivated users lose access | **COMPLETE** | #1415 · `6670a9a7e5df063d8d42ad6872a0b5599ae8bb11` (CI #9359 ✅) | Reactivation requires a fresh login by design | No |
| REM-09 64-bit overflow guards | **PARTIAL** | Guarded: `ReturnSourceAllocator::mulDiv`, `DeliveryNote…::checkedMultiply`. Unguarded: `InvoiceService.php:1248`, `PurchaseService.php:245` (`intdiv($taxGross * $net, …)`) | Shared helper, documented maximum, boundary tests. Start: maximum amount = policy | No |
| REM-10 VAT arithmetic consistency | **BLOCKED** | `?? 15` defaults (`ReturnService:165`, `ExpenseService:59,100`, `AssetService:72`, `RecurringInvoiceService:60`); client `tax_inclusive` accepted (`StorePosSaleRequest:25`) | 10a–10f. Blocked by REM-09, ADR-B (direction recorded in `ADR-0003`; **no calculation change approved; gates G-B1…G-B8 open**) | No |

### Tier 2 — ZATCA document blockers

| Task | Status | Evidence | Missing | Blocked by | SDK |
|---|---|---|---|---|---|
| REM-11 SDK conformance harness | **COMPLETE (advisory)** | #1416 · `cb87e17d7583d8b24eab76e87ae5dad1d78484b3` (CI #9365 ✅); `tests/Fixtures/zatca-sdk/baseline.json`; 19/19 official samples pass | Promotion to a blocking check; signed path not covered; **D-03a** legal/portal terms open | D-03a | It *is* the oracle |
| REM-12 VAT category / VATEX | **BLOCKED** | No category/VATEX in `ZatcaService` | Everything | ADR-I (direction recorded in `ADR-0002`; **gates G-I1…G-I7 open; no schema change authorised**) | Yes |
| REM-13 Issue time frozen at posting | **IMPLEMENTED IN A DRAFT PR (REM-13a, 2026-10-15) — not merged, not deployed** | At `main` @ `a79b157`: `ZatcaService.php:90,163,253` used `created_at`; no `invoices.issued_at` (`print_issued_at` exists only on `quotes`/`procurement_documents`). REM-13a: `invoices.issued_at` (UTC, second precision, immutable, no backfill) captured in `InvoiceService::post()` before `buildFor`; XML `IssueDate`/`IssueTime` in AST without `Z` (BR-KSA-70); both QR tag-3 values derive from it keeping their existing literal formats; `SigningTime` and transmission time independent. Report: `REM-13a-IMPLEMENTATION-REPORT.md` | **Open regulatory questions Q1 (QR tag 3 form) and Q2 (BR-KSA-04 zone) → D-06 / TAX-E01**; G-A3…G-A6; legacy rows stay `NULL` by design | ADR-A (`ADR-0001`; authorised for REM-13a by the owner) | Yes |
| REM-14 Party validation + snapshots | **BLOCKED** | No snapshot columns | Everything | REM-13 | Yes |
| REM-15 Classification as precondition | **BLOCKED** | Classification + type snapshot exist (#505); no preconditions, no buyer block | Preconditions, buyer block | REM-14 | Yes |
| REM-16 UBL 2.1 KSA body | **BLOCKED** | `buildXml` skeleton (`ZatcaService.php:272`: always `388`); SDK XSD/EN/KSA fail (REM-11 baseline) | 16a–d | REM-11 ✅, 12, 13, 14, ADR-B (`ADR-0003`, gates open) | Yes |
| REM-17 Stamp & QR conformance | **BLOCKED** | Signing infrastructure and Phase 2 QR exist; genesis `base64(sha256_raw("0"))` (`ZatcaService.php:175`); Phase 1 `tlv()` unguarded (`:181-184`) | 17a–c | REM-13, D-06 | Yes |
| REM-18 Credit/debit notes 381/383 | **BLOCKED** | `buildFor` has a single caller (`InvoiceService.php:1032`) | Everything | REM-16, ADR-E | Yes |
| REM-19 Onboarding CSR → CSID | **BLOCKED** | No CSR/OTP/CSID code for ZATCA (OTP hits are customer commerce OTP); credentials pasted manually | Everything | REM-17, ADR-C, D-07, D-09; separate approval before any ZATCA contact | Yes |
| REM-20 E-invoicing default-on (KSA tenants) | **BLOCKED** | `compliance.zatca` `mandatory => false` (`ApplicationCatalog.php:91-96`) | Default/mandatory semantics; page reading `invoice.zatca.qr` | D-04 | No |

### Tier 3 — submission reliability (all dormant while dispatch is off)

| Task | Status | Evidence | Missing | Blocked by |
|---|---|---|---|---|
| REM-21 Outcome classification + request contract | **NOT IMPLEMENTED** (21a ready; 21b blocked) | `ZatcaHttpTransport.php:83` `accepted = in_array($httpStatus,[200,202])`; body `{invoiceHash, invoice}`, no `uuid` | 21a: status map, failure category, no redirects. 21b: `uuid`, header constants | 21a: start approval (208/409 branch needs D-06). 21b: REM-16, TAX-E02 |
| REM-22 In-doubt state / lease / HTTP outside txn | **BLOCKED** | HTTP call inside `DB::transaction` (`ZatcaSubmissionDispatcher.php:26,42`); PostgreSQL `25P02` abort characterised by TAX-N01 | Everything | REM-21, ADR-D |
| REM-23 Worker, scheduler, 24 h clock | **BLOCKED** | `Dockerfile:56,58` file cache + sync queue; `render.yaml` defines one `web` service | Everything | REM-22, REM-00A, ADR-D |
| REM-24 Release gate, cleared XML, corrections | **BLOCKED** | `zatca_cleared_xml` stored but unused | Everything | REM-21, REM-23 |
| REM-25 Environment-scoped chain | **BLOCKED** | Unique `(tenant_id, zatca_icv)`; no environment column on invoices/attempts | Everything | REM-19, ADR-C |
| REM-26 Fail-closed hardening | **PARTIAL** | Readiness catches `DecryptException`; stable blocker codes | Expiry warnings, CRL/OCSP, coded errors, `undecryptable` state in listings | REM-19, REM-25 |
| REM-27 Observability, runbook | **BLOCKED** | TAX-N01 structured failure log only | Tenant-wide list, metrics, digest, runbook | REM-23 |

### Tier 4 and Tier 5

| Task | Status | Evidence | Blocked by |
|---|---|---|---|
| REM-28 VAT return / period freeze | **BLOCKED** | No `VatPeriod`/return code | REM-12, ADR-G (REM-05/06 now satisfied) |
| REM-29 Tax point / prepayments | **BLOCKED** | None | REM-16, REM-28, ADR-G |
| REM-30 Commerce → invoice VAT | **BLOCKED** | No tax fields on `CommerceOrder` | REM-10, REM-28, ADR-F |
| REM-31 Note deadline controls | **BLOCKED** | None | REM-28 |
| REM-32 Unsupported VAT scenarios | **BLOCKED** | None | REM-12, REM-28, ADR-I |
| REM-33 Report guard, reversal source link, retention | **BLOCKED** | No `requireTenant` in `ReportService`; `LedgerService.php:127` reversal carries `reversal_of` but no `source_*`; `DocumentRevision` 730 days, `Prunable` | REM-07, ADR-J |
| REM-34 Rendering / labelling | **PARTIAL** | PRINT-01/02 rate-aware credit-note label. Open: hard-coded "(15%)" defaults (4 in `en.json`, 3 in `ar.json`); landing copy `ar.json:2663` "فواتير ضريبية متوافقة مع المرحلتين" | REM-13 (the copy removal can be split out) |
| REM-35 Number allocated at posting | **BLOCKED** | `InvoiceService.php:99` allocates at create | REM-34 |
| REM-36 Retention / export | **BLOCKED** | 365-day default, local disk | REM-00A, ADR-H/J |
| REM-37 `zatca.submit` permission | **COMPLETE** | #1419 · `ff8e2332d23d156de2ca6f79646da2eccc7da4e8` (CI #9424 ✅) + review fixes #1445 · `38e259c8a7b2776f0f00da8ff1d14b9453e9f139` (CI #9444 ✅) | Backfill migration `down()` is a no-op by design |
| REM-38 Hygiene bundle | **NOT IMPLEMENTED** | `clearedXml()` has no DOCTYPE rejection (`ZatcaSubmissionDispatcher.php:168`); `deploy/cors.php:35` `?: ['*']` | Start: CORS boot-fail needs owner confirmation |

### TAX-HZ-00 additions (counted separately from the canonical 40)

| Task | Status | Evidence | Blocked by |
|---|---|---|---|
| TAX-E01 Clarification pack | **BLOCKED** | Questions listed in the evidence register; not sent | D-06 (external) |
| TAX-E02 Swagger/OpenAPI capture | **BLOCKED** | — | D-07 |
| TAX-E03 SDK licence & fixture policy | **PARTIAL** | D-03b…g decided and merged with REM-11 | D-03a open (legal) |
| TAX-N01 Dispatcher diagnostics | **COMPLETE** | #1444 · `17dc59af83c44ed3f4b3a4f9c59f61a5f5d3ea36` (CI #9437 ✅) | `ZatcaNotificationBridge.php:51` still logs a raw `getMessage()` |
| TAX-N02 Credential ↔ VAT/template binding | **NOT IMPLEMENTED** | Validator has no subject/VAT/template check | Start approval (credential PUT behaviour change) |
| TAX-N03 Credential/environment audit events | **NOT IMPLEMENTED** | No audit call in credential service, controller or settings | Start approval (audit facility) |
| TAX-N04 Honest `submission_mode` | **NOT IMPLEMENTED** | `automatic` accepted (`UpdateZatcaSettingsRequest.php:21`), no consumer | Start approval |
| TAX-N05 Wave / due-date setting | **BLOCKED** | None | D-04, D-10 |
| TAX-N06 | **NEEDS VERIFICATION** | Referred to as blocked by D-06 but no card was found | Define or drop |
| TAX-N07 CLAUDE.md corrections | **BLOCKED** | ICV statement at `CLAUDE.md:400` unconfirmed by official texts; stale "no automated web tests" line | D-06, D-12 |

### Status counts (internally consistent)

| Set | Complete | Partial | Not implemented | Blocked | Needs verification | Total |
|---|---:|---:|---:|---:|---:|---:|
| Canonical (REM-00A, 00B, 01–38) | 9 | 3 | 4 | 24 | 0 | **40** |
| TAX-HZ-00 additions | 1 | 1 | 3 | 4 | 1 | **10** |

Canonical lists — COMPLETE: 01, 02, 03, 04, 05, 06, 08, 11, 37 · PARTIAL: 09, 26, 34 · NOT IMPLEMENTED: 00B, 07, 21, 38 · BLOCKED: 00A, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25, 27, 28, 29, 30, 31, 32, 33, 35, 36. "Post-merge `CI` run #" in §3 is the `CI` workflow push run on that merge SHA (SQLite + PostgreSQL jobs), as returned by the GitHub Actions API.

---

## 4. Historical PR reuse matrix

Merge SHAs for the October PRs are full SHAs verified against `origin/main` history or the GitHub commit API. August SHAs are the 10-character prefixes returned by the GitHub commit search (full SHAs not resolved here).

| PR | Merge SHA | Delivered (present in `main`) | Reuse / caveat |
|---|---|---|---|
| #371 | not resolved | Legacy ZATCA entitlement grant | NOT VERIFIED beyond title/merged state |
| #503 | `7465031e31` | `submission_mode` manual/automatic | `automatic` has no consumer (TAX-N04) |
| #505 | `e0f1929bee` | Invoice type + clearance/reporting path snapshot | Base for REM-15 |
| #507 | `36df2e52cc` | `zatca_submission_attempts`: idempotency, immutable identity, pending→final only | Base for REM-22 (needs `sending`/`unknown`, lease) |
| #514 | `33f3729f7b` | Encrypted per-tenant, per-environment CSID store; password-gated | One `APP_KEY` protects all tenants (D-09) |
| #519, #538 | `8e39829e77`, `8e342b93bf` | C14N 1.1 invoice hashing | Hash step matched 19/19 official samples in AUDIT-1; keep |
| #527, #533 | `e04975112e`, `25f0dfa5fe` | Key↔certificate, secp256k1, chain storage | Extend for TAX-N02 |
| #531, #532, #535, #536, #543 | `810ba17011`, `8fb30c7fbf`, `bb9f4885aa`, `644c139921`, `ee80b9bb89` | UBL envelope, ECDSA signer, SignedProperties, SignedInfo, XAdES assembly | Reuse in REM-17; signature form failed the SDK in AUDIT-1 |
| #544 | `306feb102a` | `active_environment`, signing-credential resolver (no cross-environment fallback) | Base for REM-25 |
| #554, #555, #556 | `f3901e9aa0`, `3ff37930a5`, `4fccc8645c` | Signature policy contract, signing readiness, signer orchestrator | Keep; policy is a hard blocker (REM-17c decides) |
| #567, #569, #571, #582 | `5e4c72f9a2`, `22ff261dd0`, `189eda0b72`, `4710169140` | Phase 2 QR encoder and material extraction | Tag 7 form failed SDK QR (REM-17) |
| **#587–#591** | **closed without individual merges** | Finalizer, posting wiring, transport, dispatcher, queue recovery (stacked drafts) | **Their relevant implementation was incorporated through merged PR #592** — all 28 files of #592 exist in `main`. Not independently merged; do not cite them as merged |
| #592 | `1c12bae7184bfccc3bbeca99a7faafc6f207a5af` | Signed-invoice freeze + posting rollback, pinned transport, dispatcher, queue/readiness/recovery | Core of REM-21–24; defects: HTTP inside the transaction, HTTP-status-only classification |
| #593 | `600d1659e2d02c00b4772051d8476934d6d9c997` | **Existing tenant ZATCA connection workspace** (readiness, per-environment credentials, production-CSID confirmation) | Extend, do not rebuild; no onboarding wizard |
| #681 | not resolved | Financial-control + ZATCA notification integration | Bridge narrowed to `zatca.submit` by #1445 |
| #1290 | not recorded here | AUDIT-1 documents (merged 2026-10-11T04:51:29Z) | Historical baseline, `0534ef1` |
| #1291, #1304, #1315, #1320 | see §3 | REM-01, REM-02, PRINT-01, PRINT-02 | Complete |
| #1398 | `0c90419874594169d422515e881425e5b3b3fa70` | TAX-HZ-00 evidence pass, gap assessment, backlog | Baseline `4781a45` |
| #1403, #1410, #1415, #1416, #1419, #1444, #1445, #1450, #1457, #1461, #1473 | see §3 | REM-03…REM-37, TAX-N01 | Complete |

---

## 5. Confirmed completed functionality — by operational layer

**A. AWJ platform-level integration operations**

* Exists: the platform console and integration centre (`PlatformIntegrationService`: document storage, malware scanner, document processing, document AI), `PlatformRuntimeHeartbeat` (document-centre worker only), generic platform application overrides over catalog capabilities, the config-level dispatch kill switch, the advisory SDK workflow.
* **Gap:** no ZATCA surface in any platform controller, service or `web/src/app/platform` screen (grep). No worker/queue readiness for ZATCA, no environment-wide transport control in the UI, no cross-tenant submission monitor, no ZATCA heartbeat, no `ZATCA_*` configuration path in any deployment manifest, no key-custody model (D-09). Whether the generic overrides were ever exercised for `compliance.zatca`: NOT VERIFIED.

**B. Tenant-level ZATCA setup** (largely built)

* Exists: encrypted per-tenant, per-environment credentials with key↔certificate/curve/chain/validity checks (#514, #527, #533); `active_environment` with no cross-environment fallback (#544); signing and transport readiness with stable blocker codes (#555, #592); workspace UI (#593); `zatca.submit` (REM-37); active-branch enforcement on submission (REM-03b); password + `company.manage` for credential writes.
* Missing: onboarding (REM-19); credential ↔ tenant VAT/template binding (TAX-N02); audit trail (TAX-N03); honest `submission_mode` (TAX-N04); expiry warnings (REM-26); seller-VAT validation outside Phase 2 QR time (REM-14).

**C. Actual ZATCA document compliance** (mostly missing; SDK-confirmed)

* Exists, AWJ-test-verified only: C14N/hash (matched official samples once, AUDIT-1), ICV (tenant lock + unique index), PIH chaining, Phase 1 QR, signing components, VAT routing/integrity (REM-05/06), return and credit-note VAT accuracy (REM-01/02).
* Missing: valid UBL body, categories/VATEX, frozen issue time, party snapshots, conformant stamp/QR/genesis PIH, 381/383 notes, clearance/reporting correctness, **any SDK pass on AWJ output**.

**D. Go-live readiness:** nothing verified. Onboarding, production configuration, worker/scheduler, runbook, residency, real-data classification: missing or NOT VERIFIED.

---

## 6. Missing functionality and critical risks

| # | Risk | Severity | Active today? | Task |
|---|---|---|---|---|
| R1 | XML body, signature form, QR tag 7 and genesis PIH non-conformant (SDK baseline) | P0 | Phase 2 path only; dispatch off | REM-16/17 |
| R2 | Phase 1 QR tag 3 uses the draft `created_at`; `tlv()` is `chr(strlen)` with no guard (values ≥256 bytes corrupt) | P1 | **Yes** (every posted invoice) | REM-13; TLV guard splittable from REM-17c |
| R3 | Fiscal Close VAT line ≠ REM-05 report after a remap (REM-05 `disclosures[]` states the difference; `FiscalCloseService::roleBalance` reads the current account only) | P1 financial integrity | **Yes** for remapped tenants | Follow-up (decision FC-1) |
| R4 | Uncapped standalone credit notes for tenants pinned by migration `2026_11_04_030000` | P1 VAT | Yes, if any such tenant exists (NOT VERIFIED) | D-11 |
| R5 | `?? 15` defaults, client `tax_inclusive`, fixed 15% shipping VAT | P2 | Yes | REM-10 |
| R6 | Unguarded 64-bit multiplication → TypeError on very large amounts | P2 | Edge | REM-09 |
| R7 | One `APP_KEY` decrypts every tenant's signing key; no VAT/template binding; no audit of credential/environment changes | P1 security | Credentials can be stored today | D-09, TAX-N02, TAX-N03 |
| R8 | HTTP 200 ⇒ "accepted" regardless of body; HTTP inside a DB transaction (PG `25P02`); `ShouldBeUnique` on a `file` cache; redirects allowed | P0 once enabled | Dormant | REM-21/22/23 |
| R9 | Cleared XML accepts a DOCTYPE; CORS falls back to `*`; raw exception text in 422 bodies, `xmllint` stderr, notification log | P2/P3 | Partly | REM-38, REM-26 |
| R10 | Posted documents/journals protected by service logic only; report layer has no tenant guard; revision retention 730 days | P2 | Yes | REM-07, REM-33 |
| R11 | Landing copy claims compliance with both phases | Legal/marketing | **Yes** | REM-34 (splittable) |
| R12 | `CLAUDE.md:400` ICV-per-VAT-number statement not confirmed by the official texts read | Governance | Docs | D-12 / TAX-N07 |
| R13 | One-time pgsql CI timeout on the REM-06 head (cause undetermined; passed on re-run); duplicate `Expense` number when the branch context changes between two expenses (observation) | Process | — | Monitor; separate numbering review |

---

## 7. Open decisions

| ID | Decision | Unblocks |
|---|---|---|
| D-05 | ADR-A (issue time), **ADR-I** (categories), **ADR-B** (rounding), C, D, E (formal), F, G, H, J + tax-adviser sign-off. **Status 2026-10-15: PARTIALLY RECORDED — not resolved.** A/I/B direction recorded (`docs/decisions/ADR-0001…0003`); regulatory gates, tax-adviser sign-off and owner approvals listed in each ADR remain open; C, D, E, F, G, H, J not started | REM-12/13/10/16 and all downstream |
| D-06 / D-07 | ZATCA clarification request; Swagger/OpenAPI capture | REM-17/19/21b/25 |
| D-03a | SDK licence / portal terms (open since REM-11) | Making REM-11 blocking |
| D-04 / D-10 | "KSA tenant" definition + default-on semantics; real taxpayer data and wave | REM-20, TAX-N05, prioritisation vs 1 Feb 2027 |
| D-08 / D-09 | Residency; key-custody model | REM-00A, REM-19/26, REM-36 |
| D-11 / D-12 | Pinned standalone credit notes; `CLAUDE.md` corrections | VAT-02 residual, TAX-N07 |
| FC-1 (new) | Fiscal Close VAT line: read the role-account set, or surface the REM-05 disclosure | R3 |
| Per-task starts | REM-09 maximum amount; REM-21a state semantics; TAX-N02 API behaviour; TAX-N03 audit facility; REM-38 CORS boot-fail | Those tasks |
| Housekeeping | Owner deletes remote branches `claude/rem-11-negative-probe` and `claude/rem-11-zatca-sdk-conformance` | Cleanliness |

---

## 8. Dependency-aware remaining work

```
Decisions (D-05: ADR-A/I/B first · D-06 · D-04) ──┐
                                                   ▼
Ready now (no unmet dependency): FC-1 follow-up · TAX-N02 · TAX-N03 · TAX-N04 · REM-21a · REM-38 · REM-09 · REM-07 · REM-00B
After ADR-I / ADR-A: REM-12 ‖ REM-13 → REM-14 → REM-15 → REM-16 (SDK gate) → REM-17 ‖ REM-18
After REM-16:        REM-21b → REM-22 (ADR-D) → REM-23 (REM-00A) → REM-24 ; REM-27
After REM-17:        REM-19 (ADR-C, D-07, D-09) → REM-25 → REM-26
After REM-12 / 07 / 13: REM-28 (ADR-G) → REM-29/30/31/32 ; REM-33 ; REM-34 → REM-35 ; REM-36
```

---

## 9. Completion estimate — methodology and limits

**Inventory.** The 40 canonical tasks of `AWJ-TAX-ZATCA-REMEDIATION-PLAN.md`. **Weight** = midpoint of the plan's own effort scale (S=1.5, M=4, L=8; XL taken as the plan's stated range midpoint: REM-16 = 16, REM-19 = 13, REM-28 = 16; ranged items at their midpoint). **Credit** = full weight for COMPLETE; PARTIAL counts 0 in the *conservative* figure and 50 % in the *upper* figure; everything else 0.

| Task weights (days) | |
|---|---|
| Tier 0 | 00A 2 · 00B 4 |
| Tier 1 | 01 4 · 02 4 · 03 1.5 · 04 4 · 05 4 · 06 4 · 07 8 · 08 1 · 09 4 · 10 7 |
| Tier 2 | 11 4 · 12 8 · 13 4 · 14 4 · 15 1.5 · 16 16 · 17 10 · 18 8 · 19 13 · 20 1.5 |
| Tier 3 | 21 4 · 22 4 · 23 8 · 24 8 · 25 4 · 26 4 · 27 4 |
| Tier 4 | 28 16 · 29 8 · 30 8 · 31 1.5 · 32 8 · 33 6.5 |
| Tier 5 | 34 4 · 35 4 · 36 4 · 37 1.5 · 38 3 |

| Scope | Weight | Complete | Partial | Conservative | Upper |
|---|---:|---:|---:|---:|---:|
| Tier 0 | 6 | 0 | 0 | 0 % | 0 % |
| Tier 1 | 41.5 | 22.5 | 4 (09) | 54.2 % | 59.0 % |
| Tier 2 | 70 | 4 (11) | 0 | 5.7 % | 5.7 % |
| Tier 3 | 36 | 0 | 4 (26) | 0 % | 5.6 % |
| Tier 4 | 48 | 0 | 0 | 0 % | 0 % |
| Tier 5 | 16.5 | 1.5 (37) | 4 (34) | 9.1 % | 21.2 % |
| **Total** | **218** | **28** | **12** | **12.8 %** | **15.6 %** |

**Limitations — read before quoting any number.**

1. The 12.8 %–15.6 % figure is progress on the *remediation backlog*, effort-weighted. It is **not** overall AWJ ERP completion and **not** overall ZATCA implementation completion.
2. It does not credit the Aug 2026 pipeline (§4) that predates the audit, and it does not measure compliance, correctness against the SDK, risk reduction or business value.
3. Weights are indicative engineering days from the plan's S/M/L/XL scale (the plan's own range for all 40 tasks is 164–272 days; 218 sits inside it). They exclude review, QA, Compliance sign-off, ZATCA onboarding lead time and all decisions.
4. Engineering effort is not sequential value: the 70 days of Tier 2 deliver the first SDK-passing document and are 5.7 % done.
5. Counts, not percentages, are the primary result: 9 / 3 / 4 / 24 (canonical) and 1 / 1 / 3 / 4 / 1 (additions).

| Dimension | Status |
|---|---|
| Backlog engineering completeness | 9 of 40 tasks COMPLETE (12.8 %–15.6 % by weight) |
| ZATCA document compliance | **Not demonstrated.** No AWJ-generated document has passed the official SDK; all 3 AWJ fixtures fail by baseline |
| Production readiness | **Not met / NOT VERIFIED.** No onboarding, worker, runbook, production evidence or confirmed deployment |

---

## 10. Recommended next five independent tasks

| # | Task | Priority | Dependencies | Complexity | Acceptance criteria |
|---|---|---|---|---|---|
| 1 | **FC-1 — Fiscal Close VAT line on the role-account set** (REM-06 residual) | P1 financial integrity | REM-05/06 ✅; owner decision FC-1 | S (1–2 d) | After a remap, the Fiscal Close VAT figure equals the REM-05 `taxReport` total, or the screen displays the `disclosures[]` difference. No posting change. Remap and multi-remap tests on SQLite and PostgreSQL; tenant and branch isolation |
| 2 | **TAX-N02 — bind credential to tenant VAT number and environment template** | P1 taxpayer isolation | Start approval; soft dependency on REM-11 fixtures | M (3–5 d) | Certificate whose subject VAT differs from the tenant's, or whose template does not match the environment, is rejected with a coded 422; no secrets in errors; valid sets unaffected |
| 3 | **TAX-N03 — audit events for credential and environment changes** | P1 accountability | Start approval (audit facility; the append-only pattern of INT-AUDIT-1 is a candidate) | S–M | Every credential store/replace and `active_environment`/mode change records who, when, environment, fingerprint, in the same transaction; no key material; tenant-isolated |
| 4 | **REM-21a — outcome classification (transport only)** | P0 once dispatch is enabled | Start approval; 208/409 branch waits on D-06 | S–M | Table-driven `Http::fake` matrix: 200 with `NOT_CLEARED` body ⇒ not accepted; redirect ⇒ failed; non-JSON 200 ⇒ failed; 208/409 ⇒ pending verification. No real network. Dispatch flag unchanged |
| 5 | **REM-38 — hygiene bundle** | P3 security | Owner confirmation (CORS boot-fail) | S–M | DOCTYPE/entity cleared XML rejected; production CORS without `*`; 1/3 quantity rejected; both databases green |

In parallel (not code): a D-05 decision packet for ADR-A, ADR-I, ADR-B — the largest single unblock for the compliance critical path.

> **Update 2026-10-15 (documentation only).** The D-05 decision review for ADR-A/I/B has been recorded as `docs/decisions/ADR-0001-invoice-issue-timestamp.md`, `docs/decisions/ADR-0002-vat-categories-and-exemptions.md` and `docs/decisions/ADR-0003-monetary-rounding-and-tax-totals.md` (index: `docs/decisions/README.md`). These record *approved architectural direction* only. They do **not** close D-05: unresolved regulatory/tax interpretations are listed as decision gates in each ADR (G-A1…G-A6, G-I1…G-I7, G-B1…G-B8); tax-adviser sign-off and ZATCA clarification (D-06/TAX-E01) are not obtained; no schema, calculation, posting or API change is authorised. Proposed next slice **REM-13a** is documented in ADR-0001 and is **not authorised** (a database migration adding `issued_at` is NOT YET AUTHORIZED).

---

## 11. References and evidence

* Documents: `docs/audits/horizon/TAX-HZ-00-REMEDIATION-BACKLOG.md`, `TAX-HZ-00-AWJ-GAP-ASSESSMENT.md`, `TAX-HZ-00-EXTERNAL-EVIDENCE-REGISTER.md`, `AWJ-TAX-ZATCA-HORIZON-MASTER-PLAN.md`, `AWJ-TAX-ZATCA-HORIZON-TASK-QUEUE.md`, `REM-03…REM-37` and `TAX-N01` implementation reports, `docs/audits/AWJ-TAX-ZATCA-REMEDIATION-PLAN.md` (§2 effort scale, §8 cards), `CLAUDE.md`.
* Code (line numbers as of `76b05f6`): `ZatcaService.php:90,163,175,181-184,253,272` · `ZatcaHttpTransport.php:36,83` · `ZatcaSubmissionDispatcher.php:26,42,168` · `ZatcaNotificationBridge.php:51` · `ZatcaCredentialMaterialValidator.php` · `ApplicationCatalog.php:91-96` · `FiscalCloseService.php:604-616` · `InvoiceService.php:99,1032,1248` · `PurchaseService.php:245` · `Invoice.php:25-34` · `LedgerService.php:127` · `DocumentRevision.php:56` · `Dockerfile:56,58` · `deploy/cors.php:35` · `web/src/messages/ar.json:2663` · `tests/Fixtures/zatca-sdk/baseline.json`.
* GitHub (read-only): PR metadata for #503, #505, #507, #514, #527, #533, #544, #587–#593, #1290, #1473 and the merge commits listed in §3/§4; `CI` push runs on each October merge SHA (run numbers in §3), including `38638390150` for `76b05f6`.
* Unverified or unresolved in this document: production state of any kind; full SHAs of the August PRs, #371, #681 and #1290; any SDK result on signed output; the cause of the one-time pgsql CI timeout; whether `compliance.zatca` overrides were exercised on any tenant.

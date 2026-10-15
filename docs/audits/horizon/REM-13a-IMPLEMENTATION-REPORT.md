# REM-13a — Implementation report: invoice issuance instant (`invoices.issued_at`)

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/tax-rem-13a-issued-at`. PR number, base/head SHAs and CI/CI Gate results are posted on the PR (this file is part of the commit and cannot name its own SHA). |
| Authority | Owner decision 2026-10-15: "Proceed with REM-13a using Option 1" (one Draft PR; `issued_at` migration authorised; QR tag-3 formats unchanged). Direction: `docs/decisions/ADR-0001-invoice-issue-timestamp.md`. |
| Base | `main` @ `a79b1576abe3d4aba9ad241f477d09b5bebdd72a` |
| Zone | C (tax / ZATCA). **No** change to journals, VAT, totals, ICV numbering/scope, ledger roles, credit limits, `invoice_date`, fiscal-year protection, permissions or routes. |
| Not claimed | **This is not a ZATCA compliance statement.** The AWJ synthetic fixtures still FAIL the official SDK (XSD/EN/KSA/QR/SIGNATURE/PIH) exactly as in the REM-11 baseline; REM-16/17 are untouched. |

---

## 1. What changed and why

**Defect (confirmed from primary evidence):** XML `IssueDate`/`IssueTime` and both QR tag-3 values were derived from `created_at` (the *draft* creation time), and the XML time was the UTC wall-clock written **without** `Z` — which BR-KSA-70 defines as Arabia Standard Time. Net effect: wrong instant (draft time, not issuance), and, for the XML, a three-hour offset (and the previous calendar day between 00:00 and 03:00 AST).

**Fix:**

| Area | Change |
|---|---|
| Persistence | `invoices.issued_at` — nullable `timestamp(0)`, **UTC**, second precision. Read/written through `App\Support\UtcSecondInstant` (a cast that never depends on `APP_TIMEZONE`, truncates fractions). Not in `$fillable`; no request class accepts it. |
| Immutability | `Invoice::booted()` `updating` guard: once non-null, any change *or clearing* throws `LogicException`. Ordinary updates that do not touch the column are unaffected. (No DB trigger/CHECK — same behaviour on SQLite and PostgreSQL.) |
| Capture point | `InvoiceService::post()` — **once**, inside the posting transaction, after the invoice row lock and after the tenant-anchor lock taken by `LedgerService::post`, and **before** `ZatcaService::buildFor`. Rolled back with the transaction; a retry captures a fresh instant. Value = `ZatcaIssueTimestamp::capture()` (`now('UTC')` truncated to the second) and is the same object handed to XML and both QR paths — the clock is never read again for them. |
| XML | `IssueDate`/`IssueTime` = the stored instant in `Asia/Riyadh` (UTC+3, no DST) formatted `Y-m-d` / `H:i:s`, **no `Z`** (BR-KSA-70). |
| QR tag 3 | Phase 1 (`qrFor`) and Phase 2 (`ZatcaSignedInvoiceFinalizer` → `ZatcaPhaseTwoQrEncoder`) both take the stored instant and **keep their existing literal formats** (Phase 1: `Y-m-d\TH:i:sP` in UTC → `…+00:00`; Phase 2: UTC `Y-m-d\TH:i:s\Z`). No new tag-3 format is introduced (Q1). |
| Independence | `SigningTime` stays `now('UTC')` at signing; transmission time stays in `zatca_submission_attempts`. Tests prove they differ from the issue instant. |
| Fail-closed | `ZatcaService` throws if asked to generate without a stored instant — no fallback to `created_at` or `now()`. |
| Legacy | Rows posted earlier keep `issued_at = NULL`; no backfill (not from `created_at`, `journal_entries.posted_at` or XML). Their signed XML/QR/hash, PIH chain and journals are not touched and nothing regenerates them. |
| API (additive, read-only) | `issued_at` (`YYYY-MM-DDTHH:MM:SSZ` or `null`) on `InvoiceResource` and `GET /invoices/{id}/zatca`. |
| Docs | ADR-0001 erratum (`print_issued_at` is on `quotes`/`procurement_documents`, **not** `invoices`) + implementation status + Q1/Q2; evidence register DP-R13/DP-R14; tracking docs; `CLAUDE.md` note. |

## 2. Official evidence for the timestamp representations (regulatory gate)

Retrieved 2026-10-15 from zatca.gov.sa; hashes equal the register's (`XML Std v1.2` `5aa15ff95efb98d3`, `Security Features v1.2` `9049935ee34f9d49`, `Data Dictionary vF` `61148ff46d174e5b`); DTG v2, Implementation Resolution (EN) read the same day. SDK `238-R3.4.8` fetched through the pinned, SHA-256-verified harness path (`91d079b4…`) into a scratch directory outside the repo (no vendoring/caching/redistribution; D-03a still open).

| Question | Finding | Evidence |
|---|---|---|
| Supported `IssueDate` / `IssueTime` formats | `YYYY-MM-DD`; `hh:mm:ss` (AST) **or** `hh:mm:ssZ` (UTC) | XML Std BR-KSA-F-01, **BR-KSA-70** p.58; Data Dictionary KSA-25 `HH:mm:ss`; SDK Schematron regexes `^hh:mm:ss$` / `^hh:mm:ssZ$` |
| Time zone / UTC conversion | Bare time = **AST**; `Z` = UTC. All 19 SDK samples use bare AST. AWJ now converts the stored UTC instant to AST. | BR-KSA-70; samples |
| Phase 1 QR tag 3 | "ISO 8601, example `…Z`" (SEC Table 3, Resolution Annex 1). **Exact text form unresolved (Q1).** | SEC p.26; RES Annex 1 |
| Phase 2 QR tag 3 | DTG: combination of issue date+time, pattern with literal `'Z'`; SDK samples/generator: bare, no `Z`. **Conflict — Q1.** | DTG QR section; 19 samples; SDK `QrGenerationService.formatDateTime` (bytecode) |
| May the same instant have different textual forms? | The standard text requires an ISO 8601 timestamp for tag 3 and `hh:mm:ss[Z]` for XML; it does **not** state the two strings must be identical, and the SDK does not enforce tag 3 (below). AWJ therefore guarantees the same **instant**, not the same string. | tests compare parsed instants |
| Does SDK acceptance prove a tag-3 requirement? | **No.** Probe on an official signed sample, tag 3 replaced by `…Z`, `…+03:00`, −3 h shifted, `garbage`: all PASS the QR stage; changing the seller-name tag FAILS. | probe (see ADR-0001 "Unresolved regulatory questions") |
| `IssueDate` ≤ current date (BR-KSA-04): which zone? | Unstated. SDK: AST date one day ahead of UTC → BR-KSA-04 error under a UTC JVM; accepted under `-Duser.timezone=Asia/Riyadh`. **Q2.** | Std p.47; Schematron; probe |

**Unresolved (recorded for D-06 / TAX-E01, not decided here):** **Q1** — must QR tag 3 carry `Z` (UTC instant) or be the bare AST `IssueDate`+`T`+`IssueTime`, and does the platform compare it with the XML? **Q2** — which zone does the platform use for BR-KSA-04? Also still open from ADR-0001: G-A3 (regeneration/re-issue after failure — no such path exists), G-A4 (`invoice_date` policy — unchanged), G-A5, G-A6 (production `APP_TIMEZONE` / existing ZATCA-issued rows — unverified).

## 3. Files

| File | Change |
|---|---|
| `database/migrations/2026_11_11_010000_add_issued_at_to_invoices.php` | new — nullable `timestamp(0)`; no backfill/index/trigger; `down()` drops the column |
| `app/Support/UtcSecondInstant.php` | new — UTC/second cast |
| `app/Support/ZatcaIssueTimestamp.php` | new — capture + XML/Phase-1 representations |
| `app/Models/Invoice.php` | cast + immutability guard (`booted`) |
| `app/Services/Accounting/InvoiceService.php` | capture in `post()` before `buildFor` |
| `app/Services/Accounting/ZatcaService.php` | XML and QR (both phases) from the stored instant; fail-closed accessor |
| `app/Http/Resources/InvoiceResource.php`, `app/Http/Controllers/Api/InvoiceController.php` | additive read-only `issued_at` |
| `tests/Feature/InvoiceIssuedAtTest.php` | new — 21 tests |
| `tests/Feature/InvoiceIssuedAtPostgresTest.php` | new — 2 real-fork concurrency tests (PostgreSQL only) |
| `tests/Feature/ZatcaSignedInvoicePostingTest.php` | +2 tests (Phase-2 QR, XML, `SigningTime` independence) |
| `tests/Feature/PosCheckoutIdempotencyTest.php` | +1 test (replay keeps instant/artifacts) |
| `tests/Feature/ZatcaSdkFixtureDriftTest.php`, `tests/Fixtures/zatca-sdk/awj/*.xml` | fixtures regenerated with `issued_at = 07:30:00Z` (= 10:30:00 AST): `IssueTime` unchanged, only the QR (line 31) differs; digests updated per the documented workflow; `baseline.json` unchanged |
| `docs/decisions/ADR-0001…`, `docs/decisions/README.md`, `docs/audits/horizon/*`, `CLAUDE.md` | docs |

## 4. Migration and backward compatibility

- Additive, nullable, no default, no rewrite of existing rows. Experimental/existing data are neither reset nor deleted.
- Pre-existing posted invoices: `issued_at = NULL` forever; API returns `null`; `zatca_xml`/`zatca_hash`/`zatca_qr`/`zatca_previous_hash` byte-identical; PIH of the next invoice is still derived from the stored XML of the previous one (tests: `legacy_posted_invoices…`, `the_migration_adds_a_nullable_column_and_never_backfills…`).
- For **new** invoices the XML hash input changes (IssueDate/IssueTime source and zone); the chain is unaffected because PIH comes from stored XML.
- API: only an added field. Clients that send `issued_at` are ignored.
- Rollback: `down()` drops the column; no data other than `issued_at` is lost.

## 5. Tests

| Suite | Result |
|---|---|
| `InvoiceIssuedAtTest` (21) — draft null; one UTC/second instant; PHP-timezone independence; cast; immutability; mass-assignment/API input ignored; rollback+retry; double post; 6 AST date-boundary cases (incl. 20:59:59Z, 21:00:00Z, year end); Phase-1 QR instant; fail-closed; reprint/resend; legacy NULL; migration no-backfill; no journal/VAT/ICV effect; tenant isolation | SQLite ✅ · PostgreSQL ✅ |
| `InvoiceIssuedAtPostgresTest` (2) — concurrent post of the same draft (one winner, one instant); 4 concurrent drafts (ICV 1–4, `issued_at` non-decreasing with ICV, PIH chain intact, no 40P01) | PostgreSQL ✅ (skipped on SQLite by design) |
| `ZatcaSignedInvoicePostingTest` (+2) — Phase-2 QR tag 3 `…Z` from the stored instant, XML AST, `SigningTime` independent | SQLite ✅ · PostgreSQL ✅ |
| `PosCheckoutIdempotencyTest` (+1) | SQLite ✅ · PostgreSQL ✅ |
| Mutation checks (local, reverted): XML time in UTC ⇒ 7 tests fail; immutability guard disabled ⇒ test fails | ✅ tests are load-bearing |
| Full `php artisan test` | Local, full, no `--filter`. **SQLite:** 7222 passed, 139 skipped, 26 failed — all 26 are the Fuel tests that need PHP `bcmath` (`Call to undefined function App\Services\bcmul()`), absent in this sandbox and present in CI. **PostgreSQL** (`--parallel --processes=4`, `PGOPTIONS='-c lock_timeout=60s'`): 7387 tests, 3 skipped, 27 failed — the same 26 Fuel/`bcmul` tests plus `StorefrontMediaApiTest › the library lists newest first…` (`PDOException HY093`, a known local-PostgreSQL-only artefact that passes in CI and fails identically on the unmodified baseline). **Zero new failures.** CI (`php artisan test` sqlite + pgsql, `CI Gate`) on the final head is posted on the PR. |

## 6. Official SDK validation (advisory harness, JDK 11, local; CI runs the same)

- Official 19 samples: all stages PASSED (unchanged).
- AWJ fixtures **before vs after this change**: per-fixture, per-stage result JSON **identical**; ratchet verdict OK for all three; no new error codes; **no** BR-KSA-70/71/F-01 errors.
- **Pre-existing failures (REM-11 baseline, not caused here, not fixed here):** XSD (`SAXParseException`), EN (`BR-CO-04/15/18`), KSA (simplified fixtures `BR-KSA-28/39/68`; standard fixture `BR-KSA-39/52/53/68`), QR (`QRCODE_INVALID`, simplified fixtures), SIGNATURE (simplified fixtures), PIH (`KSA-13`) — the skeleton UBL is not Phase-2 conformant (REM-16/17).
- **New regressions:** none.
- Environment note: local JDK 21 cannot verify secp256k1 (SIGNATURE stage); results above use Temurin 11 like CI.

## 7. Remaining risks

| Risk | Note |
|---|---|
| **Q1** QR tag-3 text may need a different form (with or without `Z`) | Not changed; the SDK cannot tell. Send to ZATCA (TAX-E01). |
| **Q2** BR-KSA-04 zone | A UTC-clock validator can flag correct AST dates 00:00–03:00 AST. Run taxpayer-side SDK checks with `-Duser.timezone=Asia/Riyadh` until answered. |
| XML hash input change for new invoices | Intended; legacy untouched. Any tenant already clearing/reporting invoices with the old (mis-zoned) XML is G-A6 (unverified). |
| Print/PDF still shows `invoice_date`/`created_at` | Not in scope; no issue-time is printed yet. |
| G-A3 contingency/re-issue | No regeneration path exists; building one must reuse the stored instant and needs evidence first. |
| Not a compliance claim | Fixtures still fail the SDK; REM-16/17/12/10 outstanding. |

## 8. Recommended next action

Owner review of the Draft PR; send Q1/Q2 with the TAX-E01 clarification pack; then REM-14 (party snapshots) which depends on this slice, with REM-12/REM-10 still gated by ADR-0002/0003.

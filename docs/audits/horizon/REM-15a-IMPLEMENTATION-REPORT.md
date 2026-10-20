# REM-15a — Implementation report: seller and buyer UBL XML party blocks from `party_snapshot`

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/rem-15a-party-xml`. PR number, head SHA, CI and CI Gate results are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner decision 2026-10-20: REM-15 is split; **15a = BOTH seller and buyer XML party blocks**, built from the immutable `invoices.party_snapshot` (REM-14). **15b** (posting preconditions/422, POS classification, `entity_type`, SAR 1,000) is **not** part of this change. Decision report: `REM-15-PARTY-XML-DECISION-REPORT.md` (owner-reviewed). |
| Base | `origin/main` = `3ca505e16140b9db75845aa711f577fc7b893998` (includes REM-13a `4e1ac1e` and REM-14 `5fb6f23`). |
| Scope | Zone C. **No** migration, model, VAT, total, journal, invoice-date, timestamp, ICV, PIH-algorithm, signing or transport change. **No** new posting-rejection or classification policy. No live ZATCA call. |
| Not a compliance claim | The SDK result below is **advisory** (D-03a) and local. Passing XSD, or having no party warnings, is not production compliance. |

## 1. What changed

| Area | Behaviour |
|---|---|
| New class | `App\Support\ZatcaPartyXml` — pure functions (no DB, no clock): `requireSnapshot()`, `supplier()`, `customer()`, `countryCode()`, `text()`. One class per file, flat `app/Support/` (covered by the existing `setup.sh`/CI copy lists). |
| `ZatcaService::buildFor` | Reads the party snapshot **first** (after `issuedAtOf`), before any lock or ICV read. A missing or structurally unusable v1 snapshot ⇒ `RuntimeException` ⇒ the posting transaction rolls back (no ICV, no journal, invoice stays a draft). |
| `ZatcaService::buildXml` | The two party blocks are produced by `ZatcaPartyXml`. Everything else in the document is byte-for-byte what it was (totals, lines, header, timestamps). `Tenant`/`Partner` are no longer read for XML. |
| QR tags 1–2 | `qrFor()` and the Phase-2 finalizer take seller name and VAT from the **same** snapshot, so QR and XML cannot disagree. Tag 3 and its formats are untouched (REM-13a). `qrFor()` lost its unused `?Tenant` parameter. |
| Harness | `scripts/zatca-sdk/conformance.py` gains `awj_forbidden_warning_codes` (exact codes or trailing `*`): a forbidden warning on an AWJ fixture is a **REGRESSION** even when the error ratchet is unchanged. A live negative control proves the gate is not vacuous. |
| Fixtures | The three AWJ fixtures now carry realistic party data; a fourth, `awj-standard-buyer-crn` (standard, buyer CRN, no VAT), is added. Digests and `baseline.json` re-recorded locally (shrunk, never widened). |

## 2. Emission rules (all from the snapshot; nothing invented)

| Element | Rule |
|---|---|
| Any element | Written only if the snapshot value is non-empty after trimming. No empty elements, no placeholder, no fallback to live data. |
| Seller `PartyIdentification` (BT-29) | `schemeID="CRN"` + `cr_number` **only if** alphanumeric (BR-KSA-08). Otherwise omitted (not replaced by another scheme). MOM/MLS/700/SAG/OTH are **not** emitted — no scheme field exists. |
| Seller VAT (BT-31) | `PartyTaxScheme/CompanyID` as captured + `TaxScheme/ID = VAT` (fixes the XSD defect and BR-KSA-39). Missing ⇒ element omitted, BR-KSA-39 stays a genuine error. Malformed ⇒ written as is (BR-KSA-40 shows). |
| Buyer VAT (BT-48) | As captured, never dropped or rewritten, including malformed values (BR-KSA-44 then shows). |
| Buyer other ID (BT-46) | `CRN` + `cr_number`, **only when no buyer VAT is present** and the value is alphanumeric. |
| Country (BT-40/55) | Only a recognised ISO 3166-1 alpha-2 code (249; case normalised, e.g. `sa` ⇒ `SA`). Names, unknown pairs (`XX`, `UK`), `1A`/`XI` ⇒ omitted. No default to `SA`. |
| Seller address | `Street, BuildingNumber, PlotIdentification (additional number), CitySubdivisionName (district), CityName, PostalZone, Country` — XSD order verified by the SDK. Values written as captured (BR-KSA-37/66 would show a malformed building/postal code). |
| Buyer address, **standard** | Every field that exists (missing ones stay visible to the SDK). |
| Buyer address, **simplified** | Written only if complete: `SA` ⇒ street, building, district, city, 5-digit postal code, country (BR-KSA-63/67); other known country ⇒ street, city, country (BR-KSA-10). Otherwise omitted; the name is still written. |
| Names | `RegistrationName` = captured `name`; no translation, no `name_en`. |
| Empty buyer | `<cac:AccountingCustomerParty></cac:AccountingCustomerParty>` is kept: omitting the container fails XSD on the SDK (tested), and the official simplified samples carry it empty. |
| Not emitted | `tenant_id`, `branch_id`, `partner_id`, phone, mobile, short address, `entity_type`, `name_en`. |

## 3. Regulatory evidence (primary sources only)

Sources: ZATCA XML Implementation Standard v1.2 (sha256 prefix `5aa15ff9…`), Data Dictionary (`61148ff4…`), SDK 238-R3.4.8 schematrons (`3312e193…` KSA, `378a7a4d…` EN) and official samples.

| Class | Items |
|---|---|
| **Verified requirement** | Seller name/VAT/other ID/address are mandatory for both invoice types (Data Dictionary M); buyer fields are C for standard and O for simplified (name C). BR-KSA-08 (alphanumeric, once, scheme list), BR-KSA-09/37/66 (seller address), BR-KSA-10/63/67 (buyer address), BR-KSA-14/44/81 (buyer identifiers), BR-CL-14 (ISO country codes). IR Art. 53(5). |
| **SDK error** (shows in the harness) | BR-KSA-39/40 (seller VAT), BR-KSA-44 (buyer VAT format), BR-KSA-14 (buyer ID scheme/alphanumeric), XSD. |
| **SDK warning** (shows only through `forbidden_warning_codes`) | BR-08, BR-KSA-08/09/10/37/63/66/67/81, BR-KSA-F-06-*. |
| **Open regulatory questions** | (1) Seller identifier when the tenant has no CRN or several (P1; MOM/MLS/700/SAG/OTH need a scheme field). (2) Branch-level seller identity/address (P2, tied to DP-R2). (3) BR-KSA-F-03 forbids empty elements yet XSD requires the (possibly empty) customer container — follows the official samples, to confirm with ZATCA (TAX-E01). (4) BR-KSA-09 in the SDK also tests `PlotIdentification` although the standard text lists only six fields — emitted when present. (5) Buyer additional number (KSA-19) is not in snapshot v1. |

## 4. SDK diagnostics before / after (official SDK, advisory, local, JDK 11)

Run: `conformance.py run … --isolation skip` (`ZATCA_SDK_ALLOW_UNISOLATED=1`, local override). Before = base fixtures at `3ca505e1`; after = regenerated fixtures.

| Fixture | Removed errors | Removed warnings | Errors still present (REM-16/17 scope) |
|---|---|---|---|
| `awj-simplified-single-line` | XSD `SAXParseException`, **BR-KSA-39** | BR-08, BR-KSA-08, BR-KSA-37 | BR-CO-04/15/18, BR-KSA-28/68, QR, SIGNATURE, PIH |
| `awj-simplified-two-lines` | XSD, **BR-KSA-39** | BR-08, BR-KSA-08, BR-KSA-37 | same |
| `awj-standard-single-line` | XSD, **BR-KSA-39** | BR-08, BR-KSA-08/10/37/81, BR-KSA-F-06-C23/C25 | BR-CO-04/15/18, BR-KSA-52/53/68, PIH |
| `awj-standard-buyer-crn` *(new)* | — (never existed) | — | same as the standard fixture |

* **XSD: FAILED → PASSED on all four fixtures. BR-KSA-39 is gone. No new error code. No new warning code.**
* **No party warning remains on any fixture** (`BR-08`, `BR-KSA-08/09/10/37/63/66/67/81`, `BR-KSA-F-06-*` all absent). Remaining warnings (BR-CO-10/13, BR-KSA-15/29/98, BR-KSA-EN16931-08) are monetary/header/signing items for REM-16/17 and were already present.
* Candidate probes (scratchpad, not committed): standard with neither buyer VAT nor CRN ⇒ only **BR-KSA-81** appears (genuine data gap, kept visible for 15b); buyer VAT + address ⇒ none; omitting the customer container ⇒ XSD fails.
* Official-sample oracle self-check, mutation liveness and ratchet negative controls: all green (19/19 samples OK).

## 5. Safety invariants — how each is held

| Invariant | Evidence |
|---|---|
| No accounting/VAT/total/journal change | `ZatcaPartyXmlTest::ledger_totals_icv_pih_and_hash_are_unchanged…` (subtotal/tax/total, balanced 115000/115000, one entry per invoice) |
| No ICV/PIH change; hash intact | Same test: ICV 1,2; `hash(stored xml) == zatca_hash`; PIH(2) = hash(xml 1); genesis for the first |
| Rollback / fail-closed | `generation_fails_closed_without_a_valid_v1_snapshot…` (7 malformed shapes, no ICV consumed); `a_character_that_cannot_exist_in_xml…` (draft, no ICV, no snapshot, no `issued_at`, no journal) |
| Snapshot is the source | `the_stored_artifacts_follow_the_snapshot_not_live_master_data` (stored XML/QR/hash unchanged after renaming tenant/partner/company; `qrFor` regenerated equals stored QR); `qr_seller_name_and_vat_match_the_xml…` |
| Historical artifacts untouched | Nothing rewrites stored `zatca_xml`/QR/hash; legacy rows (NULL snapshot) are never rebuilt; the old `ZatcaSignedInvoicePostingTest` signing path still passes |
| Isolation | `another_tenants_identity_never_reaches…` (two tenants, no cross-leak, internal ids absent, ICV independent) |
| Idempotency | `a_second_posting_attempt_is_rejected…`; `PosCheckoutIdempotencyTest` unchanged and green |
| No new migration / identity column | `git diff --stat` shows none; snapshot v1 shape unchanged |

## 6. Tests

| Suite | Result |
|---|---|
| New `ZatcaPartyXmlTest` (20 tests) | SQLite ✅ · PostgreSQL ✅ |
| Adapted: `InvoicePartySnapshotTest`, `ZatcaSignedInvoicePostingTest`, `ZatcaSdkFixtureDriftTest` (+ new fixture) | SQLite ✅ · PostgreSQL ✅ |
| Python harness unit tests | 70 (66 + 4 new) ✅ |
| Full suites, CI, CI Gate | see the PR and the final report |

Adapting existing tests (justified, not weakened): `InvoicePartySnapshotTest` asserted "XML does not yet carry the party data" — now asserts the new content and that the second invoice follows **its own** snapshot while the first is unchanged; the signed-posting test and the drift test build a snapshot because XML/QR generation now requires one; the SDK guard test that allowed only the seller VAT now also allows the one synthetic buyer VAT.

## 7. Remaining risks and open items

1. **Standard invoices with missing buyer data still post** (REM-15b policy: P3, R1-077). The gaps show as BR-KSA-81/10/63 in the SDK but nothing blocks posting.
2. **Malformed VAT numbers are emitted as captured.** A simplified invoice to a partner with a bad VAT will carry BR-KSA-44 (error) — deliberate (no silent rewriting); validation belongs to 14b/15b.
3. Tenants without a CRN, or with several, produce no `PartyIdentification` (BR-KSA-08 warning). Needs a scheme field (migration) — not authorised.
4. Seller address comes from `Settings` company data; tenants who never filled it produce an incomplete (non-compliant) seller block — visible, not blocked.
5. Every other EN/KSA/QR/SIGNATURE/PIH error on the AWJ fixtures remains (REM-16/17); this change does not make any invoice SDK-valid.
6. New XML bytes only for **new** invoices; the SDK baseline and digests were re-recorded locally and the diff is a strict shrink.

## 8. Recommended next step

Review and merge this PR; then either **REM-15b** (needs owner decisions P3 — block vs warn on missing buyer data — and R1-077) or **REM-16** (body rebuild, which can now reuse `ZatcaPartyXml` unchanged).

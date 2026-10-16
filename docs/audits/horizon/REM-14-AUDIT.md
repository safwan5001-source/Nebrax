# REM-14 — Seller/Buyer issuance snapshots: focused audit (READ-ONLY)

> **Pre-implementation audit (2026-10-15).** Slices 14a + 14c were subsequently implemented in one Draft PR — see `REM-14-IMPLEMENTATION-REPORT.md`. Findings below describe the code at base `4e1ac1e`; P1–P6, 14b and the XML party blocks remain open.

| | |
|---|---|
| Base | `main` @ `4e1ac1eb245e8eeb418bfb93b55d51ee142546fd` (REM-13a merge) — tree clean, nothing written to the repo |
| Scope | REM-14 only (backlog row 2.5; plan §REM-14). Not reopened: S7, S6, R-1, ADR-I, ADR-B. No XML/timestamp/ICV/hash/VAT/journal change proposed. |
| Evidence | Code at the base SHA; official ZATCA XML Standard v1.2 (SHA-256 `5aa15ff95efb98d3`), Data Dictionary vF (`61148ff46d174e5b`), re-read 2026-10-15; one throw-away probe run in the local overlay (deleted; repo untouched). **Not a compliance statement.** |

## 0. Verdict

**Existing snapshots do NOT satisfy REM-14.** There is no seller/buyer snapshot anywhere in the invoice domain. The *signed* artifacts are immutable (stored once), but they carry almost no party data; every *human-readable / API* representation reads parties **live**. A migration is genuinely required for the snapshot itself; validation and XML party blocks are separable slices.

## 1. Existing vs required behaviour

| # | Question | Finding (evidence) |
|---|---|---|
| 1 | How does the XML builder get seller/buyer? | Live, at post time only: `ZatcaService::buildFor` does `Tenant::find($invoice->tenant_id)` (`:47`) and `$invoice->partner`; `buildXml` writes **seller** = `tenants.vat_number` + `tenants.name` (`ZatcaService.php:318-323`) and **buyer** = `partner.name` only (`:324-328`). QR tags 1–2 = tenant name/VAT (`:182-183`); Phase-2 finalizer receives the same (`:101-102`). Currency hard-coded `SAR` (`:297`). |
| 2 | Is the original XML stable? | **Yes.** `buildFor` has one caller, `InvoiceService::post` (`:1038`); it persists `zatca_xml/qr/hash`; submission re-sends the stored XML and checks `request_hash = sha256(zatca_xml)` (`ZatcaSubmissionDispatcher.php:141`). Probe: after renaming tenant and partner, `zatca_xml/qr/hash` were **byte-identical**. |
| 3 | Does a later partner/tenant edit change *other* output? | **Yes — everything except the signed artifacts.** Probe after rename: `GET /invoices/{id}` partner block shows the **new** name/VAT/city (`InvoiceResource.php:30-35`; same in `PublicInvoiceResource.php:43-46`); `/me` company (what print/PDF uses) shows the new name/VAT. Web print/PDF: `web/src/app/(app)/invoices/[id]/page.tsx:280-282` fetches live `/partners/{id}` and `/me`, passed to `buildInvoiceDocument` (`web/src/modules/documents/builder/from-invoice.ts:146,160`). The webhook `invoice.created` payload is also built from the live partner. No server-side invoice PDF/export exists. |
| 4 | Do frozen templates help? | No: `print/pdf/thermal_template_revision_id` and `language_frozen` freeze **layout/language**, not data (`InvoiceService.php:1048-1056`). |
| 5 | Existing snapshot infrastructure to reuse? | **None for parties.** Invoice-domain snapshots are flat per-line columns (`product_name_snapshot`, `unit_name`, `min_sale_price_snapshot`…) and template revision ids. `CommerceOrderSnapshot` (billing/shipping flat columns) belongs to the Commerce domain — CLAUDE.md Commerce contract forbids mixing. `RecordsRevisions` covers only `Invoice/Quote/Purchase/…` header diffs — `Partner` and `Tenant` are **not** revisioned, so history cannot be replayed. `zatca_xml` is a legal artifact, not a structured source (legacy XML lacks party data; REM-16 will restructure it). |
| 6 | Posting-time validation today | **None in Phase 1; signing-time only in Phase 2.** `^3\d{13}3$` exists solely in `ZatcaPhaseTwoQrEncoder.php:32` (reached only when a `ZatcaCredential` exists). Probe: with seller VAT `12345` and with an empty seller VAT, `post()` **succeeded** (QR tag 2 = `12345` / empty). Entry rules are length-only: `UpdateCompanyRequest` VAT `max:20` (no pattern), `StorePartnerRequest` VAT `size:15`, partner country `max:255`, no building/postal pattern. |
| 7 | Document classification | `InvoiceService::zatcaDocumentType` (`:431-449`): any 15-digit partner VAT ⇒ `standard`, else `simplified`; ignores `entity_type`/amount (that is REM-15). |

## 2. Fields: required by ZATCA vs. what AWJ holds

Status from the Data Dictionary vF (M = mandatory, C = conditional, O = optional) and BR-KSA rules read on 2026-10-15.

**Seller (same for standard & simplified)**

| Field (term) | ZATCA | AWJ source today | In stored XML now | Gap |
|---|---|---|---|---|
| Name BT-27 | M | `tenants.name` | ✅ | — |
| VAT no. BT-31 | M; 15 digits, first/last `3` (BR-KSA-39/40) | `tenants.vat_number` | ✅ (unvalidated) | validation |
| Other seller ID BT-29 (scheme `CRN`/`MOM`/`MLS`/`700`/`SAG`/`OTH`, alphanumeric; BR-KSA-08) | M | `tenants.cr_number` (scheme implicitly CRN) | ❌ | not emitted; no scheme modelling |
| Street BT-35 | M | `Settings company.street` | ❌ | not emitted |
| Building no. KSA-17 (4 digits, BR-KSA-37) | M | `company.building_no` (max 20, no pattern) | ❌ | validation |
| Additional no. KSA-23 | O | `company.additional_no` | ❌ | — |
| District KSA-3 | M | `company.district` | ❌ | — |
| City BT-37 | M | `company.city` | ❌ | — |
| Postal code BT-38 (5 digits) | M | `company.postal_code` (max 20, no pattern) | ❌ | validation |
| Country BT-40 | M | `tenants.country` (2 chars, default `SA`) | ❌ | — |
| Subdivision BT-39 | O | not modelled | ❌ | optional |
| Branch-level CR / VAT / address | (R1-090/091 in plan) | `branches` has `address_line1/2, city, region, country` only — no VAT, CR, building no., postal code, district | ❌ | **unresolved** (see §3) |

**Buyer**

| Field | Standard | Simplified | AWJ source | In stored XML |
|---|---|---|---|---|
| Name BT-44 | M (BR-KSA-42) | O; M if VATEX-SA-EDU/HEA (BR-KSA-25) | `partners.name` (`name_en` also exists) | ✅ |
| VAT no. BT-48 | C; 15 digits (BR-KSA-44) | O | `partners.vat_number` (`size:15`) | ❌ |
| Other buyer ID BT-46 (schemes e.g. `TIN`/`CRN`/`NAT`/`GCC`/`IQA`/`PAS`/`OTH`) | C — required when no buyer VAT on a tax invoice (BR-KSA-81) | O | only `partners.cr_number` (CRN); no NAT/IQA/PAS | ❌ |
| Street BT-50 / City BT-52 / Country BT-55 | M (BR-KSA-10) | O | `street`, `city`, `country` (free text) | ❌ |
| Building KSA-18, Postal BT-53, District KSA-4 | C: mandatory if country = `SA` (BR-KSA-63) | O | `building_no`, `postal_code`, `district` | ❌ |
| Entity type | drives classification (REM-15) | — | `entity_type` (individual/commercial) | — |

Legal basis for the printed/legal invoice: IR Art. 53(5) — tax invoice carries seller and customer names, addresses and TIN; simplified carries seller name/address/TIN (evidence register row 31, VL).

## 3. Verified requirements vs unresolved questions

**Verified (primary evidence):** the M/O/C matrix above; BR-KSA-08/09/10/25/37/39/40/42/44/63/81 texts; seller VAT pattern; seller building 4 digits; buyer address mandatory for standard (and complete if country `SA`).

**Unresolved — must not be decided by code:**

| ID | Question | Why it blocks |
|---|---|---|
| P1 | Which seller identity (scheme) applies to a tenant with no CRN (MOM/MLS/700/SAG/OTH), and does BT-29 mandatory mean posting must be blocked without it? | AWJ models CRN only; a hard block could stop legitimate tenants. |
| P2 | Seller address/CR/VAT **per branch** vs registrant HQ when the invoice's branch differs; relation to ICV-per-VAT-number (DP-R2, D-06). | Affects snapshot shape and which seller fields are authoritative. |
| P3 | Buyer: block standard invoices lacking buyer VAT/other-ID/address, or warn? (Plan: hard-blocking is a configurable policy — CLAUDE.md rule 6; the plan's REM-15 text states ZATCA accepts a missing additional buyer ID with warnings — carried from the audit, not re-verified here.) | Policy + REM-15 scope. |
| P4 | Language of party names in XML (partner `name` vs `name_en`; Arabic invoice rule IR 53/66). | Which snapshot field renders. |
| P5 | When are the seller/buyer preconditions enforced: "KSA tenant"/ZATCA-active definition (D-04). | Existing tenants must not break (rule 6: default protects existing tenants). |
| P6 | Non-SAR: tenant currency is configurable but XML says `SAR`; SAR-only guard on the e-invoice path (plan REM-14 scope; PH1-18). | New posting precondition ⇒ owner decision. |

## 4. Proposed snapshot data contract (additive, versioned)

One nullable JSON column on `invoices` — **`party_snapshot`** (recommended; the plan names two columns `seller_snapshot`/`buyer_snapshot` — equivalent, owner's choice). Written **once**, inside `InvoiceService::post()`, in the same transaction and boundary as `issued_at` (after the invoice row lock and the tenant-anchor lock, before `ZatcaService::buildFor`), by a small pure builder (new flat class, e.g. `App\Support\InvoicePartySnapshot`). Immutable via the existing `Invoice::booted()` guard pattern (extend to this column); not in `$fillable`; read-only in API.

```json
{
  "v": 1,
  "seller": {
    "tenant_id": "…", "branch_id": "…|null",
    "name": "…", "vat_number": "3xxxxxxxxxxxxx3",
    "other_id": {"scheme": "CRN", "value": "…"},
    "address": {"street": "", "building_no": "", "additional_no": "", "district": "", "city": "", "postal_code": "", "country": "SA", "short_address": ""},
    "phone": "", "mobile": ""
  },
  "buyer": {
    "partner_id": "…", "entity_type": "commercial|individual",
    "name": "…", "name_en": "…", "vat_number": "…|null",
    "other_id": {"scheme": "CRN", "value": "…"} ,
    "address": {"street": "", "building_no": "", "district": "", "city": "", "postal_code": "", "country": ""}
  }
}
```

Sources are exactly today's: `Tenant` columns (`name, vat_number, cr_number, country`), `Settings::group('company')` (address/phone/mobile — via `CompanyProfile`), `Partner` columns. Logo/branding is **not** snapshotted (not legal identity). No VAT, totals, journal, ICV, hash, timestamp or XML field changes. `partner_id` stays the FK; the snapshot is point-in-time data, so it duplicates nothing that `zatca_xml` provides in structured form.

**Legacy:** rows posted before the change keep `party_snapshot = NULL`; no backfill (current live values are not issue-time facts); consumers fall back to live data and treat `NULL` as "issue-time parties unknown". Stored XML/QR/hash/PIH never regenerated.

## 5. Is a migration genuinely necessary?

**Yes, for the snapshot (14a).** Alternatives rejected: (a) derive from `zatca_xml` — legacy XML has no addresses/buyer VAT, REM-16 will restructure the body, and parsing a signed legal artifact for display is brittle; (b) `RecordsRevisions` replay — Partner/Tenant not revisioned; (c) reuse Commerce snapshots — wrong domain; (d) a generic meta column — none exists on `invoices`. One additive nullable JSON column, no index, no backfill, no trigger. **Not authorised yet — needs owner approval.** Validation (14b) and web (14c) need no migration.

## 6. Smallest safe implementation scope

| Slice | Content | Schema | Risk |
|---|---|---|---|
| **14a — snapshot only** | column + capture in `post()` + immutability guard + read-only `parties` in `InvoiceResource` / `GET invoices/{id}/zatca` + tests. **Rejects nothing, changes no XML/QR/hash.** | 1 nullable JSON | low; existing tenants unaffected |
| 14b — entry validation + posting preconditions | `SaudiVatNumber` rule on new/changed company & partner input (existing invalid values reported, not rewritten); seller completeness gate behind a **configurable policy**, default non-blocking (warn/report) for existing tenants, enforceable for ZATCA-active tenants (needs P1, P5, P6) | none | policy-bearing — owner gate |
| 14c — consumers read the snapshot | web `from-invoice` / print / PDF, Public API resource prefer snapshot, fall back to live for legacy | none | web CI; display change |
| (later) REM-15 / REM-16 | render buyer/seller blocks into the UBL body **from the snapshot** (BR-KSA-08/09/10/37/39/42/44/63/81), classification preconditions | none | changes XML & hash input ⇒ own gate |

Recommended order: **14a → 14c → 14b**, with REM-15/16 consuming the snapshot. 14a alone already satisfies the plan's acceptance criterion "rename after posting → `GET /invoices/{id}` returns issue-time parties".

## 7. Targeted tests (14a)

SQLite **and** PostgreSQL unless noted:
1. Draft has `party_snapshot = NULL`; posting writes exactly one snapshot (version, seller, buyer) inside the same transaction as `issued_at`; failed posting (Flaky service) leaves none; retry writes a fresh one.
2. **Rename tenant + company address + partner after posting** → `GET /invoices/{id}` and `/zatca` return issue-time parties; live `/me` and `/partners` return new values; `zatca_xml/qr/hash` byte-identical.
3. Immutable: change/clear after post → rejected; not mass-assignable; API input ignored.
4. Concurrent posts (PG forks): one winner, snapshot written once, ICV/PIH chain and `issued_at` ordering unchanged.
5. POS replay and `duplicate()`: replay keeps snapshot; duplicate has `NULL`.
6. Legacy row (`NULL`) untouched by reads/updates; next invoice still chains PIH from stored legacy XML.
7. Tenant & branch isolation: snapshot carries the posting tenant/branch; other tenants never read it; branch-scoped listing unchanged.
8. No financial effect: journal lines, VAT, totals, ICV identical to a pre-change baseline basket.
9. Snapshot contains no logo/credentials/other-tenant data (shape test).

SDK (advisory harness, JDK 11): **14a/14b/14c must leave the AWJ fixture results identical to the REM-11 baseline** (`ZatcaSdkFixtureDriftTest` digests unchanged because XML is untouched). When REM-15/16 emit party blocks, add fixtures and shrink the baseline for BR-KSA-08/09/10/37/39/40/42/44/63/81 — report pre-existing failures (XSD/EN/KSA/QR/SIGNATURE/PIH) separately from any regression.

## 8. Risks and owner approval gates

| Gate | Decision needed |
|---|---|
| G1 | Approve the migration (one nullable JSON column) and single-column vs two-column shape. |
| G2 | Confirm 14a is non-blocking (no new posting rejection) for all tenants. |
| G3 | Policy for 14b: default (warn/report vs block), definition of "ZATCA-active" (D-04), SAR-only guard (P6). |
| G4 | Seller identity model (P1) and branch-level seller (P2) — need tax adviser / ZATCA clarification (D-06/TAX-E01); do **not** model branch CR/VAT until answered. |
| G5 | Personal-data review: an immutable snapshot retains buyer names/addresses (and later national IDs, `NAT`/`IQA`/`PAS`) for the retention period; confirm with the legal/PDPL owner (tax-record retention vs erasure). |
| Risk | Snapshot ≠ legal XML until REM-16: the printed document may show richer parties than the signed XML carries; avoid claiming print/XML parity before REM-16. |
| Risk | Existing invalid seller VAT/address values are only *reported* in 14b; enforcement is a separate decision. |
| Risk | Larger invoice rows (≈1 KB JSON) and a web display change (14c) — contained. |

## 9. Recommended next step

Owner decision on **G1/G2**, then implement **14a** (one Draft PR: migration + capture + guard + read-only API + the tests above, SQLite/PostgreSQL, SDK ratchet unchanged). Send P1–P4 (seller scheme, branch seller, buyer policy, name language) with Q1/Q2 in the TAX-E01 clarification pack; hold 14b until D-04 and the policy defaults are decided.

> **Stopped for owner review.** No code changes, no migration, no commit, no PR, no merge, no deploy.

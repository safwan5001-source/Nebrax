# REM-14 (14a + 14c) — Implementation report: immutable seller/buyer snapshots + posted-invoice display

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/tax-rem-14-party-snapshot`. PR number, base/head SHAs, CI and CI Gate results are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner decision 2026-10-15: add nullable JSON `invoices.party_snapshot`; capture at posting; display posted invoices from it; combine 14a + 14c in ONE PR. Audit: `REM-14-AUDIT.md`. |
| Scope | Zone C. **Does NOT change** ZATCA XML, QR, signing, hashes, PIH, ICV; VAT, totals, journals, accounting dates; no new validation; **no posting is ever blocked** for missing seller/buyer data; no new Partner/Tenant/Branch identity fields; no P1–P6 decision; no data reset. |
| REM-14 overall | **NOT complete.** 14a (snapshot) and 14c (display) only. Still open: 14b (entry validation / posting preconditions / SAR guard), and — outside REM-14 — rendering the seller/buyer blocks **into the XML** (REM-15/REM-16). **The signed XML still carries only seller name + VAT and buyer name.** Nothing here is a ZATCA compliance statement. |

## 1. Implemented behaviour

| Area | Behaviour |
|---|---|
| Persistence | One additive nullable JSON column `invoices.party_snapshot` (type `json`, not `jsonb`: text kept as written on both databases). No index/CHECK/trigger, **no backfill**. |
| Capture | Once, in `InvoiceService::post()`, inside the posting transaction, after the invoice row lock and the tenant-anchor lock (taken by `LedgerService::post`) and **before** `ZatcaService::buildFor` — the same write-once boundary as `issued_at` (REM-13a). Built by `App\Support\InvoicePartySnapshot::capture`. Rolled back with the transaction; a retry captures current data. Never blocks posting (missing data is captured as `null`). |
| Immutability | Not in `$fillable`; `Invoice::booted()` `updating` guard (now covering `issued_at` **and** `party_snapshot`) rejects any change or clearing once stored; compares decoded JSON (so re-assigning the same content in another key order is not a change); if the column was not loaded (partial `select`) it reads the stored value by primary key **without scopes** — closing the partial-model hole documented below. |
| Client input | `party_snapshot`/`parties` keys in create/update/post payloads are ignored (request classes and the service use explicit allowlists; verified by test through service, mass-assignment and API). |
| Display (API) | `GET /invoices/{id}` adds `parties` (`{version, seller, buyer}`, **without** `tenant_id`) — single read only, not lists, behind the existing `invoices.view` permission and active-branch scope. The existing `partner` block (`id,name,vat_number,city`) is now sourced from the snapshot for a **posted invoice with a valid v1 snapshot**; drafts and legacy `NULL` use live data. Public API `partner.name` follows the same rule (`code` stays live). |
| Display (web/print) | New pure resolver `web/src/modules/documents/builder/invoice-parties.ts`; `buildInvoiceDocumentModel` and the invoice page use it. Posted + snapshot ⇒ seller identity/address/contact and buyer name/VAT/city come from the snapshot; logo and currency stay from the live company profile (branding, not legal identity). Existing templates, AR/EN and RTL/LTR logic untouched. |
| Revisions | `party_snapshot` is excluded from the generic revision diff (`RecordsRevisions`) to avoid duplicating personal data into the audit log. |

## 2. Snapshot v1 — schema and field mapping

```json
{ "v": 1,
  "seller": { "tenant_id","branch_id","name","vat_number","cr_number","country",
              "address": {"building_no","street","additional_no","district","city","postal_code","short_address"},
              "phone","mobile" },
  "buyer":  { "partner_id","entity_type","name","name_en","vat_number","cr_number",
              "address": {"building_no","street","district","city","postal_code","country"} } }
```

| Snapshot field | Source (unchanged meaning) |
|---|---|
| `seller.tenant_id`, `seller.branch_id`, `buyer.partner_id` | the invoice row (capture context / link, not identity) |
| `seller.name`, `vat_number`, `cr_number`, `country` | `tenants.name`, `.vat_number`, `.cr_number`, `.country` |
| `seller.address.*`, `seller.phone`, `seller.mobile` | `Settings` group `company` (`CompanyProfile::SETTINGS_FIELDS`) |
| `buyer.entity_type`, `name`, `name_en`, `vat_number`, `cr_number` | `partners.*` |
| `buyer.address.*` | `partners.building_no/street/district/city/postal_code/country` |

Nullability: empty/whitespace string ⇒ `null`; absent stays `null`; no defaults invented. `cr_number` is captured **as-is without an identification scheme** (modelling CRN/MOM/MLS/700/NAT… is open question P1).

## 3. Read vs fallback rules

| Case | Source used |
|---|---|
| Posted + valid v1 snapshot | **Snapshot** (API `partner`/`parties`, Public API `partner.name`, web document builder, invoice page) |
| Draft | Live partner/company (unchanged) |
| Posted, `party_snapshot = NULL` (legacy) | Live data — **compatibility behaviour, not a historical guarantee**; API returns `parties: null` so consumers can tell |
| Posted, unknown version / malformed JSON | Treated as no snapshot (live), never half-rendered |

## 4. Immutability boundaries (documented Eloquent limits)

Guarded: `save()`/`update()`/`forceFill()->save()` on a full or partially-loaded `Invoice`. **Not coverable by any model event:** `Invoice::query()->update()`/bulk writes, `DB::table('invoices')`, raw SQL, `saveQuietly`/`withoutEvents`, and direct database access. Actual write-path inspection found **none** of these in `app/` for the invoices table; `InvoicePartySnapshotTest::no_application_code_writes_the_write_once_columns_outside_the_posting_path` fails the build if any appears, and if a new file assigns `party_snapshot`. Residual (theoretical): a database administrator or future code deliberately bypassing the model. No DB trigger was added (consistent with REM-13a: identical behaviour on SQLite/PostgreSQL).

## 5. Data minimisation and privacy

Only existing columns; **no** logo, email, buyer phone, free-text buyer address, credentials, or unrelated settings. Seller phone/mobile are the only non-identity fields (printed in the invoice header; captured so a frozen name is never printed beside a live phone). `tenant_id` is not exposed by the API. The snapshot is personal data about buyers (names/addresses/VAT) kept immutably with the tax record — retention vs. erasure under PDPL needs the legal owner's confirmation (gate G5 of the audit).

## 6. Compatibility

- **Migration** `2026_11_12_010000_add_party_snapshot_to_invoices.php`: additive nullable column; `down()` drops it. Existing/experimental rows untouched (`NULL`); nothing deleted or reset.
- **API:** additive only (`parties` on single read; `partner` keeps its shape). No field removed or retyped; clients that ignore `parties` are unaffected. Lists unchanged in shape.
- **Frontend:** `SourceInvoice.parties` optional; all other builders/consumers untouched; legacy and draft paths identical to before.
- **ZATCA:** `zatca_xml`/`qr`/`hash`/PIH/ICV byte-identical (test + SDK fixture drift digests unchanged).

## 7. Remaining regulatory / design questions (not decided here)

P1 seller identity scheme when no CRN · P2 seller address/CR/VAT per branch (links ICV-per-VAT-number DP-R2) · P3 block vs warn for incomplete buyer · P4 name language in XML (`name` vs `name_en`) · P5 when preconditions are enforced (D-04 "KSA tenant") · P6 SAR-only guard. Details: `REM-14-AUDIT.md` §3. **XML-side:** the UBL body still emits only seller name/VAT and buyer name; BR-KSA-08/09/10/37/39/40/42/44/63/81 content (CRN, addresses, buyer VAT/ID) must be rendered from this snapshot in REM-15/REM-16.

## 8. Tests

See the PR description for the run matrix (SQLite + PostgreSQL, web unit tests, SDK drift, CI). New: `InvoicePartySnapshotTest` (20), `InvoiceIssuedAtPostgresTest` (+snapshot assertions, +1 race test), `PosCheckoutIdempotencyTest` (replay keeps snapshot after a partner rename), `web/.../invoice-parties.test.ts` (9).

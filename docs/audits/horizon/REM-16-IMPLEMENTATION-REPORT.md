# REM-16 (XML-only slice) — Implementation report: monetary totals and invoice lines in the UBL document

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/rem-16-monetary-lines`. PR number, head SHA, CI and CI Gate are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction 2026-10-20: implement only the approved safe XML corrections from `REM-16-MONETARY-LINES-AUDIT.md`; ONE Draft PR. |
| Base | `origin/main` = `f774842a6c9d197ffbd6ce87fd05e169180350ba` (REM-15a merged). |
| Scope | Zone C, **XML generation only**. No migration, no change to VAT/rounding/totals/journals/stored lines, `issued_at`, `party_snapshot`, seller/buyer blocks, QR, signing, PIH algorithm or ICV; no new posting restriction; no historical regeneration; no live ZATCA call. |
| Not a compliance claim | The official SDK is run locally and is **advisory**. Passing XSD/EN/KSA stages on selected fixtures is not production compliance (§6). REM-16 is **not complete**. |

## 1. What changed

| Area | Behaviour |
|---|---|
| New class | `App\Support\ZatcaMonetaryXml` — pure functions over the stored `Invoice`/`InvoiceLine` models: `documentBlock()` and `line()`. One class per file, flat `app/Support/` (covered by the existing `setup.sh`/CI copy lists). Amounts only through `Money::toRiyal()` on stored integers (no float). |
| `ZatcaService::buildXml` | Adds `TaxCurrencyCode`; the old `TaxTotal`/`LegalMonetaryTotal`/`InvoiceLine` text is replaced by the helper. Header, parties, ICV/PIH/QR placeholder and signature container are unchanged. |
| Harness | `awj_forbidden_warning_codes` extended with the monetary rules (BR-S-01/08/09, BR-CO-10/13/16/17, BR-KSA-18/19/21/51, BR-KSA-EN16931-08/09/11); new `awj_known_gap_warnings` (per fixture, exact codes) — a documented gap is tolerated for that fixture only and **demands removal when it stops firing**. Negative controls now target a fixture/stage that actually fails. |
| Fixtures | 14 AWJ fixtures (4 existing + 10 new: multi-line, line discount, document discount, shipping, tax-inclusive, small lines, fractional quantity, zero-rate, adjustment, simplified document discount). Specs hold the values **posted through the real `InvoiceService`**, digests and baseline re-recorded locally (strict shrink). |
| `InvoiceService` | **Untouched.** (The builder runs before `update()` persists `discount`/`shipping`; it therefore applies the same `max(0, …)` derivation, and a test proves the XML inputs equal the persisted columns.) |

## 2. Mapping (stored → UBL)

| UBL | From stored | Note |
|---|---|---|
| `TaxCurrencyCode` | `SAR` | document currency is hard-coded SAR and no currency column exists (BR-KSA-68) |
| BT-106 `LineExtensionAmount` | `subtotal` | = Σ BT-131 (post() derives it from lines) |
| BT-107 / BT-108 | `discount` / `shipping` (only if > 0) | `AllowanceTotalAmount` always written (0.00), as in the official samples |
| BT-109 `TaxExclusiveAmount` | `subtotal − discount + shipping` | was `subtotal` (wrong with discount/shipping) |
| BT-110 `TaxTotal` ×2 | `tax_amount` | #1 amount only; #2 amount + `TaxSubtotal` when applicable |
| BT-112 `TaxInclusiveAmount` | BT-109 + BT-110 (`total − adjustment`) | was `total` (wrong with adjustment) |
| BT-113 | `0.00` | settlement happens after issuance |
| BT-114 `PayableRoundingAmount` | **never written** | see §3 |
| BT-115 `PayableAmount` | `total` | |
| `TaxSubtotal` (BT-116…119) | `TaxableAmount = BT-109`, `TaxAmount = tax_amount`, `S` / `15.00` / `VAT` | **only when every line is S/15** |
| Doc `AllowanceCharge` (discount) | `discount`; category S/15 only when every line is S/15 | no distribution across categories |
| Doc `AllowanceCharge` (charge) | `shipping`; text only, S/15 | stored shipping VAT is a constant 15 % |
| Line BT-131 | `line_subtotal − line_discount` | was `line_subtotal` (wrong with a line discount) |
| Line allowance (BT-136) | `line_discount` | |
| Line KSA-11 / KSA-12 | `line_tax` / `line_total` (= BT-131 + KSA-11) | written for standard **and** simplified (KSA-12 is mandatory for both) |
| Line `ClassifiedTaxCategory` | `S` / `15.00` / `VAT` **iff `tax_rate = 15`** | nothing otherwise |
| Line BT-146 `PriceAmount` | non-inclusive: `unit_price`; inclusive: stored `unit_price_before_tax` | was always `unit_price` (VAT-inclusive price in inclusive mode); inclusive line without the stored snapshot ⇒ no `Price` (not invented) |

Element order is XSD-verified through the SDK and asserted element-by-element in `ZatcaMonetaryXmlTest`.

## 3. Supported versus BLOCKED

| Case | Status | What the XML does |
|---|---|---|
| Single/multi line S/15, line discount, document discount, shipping, discount + shipping, tax-inclusive, small lines, fractional quantity (fuel) | **Supported** (identities BR-CO-10/13/14/15/16 and BR-KSA-51 hold on the XML itself; tested) | stored values, as above |
| Zero-rate line, 5 % or any other rate | **BLOCKED — REM-12 / G-I3** | no `ClassifiedTaxCategory`, no `TaxSubtotal`: BR-CO-04, BR-CO-18 remain *explicit* (known-gap fixture `awj-standard-zero-rate`) |
| Mixed 15 % + unclassified lines | **BLOCKED** | S lines classified, no `TaxSubtotal` (the stored tax is not stored per category), document discount written without a category — never distributed |
| `adjustment ≠ 0` | **BLOCKED — ADR-B G-B5** | not mapped to `PayableRoundingAmount`; `PayableAmount − TaxInclusiveAmount = adjustment` stays visible (BR-CO-16 known gap) |
| Shipping reason **code** | **BLOCKED — no matching code** | text only (BR-KSA-21 satisfied); BR-KSA-19 known gap. Meanings (OpenPEPPOL publication of UNCL 7161; UNECE page not reachable from the sandbox): SAA "Shipping and handling", DL "Delivery", FC "Freight service" — none equals AWJ's field "رسوم الشحن" ("shipping fees"). SDK acceptance of a code was **not** used as justification. |
| Per-line vs document-level VAT rounding; header-discount tax scaling | **Open — ADR-B G-B1/B2/B3** | stored tax mirrored; divergence documented (`small lines`: stored 0.10 vs document-level 0.08) and invisible to the SDK |
| Supply date (KSA-5), `PaymentMeans`, `unitCode` | Out of scope | BR-KSA-15 stays a warning; not invented |

## 4. Financial invariants

* `InvoiceService`, ledger code, models, migrations: **no diff**.
* The literal posted figures of 8 scenarios (subtotal/discount/shipping/adjustment/VAT/total, balanced journal, one entry, ICV 1…n, PIH chain, `hash(stored xml) = zatca_hash`) are asserted by `posting_math_ledger_and_hash_chain_are_unchanged_by_the_monetary_xml` — and **that test also passes against `main`'s `ZatcaService`** (run with the old builder swapped in), proving the figures do not depend on this change.
* XML amounts = persisted columns (`the_builders_inputs_are_exactly_what_is_persisted_by_the_posting`).
* Stored XML is immutable after issuance (read APIs and a tax-setting change leave it byte-identical); a second post is rejected with no artifact change; tenants never see each other's amounts and have independent ICV.

## 5. Tests

| Suite | Result |
|---|---|
| New `ZatcaMonetaryXmlTest` (45 cases: 11 scenarios × 2 mapping tests, 9 identity shapes, 14 targeted) | SQLite ✅ · PostgreSQL ✅ |
| Adapted `ZatcaSdkFixtureDriftTest` (14 fixtures) | SQLite ✅ · PostgreSQL ✅ |
| Existing ZATCA/invoice/POS/credit-note/signing tests, unchanged | green (only the known `Fuel*` bcmath failures in this sandbox) |
| Python harness unit tests | 73 (70 + 3 new) ✅ |
| Mutation check | wrong `TaxExclusiveAmount` ⇒ 9 failures; classifying every positive rate as S ⇒ 2 failures |
| Local SQLite full suite (7940 tests) | only the 26 known `Fuel*` failures (`bcmul`: no bcmath in this sandbox; CI has it) |
| Local PostgreSQL focused (ZatcaMonetaryXml, ZatcaPartyXml, SdkFixtureDrift, SignedInvoicePosting, ZatcaTest, InvoiceIssuedAt*, InvoicePartySnapshot, PosCheckoutIdempotency) | ✅ 147 passed |
| Full PostgreSQL suite, CI, CI Gate | on the PR (CI `pgsql` job is the authoritative full PostgreSQL run) |

## 6. Official SDK diagnostics, before → after (238-R3.4.8, JDK 11, advisory, local)

"Before" = the same fixture specs rendered by `main`'s builder.

| Fixture | Errors removed | Warnings removed | New warnings | Errors still present |
|---|---|---|---|---|
| `awj-simplified-document-discount` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | BR-KSA-28, KSA-13, NullPointerException, QRCODE, certificate |
| `awj-simplified-single-line` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | BR-KSA-28, KSA-13, NullPointerException, QRCODE, certificate |
| `awj-simplified-two-lines` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | BR-KSA-28, KSA-13, NullPointerException, QRCODE, certificate |
| `awj-standard-adjustment` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | BR-CO-16 | KSA-13 |
| `awj-standard-buyer-crn` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-document-discount` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-fractional-quantity` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-line-discount` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-multi-line` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-shipping` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | BR-KSA-19 | KSA-13 |
| `awj-standard-single-line` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-small-lines` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08 | — | KSA-13 |
| `awj-standard-tax-inclusive` | BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13, BR-KSA-EN16931-08, BR-KSA-EN16931-11 | — | KSA-13 |
| `awj-standard-zero-rate` | BR-KSA-52, BR-KSA-53, BR-KSA-68 | BR-CO-10, BR-CO-13 | BR-KSA-EN16931-09 | BR-CO-04, BR-CO-18, KSA-13 |

* **Targeted errors BR-CO-04, BR-CO-15, BR-CO-18, BR-KSA-52, BR-KSA-53, BR-KSA-68: gone on every supported fixture.** On `awj-standard-zero-rate` BR-CO-04/BR-CO-18 remain by design.
* **No new error code anywhere.** New warnings are exactly the three documented gaps: BR-CO-16 (adjustment), BR-KSA-19 (shipping code), BR-KSA-EN16931-09 (zero-rate, no breakdown).
* Remaining errors belong to REM-17: `KSA-13` (genesis PIH constant — shown in the audit to be the only cause), `BR-KSA-28`, `QRCODE`, signature/certificate on simplified fixtures.
* Standard fixtures now pass XSD, EN and KSA; simplified fixtures pass XSD and EN. **Global result is still FAILED on every fixture** (PIH / signing / QR), and passing stages is not compliance.
* Warning regression gate: BR-S-09 and BR-CO-17 (and the other monetary rules) are pinned at zero for all fixtures except the three documented gaps; the ratchet's negative controls reject a wrongly declared forbidden code.

**What the SDK cannot see (why green is not compliant).** BR-S-09 and BR-CO-17 are *warnings* with a tolerance of 0.01 × lines; per-line rounding of 30 lines × 0.10 SAR gives 0.60 against 0.45 at document level and passes silently. That divergence is a legal/accounting question (ADR-B), recorded here and by the `small lines` fixture, not fixed.

## 7. Remaining decisions and risks

1. **REM-12** — category for 0 %/other rates and reason codes; until then every zero-rated/exempt/5 % invoice stays SDK-invalid (visible, never blocked).
2. **ADR-B** — rounding method (document level per category), header-discount allocation, shipping category, `adjustment` bound/mapping, QR tag 4 (= `total`) vs BT-112 when an adjustment exists.
3. **Shipping reason code** — needs an owner/regulatory confirmation of which UNCL 7161 code (if any) is the official meaning of AWJ's shipping fee (or a field that distinguishes delivery / freight / handling).
4. **Supply date, `PaymentMeans`, `unitCode`** — REM-29/TAX-E01.
5. XML bytes change for **new** invoices only; stored XML/QR/hash are never regenerated; the signed path (finalizer/signer tests) is unchanged and green.
6. Hand-checked: the tax-inclusive net price is rounded to a halala in the source, so BT-131 and 3 × BT-146 can differ by one halala per line (within SDK tolerance; reported in the test, not hidden).

## 8. Recommended next step

Merge after review; then **REM-17** (genesis PIH constant, QR, signature) — the only thing separating the standard fixtures from a full SDK pass — in parallel with the owner decisions above (REM-12 first for the zero-rate gap).

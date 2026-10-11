# R2 — ZATCA technical e-invoicing requirements register (official sources + offline SDK)

Audit AWJ-TAX-ZATCA-AUDIT-1 · auditor R2 · compiled 2026-10-10 · all downloads under `<audit-workspace>/official/downloads/R2/`, extracted texts under `<audit-workspace>/official/R2-work/text/`, SDK how-to in `<audit-workspace>/official/R2-sdk-howto.md`, samples in `<audit-workspace>/official/R2-reference-samples/`.

Verification labels used below: **VERIFIED-FROM-SOURCE** (read in the official PDF/XLSX/portal page named), **VERIFIED-BY-SDK** (read in SDK 238-R3.4.8 files — Schematron XSLT, jar templates, samples — or reproduced by running the SDK), **RECALLED-UNVERIFIED** (from memory/community knowledge; not found in any source obtained here). Where the PDF text and the SDK disagree, both are shown and the SDK (the actual validator ZATCA ships, dated 2025-03) is flagged as the operative behaviour.

## 0. Headline findings

1. The current official technical trio is dated **19 May 2023 (v1.2)**: XML Implementation Standard, Data Dictionary, Security Features Implementation Standards. The 24 Jun 2022 (v1.1) files are superseded (the 2022 "vF" PDF still hosted is byte-identical to the 2023 "vTrack" file). Nothing newer is published on zatca.gov.sa (pages last updated 2026-01/08 but still link the 2023 files).
2. The **validator that matters is the SDK (238-R3.4.8, jar built 2025-03-11)**: its Schematron is newer than the 2023 PDF — it adds BR-KSA-92/97/98/99, BR-KSA-F-07…F-13, BR-KSA-F-C-01, BR-CUSTOM-VALIDATION-01, VATEX-SA-ROYALDECREE / VATEX-SA-32(bis), the 9-position transaction code `NNPNESBCG` (continuous-supply and B2G flags), removes BR-KSA-86 enforcement from errors to warnings, and **inverts BR-KSA-EN16931-06** (price-level charge NOT allowed — the 2023 PDF text says "allowed … 'True'").
3. Three byte-level quirks of the signature profile were **reproduced here byte-for-byte** against all 19 SDK samples (§7, §11, script `R2-reference-samples/zatca_hash_reference.py`): (a) invoice hash = base64(SHA-256(C14N of the document with `ext:UBLExtensions`, `cac:Signature`, `cac:AdditionalDocumentReference[cbc:ID='QR']` removed, **keeping their tail whitespace**)); (b) SignedProperties digest = base64(**hex**(SHA-256(the `xades:SignedProperties` element as the SDK's fixed indented template text, with `xmlns:xades` on the root and `xmlns:ds` on every `ds:*` child))); (c) CertDigest = base64(**hex**(SHA-256(the **base64 text** of the certificate, not its DER))).
4. QR TLV encodings (verified on samples and in the Detailed Technical Guideline): tags 1–5 UTF-8 text; tag 6 = the 44-char base64 hash **text**; tag 7 = the base64 **text** of `ds:SignatureValue`; tag 8 = **raw DER** SubjectPublicKeyInfo bytes (88 bytes for secp256k1); tag 9 = **raw DER** signature bytes of the CSID certificate (simplified documents only). The Security standard's wording "tag 6 length 32 bytes" is NOT what the SDK produces/validates (44).
5. SDK runs offline on Java 11 only for signature checks (Java 21 cannot verify/sign secp256k1) and needs `-Dfile.encoding=UTF-8` on JDK 11 or hashes of Arabic content are silently wrong (§11).
6. Not obtainable without calling the gateway: the Swagger/OpenAPI files (served through `gw-fatoora.zatca.gov.sa/e-invoicing/core/adminconfig` only). API endpoint paths, auth scheme, `accept-version: v2`, `accept-language`, the response-code table and the request body `{invoiceHash, uuid, invoice}` are verified from the Fatoora Portal manual / Developer Portal manual / Detailed Guidelines / SDK; the exact response JSON field names (`validationResults`, `reportingStatus`, `clearanceStatus`, `clearedInvoice`, `binarySecurityToken`, `secret`, `requestID`) are only partly verified (see §10).

## 1. Document inventory

| # | Document | Version / date (from the document) | URL | Retrieved | sha256 | Status |
|---|---|---|---|---|---|---|
| D1 | Electronic Invoice XML Implementation Standard (vF) | v1.2, 2023-05-19 (PDF created 2023-05-18), 72 pp | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_XML_Implementation_Standard_%20vF.pdf | 2026-10-10 | 5aa15ff95efb98d3696083c309470d116d7e93ea7e134cca63f9680bc112685e | **CURRENT** (linked from zatca.gov.sa E-Invoice-specifications page, page updated 12 Jan 2026) |
| D1t | same, track-changes (vTrack) | 2023-05-19, 75 pp | …Standard_%20vTrack.pdf | 2026-10-10 | f4a14e3e601748435bb425e9caa9f2db305af38d0322d154c59a16aa4b228dc9 | reference only |
| D1old | XML Implementation Standard 20220624 "vF" (as still hosted and hard-linked by the Developer Portal SPA) | file is byte-identical to D1t | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_XML_Implementation_Standard_vF.pdf | 2026-10-10 | f4a14e3e… (same as D1t) | SUPERSEDED (v1.1) |
| D2 | Electronic Invoice Data Dictionary (vF, xlsx) | v1.2, 2023-05-19 | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_EInvoice_Data_Dictionary%20vF.xlsx | 2026-10-10 | 61148ff46d174e5b1f04471418c2c209192de668198b7ae1de781f7032e9f038 | **CURRENT** |
| D2t | Data Dictionary vTrack | 2023-05-19 | …Dictionary%20vTrack.xlsx | 2026-10-10 | 07a3d75f5be8f0f59a30df9bb3d2be3408e770af7c8f506ca7ec3e126a78f7ea | reference only |
| D2old | EInvoice_Data_Dictionary.xlsx (Developer-Portal hard link) | 2022 (v1.1) | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/EInvoice_Data_Dictionary.xlsx | 2026-10-10 | c0071ee7f72bed9a81b30e9744e0f85207faee77893d397e92f831c4f69c5de2 | SUPERSEDED |
| D3 | Security Features Implementation Standards (vF) | v1.2, 2023-05-19, 27 pp | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20230519_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards_vF.pdf | 2026-10-10 | 9049935ee34f9d491c592151506984944d036b5f946f77b443321bf580e704d4 | **CURRENT** (Security-Requirements page, updated 10 Aug 2026) |
| D3old | Security Features … 20220624 | v1.1, 27 pp | https://zatca.gov.sa/ar/E-Invoicing/SystemsDevelopers/Documents/20220624_ZATCA_Electronic_Invoice_Security_Features_Implementation_Standards.pdf | 2026-10-10 | 9e094a36767e1afddbd0abb0e67d57c6cd42cfe01b85940a9c4c117b18e1d88b | SUPERSEDED (only change in v1.2: "Elaborated on QR code Tag 5 VAT total") |
| D4 | E-Invoicing Detailed Guidelines | Version 2, May 2023, 66 pp | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-Invoicing_Detailed__Guideline.pdf | 2026-10-10 | 55b7dfb481b8732078ee8fa6264a42a7293ac555b0682a8458a75f634e4ff2e4 | CURRENT (Guidelines page, updated 10 Aug 2026) |
| D5 | E-invoicing Detailed Technical Guideline | Version 2, Nov 2022, 81 pp | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/E-invoicing-Detailed-Technical-Guideline.pdf | 2026-10-10 | 313393cc506191449fab44e2db1a930801676d172f214533e1995ca91e2487ab | CURRENT |
| D6 | Developer Portal Manual | Version 3, Nov 2022, 96 pp | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/DEVELOPER-PORTAL-MANUAL.pdf | 2026-10-10 | f74c94302e33b68568545e2e320f73691f47800b6a4374bf784fb663d2743104 | CURRENT |
| D7 | Fatoora Portal User Manual | Version 3, May 2023, 32 pp | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Fatoora_Portal_User_Manual_English.pdf | 2026-10-10 | 6fec08254aac8f3aab2247f96bd7b4ac2dc3558fb48c2a4b598dde564ad14c52 | CURRENT |
| D8 | Simplified Guideline for E-Invoicing | Version 1, 29 Jun 2022, 23 pp | https://zatca.gov.sa/en/E-Invoicing/Introduction/Guidelines/Documents/Simplified%20guide_En.pdf | 2026-10-10 | e95c06318e7ccc1948a85f3de83406c7c88aa4f2c6503014c18d8cf4e55d6a1e | background |
| S1 | ZATCA E-Invoicing Java SDK | **238-R3.4.8** (`Apps/global.json`; jar classes dated 2025-03-11; KSA Schematron file `20210819_ZATCA_E-invoice_Validation_Rules.xsl`, EN file `CEN-EN16931-UBL.xsl`) | Developer Portal link `REACT_APP_DOWNLOAD_SDK_JAVA` in https://sandbox.zatca.gov.sa/env-config.js → https://sadzit.sharepoint.com/sites/EXTERNALZATCA/ZatcaSDK/SDK/3.4.8/zatca-einvoicing-sdk-Java-238-R3.4.8.zip | 2026-10-10 | 91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6 | **CURRENT** (latest in portal version history) |
| S2 | SDK version history / release notes 3.3.8→3.4.8 | embedded in Developer Portal bundle | https://sandbox.zatca.gov.sa/assets/index-CqfbJeRB.js (extract: `R2-work/sdk-version-history-from-portal-bundle.txt`) | 2026-10-10 | n/a | CURRENT |
| S3 | Developer Portal runtime config (API gateway URLs, SDK links) | — | https://sandbox.zatca.gov.sa/env-config.js | 2026-10-10 | n/a | CURRENT |
| X1 | Fatoora/Developer Portal **Swagger (OpenAPI) files** | — | only downloadable through `https://gw-fatoora.zatca.gov.sa/e-invoicing/core/adminconfig` (gateway) | **NOT OBTAINED** (gateway calls forbidden by brief) | — | gap → API JSON schemas marked RECALLED-UNVERIFIED |

Supporting extracts (all in `<audit-workspace>/official/R2-work/`): `rules-ksa-with-tests.txt` (150 KSA assertions with XPath tests), `rules-en-with-tests.txt` (108 EN assertions), `data-dictionary-2023-condensed.txt` (154 business terms with per-type status), `text/*.txt` (pdftotext -layout of every PDF), `portal-i18n-api-strings.txt`, `validate-all-samples-jdk11.log`, `sample-hashes-jdk11.txt`, `reference-script-run.log`.

## 2. Requirements register

Columns: ID · Topic · Requirement · Source (version/date) · Section/rule/page · Applies to · Verification · Notes.

| ID | Topic | Requirement | Source | Section / rule / page | Applies to | Verification | Notes |
|---|---|---|---|---|---|---|---|
| R2-001 | Validation phases | An invoice is compliant only after (1) XSD/UBL 2.1 syntax validation and (2) content validation: EN 16931 subset then KSA CIUS rules; KSA rules override EN rules, EN overrides UBL. | D1 v1.2 2023-05-19 | §4 pp.5–6; D6 §4.2.4 Q1 | XML | VERIFIED-FROM-SOURCE | SDK order: XSD → EN → KSA → QR → SIGNATURE → PIH (VERIFIED-BY-SDK run). |
| R2-002 | Document types | `cbc:InvoiceTypeCode` ∈ {388 invoice, 386 prepayment invoice, 383 debit note, 381 credit note}; UBL message type is always `Invoice` (also for credit notes). | D1 §11.2.1 p.30–31 | BR-KSA-05 | XML | VERIFIED-FROM-SOURCE + SDK (`contains(' 388 383 381 386 ')`) | BR-CL-01 (EN) list is wider; KSA subset governs. |
| R2-003 | Transaction code | `cbc:InvoiceTypeCode/@name` = `NNPNESB`: NN=01 tax / 02 simplified; P 3rd-party; N nominal; E export; S summary; B self-billed. | D1 §11.2.1 + BR-KSA-06 p.48 | BR-KSA-06 | XML | VERIFIED-FROM-SOURCE | **SDK 3.4.3+ accepts 7, 8 or 9 chars: `NNPNESBCG`, C = continuous supply, G = B2G** (BR-KSA-06 text + test in SDK XSL; BR-KSA-F-06-C40 length 7–9). PDF is outdated. |
| R2-004 | Self-billing limits | Self-billed not allowed for exports (position 5=1 ⇒ position 7≠1) [error]; simplified documents cannot be self-billed (BR-KSA-31, error). SDK 3.4.6 relaxed BR-KSA-31 to allow simplified **exports** (B2C). | D1 BR-KSA-07, BR-KSA-31; S2 (3.4.6) | pp.48, 55 | XML | VERIFIED-FROM-SOURCE / VERIFIED-BY-SDK | |
| R2-005 | B2G | If @name position 9 = 1 (B2G) then Contract ID (BT-12, `cac:ContractDocumentReference/cbc:ID`) mandatory [error, BR-KSA-92]; Company legal form KSA-40 should be `GOV` [warning, BR-KSA-91]. | S1 KSA XSL; S2 (3.4.3) | BR-KSA-91/92 | XML | VERIFIED-BY-SDK | Not in the 2023 PDF. |
| R2-006 | Profile | `cbc:ProfileID` must be `reporting:1.0` [error]. | D1 BR-KSA-EN16931-01 p.66 | | XML | VERIFIED-FROM-SOURCE + SDK | |
| R2-007 | UUID | `cbc:UUID` (KSA-1) mandatory, letters/digits/dashes only [error]. | D1 BR-KSA-03 p.47; D2 KSA-1 | | XML | VERIFIED-FROM-SOURCE + SDK (`matches(cbc:UUID,'^[\w.-]+')`) | Rejected documents' UUID/ICV must not be reused (D5 FAQ p.76). |
| R2-008 | Issue date/time | `cbc:IssueDate` mandatory, `YYYY-MM-DD` (BR-KSA-F-01, **error** since SDK 3.4.2), ≤ current date (BR-KSA-04, error); `cbc:IssueTime` (KSA-25) mandatory, `hh:mm:ss` or `hh:mm:ssZ` (BR-KSA-70, error). Dates carry no timezone; local KSA time or UTC with `Z`. | D1 §7.3 rows 7,10 p.13; BR-KSA-04/70/F-01 | | XML | VERIFIED-FROM-SOURCE + SDK | SDK regex: `^([01][0-9]\|2[0-3]):([0-5][0-9]):([0-5][0-9])Z?$`; fractional seconds NOT accepted by SDK although §7.3 allows them. |
| R2-009 | Currency | `cbc:DocumentCurrencyCode` mandatory ISO 4217; `cbc:TaxCurrencyCode` mandatory and must be `SAR` (BR-KSA-68 error, BR-KSA-EN16931-02 error); all `@currencyID` = document currency except BT-111 (BR-KSA-CL-02 error). Non-SAR invoice: BT-110 ≠ BT-111 expected (BR-KSA-97 warning); exactly one `cac:TaxTotal` with subtotals (BR-KSA-EN16931-08) and one without when tax currency present (…-09). Tax exchange rate (KSA-36…39): source = BT-5, target = BT-6, rate ≤ 14 digits (BR-KSA-87…90). | D1 §9.1, §11.2.3, rules pp.57,63–66; S1 | | XML/ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | Sample "Advance Payment adjustments with foreign currency invoice.xml" (USD doc currency, SAR tax currency) passes. |
| R2-010 | ICV | Invoice counter value KSA-16 in `cac:AdditionalDocumentReference[cbc:ID='ICV']/cbc:UUID`, mandatory, digits only (BR-KSA-33/34, errors); one sequence per EGS unit covering standard+simplified; never reused; gaps investigated. | D1 BR-KSA-33/34 p.55; D5 §4.3 p.48 & FAQ pp.71,76,78 | | XML/OPS | VERIFIED-FROM-SOURCE + SDK | |
| R2-011 | PIH | Previous invoice hash KSA-13 in `cac:AdditionalDocumentReference[cbc:ID='PIH']/cac:Attachment/cbc:EmbeddedDocumentBinaryObject[@mimeCode='text/plain']`, mandatory (BR-KSA-61 warning in SDK), = hash of the previously **generated** document (even if that one was rejected); first document uses `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==` (= base64 of hex SHA-256 of "0"). Submission order may differ from generation order. | D1 BR-KSA-26 p.53–54; D3 §3 p.25; D5 §4.3 p.48 + FAQ p.70 | | XML/HASH/OPS | VERIFIED-FROM-SOURCE + SDK (`Data/PIH/pih.txt`, verified = b64(hex(sha256("0")))) | PIH hash method = same transform as the signature hash (R2-040). |
| R2-012 | QR element | KSA-14 QR in `cac:AdditionalDocumentReference[cbc:ID='QR']/cac:Attachment/cbc:EmbeddedDocumentBinaryObject[@mimeCode='text/plain']`, base64, ≤ 1000 chars (BR-CL-KSA-14 error), mandatory for simplified (BR-KSA-27 warning); for standard documents ZATCA generates it at clearance. | D1 BR-KSA-27 p.53; D2 KSA-14; D4 FAQ p.59 | | XML/QR | VERIFIED-FROM-SOURCE + SDK | SDK validates QR content only for `02…` documents (observed). |
| R2-013 | Cryptographic stamp placement | Signature lives in `ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sig:UBLDocumentSignatures/sac:SignatureInformation/ds:Signature`; `sac:SignatureInformation/cbc:ID` = `urn:oasis:names:specification:ubl:signature:1` (BR-KSA-28 error); `sbc:ReferencedSignatureID` and `cac:Signature/cbc:ID` = `urn:oasis:names:specification:ubl:signature:Invoice` (BR-KSA-29 warning); `cac:Signature/cbc:SignatureMethod` = `urn:oasis:names:specification:ubl:dsig:enveloped:xades` (BR-KSA-30 error); `ext:ExtensionURI` = same URN. Mandatory for simplified documents (BR-KSA-60 warning). | D2 KSA-15 (stamp example); D1 BR-KSA-28/29/30/60; S1 jar `xml/ubl.xml`, `xml/signature.xml` | | SIGNATURE | VERIFIED-FROM-SOURCE + SDK | `cac:Signature` is inserted immediately before `cac:AccountingSupplierParty`; QR AdditionalDocumentReference likewise (jar XSLTs). |
| R2-014 | Seller identification | BT-29 `cac:PartyIdentification/cbc:ID` with `@schemeID` ∈ {CRN, MOM, MLS, 700, SAG, OTH}, alphanumeric, once; CRN must be 10 digits (BR-KSA-F-08 warning), 700-number 10 digits starting with 7 (F-09); no spaces in schemeID (F-12); F-13 pattern check. | D1 BR-KSA-08 p.48–49; S1 | | XML | VERIFIED-FROM-SOURCE + SDK | SDK flag for BR-KSA-08: **warning**. |
| R2-015 | Seller VAT number | BT-31 `cac:PartyTaxScheme/cbc:CompanyID` with `cac:TaxScheme/cbc:ID='VAT'`: mandatory (BR-KSA-39 error), 15 digits, first and last digit 3 (BR-KSA-40 error); must differ from buyer VAT (BR-CUSTOM-VALIDATION-01 error, SDK only). | D1 BR-KSA-39/40 p.56; S1 | | XML | VERIFIED-FROM-SOURCE + SDK | |
| R2-016 | Seller address | Mandatory: street (BT-35, 1–1000 ch), building number KSA-17 (**4 digits**, BR-KSA-37 warning), postal code BT-38 (**5 digits**, BR-KSA-66), city BT-37 (1–127), district KSA-3 (1–127), country BT-40 (ISO 3166-1 alpha-2) — BR-KSA-09 (warning in SDK). Optional: additional street BT-36 (≤127), additional number KSA-23, province BT-39 (≤127). | D1 BR-KSA-09/37/66 pp.49,56,57; D2 rows BT-35…KSA-3 | | XML | VERIFIED-FROM-SOURCE + SDK | ZATCA states seller-address errors are returned as **warnings** (accepted) on the API (D6 §2.3.11; D4 p.53). |
| R2-017 | Buyer data (standard) | Tax invoice & its notes (01): buyer name BT-44 mandatory (BR-KSA-42); buyer address: street, city, country mandatory (BR-10/BR-KSA-10); if buyer country = SA also building number KSA-18, postal code BT-53 (5 digits, BR-KSA-67), district KSA-4 (BR-KSA-63); buyer VAT BT-48 if registered (15 digits, 3…3, BR-KSA-44 error; empty tag → BR-KSA-99 warning), else other buyer ID BT-46 mandatory (BR-KSA-81) with schemeID ∈ {TIN, CRN, MOM, MLS, 700, SAG, NAT, GCC, IQA, PAS, OTH} (BR-KSA-14 error) — TIN 10 digits starting 3 (F-07), NAT 10 digits starting 1 (F-10), IQA 10 digits starting 2 (F-11). For exports (position 5=1) buyer VAT must not exist (BR-KSA-46, PDF only). | D1 pp.50–57; D5 FAQ p.79 (ID preference order) | | XML | VERIFIED-FROM-SOURCE; BR-KSA-46 is **not in the SDK XSL** (SDK has no such assertion) | SDK 3.4.5 removed BR-10 postal-code requirement when buyer country ≠ SA. |
| R2-018 | Buyer data (simplified) | Simplified (02): buyer block optional; buyer name mandatory when exemption code is VATEX-SA-EDU/HEA (BR-KSA-25) or for summary simplified invoices (BR-KSA-71); EDU/HEA additionally require other buyer ID with schemeID NAT (BR-KSA-49 error). | D1 BR-KSA-25/49/71 | | XML | VERIFIED-FROM-SOURCE + SDK | |
| R2-019 | Buyer contact | BT-57 telephone: starts `0` or `+` then 4–15 digits (BR-KSA-85 warning); BT-58 e-mail format rule BR-KSA-86 (warning; SDK 3.4.1 "removed" it from errors — still present as warning in 3.4.8 XSL); contact name/note ≤1000. | S1 KSA XSL | | XML | VERIFIED-BY-SDK | Not in the 2023 PDF/Data Dictionary. |
| R2-020 | Supply date | Tax invoice 388/01 must contain `cac:Delivery/cbc:ActualDeliveryDate` KSA-5 (BR-KSA-15 warning); supply end date KSA-24 requires KSA-5 and must be ≥ it (BR-KSA-35/36); simplified summary (02, position 6=1) requires both (BR-KSA-72 error). All dates `YYYY-MM-DD`. | D1 pp.52,55,58 | | XML | VERIFIED-FROM-SOURCE + SDK | |
| R2-021 | Payment means | BT-81 `cac:PaymentMeans/cbc:PaymentMeansCode` optional; if present must be in UNTDID 4461 subset (SDK list: 1–68, 70, 74–78, 91–97, ZZZ) (BR-KSA-16 warning). Payment terms KSA-22 (`PayeeFinancialAccount/cbc:PaymentNote`) ≤1000, account id BT-84 ≤127. | D1 §11.2.5, BR-KSA-16; S1 | | XML | VERIFIED-FROM-SOURCE + SDK | Sample values used: 10 (cash), 30 (credit transfer). |
| R2-022 | Credit/debit notes | 381/383 must carry `cac:PaymentMeans/cbc:InstructionNote` KSA-10 reason (BR-KSA-17 error, 1–1000 ch) and `cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID` BT-25 (BR-KSA-56 warning in SDK; 1–5000 ch, error F-06-C22). Note shares the subtype (01/02) and issuing rules of the referenced invoice. One supply-date range may cover several originals. | D1 BR-KSA-17/56 pp.52,57; §5.2; D5 FAQ p.72 | | XML | VERIFIED-FROM-SOURCE + SDK | Sample notes use `InstructionNote` bilingual text and `BillingReference/InvoiceDocumentReference/cbc:ID=SME00002`. |
| R2-023 | Lines | ≥1 `cac:InvoiceLine` (BR-16); each: ID (1–6 chars, error), quantity (BT-129, non-zero), `cbc:LineExtensionAmount` BT-131, item name BT-153 (3–1000 chars warning; numeric-only/sequential names flagged BR-KSA-F-C-01), net price BT-146, `cac:Item/cac:ClassifiedTaxCategory` (ID S/Z/E/O, Percent, TaxScheme VAT), line `cac:TaxTotal/cbc:TaxAmount` KSA-11 and `cbc:RoundingAmount` KSA-12 (mandatory for 01 documents, errors BR-KSA-52/53; SDK context also includes 02). | D1 BR-21…26, BR-KSA-51/52/53; D2 rows BT-126…KSA-12 | | XML | VERIFIED-FROM-SOURCE + SDK | |
| R2-024 | Allowances/charges | Document level: `cac:AllowanceCharge` with `cbc:ChargeIndicator` false/true (BR-KSA-F-02), amount BT-92/99, VAT category + rate (rate >0 for S, =0 for Z/E/O); charges need reason code BT-105 (UNTDID 7161, BR-KSA-CL-06) and reason text BT-104 (BR-KSA-19/21). Line level allowances BT-136 (and charges BT-141 with reason BT-144/145). Percentage ⇔ base amount both present (BR-KSA-EN16931-04/05) and amount = base × pct/100 (…-03, rounded half-up). **Price-level (`cac:Price/cac:AllowanceCharge`) charges are NOT allowed, only allowances (indicator false) — error BR-KSA-EN16931-06 in SDK**; net price = gross − price discount (…-07). | D1 §9.4 p.18–19, rules pp.52,66–67; S2 (3.4.1, 3.4.2) | | XML/ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | 2023 PDF text of …-06 ("is allowed… 'True'") is the OPPOSITE of the SDK — treat the SDK as operative. |
| R2-025 | VAT categories | `cbc:ID` ∈ {S, Z, E, O} only (BR-KSA-18 error); S rate must be 15 or 5 (BR-KSA-84 error); Z/E/O rate 0; one `cac:TaxSubtotal` per distinct (category, rate), trailing zeros of the rate ignored; O breakdown has 0 tax. | D1 §8, §11.2.4, BR-KSA-18/84 | | XML/ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | |
| R2-026 | Exemption reason codes | For Z/E/O breakdowns `cbc:TaxExemptionReasonCode` BT-121 must exist with a code from §11.2.4 (BR-KSA-CL-04, BR-KSA-23/24/69 — warnings) and `cbc:TaxExemptionReason` BT-120 must carry the matching official text (BR-KSA-83 warning; SDK compares code+text without spaces, min lengths). Full table in §4 below. | D1 §11.2.4 pp.32–33, BR-KSA-83/CL-04; S1 | | XML | VERIFIED-FROM-SOURCE + SDK | SDK adds VATEX-SA-ROYALDECREE and VATEX-SA-32(bis) (3.4.2) and DIPLOMAT/DUTYFREE (not in PDF). |
| R2-027 | Document totals | BT-106 Σ lines; BT-107 Σ doc allowances; BT-108 Σ doc charges; BT-109 = BT-106 − BT-107 + BT-108; BT-110 = Σ BT-117; BT-112 = BT-109 + BT-110; BT-115 = BT-112 − BT-113 + BT-114 (BR-CO-10…16); each ≤2 decimals (BR-DEC-*). SDK tolerances: see §6. | D1 §9.2 p.16, §13.2.2 | | ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | |
| R2-028 | Line arithmetic | BT-131 = (BT-146 ÷ BT-149) × BT-129 − BT-136 + BT-141, each part rounded separately to 2 dp (BR-KSA-EN16931-11; SDK: product truncated to 2 dp via floor(x·1000)/10 then rounded, ±0.01 tolerance). KSA-12 = BT-131 + KSA-11 rounded to 2 dp (BR-KSA-51). Line VAT KSA-11 ≤2 dp. | D1 §9.3 p.17; S1 | | ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | Rounding method: half-up on the third decimal (D1 §10). |
| R2-029 | VAT breakdown arithmetic | BT-116 = Σ BT-131 (lines of that category/rate) + Σ BT-99 − Σ BT-92 (same category) (BR-S-08/Z-08/E-08/O-08); BT-117 = BT-116 × rate/100 rounded to 2 dp (BR-CO-17, BR-S-09) — SDK accepts \|BT-117 − round(BT-116×rate/100,2)\| ≤ 0.01 × (number of invoice lines). Document VAT total rounded at document level, not as sum of rounded line VAT (D1 §10). | D1 §9.6, §10, §13; S1 (`toleranceLimit = count(//cac:InvoiceLine) * 0.01`) | | ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | SDK 3.3.8 release note confirms the tolerance fix for BR-CO-17/BR-S-09. |
| R2-030 | Rounding | Half-up; document totals rounded to 2 dp; round final results not intermediates. Payable rounding amount BT-114 (`cbc:PayableRoundingAmount`, ≤2 dp, may be negative e.g. −0.01) feeds BT-115. | D1 §10 p.29; sample "Standard Invoice with Payable Rounding Adjustment.xml" | | ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | BR-KSA-F-04 (error) requires all amounts/quantities ≥0 **except** `PayableRoundingAmount` and O-category taxable amounts (not in its context list). |
| R2-031 | Prepayment (386) adjustment | Invoice adjusting an advance: `cbc:PrepaidAmount` BT-113 = Σ KSA-31 + Σ KSA-32 (BR-KSA-80); one extra line per prepayment invoice with `cac:DocumentReference` {ID KSA-26, IssueDate KSA-28, IssueTime KSA-29, DocumentTypeCode = 386 KSA-30} (BR-KSA-73/74), zero price/net/VAT/rounding amounts (BR-KSA-82 error), line `cac:TaxTotal/cac:TaxSubtotal` with taxable KSA-31, tax KSA-32 (= KSA-31 × KSA-34/100, BR-KSA-79), category KSA-33 and rate KSA-34 (BR-KSA-75…78, 93…96, CL-07). | D1 §9.5 pp.20–25, rules pp.59–61 | | XML/ARITHMETIC | VERIFIED-FROM-SOURCE + SDK | Three SDK samples cover this incl. rate change 5%/15% and USD. |
| R2-032 | Field length limits | BR-KSA-F-06 family (SDK ids F-06-C1…C40): invoice number ≤127, note ≤1000, PO/contract ids ≤127, billing reference 1–5000 (error), names ≤1000, streets ≤1000, additional street/city/province/district ≤127, reason texts ≤1000, item ids ≤127, line id ≤6 (error), QR ≤1000 (error), transaction code 7–9 chars. | D2 columns Y–AA; S1 | | XML | VERIFIED-FROM-SOURCE + SDK | Most are warnings; C17 (line id) and C22 (billing ref) are errors. |
| R2-033 | No empty elements | "Document MUST not contain empty elements" (BR-KSA-F-03). | D1 §13.3.5 p.68 | | XML | VERIFIED-FROM-SOURCE (PDF); **not present in SDK XSL** | Empty `cbc:CompanyID` is instead caught by BR-KSA-99 (warning). |
| R2-034 | Mime codes | `@mimeCode` ∈ {text/csv, text/plain, application/pdf, image/png, image/jpeg, image/tiff, application/acad, application/dwg, drawing/dwg, xlsx, ods} (BR-KSA-CL-03 error). | S1 | | XML | VERIFIED-BY-SDK | PIH/QR use `text/plain`. |
| R2-035 | File naming | `<SellerVAT>_<YYYYMMDD>T<HHMMSS>_<InvoiceNumber with non-alphanumerics → '-'>.xml` e.g. `3xxxxxxxxx1xxx3_20210526T132400_2021-05-26-23555.xml`. | D1 §14 p.71 | | OPS | VERIFIED-FROM-SOURCE | |
| R2-036 | Arabic | Human-readable invoice data must be in Arabic (bilingual allowed); XML technical tags English. | D4 FAQ p.59; D5 FAQ p.78 | | OPS | VERIFIED-FROM-SOURCE | Sample seller names are "Arabic \| English". |
| R2-037 | Archiving/format | Once integrated, e-invoices must be generated and stored as XML or PDF/A-3 with embedded XML; submission to ZATCA must be XML (not PDF/A-3); share XML or PDF/A-3 with the buyer. | D4 FAQ p.60; D5 §4.3 p.47 | | OPS | VERIFIED-FROM-SOURCE | |
| R2-040 | Invoice hash (transform) | Hash input = document with `ext:UBLExtensions`, `cac:Signature`, `cac:AdditionalDocumentReference[cbc:ID='QR']` excluded via XPath-filter transforms, then C14N 1.1 (`http://www.w3.org/2006/12/xml-c14n11`), SHA-256, base64 of the **binary** digest (44 chars). XML declaration dropped (C14N). | D1 BR-KSA-26; D3 §2.3.3 (1.3.1) p.20; D5 §5.2 step 1 p.52 (hex→base64 i.e. binary) | | HASH | VERIFIED-FROM-SOURCE + **reproduced** (19/19 samples; whitespace tails of removed elements must be kept) | SDK jar `xslt/removeElements.xsl` removes `UBLExtensions` anywhere under Invoice, QR reference anywhere, `Signature` as direct child of Invoice. |
| R2-041 | Signature algorithm | `ds:SignatureMethod` = `http://www.w3.org/2001/04/xmldsig-more#ecdsa-sha256`; `ds:CanonicalizationMethod` = `http://www.w3.org/2006/12/xml-c14n11`; `ds:DigestMethod` = `http://www.w3.org/2001/04/xmlenc#sha256`; key: ECDSA **secp256k1** (OID 1.3.132.0.10), 256-bit; SHA-256 everywhere. | D3 §2.2.1 req 16 p.12 ("ECDSA, key length 256"); D2 stamp example; S1 CSR (`ASN1 OID: secp256k1`) + SDK readme | | SIGNATURE | VERIFIED-FROM-SOURCE + SDK | D3's certificate profile table says "Key length: P-256" (= secp256**r**1) — **the SDK/CSR/samples use secp256k1**; treat P-256 wording as an error in D3. |
| R2-042 | Signature structure (XAdES B-B, enveloped) | `ds:Signature Id="signature"` with `ds:SignedInfo` containing two `ds:Reference`s: (1) `Id="invoiceSignedData" URI=""` with the 3 XPath transforms + c14n11 transform and the invoice digest; (2) `Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties" URI="#xadesSignedProperties"`; `ds:SignatureValue` base64 DER ECDSA; `ds:KeyInfo/ds:X509Data/ds:X509Certificate` (CSID, base64 DER); `ds:Object/xades:QualifyingProperties Target="signature"` (ns `http://uri.etsi.org/01903/v1.3.2#`) / `xades:SignedProperties Id="xadesSignedProperties"` / `xades:SignedSignatureProperties` {`xades:SigningTime`, `xades:SigningCertificate/xades:Cert` {`xades:CertDigest` (DigestMethod sha256 + DigestValue), `xades:IssuerSerial` {`ds:X509IssuerName`, `ds:X509SerialNumber`}}}. | D2 "Stamp example"/KSA-15; S1 jar `xml/ubl.xml` (template); all 19 samples | | SIGNATURE | VERIFIED-FROM-SOURCE + SDK | D3 §2.3.3 lists `SigningCertificateV2`, `SignaturePolicyIdentifier` (card. 1), `DataObjectFormat/MimeType text/xml`, and Reference Type `http://uri.etsi.org/01903#SignedProperties` — **none of these appear in the SDK template or samples, which validate PASS**; the operative profile is the SDK's. Signing time format in samples: `YYYY-MM-DDThh:mm:ss` (no zone). |
| R2-043 | SignedProperties digest | Second `ds:DigestValue` = base64( **hex-string**( SHA-256( UTF-8 bytes of the `xades:SignedProperties` element rendered exactly as the SDK template: 4-space pretty print, `<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id="xadesSignedProperties">` at column 0, children starting at 36 spaces, closing tag at 32 spaces, `xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` on **every** `ds:*` element, `<ds:DigestMethod .../>` self-closed, LF line ends, no trailing newline ) ) ) → 88-char value. | S1 samples + jar template; D5 §5.2 step 5 ("linearize and remove spaces", HEX-to-Base64) | | SIGNATURE | **VERIFIED-BY-SDK (reproduced 19/19)**; D5 wording ("remove the spaces", 44-char example) does NOT match SDK output | Exact hashed bytes per sample dumped in `R2-reference-samples/derived/*.signedproperties-hashed-text.xml`. Real C14N of the element does NOT reproduce it. |
| R2-044 | CertDigest | `xades:CertDigest/ds:DigestValue` = base64( hex-string( SHA-256( the **base64 text** of the certificate as it appears in `ds:X509Certificate`, not the DER bytes ) ) ) → 88 chars. | S1 samples; D5 §5.2 step 3 ("hash the certificate… encode using base64" with 88-char example) | | SIGNATURE | VERIFIED-BY-SDK (reproduced 19/19) | |
| R2-045 | IssuerSerial | `ds:X509IssuerName` = issuer DN in RFC 2253-style order as in samples: `CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local`; `ds:X509SerialNumber` = decimal serial (e.g. `379112742831380471835263969587287663520528387`). | S1 samples; D5 §5.2 step 4 | | SIGNATURE | VERIFIED-BY-SDK | Issuer naming per environment: RECALLED-UNVERIFIED (`TSTZATCA…`/`PRZEINVOICESCA…`/production CA) — only the simulation CA name is evidenced. |
| R2-046 | Signing time / signer | Claimed signing time from the EGS clock; private key non-exportable, FIPS 186 key generation, key protected; signature level B-B; full chain to trust anchor "shall be included" (D3) — samples include only the end-entity certificate and pass. | D3 §2.2.1 req 6,8,9,13,15,17 pp.11–12 | | SIGNATURE/OPS | VERIFIED-FROM-SOURCE | |
| R2-047 | Certificate revocation checks | CRL valid 7 days ⇒ EGS may run fully offline for 7 days before refreshing CRL; check validity before stamping; OCSP/CRL published by ZATCA CA. | D3 §2.2.1 req 14 p.12; §2.1.3 | | OPS | VERIFIED-FROM-SOURCE | |
| R2-048 | Certificate profile | X.509 v3; serial ≥64 bits entropy; SHA256-ECDSA; NotAfter up to 60 months; Key Usage digitalSignature+keyEncipherment (critical); EKU clientAuth; CRL DP, AIA (OCSP/CA issuer), SKI/AKI. Sample dummy cert (openssl decode): issuer `DC=local, DC=gov, DC=extgazt, CN=PRZEINVOICESCA4-CA`, serial 20 bytes, ecdsa-with-SHA256, valid 2024-01-11→2029-01-09 (5 years), secp256k1, **Key Usage = digitalSignature only (critical)** — not keyEncipherment as D3 says —, EKU = Code Signing + TLS Web Client Authentication, SAN DirName `/SN=1-TST\|2-TST\|3-<uuid>/UID=<VAT>/title=1100/registeredAddress=…/businessCategory=…`, MS certificate-template extensions 1.3.6.1.4.1.311.21.7 / .21.10 (the CSR carries template name OID 1.3.6.1.4.1.311.20.2). | D3 §2.2.2 pp.13–15; S1 `Data/Certificates/cert.pem` (decoded) | | SIGNATURE/ONBOARDING | VERIFIED-FROM-SOURCE + SDK | A CSID "remains valid for multiple years" (D5 FAQ p.78). |
| R2-050 | CSR subject | PKCS#10 signed with the EGS private key (proof of possession); subject: C=SA (ISO 3166 alpha-2), OU = branch name (VAT group: 10-digit TIN of the member; group detected by 11th digit of VAT number = 1), O = taxpayer name, CN = unique EGS name/asset tracking number; SAN DirName: SN = `1-<manufacturer/solution name>\|2-<model/version>\|3-<serial/UUID>`, UID = 15-digit VAT (3…3), title = 4-digit functionality map `TSCZ` (1000 standard only, 0100 simplified only, 1100 both; C,Z future use = 0), registeredAddress = location (short national address), businessCategory = industry. All fields mandatory. | D3 Table 1 pp.15–17; D5 §3.3.3 pp.26–29; S1 CSR config + generated CSR (openssl decode) | | ONBOARDING | VERIFIED-FROM-SOURCE + SDK | SDK property names: `csr.common.name, csr.serial.number, csr.organization.identifier, csr.organization.unit.name, csr.organization.name, csr.country.name, csr.invoice.type, csr.location.address, csr.industry.business.category`. |
| R2-051 | CSR certificate template | Extension `1.3.6.1.4.1.311.20.2` (certificateTemplateName, PrintableString): `TSTZATCA-Code-Signing` (developer/sandbox, SDK `-nonprod`), `PREZATCA-Code-Signing` (simulation, SDK `-sim`), `ZATCA-Code-Signing` (production, SDK default). | D7 §3 p.31 (openssl `ASN1:PRINTABLESTRING:ZATCA-Code-Signing` / `PREZATCA-Code-Signing`); S1 (three CSRs generated and decoded) | | ONBOARDING | VERIFIED-FROM-SOURCE + SDK | |
| R2-052 | Onboarding sequence | (1) Taxpayer logs into Fatoora portal (ERAD SSO; TRN Active/Reactive) → "Onboard new solution unit/device" → generate 1–100 OTPs, **valid 1 hour**, six digits, no API for OTP; (2) EGS builds key pair + CSR, calls Compliance CSID API with OTP → compliance CSID (`binarySecurityToken`) + secret + request id; (3) EGS runs compliance checks: submit sample documents per functionality map — 1000: standard invoice, debit, credit; 0100: simplified invoice, debit, credit; 1100: all six — through the Compliance Invoice API using Basic auth (compliance CSID:secret); (4) Production CSID API with the compliance request id → production CSID + secret; failure of any check ⇒ restart from a new OTP + CSR. | D5 §3.2–3.3 pp.13–31, FAQ p.76; D6 §2.3.10, §3 p.68 | | ONBOARDING | VERIFIED-FROM-SOURCE | Exact JSON field names of the CSID responses: see R2-062 (partly RECALLED). |
| R2-053 | Renewal / revocation | Renewal = same flow (OTP + CSR + compliance checks) via the Production CSID **renewal** API; the CA revokes the old CSID and issues a new one; portal sends expiry reminders. Revocation by taxpayer via portal (compromise, decommission, inaccurate data, loss, unauthorised onboarding, major upgrade) or automatically on VAT deregistration/suspension (joining a VAT group ⇒ group must re-onboard all EGS under the group TRN). | D5 §3.2.2–3.2.3, §3.3.7–3.3.8, §4.2; D3 §2.1.2–2.1.3 | | ONBOARDING/OPS | VERIFIED-FROM-SOURCE | Renewal window ("before expiry") — no fixed number of days found in sources. |
| R2-054 | Environments / base URLs | Production: `https://gw-fatoora.zatca.gov.sa/e-invoicing/core/{compliance \| compliance/invoices \| production/csids \| invoices/reporting/single \| invoices/clearance/single}`. Simulation: same with `/e-invoicing/simulation/…`. Developer portal (sandbox) integration: `/e-invoicing/developer-portal/…` (host `gw-fatoora.zatca.gov.sa`, seen in portal config). Simulation and production are independent environments (separate onboarding). | D7 §3 pp.30–31; S3 env-config (`developer-portal` paths) | | API | VERIFIED-FROM-SOURCE | Developer-portal full endpoint paths: only `/invoices/reporting/single`, `/compliance` and `complianceCert-api` fragments seen in the bundle; assume same relative paths (RECALLED-UNVERIFIED for the prefix). |
| R2-055 | Auth & headers | HTTP Basic auth: username = CSID (`binarySecurityToken`, base64), password = secret; `Authorization: Basic base64(CSID:secret)`; header `accept-version: v2` mandatory ("V2 is currently the only valid version"); `accept-language` header (en/ar) passed; `Content-Type: application/json`. Compliance CSID call carries the OTP (Swagger "Insert valid OTP"). | D6 §3 p.68, §2.3.10, §4.2.4 Q2/Q6; D3 §5 p.27 | | API | VERIFIED-FROM-SOURCE | Exact header name for the OTP (`OTP`) and the clearance toggle header `Clearance-Status: 1`: RECALLED-UNVERIFIED (not in any obtained document). |
| R2-056 | Request body | Reporting/Clearance/Compliance-invoice body: `{"invoiceHash": "<base64 invoice hash>", "uuid": "<cbc:UUID>", "invoice": "<base64 of the exact signed XML bytes>"}` — SDK `-invoiceRequest` emits exactly these three keys; D6 FAQ shows `invoiceHash` + `invoice`. One document per call; no bulk API. | S1 (`-invoiceRequest` output verified); D6 §4.2.4 Q3/Q7; D5 FAQ p.72 | | API | VERIFIED-BY-SDK + SOURCE | |
| R2-057 | Response codes | 200 accepted; 202 accepted with warnings (do not resubmit; fix for future); 303 clearance disabled → use Reporting API for standard documents (no stamp/QR returned); 400 rejected (errors listed; fix and submit a **new** document with new UUID/ICV/hash); 401 unauthorized (check CSID/secret); 413 payload too large (~10 MB limit); 429 too many requests → resend; 500/503/504 → resend (document not received). | D4 p.52 table & FAQ p.60; D6 §4.2.4 Q9/Q10; D5 FAQ pp.70,77 | | API | VERIFIED-FROM-SOURCE | Explicit retry/back-off intervals, rate limits and timeouts: not published in the obtained documents (RECALLED-UNVERIFIED). |
| R2-058 | Validation outcome semantics | Error ⇒ whole document rejected; warning ⇒ accepted but non-compliant (only "seller address" class and a growing list of rule-warnings); repeated warnings investigated/penalised; KSA rules override EN rules; ZATCA stores accepted documents (and hashes of rejected ones). | D5 §4.3 pp.47–48, FAQ p.70; D4 pp.53–55 | | API/OPS | VERIFIED-FROM-SOURCE | |
| R2-059 | Clearance output | For standard documents ZATCA applies its own stamp and generates/updates the QR and returns the document; the **cleared document (with ZATCA stamp + QR) is the valid tax invoice to give the buyer**; seller's own stamp/QR optional on standard documents (ZATCA then adds a second stamp). Clearance does not change the document hash, so the next document can be generated without waiting. | D5 §4.3.2 pp.50–51, FAQ p.72; D4 FAQ p.59 | | API/OPS | VERIFIED-FROM-SOURCE | Field name `clearedInvoice` (base64 XML) in the JSON response: RECALLED-UNVERIFIED. |
| R2-060 | Reporting timing | Simplified documents reported within **24 hours** of issue (SDK BR-KSA-98 warns when IssueDate+IssueTime older than 24 h); seller must include its own stamp and QR; ZATCA does not stamp simplified documents. Continuous-supply simplified invoices: notify at end of supply month. Tax invoices may be issued within 15 days after the month of supply but must be cleared before being given to the buyer. | D5 §4.3.1 p.49; D4 pp.52,59, FAQ p.59; S1 BR-KSA-98 | | OPS | VERIFIED-FROM-SOURCE + SDK | |
| R2-061 | Rejections & chaining | After a rejection: keep the rejected document's hash/ICV (never reuse), generate a new document with new UUID, ICV, hash, timestamp; its PIH = hash of the immediately preceding generated document (which may be the rejected one). Simplified: original was already issued, keep transaction in VAT return; standard: non-cleared invoice is not a valid tax invoice — reissue with updated date. Duplicate submission is not rejected by the API but ZATCA counts the invoice once (UUID + hash). `NOT_REPORTED` status ⇒ invoice invalid, cancel via credit note and reissue. | D5 FAQ pp.70–71,76–77 | | OPS | VERIFIED-FROM-SOURCE | Status strings `REPORTED`/`NOT_REPORTED`, `CLEARED`/`NOT_CLEARED`: only `NOT_REPORTED` evidenced (D5 p.76); the others RECALLED-UNVERIFIED. |
| R2-062 | Response JSON | V2 responses: `validationResults` {`infoMessages[]`, `warningMessages[]`, `errorMessages[]` (each `{type,code,category,message,status}`), `status`}, `reportingStatus` / `clearanceStatus`, `clearedInvoice` (clearance only), `qrSellertStatus`/`qrBuyertStatus` (clearance); CSID responses: `requestID`, `dispositionMessage`, `binarySecurityToken`, `secret`, `errors`; Production CSID request: `{"compliance_request_id": "<requestID>"}`. | — (Swagger not obtained) | — | API | **RECALLED-UNVERIFIED** except: `binarySecurityToken` & `secret` (D6 §2.3.10 steps 6: "obtain the binarySecurityToken to be used as the Username and secret as the Password" — VERIFIED), "compliance request ID" as the production-CSID input (D6 §2.3.10.3 step 9 — VERIFIED concept), the Release-1 sandbox shape `{invoiceHash,status,warnings,errors}` (D6 §4.2.4 — VERIFIED but old). | Stream D must mock these shapes as unverified. |
| R2-063 | Failure / contingency | On EGS incidents hindering generation, notify ZATCA via the Failure Notification service (zatca.gov.sa/en/E-Invoicing/FailureNotifications/…); after recovery, clear/report all transactions of the downtime. CRL allows 7-day offline stamping (R2-047). | D5 FAQ p.77; D3 req 14 | | OPS | VERIFIED-FROM-SOURCE | |
| R2-064 | Compliance toolbox | SDK validates XSD + EN subset + KSA rules + QR + stamp + PIH offline; passing the SDK ≈ passing the API except API-specific/referential checks; sandbox does not store invoices and its acceptance is not approval. | D6 §4.1.4 Q2/Q3/Q10 | | OPS | VERIFIED-FROM-SOURCE | |
| R2-065 | Seller acceptance (self-billing) | Developer portal lists a "Seller Acceptance API (for Invoice Matching)": seller submits the QR of a self-billed standard document; "Seller and Buyer should be in a Self-Billing agreement approved by ZATCA (currently under development on ERAD)". | S2/S3 bundle strings (`sellerAcceptance*`, `swaggerLi10`) | | API | OBSERVED in portal bundle (not in PDFs) | Not documented in any obtained PDF; treat as emerging requirement. |
| R2-070 | QR (phase 1 vs 2) | QR base64 TLV ≤ 700 chars (D3) / field ≤1000 chars (SDK rule). Tags 1–5 mandatory since 2021-12-04 (phase 1); tags 6–8 from 2023-01-01 (phase 2, in waves); tag 9 for simplified documents only. TLV: 1-byte tag, 1-byte length (UTF-8 byte count), value. | D3 §4 pp.25–26; D5 §6 pp.58–63 | | QR | VERIFIED-FROM-SOURCE | |
| R2-071 | QR tag values | 1 seller name (BT-27); 2 seller VAT (BT-31); 3 `IssueDate + 'T' + IssueTime` (samples: no `Z`; D3/D5 examples with `Z`); 4 `TaxInclusiveAmount` (BT-112) text; 5 `cac:TaxTotal/cbc:TaxAmount` (BT-110) text; 6 invoice hash **base64 text** (44 bytes); 7 `ds:SignatureValue` **base64 text** (e.g. 96 bytes); 8 **raw DER** SubjectPublicKeyInfo of the signing key (88 bytes secp256k1, bytes `30 56 30 10 06 07 2a 86 48 ce 3d 02 01 06 05 2b 81 04 00 0a 03 42 00 04 …`); 9 **raw DER** ECDSA signature of the CSID certificate (the CA's signature over the cert, 70–72 bytes) — simplified only; for standard documents ZATCA's clearance supplies the QR. | D5 §6.2 worked example (hex) + XPath table pp.60–62; S1 samples (decoded and matched); D3 Table 3 | | QR | VERIFIED-FROM-SOURCE + SDK | D3's "tag 6 length 32 bytes" statement contradicts both D5 and the SDK (44); SDK is operative. SDK emits tags 1–8 for standard documents when asked (`-qr`), never tag 9. |
| R2-072 | QR common mistakes | Tag/length are binary bytes (not ASCII digits), values converted to bytes before base64, no separators/padding between TLVs, UTF-8 for Arabic. | D5 §6.3 p.64 | | QR | VERIFIED-FROM-SOURCE | |
| R2-073 | Platform QR check | Simplified-document QR tags are checked against XML values by the SDK (seller name, VAT, timestamp, totals, hash, signature, public key) — error codes `sellerName`, `hashedXml`, etc. | S1 run (`[QR] validation … CODE : sellerName / hashedXml`) | | QR | VERIFIED-BY-SDK | |

## 3. Mandatory-element matrix (Data Dictionary v1.2, 2023-05-19; columns = Tax invoice / Tax debit / Tax credit / Simplified invoice / Simplified debit / Simplified credit; M mandatory, O optional, C conditional, NA not applicable)

| Term | Element | Status (TI/TDN/TCN/SI/SDN/SCN) | Notes |
|---|---|---|---|
| BT-23 | cbc:ProfileID | M/M/M/M/M/M | `reporting:1.0` |
| BT-1 | cbc:ID | M×6 | 1–127 |
| KSA-1 | cbc:UUID | M×6 | |
| BT-2 / KSA-25 | cbc:IssueDate / cbc:IssueTime | M×6 | |
| BT-3 / KSA-2 | cbc:InvoiceTypeCode / @name | M×6 | |
| BT-22 | cbc:Note | O×6 | ≤1000 |
| BT-5 / BT-6 | cbc:DocumentCurrencyCode / cbc:TaxCurrencyCode | M×6 | BT-6 = SAR |
| BT-13 / BT-12 | OrderReference/ID, ContractDocumentReference/ID | O×6 | BT-12 mandatory for B2G (SDK) |
| BT-25 | BillingReference/InvoiceDocumentReference/ID | NA/M/M/NA/M/M | |
| KSA-16 ICV, KSA-13 PIH, KSA-14 QR, KSA-15 stamp | AdditionalDocumentReference ICV/PIH/QR; UBLExtensions | M×6 (QR/stamp: ZATCA-applied for standard) | |
| BT-29 | Seller PartyIdentification/ID @schemeID | M×6 | |
| BT-35, KSA-17, BT-37, BT-38, KSA-3, BT-40 | Seller street, building no., city, postal code, district, country | M×6 | BT-36, KSA-23, BT-39 optional |
| BT-31 | Seller VAT CompanyID | M×6 | |
| BT-27 | Seller RegistrationName | M×6 | |
| BT-46 | Other buyer ID | C×6 | mandatory on 01 when BT-48 absent; NAT for EDU/HEA |
| BT-50, BT-52, BT-55 | Buyer street, city, country | M/M/M/O/O/O | |
| KSA-18, BT-53, KSA-4 | Buyer building no., postal code, district | C/C/C/O/O/O | mandatory when buyer country = SA |
| BT-48 | Buyer VAT | C/C/C/O/O/O | |
| BT-44 | Buyer name | M/M/M/C/C/C | |
| KSA-5 / KSA-24 | ActualDeliveryDate / LatestDeliveryDate | C×6 | KSA-5 mandatory for 388/01 |
| BT-81 | PaymentMeansCode | O×6 | |
| KSA-10 | PaymentMeans/InstructionNote | NA/M/M/NA/M/M | |
| KSA-22, BT-84 | PaymentNote, PayeeFinancialAccount/ID | O×6 | |
| BG-20/BG-21 doc allowances/charges (BT-92…105, KSA-21) | cac:AllowanceCharge | C×6 | |
| BT-106, BT-109, BT-110, BT-112, BT-115 (+currency) | LegalMonetaryTotal / TaxTotal | M×6 | |
| BT-107, BT-108, BT-111 | AllowanceTotalAmount, ChargeTotalAmount, TaxTotal in SAR | C×6 | |
| BT-113, BT-114 | PrepaidAmount, PayableRoundingAmount | O×6 | |
| BT-116, BT-117, BT-118, KSA-21 | TaxSubtotal taxable/tax/category/scheme | M×6 | |
| BT-119 | VAT category rate | C×6 (mandatory except O) | |
| BT-120, BT-121 | exemption reason text / code | C×6 | Z/E/O only |
| BT-126, BT-129, BT-131, BT-153, BT-146, BT-151, BT-152, KSA-21 | line id, qty, net amount, item name, net price, category, rate, scheme | M×6 | |
| KSA-11 | line VAT amount | M/M/M/O/O/O | |
| KSA-12 | line amount incl. VAT | M×6 | |
| KSA-26…KSA-34 | prepayment reference & breakdown | C×6 | when BT-113 > 0 |
| BT-130, BT-149/150, BT-155/156/157, BT-136…145 | unit code, base qty, item ids, line allowances/charges | O/C | |
| BT-147/BT-148 | price discount / gross price | C×6 | price-level charge not allowed |

Terms present in the SDK rules but **absent from the 2023 Data Dictionary**: BT-56/57/58 (buyer contact), KSA-35 (contact note), KSA-36…39 (tax exchange rate), KSA-40 (`cbc:CompanyLegalForm`), KSA-41/42 (prepayment exemption code/text), B2G/continuous-supply flags. (`R2-work/data-dictionary-2023-condensed.txt` has every row.)

## 4. VAT category and exemption-reason codes (D1 §11.2.4 + SDK list `BR-KSA-CL-04`)

| Category | Code | English text (must match BR-KSA-83 check) | Source |
|---|---|---|---|
| E Exempt | VATEX-SA-29 | Financial services mentioned in Article 29 of the VAT Regulations | D1 + SDK |
| E | VATEX-SA-29-7 | Life insurance services mentioned in Article 29 of the VAT Regulations | D1 + SDK |
| E | VATEX-SA-30 | Real estate transactions mentioned in Article 30 of the VAT Regulations | D1 + SDK |
| S Standard | — (15 or 5) | no reason code/text allowed (BR-S-10) | D1 + SDK |
| Z Zero | VATEX-SA-32 | Export of goods | D1 + SDK |
| Z | VATEX-SA-33 | Export of services | D1 + SDK |
| Z | VATEX-SA-34-1 … 34-5 | The international transport of Goods / international transport of passengers / services directly connected and incidental to a Supply of international passenger transport / Supply of a qualifying means of transport / Any services relating to Goods or passenger transportation, as defined in article twenty five of these Regulations | D1 + SDK |
| Z | VATEX-SA-35 | Medicines and medical equipment | D1 + SDK |
| Z | VATEX-SA-36 | Qualifying metals | D1 + SDK |
| Z | VATEX-SA-EDU | Private education to citizen (buyer name + NAT id mandatory) | D1 + SDK |
| Z | VATEX-SA-HEA | Private healthcare to citizen (idem) | D1 + SDK |
| Z | VATEX-SA-MLTRY | supply of qualified military goods | D1 + SDK |
| Z | VATEX-SA-DIPLOMAT, VATEX-SA-DUTYFREE | (SDK list only; no official text in D1) | SDK only |
| Z | VATEX-SA-ROYALDECREE | Supply on which the Government bears the VAT | SDK 3.4.2 release note + XSL |
| Z | VATEX-SA-32(bis) | Supply under Customs Suspension Arrangement | SDK 3.4.2 release note + XSL |
| O Not subject | VATEX-SA-OOS | free text reason provided by the taxpayer | D1 + SDK |

Arabic texts are in D1 pp.32–33 (sample files carry "English | Arabic" strings).

## 5. Business rules as implemented by SDK 238-R3.4.8 (flag = SDK severity; test = XPath, see `R2-work/rules-*-with-tests.txt` for the full expressions)

### 5.1 KSA rules (`20210819_ZATCA_E-invoice_Validation_Rules.xsl`) — 157 assertions, 52 error / 105 warning

| Rule | Flag | Content (formula where arithmetic) |
|---|---|---|
| BR-KSA-03 | error | UUID present, `^[\w.-]+` |
| BR-KSA-04 | error | IssueDate ≤ current date |
| BR-KSA-05 | error | type code ∈ {388,383,381,386} |
| BR-KSA-06 | error | @name = NNPNESB(C)(G), 7/8/9 chars, NN ∈ {01,02}, flags 0/1 |
| BR-KSA-07 | error | export (pos5=1) ⇒ pos7 ≠ 1 |
| BR-KSA-08 | warning | seller id schemeID ∈ {CRN,MOM,MLS,SAG,OTH,700}, alphanumeric |
| BR-KSA-09 | warning | seller address: street, building no., city, postal zone, district, country |
| BR-KSA-10 | warning | buyer (non-SA / 01 docs): street, city, country present |
| BR-KSA-11 | error | O line ⇒ rate 0 |
| BR-KSA-12 / 13 | warning | O doc allowance / charge ⇒ rate 0 |
| BR-KSA-14 | error | buyer id schemeID ∈ {TIN,NAT,IQA,PAS,CRN,MOM,MLS,700,SAG,GCC,OTH} |
| BR-KSA-15 | warning | 388 & 01 ⇒ ActualDeliveryDate present |
| BR-KSA-16 | warning | payment means code in UNTDID 4461 subset |
| BR-KSA-17 | error | 381/383 ⇒ InstructionNote present |
| BR-KSA-18 | error | category ∈ {S,Z,E,O} |
| BR-KSA-19/20 | warning | doc / line charge has reason code |
| BR-KSA-21/22 | warning | doc / line charge has reason text |
| BR-KSA-23/24/69 | warning | E / O / Z breakdown has exemption reason code |
| BR-KSA-25 | warning | 02 + EDU/HEA ⇒ buyer name |
| BR-KSA-26 | warning | PIH present, text/plain (method per R2-040) |
| BR-KSA-27 | warning | QR present, text/plain |
| BR-KSA-28 | error | SignatureInformation/cbc:ID = …signature:1 |
| BR-KSA-29 | warning | ReferencedSignatureID & cac:Signature/cbc:ID = …signature:Invoice |
| BR-KSA-30 | error | cac:Signature/SignatureMethod = …dsig:enveloped:xades |
| BR-KSA-31 | error | 02 ⇒ pos7 = 0 (no self-billing) |
| BR-KSA-33/34 | error | ICV present / digits only |
| BR-KSA-35/36 | warning | LatestDeliveryDate ⇒ ActualDeliveryDate present and ≤ |
| BR-KSA-37 | warning | seller building number `^[0-9]{4}$` |
| BR-KSA-39 | error | seller VAT present with TaxScheme VAT |
| BR-KSA-40 | error | seller VAT `^[0-9]{15}$`, starts/ends with 3 |
| BR-KSA-42 | warning | buyer name present (01) |
| BR-KSA-44 | error | buyer VAT if present: 15 digits 3…3 |
| BR-KSA-49 | error | EDU/HEA ⇒ buyer id schemeID = NAT |
| BR-KSA-51 | warning | KSA-12 = round((KSA-11 + BT-131)·100)/100 |
| BR-KSA-52/53 | error | every line has TaxTotal/TaxAmount and RoundingAmount |
| BR-KSA-56 | warning | 381/383 ⇒ InvoiceDocumentReference/ID present |
| BR-KSA-60 | warning | 02 ⇒ cac:Signature exists |
| BR-KSA-61 | warning | PIH present |
| BR-KSA-63 | warning | buyer country SA ⇒ street, building, postal, city, district, country |
| BR-KSA-66 / 67 | warning | seller / buyer(SA) postal code 5 digits |
| BR-KSA-68 | error | TaxCurrencyCode present |
| BR-KSA-70 | error | IssueTime `hh:mm:ss[Z]` |
| BR-KSA-71 / 72 | warning / error | 02 summary ⇒ buyer name / supply date + end date |
| BR-KSA-73 | warning | prepaid ⇒ line DocumentReference ID, IssueDate, IssueTime, DocumentTypeCode |
| BR-KSA-74 | error | DocumentTypeCode = 386 |
| BR-KSA-75 | warning | prepayment line has subtotal taxable, tax, category, percent |
| BR-KSA-76/77/78 | warning | prepayment Z/E/O ⇒ rate 0 |
| BR-KSA-79 | warning | KSA-32 = round-half-up(KSA-31 × KSA-34/100, 2) ± 0.01 |
| BR-KSA-80 | warning | BT-113 (#.00) = Σ KSA-31 + Σ KSA-32 (#.00) |
| BR-KSA-81 | warning | 01 and no buyer VAT ⇒ buyer PartyIdentification/ID present |
| BR-KSA-82 | error | prepayment line: LineExtensionAmount, TaxAmount, RoundingAmount, PriceAmount, AllowanceCharge/Amount = 0 |
| BR-KSA-83 | warning | Z/E/O reason text matches official text (code+text, spaces removed, min length) |
| BR-KSA-84 | error | S rate ∈ {15, 5} |
| BR-KSA-85 | warning | buyer phone `^(?:0\|\+)[0-9]{4,15}$` |
| BR-KSA-86 | warning | buyer e-mail regex (`;`-separated allowed) |
| BR-KSA-87 | warning | TaxExchangeRate ⇒ source, target, rate present |
| BR-KSA-88 / 89 | error | source currency = BT-5 / target = BT-6 |
| BR-KSA-90 | error | CalculationRate ≤ 14 characters |
| BR-KSA-91 | warning | CompanyLegalForm, if present, = GOV |
| BR-KSA-92 | error | B2G ⇒ ContractDocumentReference/ID present |
| BR-KSA-93/94/95 | warning | prepayment Z/E/O ⇒ exemption code |
| BR-KSA-96 | warning | prepayment Z/E/O ⇒ exemption text |
| BR-KSA-97 | warning | TaxTotal[with subtotals]/TaxAmount ≠ TaxTotal[without]/TaxAmount (non-SAR) |
| BR-KSA-98 | warning | 02 and now − IssueDateTime > 24 h |
| BR-KSA-99 | warning | buyer CompanyID tag present but empty |
| BR-CUSTOM-VALIDATION-01 | error | seller VAT ≠ buyer VAT |
| BR-CL-KSA-14 | error | QR length 1–1000 |
| BR-KSA-CL-01 | error | currency codes ISO 4217 (list) |
| BR-KSA-CL-02 | error | all currencyID = DocumentCurrencyCode (BT-111 excluded) |
| BR-KSA-CL-03 | error | mimeCode in subset |
| BR-KSA-CL-04 | warning | exemption code valid for category (Z/E/O lists) |
| BR-KSA-CL-06 | warning | charge reason code in UNTDID 7161 |
| BR-KSA-CL-07 | warning | prepayment exemption code valid for category |
| BR-KSA-DEC-01 | error | allowance % 0–100, ≤2 dp, no '%' |
| BR-KSA-DEC-02 | error | VAT rates 0–100, ≤2 dp |
| BR-KSA-DEC-03/04 | warning | KSA-11 / KSA-12 ≤2 dp |
| BR-KSA-DEC-06 | warning | KSA-31/32 ≤2 dp |
| BR-KSA-EN16931-01 | error | ProfileID = reporting:1.0 |
| BR-KSA-EN16931-02 | error | TaxCurrencyCode = SAR |
| BR-KSA-EN16931-03 | warning | Amount(#.00) = floor(Base × pct/100 × 100 + 0.5)/100 (half-up) |
| BR-KSA-EN16931-04/05 | warning | percentage ⇔ base amount |
| BR-KSA-EN16931-06 | error | Price/AllowanceCharge/ChargeIndicator must be false |
| BR-KSA-EN16931-07 | error | PriceAmount = BaseAmount − Amount (price discount) |
| BR-KSA-EN16931-08 | warning | exactly one TaxTotal with subtotals |
| BR-KSA-EN16931-09 | warning | exactly one TaxTotal without subtotals when TaxCurrencyCode present |
| BR-KSA-EN16931-11 | warning | BT-131 = round(trunc2(qty × price[/baseQty]) + Σ charges − Σ allowances, 2) ± 0.01 |
| BR-KSA-EN16931-12 | error | BaseQuantity > 0 |
| BR-KSA-F-01 | error | dates `YYYY-MM-DD` (IssueDate, DueDate, delivery dates, billing ref date, prepayment date, TaxPointDate) |
| BR-KSA-F-02 | error | ChargeIndicator ∈ {true,false} |
| BR-KSA-F-04 | error | listed amounts/quantities ≥ 0 |
| BR-KSA-F-05 | warning | prepayment IssueTime castable as xs:time |
| BR-KSA-F-06-C1…C40 | mostly warning (C17, C22 error) | character limits (see R2-032) |
| BR-KSA-F-07/08/09/10/11 | warning | TIN / CRN / 700 / NAT / IQA value formats |
| BR-KSA-F-12 / F-13 | warning | schemeID spaces / invalid ID pattern |
| BR-KSA-F-C-01 | warning | item name numeric-only or trivial sequences |

PDF-only rules not implemented in the SDK XSL: BR-KSA-46 (export ⇒ no buyer VAT), BR-KSA-F-03 (no empty elements). PDF rule BR-O-13 (O breakdown ⇒ no non-O allowances) is listed in D1 but not in the SDK EN XSL.

### 5.2 EN 16931 subset (`CEN-EN16931-UBL.xsl`) — 109 assertions, 104 unique ids

Errors: BR-03, BR-04, BR-05, BR-14, BR-15, BR-16, BR-22, BR-24, BR-26, BR-31, BR-32, BR-41, BR-45, BR-46, BR-47, BR-48, BR-54, BR-55, BR-CL-01, BR-CL-03, BR-CL-04, BR-CL-05, BR-CL-18, BR-CO-04, BR-CO-11, BR-CO-12, BR-CO-14, BR-CO-15, BR-CO-18, BR-E-05, BR-E-06, BR-E-07, BR-E-09, BR-O-09, BR-S-06, BR-Z-05, BR-Z-06, BR-Z-07, BR-Z-09, BR-KSA-F-06-C17.
Warnings: BR-02, BR-06, BR-08, BR-09, BR-10 (01 documents only), BR-13, BR-21, BR-25, BR-36, BR-37, BR-43, BR-49 (01 only), BR-52, BR-53, BR-CL-14, BR-CL-16, BR-CO-10, BR-CO-13, BR-CO-16, BR-CO-17, BR-DEC-01/02/05/06/09…20/23/24/25/27/28, BR-E-01, BR-E-08, BR-O-01, BR-O-08, BR-S-01, BR-S-05, BR-S-07, BR-S-08, BR-S-09, BR-S-10, BR-Z-01, BR-Z-08, BR-KSA-F-06-C1/C2/C8/C10/C18/C19/C20/C27/C30/C31, BR-KSA-F-C-01.
Formulas (SDK): BR-CO-10 `BT-106 = round(Σ BT-131 ·100)/100`; BR-CO-11/12 `BT-107/108 = round(Σ amounts·100)/100` (or absent when no allowances/charges); BR-CO-13 `BT-109 = round((Σ BT-131 + BT-108 − BT-107)·100)/100`; BR-CO-14 `BT-110 = round(Σ BT-117 ·100)/100`; BR-CO-15 `BT-112 = round((BT-109 + Σ BT-117)·100)/100` (per document currency); BR-CO-16 `BT-115 = round((BT-112 − BT-113)·100)/100` (+ BT-114 handling); BR-CO-17 / BR-S-09 `|BT-117 − round(BT-116 × rate/100, 2)| ≤ 0.01 × count(InvoiceLine)` or exact; BR-S-08/Z-08/E-08/O-08 `BT-116 = Σ lines + Σ charges − Σ allowances` of the category (exact, no tolerance).

## 6. Arithmetic & precision summary

| Item | Rule | Precision / method | Source |
|---|---|---|---|
| Amounts (BT-*, KSA-11/12/31/32) | 2 decimals max | BR-DEC-*, BR-KSA-DEC-* | D1 §7.3, §13 |
| Unit price BT-146, quantity, percentages | no decimal restriction (BR-KSA-DEC-02 limits rates to 2 dp) | | D1 §7.3 |
| Rounding | half-up on the 3rd decimal; final results only; VAT total at document level | | D1 §10 |
| Line net | trunc/round product then ± allowances/charges; SDK ±0.01 | BR-KSA-EN16931-11 | SDK |
| Line VAT KSA-11 | no SDK formula (only ≤2 dp, non-negative, mandatory) — informative: BT-131 × rate/100 | | D1 §8.2; samples |
| Line incl. VAT KSA-12 | = BT-131 + KSA-11 (rounded) | BR-KSA-51 | SDK |
| Category taxable BT-116 | exact sum of the category's line nets ± doc allowances/charges | BR-S-08… | SDK |
| Category VAT BT-117 | round(BT-116 × rate/100, 2) with tolerance 0.01 × n_lines | BR-CO-17, BR-S-09 | SDK |
| Document VAT BT-110 | Σ BT-117 (rounded) | BR-CO-14 | SDK |
| Totals BT-109/112/115 | as in R2-027 | BR-CO-13/15/16 | SDK |
| Allowance/charge amount | base × pct/100, half-up | BR-KSA-EN16931-03 | SDK |
| Prepaid | BT-113 = Σ KSA-31 + Σ KSA-32 | BR-KSA-80 | SDK |
| Non-negative | all amounts/quantities ≥ 0 except PayableRoundingAmount and O-category taxable amounts | BR-KSA-F-04 | SDK |

## 7. Cryptographic parameters (verified)

| Parameter | Value | Verification |
|---|---|---|
| Hash | SHA-256 | D3 req 16; SDK |
| Signature | ECDSA with SHA-256 (`xmldsig-more#ecdsa-sha256`), DER-encoded signature value base64 | D2/SDK samples |
| Curve | secp256k1 (1.3.132.0.10) — CSR, dummy key, cert | SDK (openssl decode of CSR/cert); D3 says "P-256" (contradiction) |
| C14N | `http://www.w3.org/2006/12/xml-c14n11` (inclusive C14N 1.1) | D1/D2/D3/SDK |
| Invoice digest | base64(sha256(c14n(filtered doc))) — 44 chars | reproduced |
| SignedProperties digest | base64(hex(sha256(template text))) — 88 chars | reproduced |
| CertDigest | base64(hex(sha256(cert base64 text))) — 88 chars | reproduced |
| XAdES ns | `http://uri.etsi.org/01903/v1.3.2#`; UBL XAdES XSDs v1.3.2/v1.4.1 shipped | SDK XSDs |
| Signature packaging | enveloped, in `ext:UBLExtensions` (first child of Invoice) | SDK jar `addUBLElement.xsl` |
| Key storage | non-exportable, hardware or software module, activation data protected | D3 req 6, 8, 9 |

## 8. SDK sample coverage (all PASS offline, hashes in `R2-reference-samples/INDEX.md`)

Standard: invoice (0100000), credit (381), debit (383), export (0100100, USD, buyer OTH, Z/VATEX-SA-32), summary (0100010), third-party (0110000), self-billed (0100001), exempt (E/VATEX-SA-29-7), out-of-scope (O/VATEX-SA-OOS), document-level charge, payable rounding (−0.01), three prepayment-adjustment scenarios (incl. 5%/15% and USD). Simplified: invoice, credit, debit, nominal (0201000), zero-rated item (Z/VATEX-SA-35). All use ProfileID reporting:1.0, PIH = first-invoice value, seller VAT 399999999900003, CRN scheme.

## 9. Known pitfalls (how verified)

| # | Pitfall | Evidence |
|---|---|---|
| P1 | Removing the three excluded elements with a DOM `remove()` that also drops the following whitespace text node produces a different hash (`xmSwaAml…` instead of `z5F9qsS6…`). Keep the tail. | reproduced (R2-work run) |
| P2 | SignedProperties digest is NOT a C14N digest; it is the hex-then-base64 of the SDK's indented template text (R2-043). Real C14N (inclusive or exclusive) does not match. | reproduced on 19 samples |
| P3 | CertDigest is over the base64 text of the certificate, hex-then-base64. | reproduced |
| P4 | QR tag 6 and tag 7 carry ASCII base64 text; tags 8 and 9 carry raw DER bytes. Tag/length are binary bytes. | samples + D5 §6.2 hex dump |
| P5 | TLV length is one byte: seller name > 255 UTF-8 bytes cannot be encoded; QR field > 1000 chars rejected (BR-CL-KSA-14). | D3 §4, SDK |
| P6 | Java 16+ removed secp256k1: SDK signature stage fails on Java 21 ("Curve not supported"). Use JDK 11–14. | SDK run |
| P7 | JDK 11 default charset follows the OS locale; POSIX locale ⇒ Arabic bytes mangled ⇒ wrong hash and false QR/signature failures. Set `-Dfile.encoding=UTF-8`. | SDK run |
| P8 | SDK exit code is 0 even when GLOBAL VALIDATION RESULT = FAILED. | SDK run |
| P9 | SDK does not run QR/SIGNATURE stages for standard (`01…`) documents; PIH stage compares with the configured pih file only. | SDK run |
| P10 | PDF text vs SDK divergences: BR-KSA-EN16931-06 inverted; KSA-2 length 7 vs 7–9; BR-KSA-46 and BR-KSA-F-03 not in SDK; D3 profile elements (SignaturePolicyIdentifier, DataObjectFormat, SigningCertificateV2, Reference Type URI) absent from SDK template; D3 "tag 6 = 32 bytes" vs 44; D3 "P-256" vs secp256k1; D5 "linearize SignedProperties" vs indented template. | this register |
| P11 | IssueTime with fractional seconds (allowed by D1 §7.3) fails BR-KSA-70 in the SDK. | SDK regex |
| P12 | Rejected submissions keep their ICV/hash; the chain continues from the rejected document's hash. | D5 FAQ |
| P13 | A 202 means accepted — resubmitting creates a duplicate (not rejected, counted once by UUID/hash). | D4/D5 FAQ |

## 10. API / onboarding quick table

| Call | Environment path (prefix `https://gw-fatoora.zatca.gov.sa/e-invoicing/{core\|simulation}`) | Auth | Body | Verified |
|---|---|---|---|---|
| Compliance CSID | `/compliance` (POST) | none + OTP (header) | CSR (base64 PEM) | path/OTP: D7/D6; JSON keys: recalled |
| Compliance checks | `/compliance/invoices` (POST) | Basic compliance-CSID:secret, `accept-version: v2` | `{invoiceHash, uuid, invoice}` | D7 + SDK |
| Production CSID (onboarding) | `/production/csids` (POST) | Basic compliance-CSID:secret | `{compliance_request_id}` (recalled key) | D7/D6 |
| Production CSID (renewal) | `/production/csids` (PATCH) with OTP | Basic production-CSID:secret | CSR | path: D7; method PATCH: recalled |
| Reporting | `/invoices/reporting/single` (POST) | Basic production-CSID:secret, `accept-version: v2`, `accept-language`, (`Clearance-Status`: recalled) | `{invoiceHash, uuid, invoice}` | D7/D6/SDK |
| Clearance | `/invoices/clearance/single` (POST) | same | same; returns cleared document | D7/D6/D5 |
| Seller acceptance (self-billing QR) | (not published) | — | QR | portal strings only |

## 11. What could not be verified from sources (RECALLED-UNVERIFIED list for the consolidator)

`Clearance-Status` header; OTP header name; production-CSID request/response JSON keys (`compliance_request_id`, `requestID`, `dispositionMessage`); `validationResults`/`infoMessages`/`warningMessages`/`errorMessages` structure; `reportingStatus`/`clearanceStatus` values other than `NOT_REPORTED`; `clearedInvoice` field; HTTP method PATCH for renewal; rate limits, timeouts, retry/back-off; CSID renewal lead time; developer-portal API prefix `/e-invoicing/developer-portal/`; CA issuer DNs per environment other than `PRZEINVOICESCA4-CA` (simulation sample). These require the Swagger files (gateway download) or a sandbox session, both outside this audit's allowed network scope.

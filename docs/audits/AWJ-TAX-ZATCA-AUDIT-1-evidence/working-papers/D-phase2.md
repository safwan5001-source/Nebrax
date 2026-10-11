> **Working paper — unedited stream output.** Written before the official-source registers existed, so regulatory citations tagged `[official-ref to confirm]` were resolved afterwards; severities, normalised statuses, re-ratings and register citations in **AWJ-TAX-ZATCA-AUDIT-1.md** and **AWJ-TAX-ZATCA-GAP-MATRIX.md** prevail where they differ. Paths of the form `<audit-workspace>/…` refer to the audit workspace (probe sources, logs, SDK runs) that is not part of the repository; the relevant extracts are in `probe-outputs.md` and `sdk-validation-extracts.md`. **Superseded after review (PR #1290):** where a paper says the web UI was only read, or implies there is no web test suite, `web-test-results.md` and `web-test-mapping.md` give the results of the Vitest and Playwright runs; where a paper attributes a test failure to the sandbox, `test-results.md` shows the controlled attribution.

# Stream D — ZATCA Phase 2: invoice generation, hashing, signing, QR, credentials/onboarding

Audit: AWJ-TAX-ZATCA-AUDIT-1 · Repo `<repo>` @ `0534ef16543b01c69b416b58897337e012a9d1ab` (read-only) · Harness `<harness>` · Date 2026-10-10
Finding prefix `PH2-` · Probes `<audit-workspace>/probes/D/` · Work products `<audit-workspace>/work/D/` · Logs `<audit-workspace>/logs/`

**Headline.** AWJ's *invoice hash* is byte-for-byte identical to the official ZATCA SDK (19/19 official samples, 10/10 mutation cases) and the ICV/PIH chain is correctly serialised on PostgreSQL. Everything above the hash, however, is built to the generic XMLDSig/XAdES standards rather than to ZATCA's published profile: the official SDK 238-R3.4.8 rejects **every** invoice AWJ produces (18/18 shapes, unsigned and signed) at XSD, EN16931, KSA, QR, SIGNATURE stages. The UBL body is a skeleton (no TaxScheme/TaxCurrencyCode/seller address/CRN/tax breakdown/line tax/allowances…), the XAdES block uses the wrong element set and digest encodings, the ECDSA signature is computed over the wrong bytes and encoded in the wrong form, the Phase-2 QR tags 3/6/7/8 use the wrong encodings, credit/debit notes have no e-invoice at all, and no onboarding (CSR/OTP/CSID/compliance) exists. Nothing produced today could pass ZATCA compliance checks or be reported/cleared.

---

## 1. Scope & method

### 1.1 Files read in full (pinned repo; line counts)

| File | Lines |
|---|---|
| `app/Services/Accounting/ZatcaService.php` | 316 |
| `app/Services/Accounting/ZatcaInvoiceHasher.php` | 90 |
| `app/Services/Accounting/ZatcaXmlCanonicalizer.php` | 171 |
| `app/Services/Accounting/ZatcaInvoiceSigner.php` | 64 |
| `app/Services/Accounting/ZatcaXmlDsigSignedInfoBuilder.php` | 136 |
| `app/Services/Accounting/ZatcaXmlEcdsaSigner.php` | 222 |
| `app/Services/Accounting/ZatcaXadesSignedPropertiesBuilder.php` | 213 |
| `app/Services/Accounting/ZatcaXadesSignatureAssembler.php` | 331 |
| `app/Services/Accounting/ZatcaSignaturePolicy.php` / `ZatcaSignaturePolicyResolver.php` | 12 / 46 |
| `app/Services/Accounting/ZatcaSigningCredentialResolver.php` / `ZatcaSigningMaterial.php` / `ZatcaSigningReadiness.php` | 62 / 16 / 53 |
| `app/Services/Accounting/ZatcaSignedInvoiceFinalizer.php` | 132 |
| `app/Services/Accounting/ZatcaSignedInvoiceQrMaterialExtractor.php` | 534 |
| `app/Services/Accounting/ZatcaQrCertificateMaterialExtractor.php` / `ZatcaQrCredentialMaterialResolver.php` | 172 / 24 |
| `app/Services/Accounting/ZatcaPhaseTwoQrEncoder.php` | 104 |
| `app/Services/Accounting/ZatcaCredentialService.php` / `ZatcaCredentialMaterialValidator.php` | 147 / 372 |
| `app/Services/Accounting/ZatcaSubmissionService.php`, `ZatcaSubmissionDispatcher.php`, `ZatcaHttpTransport.php`, `ZatcaTransportCredentialResolver.php` (read for the credential/secret questions only; transport is out of my scope) | 149 / 120 / 138 / 55 |
| `app/Models/ZatcaCredential.php` | 30 |
| `app/Support/ZatcaIcvScope.php` | 104 |
| `config/zatca.php` | 64 |
| `app/Http/Controllers/Api/ZatcaCredentialController.php`, `ZatcaSettingsController.php`; `app/Http/Requests/UpdateZatcaCredentialRequest.php`, `UpdateZatcaSettingsRequest.php` | 30 / 50 / 34 / 51 |
| `database/migrations/2025_01_01_0000{12,13,129,130,131,132,133}_*` and `000053_branch_scoped_document_numbering.php` | 24/26/31/43/34/24/23/145 |
| `app/Services/Accounting/InvoiceService.php` (`post()` 880–1062, `zatcaDocumentType()` 429–447, `create()` keys) | 1285 |
| `app/Services/Accounting/CreditNoteService.php` (head + grep: zero ZATCA references) | 253 |
| Tests: `ZatcaTest`, `ZatcaPhase2Test`, `ZatcaInvoiceHasherTest`, `ZatcaInvoiceSignerTest`, `ZatcaSignedInvoiceFinalizerTest`, `ZatcaSignedInvoicePostingTest`, `ZatcaPhaseTwoQrEncoderTest`, `ZatcaQrCertificateMaterialExtractorTest`, `ZatcaQrCredentialMaterialResolverTest`, `ZatcaSignaturePolicyResolverTest`, `ZatcaSigningCredentialResolverTest`, `ZatcaSigningReadinessTest`, `ZatcaCredentialTest`, `ZatcaIcvScopeTest` (read in full); `ZatcaSignedInvoiceQrMaterialExtractorTest`, `ZatcaXadesSignatureAssemblerTest`, `ZatcaXadesSignedPropertiesBuilderTest`, `ZatcaXmlCanonicalizerContextTest`, `ZatcaXmlDsigSignedInfoBuilderTest`, `ZatcaXmlEcdsaSignerTest` (executed; assertions reviewed by name) | — |
| Project pattern for PG concurrency: `tests/Feature/InventoryStatePostgresConcurrencyTest.php` | 285 |

### 1.2 Official reference material actually used (all offline, no gateway traffic)

* **ZATCA E-Invoicing Java SDK 238-R3.4.8** (R2 download, sha256 `91d079b4…d1f6`): executed under JDK 11 (Temurin 11.0.32.1, R2 download) with `-Dfile.encoding=UTF-8` per `<audit-workspace>/official/R2-sdk-howto.md`. My wrapper: `<audit-workspace>/work/D/sdk/fatoora.sh`; configs `config.json` (SDK dummy cert) and `config-awj.json` (my synthetic cert as `certPath`, AWJ genesis PIH as `pihPath`). Validator stages decoded from the jar's bytecode (`javap -c -p`, dumps in `<audit-workspace>/work/D/sdk-javap/*.javap.txt`): `SignatureValidator`, `QrCodeValidator`, `QrGenerationService`, `HashingGenerationServiceImpl` (+ `invoice.xsl`, extracted to `<audit-workspace>/work/D/sdk-res/`), `SigningServiceImpl`, `DigitalSignatureServiceImpl`, `QRCodeGeneratorServiceImpl`, `ECDSAUtil`, `EcryptionUtils`, `PihValidator`, `Config`.
* **19 official sample invoices** bundled in the SDK (`Data/Samples/**`, copies in `<audit-workspace>/official/R2-reference-samples/`), incl. simplified/standard invoices, credit notes, debit notes, zero-rated, export, self-billing, summary, third-party, prepayment samples.
* **Official rule sets** bundled in the SDK: `20210819_ZATCA_E-invoice_Validation_Rules.xsl` (149 BR-KSA rule ids extracted), `CEN-EN16931-UBL.xsl`, and the SDK's UBL 2.1 XSD set (`UBL-XAdESv132-2.1.xsd`, `UBL-xmldsig-core-schema-2.1.xsd`, …).
* **ZATCA E-Invoicing Data Dictionary (2023 edition)** — R2 extract `<audit-workspace>/official/R2-work/data-dictionary-2023-condensed.txt` (M/O/C per document type).
* Where I cite the *XML Implementation Standard* or the *Security Features Implementation Standard* by name without a section number, the citation is tagged `[official-ref to confirm]`; the executable reference (SDK + samples + XSL rules) is what the evidence below rests on. `R1-regulatory-register.md` / `R2-technical-register.md` had not materialised when this file was written; the consolidator should reconcile rule ids against them.
* **Lead's independent SDK run** (`<audit-workspace>/official/R2-work/run-lead/`): AWJ unsigned standard + simplified XML → same XSD/EN/KSA/PIH failures as my S3; perturbation battery (`run-lead/arith/`) establishes the ERROR-vs-WARNING level of the arithmetic rules in this XSL set: **BR-CO-15 = ERROR**; BR-CO-10/-13/-16/-17, BR-S-08/-09, BR-KSA-51, BR-KSA-EN16931-11 = WARNING (BR-CO-17/BR-S-09 with a 0.01 × #lines tolerance). My own 18-file log agrees (split below, §3 PH2-04).

### 1.3 Tests and probes executed (exact commands, results)

| # | Command (from `<harness>`) | Result |
|---|---|---|
| T1 | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/D-run1.sqlite php artisan test --filter='Tests\\Feature\\Zatca'` (all 25 `Zatca*` classes) | **145 passed, 1346 assertions, 0 failed, 0 skipped**, 24.4 s — log `<audit-workspace>/logs/D-existing-tests-sqlite.log` |
| P1 | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/D-hasher.sqlite php artisan test <audit-workspace>/probes/D/DHasherOfficialSamplesProbeTest.php` | 2 passed — AWJ hash == embedded `DigestValue` for 19/19 samples; mutation hashes in `<audit-workspace>/work/D/sdk/awj-mut-hashes.txt` |
| P2 | `DB_CONNECTION=sqlite DB_DATABASE=<audit-workspace>/db/D-gen.sqlite php artisan test <audit-workspace>/probes/D/DGenerationProbeTest.php` | 1 passed — 18 invoices (9 shapes × unsigned/signed tenant) + 1 credit note posted through `InvoiceService::post`; dumps in `<audit-workspace>/work/D/out/` (`*.xml`, `*.qr.txt`, `manifest.json`) |
| P3 | `DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=5432 DB_DATABASE=audit_d DB_USERNAME=audit DB_PASSWORD=audit php artisan test <audit-workspace>/probes/D/DIcvPostgresConcurrencyProbeTest.php` (after `migrate:fresh --force` on `audit_d`, log `<audit-workspace>/logs/D-pg-migrate.log`) | 3 passed, 28 assertions — real two/six-process `pcntl_fork` races on PostgreSQL 16.15 |
| S1 | `<audit-workspace>/work/D/sdk/fatoora.sh -generateHash -invoice <each of 19 samples>` | SDK hash == embedded DigestValue 19/19 (`<audit-workspace>/work/D/sdk/sdk-hashes.txt`) |
| S2 | same on the 10 mutated files written by P1 (`<audit-workspace>/work/D/sdk/mut/*.xml`) | SDK == AWJ on 10/10 (`sdk-mut-hashes.txt` vs `awj-mut-hashes.txt`) |
| S3 | `SDK_CONFIG=config-awj.json fatoora.sh -validate -invoice <each of the 18 AWJ outputs>` | **18/18 GLOBAL VALIDATION RESULT = FAILED** — full log `<audit-workspace>/work/D/sdk/validate-awj-outputs.log`, condensed `validate-awj-outputs.summary.txt` |
| S4 | `xmllint --noout --nonet --schema UBL-Invoice-2.1.xsd <18 outputs>` | all fail (`<audit-workspace>/work/D/xsd-awj-outputs.log`). Caveat: xmllint also rejects the *official* samples (`X509SerialNumber` big-integer, a libxml2 limitation) — so the SDK's Xerces XSD result (S3) is the authoritative one; xmllint is quoted only for its error texts, which agree with the SDK on AWJ's defects |
| V1 | `php <audit-workspace>/work/D/verify_sig.php <signed output>` (my own DOM/openssl script, no AWJ classes) | AWJ signature VALID under XMLDSig semantics, INVALID under ZATCA-SDK semantics; official sample the exact opposite (see PH2-01) |
| Q1 | `php <audit-workspace>/work/D/tlv.php <qr files>` | TLV tag-by-tag decode of AWJ and official QRs (see PH2-03) |

Synthetic PKI (openssl, secp256k1, CA + leaf with `keyUsage=digitalSignature`, `extendedKeyUsage=clientAuth`, `CA:FALSE`, ZATCA-like SAN dirName) in `<audit-workspace>/work/D/pki/`; the leaf was stored through the real `ZatcaCredentialService::store()` with the synthetic CA as `zatca.trust_anchors.developer`. No real key, no real CSID, no network.

---

## 2. Positive controls (VERIFIED IMPLEMENTED)

**PC-1 — Invoice hash transform and canonicalisation are exactly ZATCA's.** `ZatcaInvoiceHasher::canonicalize()` removes `ext:UBLExtensions`, `cac:Signature`, the QR `cac:AdditionalDocumentReference` and comments (`ZatcaInvoiceHasher.php:37-57`), then `ZatcaXmlCanonicalizer` runs `xmllint --nonet --c14n11` (`ZatcaXmlCanonicalizer.php:35-37`), SHA-256, base64 (`:24-27`). The SDK does the same via `invoice.xsl` + Santuario C14N 1.1 (`HashingGenerationServiceImpl`). Evidence: P1 + S1: **19/19 official samples** give identical hashes (e.g. `Simplified_Invoice.xml` → `z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=` = embedded DigestValue = SDK); S2: 10/10 mutation cases (CRLF, attribute whitespace, comment, XML-declaration removal → unchanged; namespace-prefix rename, indentation, non-ASCII, empty-element → changed identically on both sides). Also every generated invoice's stored `zatca_hash` equals a re-hash of its stored XML (P2 manifest `hash`/`rehash`; `ZatcaTest::stored_hash_is_the_zatca_c14n11_sha256_of_the_stored_xml`). Independently confirmed by the lead on AWJ's own unsigned standard + simplified outputs (`run-lead/awj-*.hash` == SDK `-generateHash`).

**PC-2 — ICV allocation is serialised and gap-free on PostgreSQL.** `ZatcaService::buildFor()` takes `lockForUpdate()` on the tenant row (`ZatcaService.php:62-64`) inside the posting transaction (`InvoiceService.php:886`), reads `max(zatca_icv)` among hashed invoices (`:69-74`), and the unique index `(tenant_id, zatca_icv)` (`000053_...php:69`) backstops it. Evidence P3: six forked processes posting concurrently → ICVs exactly `[1,2,3,4,5,6]`, PIH chain verified link by link, per-process durations 101→489 ms (serialisation visible); a post that hits the unique index fails and the invoice stays `draft` with `zatca_icv=null`, `journal_entry_id=null` (full rollback); two tenants in parallel each get ICV 1. SQLite results (T1 `ZatcaPhase2Test`, `ZatcaIcvScopeTest`) agree.

**PC-3 — PIH is derived from the stored previous XML, not from a stored column.** `previousInvoiceHash()` re-hashes `$last->zatca_xml` (`ZatcaService.php:140-151`), so a legacy raw hash is re-canonicalised at the chain boundary (`ZatcaPhase2Test::legacy_raw_hash_is_recanonicalized_at_the_chain_boundary`), and the hash is invariant to the later QR/signature insertion (transform excludes them; `ZatcaSignedInvoiceFinalizer.php:63-68` re-verifies). Missing previous XML fails closed (`:146-148`).

**PC-4 — Credential storage hygiene.** Payload `encrypted:array` under APP_KEY (`ZatcaCredential.php:20`, migration `000131:18`), password re-authentication (`ZatcaCredentialService.php:31-33`), tenant-row lock against double insert (`:39`), application-state re-check inside the lock (`:43-50`), stage/CSID change requires a complete new set (`:61-73`), API returns booleans/fingerprint only (`publicMetadata()` `:124-146`), routes restricted to `company.manage` + `compliance.zatca` + throttle (`routes/api.php:1585-1590`). Validator (`ZatcaCredentialMaterialValidator.php`): private key ↔ certificate public-key match (`:46-53`), secp256k1/256-bit on both (`:25-44`), chain to a configured per-environment trust anchor with exactly one complete path (`:55-73`, `:152-196`), `CA:FALSE` (`:82-88`), `digitalSignature` (`:90-96`), `clientAuth` EKU exact OID (`:98-116`), not-before/not-after (`:118-130`). All 11 `ZatcaCredentialTest` tests pass (T1). My probe stored a synthetic CSID through this path (P2 output `[credential] stored … chain_len=2`).

**PC-5 — Fail-closed environment/credential resolution.** No fallback between environments (`ZatcaSigningCredentialResolver.php:22-34`), expired/incomplete material rejected before signing (`:36-53`), tenant context mandatory (`:17-20`), transport only with a *production*-stage CSID (`ZatcaTransportCredentialResolver.php:36-38`), developer environment has no endpoints (`config/zatca.php:40-54`). A signing failure rolls back the whole posting transaction — journal, ICV, status (`ZatcaSignedInvoicePostingTest::posting_fails_closed_and_rolls_back_financial_effects…`).

**PC-6 — The signature AWJ builds is internally sound as a generic XMLDSig/XAdES signature.** V1 (independent openssl/DOM script): `SignatureValue` verifies over inclusive-C14N(`SignedInfo`) with the leaf public key; `Reference[URI=""]` DigestValue equals base64(SHA-256(C14N11(doc − exclusions))); the assembler re-verifies after serialisation (`ZatcaXadesSignatureAssembler.php:107-116`, `:195-212`) and rejects DTDs, non-Invoice roots, id collisions, double signing (`:55-64`, `:214-236`, `:286-315`). (It is nevertheless not what ZATCA validates — PH2-01/02.)

**PC-7 — Secure XML handling.** Every parser call uses `LIBXML_NONET` and rejects `doctype` (`ZatcaInvoiceHasher.php:75-82`, `ZatcaXmlCanonicalizer.php:158-165`, assembler `:220-223`, finalizer `:117-123`, extractor `:506-516`); temp files `0600` and unlinked (`ZatcaXmlCanonicalizer.php:24-33`, `:69-71`); XML escaping of business text is correct (P2 `special_chars` case: `&quot;`, `&lt;&amp;&gt;`, emoji survive, document well-formed, hash computed).

**PC-8 — QR material that is correct.** Tag 1 (seller name UTF-8), tag 2 (VAT), tag 4/5 (amounts as in XML) and tag 9 (DER ECDSA signature of the certificate) are accepted by the SDK's QR validator (it reported only `hashedXml`, `digital signature`, `publicKey`, `timeStamp` — S3). `ZatcaQrCertificateMaterialExtractor::certificateSignature()` parses the X.509 BIT STRING correctly (`:53-100`; `ZatcaQrCertificateMaterialExtractorTest` verifies it against the CA key). Tag 9 is omitted for standard invoices as required (`ZatcaPhaseTwoQrEncoder.php:52-54`, `:69-71`).

**PC-9 — Document-type snapshot.** `zatca_document_type` is frozen at creation/posting (`InvoiceService.php:429-447`, `:1020`), drives `@name` 0100000/0200000 (`ZatcaService.php:254`) and clearance vs reporting routing (`ZatcaSubmissionService.php:37-41`); explicit override validated (`StoreInvoiceRequest.php:19`).

---

## 3. Findings

### PH2-01 — ECDSA signature is computed over the wrong bytes and encoded in the wrong form (SDK: "wrong signature Value")
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** Phase-2 cryptographic stamp on simplified invoices (and the signature AWJ also adds to standard invoices); QR tag 7.
- **Official requirement:** ZATCA Security Features Implementation Standard — digital signature = ECDSA (secp256k1, SHA-256) over the invoice hash; `ds:SignatureValue` and QR tag 7 carry the base64 of the (DER) ECDSA signature [official-ref to confirm section]. Executable reference: SDK `DigitalSignatureServiceImpl.getDigitalSignature()` = `signECDSA(privateKey, base64decode(invoiceHash))` with `SHA256withECDSA` (DER output, base64); `SignatureValidator.doValidate()` = `ECDSAUtil.verifyECDSA(pubKey, signatureValueBase64, base64decode(computedInvoiceHash))`; official samples: `SignatureValue` = 72-byte DER (`MEYCIQ…`/`MEUCIQ…`), verified by V1 to be valid over the raw 32 hash bytes and *invalid* over C14N(SignedInfo).
- **Actual behavior:** `ZatcaXadesSignatureAssembler.php:100-101` signs `canonicalizeElementInContext($signedInfo)` (the XMLDSig standard input); `ZatcaXmlEcdsaSigner::sign()` converts OpenSSL's DER to raw `r||s` 64 bytes (`:31-35`, `derToRaw` `:72-91`) and `verify()` demands exactly 64 bytes (`:43-46`). The extractor also hard-requires 64 bytes (`ZatcaSignedInvoiceQrMaterialExtractor.php:134-136`) and the QR encoder too (`ZatcaPhaseTwoQrEncoder.php:43-45`).
- **Expected behavior:** `SignatureValue` = base64(DER(ECDSA-SHA256(rawInvoiceHashBytes))) — i.e. sign the 32-byte hash that is already in `Reference/DigestValue` — and QR tag 7 = that base64 text.
- **Evidence:** V1 on `signed__simplified_basic.xml`: `SignatureValue bytes=64 … XMLDSig-standard verify: VALID … ZATCA-SDK-style verify: INVALID`; on the official sample: `bytes=72 … XMLDSig: INVALID … ZATCA-SDK-style: VALID`. S3: every simplified signed output → `[SIGNATURE] FAILED`, `CODE : signatureValue, MESSAGE : wrong signature Value`. SDK bytecode: `<audit-workspace>/work/D/sdk-javap/SignatureValidator.javap.txt` lines 116-140, `DigitalSignatureServiceImpl.javap.txt` 12-52, `ECDSAUtil.javap.txt` 43-60.
- **Impact:** Regulatory — every simplified invoice would be rejected at compliance check and at reporting (signature invalid); production CSID could never be obtained. Standard invoices are not signature-checked by the SDK, but AWJ's QR for them is also wrong (PH2-03).
- **Recommendation:** Replace the SignedInfo-based signing with ZATCA's: sign the decoded invoice-hash bytes with `openssl_sign(…, OPENSSL_ALGO_SHA256)` and emit the DER output base64 unchanged (no raw conversion); make the extractor/encoder accept DER (70–72 bytes, up to the 255-byte TLV limit). Keep the XMLDSig self-check only if rewritten to ZATCA semantics.
- **Regression tests required:** A test that takes an official sample, re-signs it with the SDK dummy key material (synthetic, shipped by ZATCA) and asserts AWJ's `SignatureValue` verifies the way the SDK does (sign-hash semantics, DER); a golden test that the SDK `-validate` reports `[SIGNATURE] PASSED` on an AWJ output (CI job with the SDK jar + JDK 11).
- **Dependencies:** PH2-02, PH2-03 (same validation stage), PH2-04 (XSD must pass first for the SDK to reach signature validation in production).

### PH2-02 — XAdES `SignedProperties` uses the wrong element set and digest encodings (SDK: XSD failure + wrong SignedProperties/certificate digests + missing IssuerSerial)
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** Phase-2 cryptographic stamp (KSA-15).
- **Official requirement:** ZATCA profile (official samples + SDK `SigningServiceImpl.populateSignedSignatureProperties`, `SignatureValidator`): `xades:SignedSignatureProperties` = `SigningTime` (`yyyy-MM-dd'T'HH:mm:ss`, no zone) + `xades:SigningCertificate/xades:Cert` with `CertDigest` **and** `IssuerSerial` (`ds:X509IssuerName`, `ds:X509SerialNumber` decimal); CertDigest DigestValue = base64(**hex**(SHA-256(base64 text of the certificate))); SignedProperties reference DigestValue = base64(**hex**(SHA-256(serialised SignedProperties node))); no `SignaturePolicyIdentifier`, no `SignedDataObjectProperties`; `QualifyingProperties/@Target="signature"`; second `ds:Reference` `Type="http://www.w3.org/2000/09/xmldsig#SignatureProperties"`; one `X509Certificate` (the CSID leaf). The SDK's XSD set (`UBL-XAdESv132-2.1.xsd`) defines only `SigningCertificate` (`:170`), **not** `SigningCertificateV2` (grep: not defined anywhere in the SDK XSDs). Data Dictionary KSA-15 (M for all six document types).
- **Actual behavior:** `ZatcaXadesSignedPropertiesBuilder.php`: `SigningCertificateV2` (`:61`), no `IssuerSerial`, CertDigest = base64(raw SHA-256(DER)) for **every** chain certificate (`:64-71`, `:158`), `SignaturePolicyIdentifier` mandatory (`:73-88`), `SignedDataObjectProperties/DataObjectFormat` (`:90-95`), `SigningTime` UTC with `Z` (`:54-59`). `ZatcaXadesSignatureAssembler.php`: SignedProperties digest = base64(raw SHA-256(C14N11(element))) (`:85-89`), `Target="#signature"` (`:71`), full chain in `KeyInfo` (`:163-168`). `ZatcaXmlDsigSignedInfoBuilder.php:77`: `Type="http://uri.etsi.org/01903#SignedProperties"`.
- **Expected behavior:** Emit exactly the ZATCA element set and encodings listed above; embed only the leaf certificate.
- **Evidence:** S3 on all 9 signed outputs: `[XSD] FAILED … cvc-complex-type.2.4.a: Invalid content was found starting with element '{…v1.3.2#}SigningCertificateV2'`; `[SIGNATURE]` errors `X509IssuerName: wrong X509IssuerName`, `NumberFormatException: Zero length BigInteger` (missing `X509SerialNumber`), `xadesSignedPropertiesDigestValue`, `signingCertificateDigestValue`. V1: AWJ SignedProperties DigestValue 44 chars / CertDigest 44 chars = base64(raw); official sample 88/88 chars = base64(hex), `IssuerSerial present: yes`, `SigningCertificate(V1)`, `SignaturePolicyIdentifier present: no`, `Target=signature`. SDK bytecode `SignatureValidator.javap.txt` 174-300, `getHashedCertificate` 350-359 (`hashString(bytes)→bytesToHex→base64`).
- **Impact:** Regulatory — XSD failure alone rejects every signed document before any business rule is evaluated; even with PH2-01 fixed the stamp would still fail SignedProperties/certificate-digest/IssuerSerial checks.
- **Recommendation:** Rebuild `SignedProperties` to the ZATCA profile (SigningCertificate v1 + IssuerSerial; hex-then-base64 digests over the exact serialised node text/cert base64 text; drop policy and DataObjectFormat; `Target="signature"`; dsig `SignatureProperties` Type; local-time SigningTime); compute the SignedProperties digest over the same serialisation the SDK recomputes (dom4j `asXML()` of the parsed node, i.e. the literal bytes as written, with indentation chosen deliberately); embed only the leaf certificate (chain stays server-side for validation).
- **Regression tests required:** Golden comparison of AWJ's signature block structure against `Simplified_Invoice.xml` (element names/order/attributes); SDK `-validate` `[XSD] PASSED` and `[SIGNATURE] PASSED` in CI.
- **Dependencies:** PH2-01, PH2-06.

### PH2-03 — Phase-2 QR tags 3, 6, 7, 8 use the wrong encodings (SDK: QR FAILED — hashedXml, digital signature, publicKey, timeStamp)
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** KSA-14 QR on simplified invoices (and on standard invoices AWJ signs itself).
- **Official requirement:** Security Features Implementation Standard — QR TLV tags 1–9 [official-ref to confirm]; executable reference SDK `QRCodeGeneratorServiceImpl.generateQrCode()` / `QrCodeValidator`: tag 3 = `IssueDate + "T" + IssueTime` (format `yyyy-MM-dd'T'HH:mm:ss`, no `Z`), tag 6 = the base64 **text** of the invoice hash (44 bytes), tag 7 = the bytes of the base64 **text** of `ds:SignatureValue` (96 bytes), tag 8 = `X509Certificate.getPublicKey().getEncoded()` = DER SubjectPublicKeyInfo (88 bytes for secp256k1), tag 9 = raw certificate signature. Official QR decodes (Q1): tag3 len 19 `2022-09-07T12:21:28`, tag6 len 44 text, tag7 len 96 text, tag8 len 88 binary `3056…`, tag9 len 71.
- **Actual behavior:** `ZatcaPhaseTwoQrEncoder.php`: tag 3 UTC `…Z` (`:56-58`), tag 6 raw 32 bytes (`:40-41`, `:65`), tag 7 raw 64 bytes (`:43-44`, `:66`), tag 8 raw bytes (`:46`, `:67`) fed from `ZatcaQrCertificateMaterialExtractor` as SEC1 uncompressed point `04‖X‖Y` 65 bytes (`:44-47`). Q1 decode of `signed__simplified_basic.qr.txt`: `tag 3 len 20 2026-10-10T12:40:25Z`, `tag 6 len 32 binary`, `tag 7 len 64 binary`, `tag 8 len 65 binary 04ec…`, `tag 9 len 70 binary 3044…`. Phase-1 path (no credential): tag 3 = `created_at->toIso8601String()` = `2026-10-10T12:40:24+00:00` (`ZatcaService.php:163`).
- **Expected behavior:** Tags per the SDK semantics above; tag 3 textually equal to `IssueDate`+`T`+`IssueTime` of the XML.
- **Evidence:** S3: all simplified signed outputs `[QR] FAILED` with `hashedXml does not match…`, `invoice signature value … doesn't match … tag 7`, `public key of the certificate does not match…`, `[WARN] timeStamp does not match…`; unsigned outputs `QRCODE_INVALID`. SDK bytecode `QrCodeValidator.javap.txt` 407-534, `QRCodeGeneratorServiceImpl.javap.txt` 10-91, `QrGenerationService.javap.txt` 407-440 (date format constants).
- **Impact:** Regulatory — QR validation is part of the KSA checks for simplified invoices; also a printed QR that scanners/ZATCA app cannot verify against the stamp.
- **Recommendation:** tag 6 = `$invoice->zatca_hash` string; tag 7 = the `SignatureValue` base64 string; tag 8 = DER SPKI (`openssl_pkey_get_details()['key']` PEM body decoded); tag 3 = XML IssueDate/IssueTime joined with `T`; keep tag 9 as is. Raise the TLV-length guard to cover 96-byte tag 7 (already ≤255).
- **Regression tests required:** Decode-and-compare test against the official `Simplified_Invoice.xml` QR layout (lengths/types per tag); SDK `[QR] PASSED` in CI.
- **Dependencies:** PH2-01 (tag 7 value), PH2-08 (tag 3 source).

### PH2-04 — The UBL document body is a non-compliant skeleton: XSD, EN16931 and BR-KSA failures on every invoice shape
- **Severity:** P0
- **Status:** VERIFIED DEFECT
- **Business process:** Generation of standard (clearance) and simplified (reporting) tax invoices.
- **Official requirement:** ZATCA XML Implementation Standard + Data Dictionary 2023 (mandatory fields per document type) [official-ref to confirm versions]; BR-KSA rules in `20210819_ZATCA_E-invoice_Validation_Rules.xsl`; EN 16931 BR-/BR-CO- rules; UBL 2.1 XSD. Specifically M for all types: BT-6 `TaxCurrencyCode`, BT-29 seller `PartyIdentification` (schemeID CRN/MOM/MLS/700/SAG/OTH), BT-35/KSA-17/KSA-3/BT-37/BT-38/BT-40 seller address, BT-31 VAT under `PartyTaxScheme/cac:TaxScheme=VAT`, BT-106 `LineExtensionAmount` total, BG-23 `TaxSubtotal` with `TaxCategory` (BT-116…121), BT-151/152 line `ClassifiedTaxCategory`, KSA-11/12 line `TaxTotal`/`RoundingAmount` (M for standard), BT-115 payable; standard-only: buyer address/VAT/other-ID (BT-46/48/50-55, BR-KSA-10/63/81), KSA-5 supply date (BR-KSA-15); document/line allowances & charges (BG-20/21/27/28); UBL XSD requires `cac:TaxScheme` inside `cac:PartyTaxScheme`.
- **Actual behavior:** `ZatcaService::buildXml()` (`ZatcaService.php:234-315`, self-described "simplified … not validated against ZATCA XSD" `:232`) emits only: ProfileID, ID, UUID, IssueDate/Time, InvoiceTypeCode (always `388`), DocumentCurrencyCode (fixed `SAR`), ICV/PIH/QR references, `cac:Signature`, seller `PartyTaxScheme/CompanyID` (no `TaxScheme`) + `RegistrationName`, buyer `RegistrationName` only, one `TaxTotal/TaxAmount`, `LegalMonetaryTotal` with TaxExclusive/TaxInclusive/Payable only, lines with ID/InvoicedQuantity (no `unitCode`)/LineExtensionAmount/Item Name/PriceAmount. Discounts, shipping (a taxable charge), rounding adjustment and tax-inclusive pricing are computed in the ledger but **not represented** in the XML.
- **Expected behavior:** A complete UBL 2.1 KSA-profile document per document type (see matrix, Appendix A).
- **Evidence:** S3 (18/18 FAILED), with the SDK's own ERROR/WARN levels (my log; identical in the lead's `run-lead/awj-*.validate.log`):
  * **ERROR (stage-failing, certain SDK rejection), every file:** `[XSD]` `cvc-complex-type.2.4.b: The content of element 'cac:PartyTaxScheme' is not complete … TaxScheme`; `[EN]` `BR-CO-18` (no VAT breakdown), `BR-CO-04` (no line VAT category), `BR-CO-15`; `[KSA]` `BR-KSA-68` (TaxCurrencyCode), `BR-KSA-39` (seller VAT requires `TaxScheme=VAT`). Standard shape additionally **ERROR** `BR-KSA-52`, `BR-KSA-53` (line VAT / line gross). Unsigned simplified additionally **ERROR** `BR-KSA-28` (no stamp).
  * **WARN (reported, not stage-failing in this XSL set), every file:** `BR-08` (seller address), `BR-CO-10`, `BR-CO-13`, `BR-KSA-08` (seller CRN), `BR-KSA-37`, `BR-KSA-EN16931-08`; standard shape `BR-KSA-10`, `BR-KSA-15` (supply date), `BR-KSA-81`, `BR-KSA-F-06-C23/C25`; tax-inclusive shape `BR-KSA-EN16931-11`; unsigned `BR-KSA-29`.
  * Note on `BR-CO-15`: its test is `TaxInclusiveAmount = round(TaxExclusiveAmount + sum(cac:TaxTotal/cac:TaxSubtotal/cbc:TaxAmount))` (`R2-work/rules-en-with-tests.txt:193-196`; `CEN-EN16931-UBL.xsl:774`) — AWJ has no `TaxSubtotal`, so the VAT term is 0 and the ERROR fires even where AWJ's totals are arithmetically right; it is *also* genuinely inconsistent in the shipping/adjustment shape (below). Fixing BR-CO-18 (TaxSubtotal) is therefore the root fix. Shape-specific arithmetic: `line_and_invoice_discount` → XML `LineExtensionAmount 200.00` vs `TaxExclusiveAmount 190.00` with no `AllowanceCharge`/`AllowanceTotalAmount` (manifest: line_discount 1000, invoice discount 500 applied to tax base); `shipping_adjustment` → `TaxExclusiveAmount 100.00 + TaxAmount 16.50 ≠ TaxInclusiveAmount 126.47` (shipping 10.00 and adjustment −0.03 absent → BR-CO-15); `tax_inclusive` → `PriceAmount 115.00` (gross) with `LineExtensionAmount 100.00` → `BR-KSA-EN16931-11`; `zero_tax_mix` → no `Z` category / `VATEX-SA-*` reason (BR-KSA-69/83/CL-04 would fire once a TaxSubtotal exists). Files: `<audit-workspace>/work/D/out/*.xml`, `manifest.json`.
- **Impact:** Regulatory — no document can pass compliance checks, clearance or reporting; VAT breakdown absent means the fiscal content (categories, exemption reasons, allowances) is not reported even though the ledger is right.
- **Recommendation:** Implement a mapping layer from the posted invoice to the full KSA UBL profile: seller master data (CRN, national address, TaxScheme VAT), `TaxCurrencyCode`, second `TaxTotal` with `TaxSubtotal` per category (S/Z/E/O with reason codes from the tax engine), line `TaxTotal`/`RoundingAmount`, `ClassifiedTaxCategory`, net `PriceAmount` (+ `AllowanceCharge` on price or line when tax-inclusive/discounted), document-level `AllowanceCharge` for invoice discount and shipping charge (with VAT category), `PayableRoundingAmount` for `adjustment`, `PaymentMeans`, `Delivery/ActualDeliveryDate` and full buyer block for standard invoices, `InvoicedQuantity/@unitCode`. Gate posting on an internal schematron/XSD check (or the SDK in CI) so that unsupported shapes fail closed rather than produce invalid XML.
- **Regression tests required:** CI job running the official SDK (`-validate`) on generated fixtures for each document type/shape (standard, simplified, discounts, charges, zero-rated/exempt/out-of-scope, tax-inclusive, fractional qty) asserting `GLOBAL VALIDATION RESULT = PASSED`; unit tests asserting the arithmetic rules BR-CO-10/13/15, BR-KSA-51, BR-KSA-EN16931-11.
- **Dependencies:** Tax-engine stream (category/reason codes), seller master-data fields (national address, CRN) — cross-stream.

### PH2-05 — Credit notes and debit notes are not e-invoiced at all (no XML, QR, hash, ICV/PIH, signature, submission)
- **Severity:** P0
- **Status:** NOT IMPLEMENTED
- **Business process:** Credit/debit notes against standard and simplified invoices (clearance/reporting of 381/383 documents).
- **Official requirement:** E-Invoicing Regulation / Resolution on controls: electronic notes are e-invoices subject to the same generation, clearance/reporting and chain requirements; Data Dictionary: BT-25 BillingReference (M), KSA-10 InstructionNote reason (M), InvoiceTypeCode 381/383 (BR-KSA-17, BR-KSA-56); the SDK ships official credit/debit note samples for both types. [official-ref to confirm article]
- **Actual behavior:** `CreditNoteService.php` contains no ZATCA reference (grep); `credit_notes` has none of `zatca_xml/qr/hash/icv/uuid/previous_hash/document_type` (P2 output `[credit_notes columns] {… all false}`); a posted credit note (`CN-2026-00001`, status posted) carries no zatca attributes and the tenant's max ICV is unchanged (`[credit_note] … max invoice ICV after credit note = 9`). `buildXml()` hard-codes `388` (`ZatcaService.php:272`) and has no `BillingReference`/`InstructionNote`. No `DebitNote` model exists for sales (grep lists only credit-note classes). Return documents (`ReturnDocument`) likewise have no ZATCA fields.
- **Expected behavior:** Every credit/debit note generates a 381/383 UBL document in the same ICV/PIH chain, with `BillingReference` to the original invoice and the reason, signed/QR'd for simplified, cleared for standard.
- **Evidence:** P2 output lines quoted above; `app/Models/CreditNote.php` (no zatca columns); `ZatcaService.php:272`.
- **Impact:** Regulatory/financial — reductions of VAT output through credit notes are invisible to ZATCA; chain integrity and sequencing rules are violated for every note; penalties exposure.
- **Recommendation:** Extend the ZATCA pipeline to a document-agnostic contract (invoice/credit/debit) sharing the tenant chain; add BillingReference, InstructionNote, type codes, and submission for notes; include `ReturnDocument`-driven notes.
- **Regression tests required:** Posting a credit note yields ICV n+1 with PIH of the previous document, 381 type code, BillingReference to the invoice; SDK validation of the `Simplified_Credit_Note`-like output.
- **Dependencies:** PH2-04.

### PH2-06 — A mandatory `SignaturePolicyIdentifier` that ZATCA's profile does not have; signing is impossible in default configuration and forces a fabricated policy
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Deployment configuration for Phase-2 signing; posting of any invoice once a credential exists.
- **Official requirement:** ZATCA stamp profile contains no `xades:SignaturePolicyIdentifier` (official samples; SDK template; XSD allows it but the validator never reads it). ETSI XAdES: policy identifier belongs to EPES, not to the ZATCA B-B-style stamp [official-ref to confirm].
- **Actual behavior:** `config/zatca.php:30-33` requires `ZATCA_SIGNATURE_POLICY_IDENTIFIER` (HTTPS URL) and `ZATCA_SIGNATURE_POLICY_DIGEST` (base64 SHA-256) with "deliberately no default"; `ZatcaSignaturePolicyResolver::resolve()` throws when unset (`:12-16`, `:21-31`); the builder embeds them in every signature (`ZatcaXadesSignedPropertiesBuilder.php:73-88`). Because `buildFor()` enters the signed path for any credential row (`ZatcaService.php:89`), an unset policy makes **every invoice posting fail** (`ZatcaSignedInvoicePostingTest::posting_fails_closed_when_the_signature_policy_is_missing` — passes, i.e. confirms the behaviour). There is no official value an operator could pin, so the only way to post is to invent an identifier and digest, which then ship inside every stamped invoice.
- **Expected behavior:** No policy element; no deployment secret/knob that can block invoicing.
- **Evidence:** cited lines; T1; V1 shows `SignaturePolicyIdentifier present: yes` on AWJ output vs `no` on the official sample.
- **Impact:** Operational (tenant-wide invoicing outage on misconfiguration) + regulatory (non-profile content in the stamp).
- **Recommendation:** Remove the policy from the profile and from config; readiness blockers should not include it.
- **Regression tests required:** Signed output contains no `SignaturePolicyIdentifier`; posting with a credential and no policy env succeeds.
- **Dependencies:** PH2-02.

### PH2-07 — Any credential row (any environment/stage) switches the whole tenant to fail-closed signing; an environment mismatch blocks all invoicing including POS
- **Severity:** P1
- **Status:** VERIFIED DEFECT (design risk)
- **Business process:** Onboarding sequencing (developer/simulation/production), POS and sales posting.
- **Official requirement:** n/a — internal invariant: fail-closed is desirable per CLAUDE.md, but the trigger should be the *active* configuration, not the mere existence of any row.
- **Actual behavior:** `ZatcaService.php:89` `if (ZatcaCredential::query()->exists())` — tenant-scoped, environment-agnostic. The resolver then requires a `configured`, unexpired credential for `Settings zatca.active_environment` (default `developer`, `Settings.php:246`). Storing a `simulation` or `production` credential while the active environment is still `developer` (the UI default), or letting the configured certificate expire, makes every `InvoiceService::post()` throw and roll back (`ZatcaSignedInvoicePostingTest::posting_fails_closed_and_rolls_back_financial_effects…`: credential for `production`, active `developer` → RuntimeException mentioning `developer`). POS and fuel flows call the same `post()` (`InvoiceService.php:873-880`).
- **Expected behavior:** Signing requirement keyed to an explicit "Phase-2 enabled for environment X" decision; expiry handled with advance readiness alerts rather than an abrupt tenant-wide outage; a clear UI state.
- **Evidence:** cited lines; T1.
- **Impact:** Operational — total sales outage for a tenant from a single settings/credential ordering mistake or a CSID expiry (CSIDs are time-limited).
- **Recommendation:** Trigger the signed path from an explicit per-environment enablement flag that is validated at save time against the credential; surface expiry days-ahead in `ZatcaSigningReadiness`; consider allowing posting with a queued "stamp later" state only if the regulation permits (it generally does not for simplified — so keep fail-closed but make it impossible to misconfigure).
- **Regression tests required:** Saving `active_environment` without a matching configured credential is rejected (or warned) before it can block posting.
- **Dependencies:** PH2-09.

### PH2-08 — `IssueDate`/`IssueTime` (and QR tag 3) come from the draft's `created_at` in the app time zone, not from the invoice's issue date/posting time
- **Severity:** P1
- **Status:** VERIFIED DEFECT
- **Business process:** Issue date/time of every e-invoice (BT-2, KSA-25), 24-hour reporting window for simplified invoices (BR-KSA-98), accounting date consistency.
- **Official requirement:** Data Dictionary BT-2 "Invoice issue date", KSA-25 "Invoice issue time" (`HH:mm:ss`; BR-KSA-70: local time, or `Z` suffix if UTC); BR-KSA-04 issue date ≤ today; simplified invoices must be reported within 24 h of issue (BR-KSA-98). [official-ref to confirm the issue-date definition in the XML Implementation Standard]
- **Actual behavior:** `ZatcaService.php:253` `$issue = ($invoice->created_at ?? now())` → `IssueDate`/`IssueTime` (`:270-271`); phase-1 QR tag 3 `created_at->toIso8601String()` (`:163`); phase-2 QR tag 3 from `created_at` converted to UTC with `Z` (`:90`, encoder `:56-58`). The accounting document date is `invoice_date` (ledger `entry_date`, `InvoiceService.php:1005`). Time zone = `config('app.timezone')` (UTC in the harness; production NOT VERIFIED), not the tenant's `timezone` column nor KSA time.
- **Expected behavior:** Issue date/time = the moment the invoice is issued (posting), consistent with the accounting document date, expressed in KSA local time (or UTC with `Z` in both IssueTime and QR); a draft created days earlier must not carry a stale time.
- **Evidence:** P2 `backdated_invoice_date` case: `invoice_date=2026-01-15` but XML `IssueDate 2026-10-10`, `IssueTime 12:42:45` (manifest `issue_in_xml` vs `invoice_date`); all cases show `issue_in_xml == created_at`. S3: `[WARN] timeStamp does not match with qr code timeStamp` (QR has `Z`/offset while XML has none).
- **Impact:** Regulatory/financial — invoices issued on a different date than the ledger date; a draft posted the next day is "issued" yesterday (24-h window already consumed); back-dated invoices get today's date in ZATCA while the books show another period.
- **Recommendation:** Freeze issue date/time at posting (`now()` in the tenant's KSA zone, written once), derive QR tag 3 from the XML fields, and reconcile with `invoice_date` (either forbid back-dating of e-invoices or document the policy).
- **Regression tests required:** Posting a draft created earlier yields IssueDate/Time = posting instant; QR tag 3 textually equals XML IssueDate+`T`+IssueTime.
- **Dependencies:** PH2-03.

### PH2-09 — No onboarding lifecycle (CSR, OTP, compliance CSID, compliance checks, production CSID, renewal, revocation); validator does not bind the CSID to the tenant/environment
- **Severity:** P1
- **Status:** NOT IMPLEMENTED (onboarding) / PARTIALLY IMPLEMENTED (credential validation)
- **Business process:** EGS onboarding and credential lifecycle.
- **Official requirement:** ZATCA Developer Portal / E-Invoicing API: CSR with certificate template `TSTZATCA-Code-Signing` / `PREZATCA-Code-Signing` / `ZATCA-Code-Signing` and the subject fields (SN serial `1-…|2-…|3-…`, UID = VAT, title = invoice type, registeredAddress, businessCategory), OTP-based compliance CSID, six compliance documents, production CSID, renewal; Basic auth = binary security token : secret [official-ref to confirm; the SDK `-csr` flags `-nonprod`/`-sim` and `csr-config-template.properties` document the template names and fields].
- **Actual behavior:** Grep of `app/` finds no CSR/OTP/CSID issuance/renewal/revocation code; the only inputs are a manual PUT of `binary_security_token`, `secret`, `private_key`, `request_id` per environment (`UpdateZatcaCredentialRequest.php:23-32`, `ZatcaCredentialService.php:24`, `:75-86`). The transport uses `credentials['binary_security_token']` as Basic username and `credentials['secret']` as password (`ZatcaTransportCredentialResolver.php:44-53`, `ZatcaHttpTransport.php:27`) — correct field mapping. The validator does **not** check: CSID subject/SAN VAT (`UID`/organizationIdentifier) == `tenants.vat_number`; certificate template (TST/PRE/ZATCA) vs the environment it is stored under; serial/EGS identification; that a `production`-stage record carries a production-template certificate. One credential per `(tenant_id, environment)` (`000131:25`) → one EGS unit per tenant, no per-branch/device credentials, no overlap window for rotation (`store()` overwrites in place `:108-117`); pending submission attempts keep `request_hash` but not the credential used. Trust anchors must be supplied as files (`config/zatca.php:14-18`); none are shipped and no official bundle source is documented (the ZATCA sample CSID carries an AIA URL `http://aia4.zatca.gov.sa/CertEnroll/…` — NOT VERIFIED as an official distribution channel).
- **Expected behavior:** Guided onboarding per environment with CSR generation on the server (key never leaves), OTP compliance CSID request, automated compliance-check submissions, production CSID, expiry tracking/renewal with overlap, revocation; validator binding CSID ↔ tenant VAT ↔ environment template.
- **Evidence:** cited lines; `ZatcaCredentialTest` (what it asserts: encryption, metadata, chain/EKU/KU/CA checks, mismatch rejection, stage change, isolation, app-guard; what it does NOT assert: subject VAT, template, serial, rotation overlap).
- **Impact:** Operational/regulatory — tenants cannot onboard from within AWJ; a certificate for another taxpayer or the wrong environment template is accepted as long as it chains to the configured bundle.
- **Recommendation:** Add the onboarding flow (CSR → compliance CSID → compliance checks → production CSID → renewal) with the certificate-template and subject binding checks in the validator; keep private keys server-generated; model credentials per EGS unit with validity windows.
- **Regression tests required:** Validator rejects a CSID whose SAN/UID VAT ≠ tenant VAT, and a `TSTZATCA` template stored under `production`; CSR output matches the SDK's structure (`openssl req -text` golden).
- **Dependencies:** Transport stream (compliance/production CSID APIs).

### PH2-10 — One ICV/PIH chain per tenant spans developer, simulation and production environments and stages
- **Severity:** P2
- **Status:** VERIFIED DEFECT (NOT VERIFIED whether the production platform enforces PIH continuity)
- **Business process:** Transition from compliance/simulation testing to production; multi-EGS setups.
- **Official requirement:** ICV is a per-EGS-unit sequential counter and PIH links consecutive invoices of that unit; the first invoice's PIH is the hash of "0" (Security Features standard; Data Dictionary KSA-13/KSA-16) [official-ref to confirm]. Simulation and production are separate environments with separate CSIDs.
- **Actual behavior:** The chain query is tenant-wide (`ZatcaService.php:69-74`), independent of `active_environment`/stage and of the credential used; invoices posted while `active_environment=simulation` (or in the unsigned phase-1 mode) consume ICVs and become the PIH predecessor of the first production invoice. `ZatcaIcvScope` only offers tenant vs branch (branch blocked). No EGS/device dimension exists.
- **Expected behavior:** Chain scoped per EGS unit/environment; production starts at ICV 1 with the genesis PIH after onboarding.
- **Evidence:** cited lines; `ZatcaIcvScopeTest::under_tenant_scope_the_counter_runs_as_one_chain_across_branches` (single chain across branches); P3 confirms a single tenant-wide counter.
- **Impact:** Regulatory — production chain begins mid-sequence pointing at non-production documents; multi-device deployments impossible.
- **Recommendation:** Key the chain by (tenant, EGS unit/environment); reset on production onboarding; record which credential stamped each document.
- **Regression tests required:** Switching environments starts a new chain; first production invoice PIH == genesis.
- **Dependencies:** PH2-09.

### PH2-11 — Genesis PIH encoding differs from ZATCA's samples/SDK
- **Severity:** P2
- **Status:** VERIFIED DEFECT (platform enforcement NOT VERIFIED)
- **Business process:** First invoice of a chain.
- **Official requirement:** SDK `Data/PIH/pih.txt` and all 19 official samples: PIH of the first invoice = `NWZlY2ViNjZ…==` = base64 of the lowercase **hex** SHA-256 of `0` (88 chars); BR-KSA-26 only requires base64 SHA-256.
- **Actual behavior:** `ZatcaService::genesisHash()` = base64 of the **raw** SHA-256 of `0` (`X+zrZv/IbzjZUnhsbWlsecLbwjndTpG0ZynXOif7V+k=`, `ZatcaService.php:173-176`). Subsequent PIHs (base64 raw of the previous hash) match the SDK convention (DigestValue is base64 raw).
- **Expected behavior:** Genesis value identical to ZATCA's.
- **Evidence:** `<audit-workspace>/official/R2-reference-samples/pih.txt`; `ZatcaPhase2Test::first_invoice_uses_the_genesis_previous_hash` (asserts the AWJ form); S3 `[PIH] PASSED` only because I pointed `pihPath` at AWJ's own value — the lead's run with the SDK's official `pih.txt` reports `[PIH] FAILED, KSA-13` for AWJ's first invoice (`run-lead/awj-*-unsigned.validate.log`).
- **Impact:** Low (BR-KSA-26 passes either way; the SDK PIH check is local); risk if the platform compares the first PIH.
- **Recommendation:** Use the hex-based genesis string; keep the rest of the chain as is.
- **Regression tests required:** First PIH == official constant.
- **Dependencies:** PH2-10.

### PH2-12 — Phase-1 QR TLV length byte wraps silently for values ≥ 256 bytes
- **Severity:** P2
- **Status:** VERIFIED DEFECT (by code reading; not triggered in probes)
- **Business process:** Phase-1 QR (tenants without credentials) — seller name tag 1.
- **Official requirement:** TLV length is one byte (0–255) [official-ref to confirm]; the phase-2 encoder already enforces this (`ZatcaPhaseTwoQrEncoder.php:95-103`).
- **Actual behavior:** `ZatcaService::tlv()` = `chr($tag).chr(strlen($value)).$value` (`:181-184`); PHP `chr(256)` wraps to `\0`, so an Arabic seller name of ≥128 characters (≥256 UTF-8 bytes; `tenants.name` allows 255 chars) yields a corrupt QR without error.
- **Expected behavior:** Reject or truncate deterministically with a clear error.
- **Evidence:** cited lines; `ZatcaTest::tlv_encodes_tag_length_and_value` tests only short values.
- **Impact:** Operational — unreadable QR on printed simplified invoices for long legal names.
- **Recommendation:** Share the bounded TLV helper of the phase-2 encoder.
- **Regression tests required:** 256-byte value is rejected.
- **Dependencies:** none.

### PH2-13 — Unsupported invoice-type transaction flags, foreign currency and tax-inclusive/allowance representation
- **Severity:** P2
- **Status:** NOT IMPLEMENTED (scope limitation to be declared)
- **Business process:** Export, nominal, summary, self-billed, third-party invoices; foreign-currency invoices; B2G.
- **Official requirement:** KSA-2 7-9 position transaction code (BR-KSA-06/07/31, BR-KSA-92); BT-5/BT-6 with BT-111 in SAR when currency ≠ SAR (BR-KSA-97, BR-KSA-CL-02); official samples exist for each.
- **Actual behavior:** `@name` is only `0100000`/`0200000` (`ZatcaService.php:254`); `DocumentCurrencyCode` fixed `SAR` and no `TaxCurrencyCode`/BT-111 (`:273`); no exchange-rate fields; tax-inclusive and discount data are not representable (PH2-04).
- **Expected behavior:** Either implement the flags/currency or block such invoices from the e-invoicing path with an explicit message.
- **Evidence:** cited lines; P2 shapes.
- **Impact:** Regulatory for tenants with exports/B2G/summary billing.
- **Recommendation:** Add explicit product-scope gating now; implement flags and FX later.
- **Regression tests required:** Non-SAR invoice is rejected from the ZATCA path until supported.
- **Dependencies:** PH2-04.

### PH2-14 — Test suite proves AWJ-vs-AWJ consistency only and encodes the deviations as expectations
- **Severity:** P2
- **Status:** PARTIALLY IMPLEMENTED
- **Business process:** Engineering assurance.
- **Official requirement:** n/a — internal invariant (CLAUDE.md "لا تستنتج التوافق من التعليقات").
- **Actual behavior:** 145 tests pass (T1) but none compares against an official sample, the SDK, or the XSD/Schematron. Several tests assert the non-conformant behaviour: `ZatcaPhaseTwoQrEncoderTest` (raw 32/64-byte tags 6/7, 65-byte tag 8), `ZatcaXmlEcdsaSignerTest::it_creates_the_xml_dsig_raw_signature…`, `ZatcaXadesSignedPropertiesBuilderTest` (policy mandatory), `ZatcaInvoiceSignerTest` (policy identifier present), `ZatcaPhase2Test::first_invoice_uses_the_genesis_previous_hash` (AWJ genesis). The hasher is the one component with an external oracle available and it does match (PC-1), but no test pins it to an official sample.
- **Expected behavior:** Golden tests against official samples and an SDK-based CI gate.
- **Evidence:** test files cited; T1.
- **Impact:** Operational — the deviations shipped with green CI.
- **Recommendation:** Add `tests/Fixtures/zatca/official/*.xml` (public SDK samples) with hash goldens; add an SDK validation job (JDK 11) for generated fixtures; rewrite the encoder/signer tests to ZATCA semantics.
- **Regression tests required:** As above.
- **Dependencies:** PH2-01…04.

### PH2-15 — Serialised stamp carries redundant namespace declarations and the hasher spawns an external process per canonicalisation
- **Severity:** P3
- **Status:** VERIFIED IMPLEMENTED (works) / hygiene
- **Business process:** Document size, runtime dependency.
- **Official requirement:** n/a.
- **Actual behavior:** libxml re-declares `xmlns:ds`/`xmlns:xades`/`xmlns:sac…` on nearly every element of the signature block (`<audit-workspace>/work/D/out/signed__simplified_basic.xml` line 2) — valid XML, ~10 KB per invoice. Each posting runs `xmllint` ≥ 5 times (hash, SignedProperties digest, SignedInfo sign + verify, extractor re-hash ×2) via temp files (`ZatcaXmlCanonicalizer.php:24-71`); `libxml2-utils` is installed in `Dockerfile:8` and CI (`ci.yml:93`), `setup.sh:15` checks it. Production hosting: NOT VERIFIED.
- **Expected behavior:** Declare namespaces once on the root; consider an in-process C14N 1.1 (PHP `DOMNode::C14N` is 1.0 — identical for documents without `xml:` attributes, which the canonicaliser already rejects `:97-109`).
- **Evidence:** cited; P2 outputs.
- **Impact:** Low.
- **Recommendation:** Namespace-aware serialisation; cache or in-process C14N.
- **Regression tests required:** none beyond existing.
- **Dependencies:** none.

### PH2-16 — Missing tenant/VAT data degrades silently in the phase-1 path
- **Severity:** P3
- **Status:** VERIFIED DEFECT (edge)
- **Business process:** Tenants without a VAT number (not VAT-registered) still get "ZATCA" artefacts.
- **Actual behavior:** `buildXml()`/`qrFor()` use `$tenant?->vat_number ?? ''` and `$tenant?->name ?? ''` (`ZatcaService.php:161-162`, `:296-297`) — an empty `CompanyID`/seller name is emitted and the hash/ICV chain still advances; the phase-2 encoder would instead throw on the VAT regex (`ZatcaPhaseTwoQrEncoder.php:32-34`), so behaviour differs by path.
- **Expected behavior:** Validate seller master data before generating e-invoice artefacts.
- **Evidence:** cited lines.
- **Impact:** Low (data quality).
- **Recommendation:** Hard-validate seller VAT/CRN/address at posting when the ZATCA application is active.
- **Regression tests required:** Posting without tenant VAT fails with a clear error.
- **Dependencies:** PH2-04.

---

## 4. NOT VERIFIED / open questions

1. **Production platform behaviour vs SDK.** All rejection evidence is from ZATCA's published SDK (which ZATCA states mirrors platform validation) and official samples; actual gateway responses were deliberately not exercised. The consolidator may mark PH2-01…04 as "certain rejection per SDK".
2. **Document versions/sections** of the XML Implementation Standard and Security Features Implementation Standard — tagged `[official-ref to confirm]`; reconcile with `R2-technical-register.md` when it lands.
3. **PIH continuity enforcement by the platform** (PH2-10/11) — unknown; obtain from the API error catalogue (`portal-i18n-api-strings.txt` in R2 work may list `PIH` errors).
4. **Production time zone** (`APP_TIMEZONE`) and whether production hosts have `xmllint` — operations evidence not available.
5. **CA trust-anchor distribution** — whether ZATCA publishes CA bundles for the three environments; the sample CSID's AIA URL is the only pointer found.
6. **Standard invoices**: the SDK skips QR/SIGNATURE for `01xxxxx`; whether the platform accepts a self-signed standard invoice with a non-profile stamp before clearance is unknown (AWJ sends its own signed XML; the cleared XML is stored separately `000132`).
7. **Whether tenants may legally back-date `invoice_date`** relative to the e-invoice issue date (PH2-08) — policy question for the owner.

## 5. Cross-stream notes

* **Tax engine stream:** `buildXml()` has no category/reason-code inputs; the engine must expose per-line VAT category (S/Z/E/O), rate, exemption code/text, and document-level allowance/charge categories for PH2-04.
* **Transport stream:** `ZatcaHttpTransport` sends `invoiceHash` = `zatca_hash` and base64 of the stored (non-conformant) XML; the `Accept-Version v2`/Basic-auth field mapping is right, but nothing can be accepted until PH2-01…04 are fixed. Also check what the dispatcher does with the warnings list of a 202 response.
* **Accounting stream:** ledger `entry_date = invoice_date` vs e-invoice `IssueDate = created_at` (PH2-08) — period/VAT-return reconciliation risk.
* **Security stream:** credentials encrypted under the single `APP_KEY`; no HSM/KMS; private keys are uploaded by users through the API (`private_key` in the PUT body) — key custody model to be assessed.
* **Platform/ops stream:** `libxml2-utils` runtime dependency; JDK 11 + SDK needed for a CI compliance gate.

---

## Appendix A — BR-KSA / XML element coverage matrix

Legend: required-for column uses Data Dictionary 2023 (M mandatory / C conditional / O optional) for **Std** = standard invoice & notes, **Simp** = simplified invoice & notes. "SDK result" = what the official SDK reported on AWJ's output (S3) or "n/a" when the rule did not fire because a prerequisite element is absent. **ERROR** = fails the stage (certain rejection by the SDK); **WARN** = reported as warning in this 2021-08-19 XSL set (does not fail the stage; the production platform's treatment of warnings is NOT VERIFIED). Level split taken from my own 18-file log (`validate-awj-outputs.log`, `[ERROR]`/`[WARN]` prefixes) and confirmed by the lead's calibration run.

| Element / rule | Required for | Emitted by `buildXml`? | Evidence (`ZatcaService.php`) | SDK result on AWJ output |
|---|---|---|---|---|
| `cbc:ProfileID` = `reporting:1.0` (BT-23, BR-KSA-EN16931-01) | M Std/Simp | yes | `:267` | pass |
| `cbc:ID` (BT-1) | M | yes (`invoice.number`) | `:268` | pass |
| `cbc:UUID` (KSA-1, BR-KSA-03) | M | yes (v4) | `:269`, `:43` | pass |
| `cbc:IssueDate` / `cbc:IssueTime` (BT-2, KSA-25, BR-KSA-04/70) | M | yes — but from `created_at` (PH2-08) | `:253`, `:270-271` | format passes; semantics wrong |
| `cbc:InvoiceTypeCode` 388/381/383 (BT-3, BR-KSA-05) | M | always `388` (PH2-05) | `:272` | pass for invoices; notes impossible |
| `@name` KSA-2 transaction code (BR-KSA-06/07/31) | M | `0100000`/`0200000` only (PH2-13) | `:254` | pass (basic) |
| `cbc:DocumentCurrencyCode` (BT-5) | M | fixed `SAR` | `:273` | pass |
| `cbc:TaxCurrencyCode` (BT-6, BR-KSA-68, EN16931-02) | M | **no** | — | **BR-KSA-68 ERROR** (18/18) |
| `cac:BillingReference/…/cbc:ID` (BT-25, BR-KSA-56) | M notes | **no** | — | n/a (no notes) |
| `cac:AdditionalDocumentReference` ICV (KSA-16, BR-KSA-33/34) | M | yes | `:274-277` | pass |
| PIH (KSA-13, BR-KSA-26/61) | M | yes (genesis encoding differs, PH2-11) | `:278-283` | pass (BR-KSA-26) |
| QR (KSA-14, BR-KSA-27) | M | yes (content wrong, PH2-03) | `:284-289`, `attachQr` `:117-131` | present; **QR stage FAIL** |
| `cac:Signature` ID/SignatureMethod (BR-KSA-28/29/30) | M | yes | `:290-293` | pass |
| Cryptographic stamp (KSA-15, BR-KSA-60) | M Simp | yes when credential exists; non-profile (PH2-01/02) | finalizer | **XSD ERROR + SIGNATURE ERROR** (signed); unsigned path **BR-KSA-28 ERROR**, BR-KSA-29 WARN |
| Seller `PartyIdentification/cbc:ID@schemeID=CRN…` (BT-29, BR-KSA-08) | M | **no** | — | BR-KSA-08 WARN (18/18) |
| Seller `PostalAddress` street/building(4 digits)/district/city/postal(5)/country (BT-35…40, KSA-3/17, BR-08, BR-KSA-09/37/66) | M | **no** | — | BR-08 WARN, BR-KSA-37 WARN (BR-KSA-09 did not fire — no address block at all) |
| Seller `PartyTaxScheme/cbc:CompanyID` + `cac:TaxScheme/cbc:ID=VAT` (BT-31, BR-KSA-39/40) | M | CompanyID yes, **TaxScheme missing** | `:296` | **XSD ERROR (cvc-complex-type.2.4.b) + BR-KSA-39 ERROR** (18/18) |
| Seller `PartyLegalEntity/RegistrationName` (BT-27) | M | yes | `:297` | pass |
| Buyer `PartyLegalEntity/RegistrationName` (BT-44) | M Std / C Simp | yes | `:302` | pass |
| Buyer `PostalAddress` (BT-50…55, BR-KSA-10/63/67) | M Std | **no** | — | BR-KSA-10 WARN, F-06-C23/C25 WARN (Std) |
| Buyer `PartyTaxScheme/CompanyID` (BT-48, BR-KSA-44) / other ID (BT-46, BR-KSA-14/81) | C/M Std | **no** | — | BR-KSA-81 WARN (Std) |
| `cac:Delivery/cbc:ActualDeliveryDate` (KSA-5, BR-KSA-15) | C (M for 388 standard) | **no** | — | BR-KSA-15 WARN (Std) |
| `cac:PaymentMeans/cbc:PaymentMeansCode` (BT-81, BR-KSA-16) + `InstructionNote` (KSA-10, BR-KSA-17 notes) | O / M notes | **no** | — | n/a |
| Document `cac:AllowanceCharge` (BG-20/21) with TaxCategory | C | **no** (discount/shipping dropped) | — | BR-CO-13 WARN; BR-CO-15 ERROR (see PH2-04 note on BR-CO-15) |
| `cac:TaxTotal/cbc:TaxAmount` (BT-110) | M | yes | `:305-307` | present |
| Second `cac:TaxTotal` with `cac:TaxSubtotal` (BT-116…121, BR-CO-18, BR-KSA-EN16931-08/09) | M | **no** | — | **BR-CO-18 ERROR** (18/18), EN16931-08 WARN |
| `TaxCategory` ID/Percent/ExemptionReasonCode+Reason for Z/E/O (BR-KSA-18/23/24/69/83/CL-04) | C | **no** | — | n/a (no subtotal) |
| `LegalMonetaryTotal/LineExtensionAmount` (BT-106, BR-CO-10) | M | **no** | `:308-312` | BR-CO-10 WARN |
| `TaxExclusiveAmount` (BT-109, BR-CO-13) | M | yes (excludes shipping) | `:309` | BR-CO-13 WARN |
| `TaxInclusiveAmount` (BT-112, BR-CO-15) | M | yes | `:310` | **BR-CO-15 ERROR** on 18/18 (rule evaluates VAT from the subtotal-bearing TaxTotal, absent) — genuinely inconsistent only in the shipping/adjustment shape |
| `AllowanceTotalAmount`/`ChargeTotalAmount`/`PrepaidAmount`/`PayableRoundingAmount` (BT-107/108/113/114) | C | **no** | — | arithmetic failures |
| `PayableAmount` (BT-115) | M | yes | `:311` | pass |
| Line `cbc:ID`, `InvoicedQuantity` (BT-129; `@unitCode` recommended) | M | yes (no unitCode) | `:243-244` | pass |
| Line `LineExtensionAmount` (BT-131, BR-KSA-EN16931-11) | M | yes (gross of line discount; tax-inclusive mismatch) | `:245` | BR-KSA-EN16931-11 WARN (tax-inclusive shape) |
| Line `cac:TaxTotal/TaxAmount` + `RoundingAmount` (KSA-11/12, BR-KSA-51/52/53) | M Std | **no** | — | **BR-KSA-52/53 ERROR (Std)** |
| Line `cac:Item/cbc:Name` (BT-153) | M | yes | `:246` | pass |
| Line `cac:Item/cac:ClassifiedTaxCategory` ID/Percent/TaxScheme (BT-151/152, BR-CO-04) | M | **no** | — | **BR-CO-04 ERROR** (18/18) |
| Line `cac:Price/cbc:PriceAmount` (BT-146 net) [+ `BaseQuantity` BT-149] | M | yes — gross when tax-inclusive (PH2-04) | `:247` | BR-KSA-EN16931-11 WARN (tax-inclusive shape) |
| Line `cac:AllowanceCharge` (BG-27/28) | C | **no** | — | — |
| XAdES: `SigningCertificate` + `IssuerSerial`, digest encodings, no policy (SDK profile) | M Simp | **no** (V2, no IssuerSerial, raw digests, policy present) | builder `:61-95` | **XSD ERROR + SIGNATURE ERROR** (X509IssuerName, NumberFormatException, xadesSignedPropertiesDigestValue, signingCertificateDigestValue) |
| `ds:SignatureValue` DER over hash bytes | M Simp | **no** (raw r‖s over SignedInfo) | signer `:31-35`, assembler `:100-101` | **SIGNATURE ERROR — wrong signature Value** |
| QR tags 6/7/8 encodings; tag 3 format | M Simp | **no** (raw/SEC1/`Z`) | encoder `:40-58` | **QR ERROR** (hashedXml, digital signature, publicKey); timeStamp WARN |
| QR tag 9 certificate signature | M Simp | yes | extractor `:49-100` | pass |
| Invoice hash transform + C14N 1.1 + SHA-256/base64 | M | **yes — identical to SDK** | hasher `:24-65` | 19/19 + 10/10 match |
| ICV uniqueness/sequence under concurrency; PIH chain | M | yes | `:59-75`, migration `000053:69` | P3 pass |

## Appendix B — What the existing tests assert vs do not assert (T1: 145 passed)

| Test class (tests) | Asserts | Does NOT assert |
|---|---|---|
| `ZatcaTest` (10) | amount formatting, TLV short values, phase-1 QR 5 tags, fractional qty rendering, document-type snapshot, stored hash == hasher(xml) | QR tag 3 format vs XML, length wrap, any official layout |
| `ZatcaPhase2Test` (8) | UUID v4, XML contains number/UUID/VAT/signature refs/QR, ICV increments, genesis PIH (AWJ form), PIH chaining, legacy re-canonicalisation, hash ≠ raw-text hash | hash vs official samples; ICV concurrency; environment scoping |
| `ZatcaInvoiceHasherTest` (3) | excluded nodes don't change hash, business change does, DTD rejected | equality with SDK/official DigestValue |
| `ZatcaXmlCanonicalizerContextTest` (5), `ZatcaXmlDsigSignedInfoBuilderTest` (3), `ZatcaXadesSignedPropertiesBuilderTest` (3), `ZatcaXadesSignatureAssemblerTest` (5), `ZatcaXmlEcdsaSignerTest` (9) | internal structure, namespace context, DER⇄raw round trip, id collisions, self-verification, policy/ID validation | conformance of element set/encodings to the ZATCA profile (they pin the deviations) |
| `ZatcaInvoiceSignerTest` (2), `ZatcaSignedInvoiceFinalizerTest` (3), `ZatcaSignedInvoicePostingTest` (3) | policy embedded, no key leak, fail-closed w/o credential/policy, rollback, QR tags 1–9 present and self-consistent | any SDK/official validation |
| `ZatcaPhaseTwoQrEncoderTest` (4), `ZatcaQrCertificateMaterialExtractorTest` (3), `ZatcaQrCredentialMaterialResolverTest` (1), `ZatcaSignedInvoiceQrMaterialExtractorTest` (19) | TLV packing, 700-char limit, 65-byte SEC1 key, cert-signature verifies vs CA, tamper detection in the signed block | official tag encodings (6/7/8), timestamp format |
| `ZatcaSignaturePolicyResolverTest` (3), `ZatcaSigningCredentialResolverTest` (4), `ZatcaSigningReadinessTest` (3) | fail-closed config, no env fallback, expiry, readiness codes without leakage | — |
| `ZatcaCredentialTest` (11) | encryption at rest, metadata, chain to anchor, key/cert match, EKU/KU/CA checks, expiry mismatch, stage change, tenant isolation, app guard | subject VAT/template/serial binding, rotation overlap |
| `ZatcaIcvScopeTest` (9) | tenant default, branch scope blocked server-side, unique index on `(tenant_id, zatca_icv)` | environment scoping, PG concurrency (my P3 covers it) |
| `ZatcaQrCertificateMaterialExtractorTest` note | The `TASK-QUEUE.md:294` flake (leading-zero EC coordinates) is mitigated by `str_pad` in the test (`:21-24`); the extractor itself pads (`:45-47`) — not a product defect. | |

## Appendix C — Probe artefacts

* `<audit-workspace>/probes/D/DHasherOfficialSamplesProbeTest.php`, `DGenerationProbeTest.php`, `DIcvPostgresConcurrencyProbeTest.php`
* `<audit-workspace>/work/D/out/` (18 XML + QR + `manifest.json`), `<audit-workspace>/work/D/sdk/{fatoora.sh,config.json,config-awj.json,sdk-hashes.txt,awj-hashes.txt,sdk-mut-hashes.txt,awj-mut-hashes.txt,validate-awj-outputs.log,validate-awj-outputs.summary.txt,samples/,mut/}`, `<audit-workspace>/work/D/sdk-javap/`, `<audit-workspace>/work/D/sdk-res/{invoice.xsl,removeElements.xsl}`, `<audit-workspace>/work/D/pki/` (synthetic), `<audit-workspace>/work/D/{verify_sig.php,tlv.php}`, `<audit-workspace>/work/D/xsd-awj-outputs.log`, `<audit-workspace>/logs/D-*.log`, DBs `<audit-workspace>/db/D-*.sqlite` + PostgreSQL `audit_d`.

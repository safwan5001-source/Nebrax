# REM-17 — Implementation report: digital signature, Phase-2 QR and PIH

| | |
|---|---|
| Status | **Draft PR — NOT merged, NOT deployed.** Branch `claude/rem-17-signature-qr-pih`. PR number, head SHA, CI and CI Gate are posted on the PR (this file cannot name its own SHA). |
| Authority | Owner instruction 2026-10-20 "REM-17 — Controlled Implementation (SECURITY-GATED)", subject to independent cryptographic verification; builds on `REM-17-SIGNATURE-QR-PIH-AUDIT.md` (read-only audit). |
| Base | `origin/main` = `e885d776ff893c37775d1242a9cab69603c291c6` (REM-16 merged). |
| Scope | Signing bytes, SignedProperties, SignedInfo reference, signature insertion, QR tags 6–8 (+ Phase-1 TLV guard), genesis PIH, the directly related extractors, and the SDK test tooling. **No migration.** No change to VAT, totals, journals, `issued_at`, `party_snapshot`, party/monetary XML, ICV, locking, posting transactions, POS, transport or credentials storage. No historical XML/QR/signature/hash/PIH regeneration. No live ZATCA call. |
| Not a compliance claim | SDK results are **advisory** and obtained with an **ephemeral synthetic credential**. They show conformance with the official validator, not acceptance by the live ZATCA platform (§8). |

## 1. Phase A — security verification (evidence gate)

Primary sources: *E-invoicing Detailed Technical Guidelines* v2 (DTG, Nov 2022) §5–6; *Security Features Implementation
Standards* v1.2 (SEC, 2023-05-19) §2.3.3 and §4; *XML Implementation Standard* v1.2 (XML), BR-KSA-26. Reference cases:
the 19 official signed samples shipped with SDK 238-R3.4.8. Independent reproduction used **the OpenSSL CLI and
stdlib Python only** (no SDK, no AWJ PHP), then the same checks became a permanent CI step (§5).

| # | Question | Official text | Independent reproduction | Verdict |
|---|---|---|---|---|
| 1 | Exact bytes signed | DTG step 2: "Sign the generated invoice hash … Generated Invoice Hash from Step 1 (**not encode**)" | `openssl dgst -sha256 -verify` on the official sample: **OK over the raw 32-byte hash**, FAIL over its hex text, FAIL over its Base64 text | **Verified** |
| 2 | Raw hash, not canonical SignedInfo | as above (SignedInfo is not the signed message) | verification over C14N(SignedInfo) fails on the official sample | **Verified** (deviates from generic XML-DSig by design) |
| 3 | Signature encoding | DTG example `MEQCIG…` | official SignatureValue decodes to an ASN.1 DER `SEQUENCE{INTEGER r, INTEGER s}` | **DER, verified** |
| 4 | XAdES signing certificate | DTG step 4 table: `SigningCertificate/Cert/CertDigest` + `IssuerSerial/X509IssuerName` + `X509SerialNumber` | official samples use v1 with IssuerSerial; the SDK XSD (`UBL-XAdESv132`) **rejects** `SigningCertificateV2`; issuer = Java `getIssuerDN().getName()` (`CN=PRZEINVOICESCA4-CA, DC=extgazt, DC=gov, DC=local`), serial decimal (hex fails XSD) | **v1 + IssuerSerial, verified**; SEC §2.3.3 says V2 — contradicted by the validator, see §7 |
| 5 | Certificate digest | DTG step 3: hash, then "encode … using base64" (example `NjlhOTVm…` = Base64 of the **hex text**) | official CertDigest = Base64(hex(SHA-256(certificate Base64 text))) on 19/19 samples; Base64(SHA-256(DER)) (pre-REM-17) does not match | **Verified** |
| 6 | SignedProperties digest | DTG step 5: "linearize … remove the spaces", example `mSglVb…` = Base64 of **raw** bytes | official digest = Base64(hex(SHA-256(T))) where T = embedded element **with its whitespace**, `xmlns:xades` on the root and `xmlns:ds` on each `ds:` element (the SDK's node serialisation); linearised form and raw-bytes form both fail; the SDK **rejects** the raw-bytes form (SIGNATURE FAILED, control PASSED) | **Verified against samples + validator**; the DTG step 5 example is inconsistent with both, see §7 |
| 7 | QR tags 6–9 | DTG §6.2 table + published TLV example; SEC §4.1 | decoding the DTG example: 6 = 44-byte Base64 text, 7 = 96-byte Base64 text of a DER signature, 8 = 88-byte DER `SubjectPublicKeyInfo` (`30 56 30 10 06 07 2A 86 48 CE 3D 02 01 06 05 2B 81 04 00 0A …`), 9 = 72-byte DER CA signature; official samples identical | **Verified** (SEC's "tag 6 = 32 bytes" contradicts the DTG example and the SDK) |
| 8 | Genesis PIH | XML BR-KSA-26: "For the first invoice, the previous invoice hash is `NWZlY2Vi…OQ==`, the equivalent for base64 encoded SHA256 of "0"" | literal = Base64 of the **hex text** of SHA-256("0"); identical to SDK `Data/PIH/pih.txt` and to the PIH of all 19 samples | **Verified** |
| — | `SignaturePolicyIdentifier` / `DataObjectFormat` | SEC §2.3.3: cardinality **1** for both; absent from DTG and samples | SDK XSD accepts both; the SDK's SignedProperties digest covers them (one changed policy-digest character → SIGNATURE FAILED); with both present the SDK reports GLOBAL PASSED | **Kept** — no evidence supports removal; the fail-closed policy gate is untouched |

## 2. What changed

| Area | Before (main) | After |
|---|---|---|
| `ZatcaXmlEcdsaSigner` | signs C14N(SignedInfo); SignatureValue = raw r‖s (64 B) | signs the **raw 32-byte invoice hash**; SignatureValue = Base64(**DER**); strict canonical-DER check (`assertCanonicalDer`); secp256k1 and key/certificate match checks kept |
| `ZatcaXadesSignedPropertiesBuilder` | DOM-built; `SigningCertificateV2`; CertDigest = Base64(SHA-256(DER)); C14N digest | fixed official layout (36/+4-space indentation); `SigningCertificate` v1 with `Cert{CertDigest, IssuerSerial}` per chain certificate (leaf first); hex-text digests; returns `{xml, digest}`; `digest()` refuses ambiguous input (namespace declarations, entities, comments, CR, foreign prefixes); policy identifier with XML-special characters is rejected (fail closed) |
| `ZatcaCertificateFields` (new) | — | DER reader: issuer in the SDK's Java format (CN/C/L/ST/O/OU/DC; multi-valued RDN, unknown attribute or value needing quoting → reject), decimal serial without bcmath/gmp, certificate SPKI |
| `ZatcaXmlDsigSignedInfoBuilder` | C14N transform on the SignedProperties reference | no Transforms on that reference (as in the samples); SignedProperties digest validated as Base64 of 64 lowercase hex chars |
| `ZatcaXadesSignatureAssembler` | DOM import + `saveXML()` of the whole invoice | builds the extension as text and inserts it **directly after the root start tag** (or before the closing tag of an existing wrapper, preserving unrelated extensions); then re-parses and fails closed if the invoice hash changed |
| `ZatcaSignedInvoiceQrMaterialExtractor` | verified raw r‖s over SignedInfo, C14N SignedProperties digest, V2 digests | verifies ECDSA over the raw hash, SignedProperties digest from the embedded **text** bound to the DOM element (exclusive-C14N equality), v1 CertDigest + IssuerSerial per KeyInfo certificate, no Transforms on the properties reference; returns `invoice_hash` (raw), `invoice_digest` and `signature_value` (canonical Base64 text) |
| `ZatcaQrCertificateMaterialExtractor` | tag 8 = 65-byte SEC1 point | tag 8 = DER SPKI **as encoded in the certificate**; tag 9 unchanged |
| `ZatcaPhaseTwoQrEncoder` | tag 6 raw 32 B, tag 7 raw 64 B, tag 8 raw point | tag 6 = 44-char Base64, tag 7 = Base64 of DER, tag 8 = secp256k1 SPKI (88 / 56 bytes); 1–255-byte and 700-char limits kept; **tag 3 unchanged** |
| `ZatcaSignedInvoiceFinalizer` | QR from raw material | QR from the text material; stored `hash` = the verified DigestValue text (same value as before for the same XML) |
| `ZatcaService` | genesis = Base64(raw SHA-256("0")); Phase-1 `tlv()` unguarded | genesis = BR-KSA-26 literal; `LEGACY_GENESIS_HASH` kept only to recognise old chains; `tlv()` rejects values > 255 bytes (no truncation) |

Unchanged on purpose: `ZatcaInvoiceHasher` (already matched the official DigestValue 4/4 in the audit), ICV allocation
and locking, credential resolution (`ZatcaSigningCredentialResolver`, tenant-scoped), `ZatcaSignaturePolicyResolver`
and `ZatcaSigningReadiness` (posting still blocks without a pinned policy), `Target="#signature"` and the
`Reference Type` (both accepted by the SDK; not shown wrong), `SigningTime` with `Z` (accepted; samples omit the zone),
KeyInfo with the full chain (SEC 1.5.1; accepted by the SDK).

## 3. PIH and historical compatibility

| Case | Behaviour | Proof |
|---|---|---|
| Truly new sequence (no posted invoice with a hash in the ICV scope) | PIH = BR-KSA-26 literal | `a_new_signed_sequence_starts_at_the_official_genesis…`, `first_invoice_uses_the_genesis_previous_hash` |
| Continuing sequence | PIH = hash of the **stored XML** of the previous invoice (unchanged rule) | same test: invoices 2 and 3 |
| Existing chain started with the old genesis | continued from its stored XML; the old first link is **not** repaired, re-signed or re-hashed; counters not reset | `a_chain_started_with_the_pre_rem17_genesis…` asserts the historical row is byte-identical after the next posting |
| Other tenant / ICV scope | independent chain and credential; no credential → Phase 1 | `tenants_keep_separate_chains_and_credentials` |

**Implication for REM-25:** any non-production chain whose first invoice carries `X+zrZv…` (old genesis) — and any
invoice signed with the pre-REM-17 format — stays non-conformant forever. They are left as-is here; the pre-production
reset/flag decision belongs to REM-25.

## 4. Financial invariants

No journal, VAT, total, rounding, `issued_at` or `party_snapshot` code is touched; the only XML that changes is inside
`ext:UBLExtensions` (excluded from the invoice hash) and the PIH value of a **new** chain's first invoice. Posting
still runs inside the same `InvoiceService::post()` transaction: a signing, QR or TLV failure rolls back the journal,
ICV and status (tests: missing credential, missing policy, oversized TLV). **No new financial operation → no new
journal entry to review.**

## 5. Tests

* **PHP (Feature):** signer (raw-hash DER signature verified independently with `openssl_verify`, hex/Base64 message
  rejected, malformed DER incl. the pre-REM-17 raw form, wrong curve, wrong key); SignedProperties (exact official
  layout, hand-written T digest, DTG step 1/3 encoding examples, whitespace sensitivity, ambiguous input, policy gate,
  issuer that cannot be represented, Java issuer format + decimal serial); SignedInfo (no transform on the properties
  reference); assembler (no re-serialisation: the invoice minus the extension is byte-identical; T digest; signature
  verifies over the raw hash and **not** over SignedInfo; full-chain v1 certificates; policy present); extractor
  (24 cases: forged/other-key/pre-REM-17 signatures, replaced KeyInfo certificate, distributed digests, raw cert
  digest, raw properties digest, wrong IssuerSerial, policy mutation, transforms, DataObjectFormat, trailing DER,
  wrapped Base64); QR encoder (**byte-for-byte match of tags 1–4 and 6–9 with the DTG published example**, real
  synthetic material, pre-REM-17 raw forms rejected, oversize rejected, tag 3 contract); certificate extractor and
  credential resolver (tag 8 = OpenSSL's SPKI); finalizer and posting (tags 6/7 equal the XML values, independent
  verification, PIH chain matrix, tenant isolation, re-post rejected without touching signed artefacts, Phase-1 TLV).
* **Harness (`scripts/zatca-sdk/tests`, 84 tests, +11):** SignedProperties digest vs a hand-written T, TLV/DER
  helpers, signed-run flag pairing, second SDK config, `awj_signed` ratchet, mutation target, genesis literal,
  aggregated official crypto metadata.
* **Concurrency/idempotency:** ICV locking and the `unique(tenant_id, zatca_icv)` index are untouched and remain
  covered by the existing suites; a re-post is rejected by `InvoiceService::post()` before any signing.

## 6. Official SDK diagnostics, before → after (238-R3.4.8, JDK 11, advisory)

| Fixture set | Before (main) | After |
|---|---|---|
| Unsigned AWJ fixtures (committed) | every fixture PIH FAILED (KSA-13); simplified also QR/SIGNATURE (unsigned by construction) | PIH PASSED everywhere; **10 standard fixtures GLOBAL PASSED**; simplified fail only QR/SIGNATURE/BR-KSA-28 because they are unsigned; zero-rate EN (REM-12) |
| AWJ output signed by the pipeline (audit run, SDK test credential) | XSD SAXParseException (V2), SIGNATURE: wrong signature value / SignedProperties digest / certificate digest / X509IssuerName / serial, QR: tags 6/7/8 mismatch, PIH KSA-13 | — |
| AWJ fixtures **stamped at run time by the production classes** (ephemeral synthetic CA + leaf) | — | **13/14 GLOBAL PASSED** (all 3 simplified pass QR + SIGNATURE + PIH); `awj-standard-zero-rate` FAILED EN BR-CO-04/BR-CO-18 = documented REM-12 gap |
| Signed mutation (policy digest, 1 char) | — | SIGNATURE FAILED (liveness) |
| Independent crypto checks (OpenSSL CLI) | — | 19/19 official reference samples OK, 14/14 stamped AWJ fixtures OK |
| Official samples (oracle) | 19/19 PASSED | 19/19 PASSED |

The SDK does not run SIGNATURE/QR for standard invoices; for those, the independent OpenSSL checks are the signature
evidence. Unrelated gates are unchanged (forbidden-warning lists, known gaps, ratchet controls).

## 7. Conflicts in the official material (recorded, not guessed)

| Topic | Conflict | Choice and reason |
|---|---|---|
| Signing certificate | SEC §2.3.3: `SigningCertificateV2`; DTG, samples, XSD: v1 + IssuerSerial | v1 — the validator's schema rejects V2 |
| SignedProperties digest | DTG step 5 text/example: linearised, raw-bytes Base64; samples + validator: whitespace-preserving, hex-text Base64 | samples + validator (raw form proven rejected) |
| QR tag 6 | SEC §4.1: 32-byte value; DTG example + SDK: 44-byte Base64 text | DTG example + SDK |
| Policy / DataObjectFormat | SEC: mandatory; DTG/samples: absent | kept (SEC is normative, SDK accepts, no evidence for removal) |
| Signing time zone | samples: no zone; AWJ: `Z` | unchanged (`xsd:dateTime`, accepted; not shown wrong) |

## 8. Remaining questions and risks

* **Real ZATCA acceptance is unverified.** No live call was made; the SDK oracle with a synthetic credential is not
  the platform. The choices in §7 must be confirmed in the compliance (sandbox) environment under REM-19/REM-21,
  with separate owner approval.
* **Signature policy values.** The official policy identifier and SHA-256 are not available in the evidence set;
  signing keeps failing closed until they are pinned in configuration. If ZATCA's platform rejects a policy element
  (not observed in the SDK), that is a new owner decision, not a silent removal.
* **Q1 / TAX-E01:** QR tag 3 format and zone remain open; not changed here (SDK does not check tag 3).
* **Certificate chain in `SigningCertificate`/KeyInfo:** AWJ keeps every chain certificate (SEC); the samples carry
  a single certificate. Accepted by the SDK; to be confirmed with a real CSID.
* **Issuer formats:** issuer names outside CN/C/L/ST/O/OU/DC or needing quoting fail closed instead of being guessed.
* **Whitespace sensitivity:** any future re-serialisation of signed XML (pretty print, CRLF, DOM `saveXML()` of the
  whole document) would break the SignedProperties digest; the extractor detects it and the tests pin it.
* **Legacy artefacts:** old-genesis chains and pre-REM-17 signatures remain as stored (→ REM-25).

## 9. Recommended next step

Owner review of this Draft PR. After merge: REM-18 (credit/debit notes through the same pipeline), then the
compliance-environment confirmation of §7 as part of REM-19/REM-21 — each a separate approval; no deploy and no live
transmission from this slice.

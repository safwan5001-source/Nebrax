# R2 — ZATCA SDK offline how-to (tested 2026-10-10 in this sandbox)

Status: **SDK WORKS OFFLINE** — all 19 bundled ZATCA samples pass `-validate` (XSD + EN16931 Schematron + KSA Schematron + QR + SIGNATURE + PIH) with the setup below. Every command here was executed in this sandbox; outputs are quoted verbatim.

## 0. What is installed where (all under <audit-workspace>, nothing touches the repo)

| Item | Path / value |
|---|---|
| `SCR` | `<audit-workspace>` |
| SDK zip (official, from the Developer Portal SharePoint link embedded in `https://sandbox.zatca.gov.sa/env-config.js` → `REACT_APP_DOWNLOAD_SDK_JAVA`) | `<audit-workspace>/official/downloads/R2/sdk-java/zatca-sdk-java.zip` — resolved file name `zatca-einvoicing-sdk-Java-238-R3.4.8.zip`, 49 169 499 bytes, **sha256 `91d079b4a6c21c8ed7fb6ec434227409537119cae8b74de34dc150f91793d1f6`** |
| SDK version | **238-R3.4.8** (`Apps/global.json` = `{"version":"238-R3.4.8"}`; banner prints "ZATCA E-Invoice Java SDK 3.4.8") |
| SDK root (`SDK`) | `<audit-workspace>/official/downloads/R2/sdk-java/extracted/zatca-einvoicing-sdk-Java-238-R3.4.8` |
| SDK jar | `$SDK/Apps/zatca-einvoicing-sdk-238-R3.4.8.jar` |
| Rule sets used by the jar | `$SDK/Data/Rules/Schematrons/CEN-EN16931-UBL.xsl` (EN) and `$SDK/Data/Rules/Schematrons/20210819_ZATCA_E-invoice_Validation_Rules.xsl` (KSA) |
| XSD | `$SDK/Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd` (+ `common/*.xsd`, incl. XAdES 1.3.2/1.4.1 and xmldsig) |
| SDK dummy cert / key (public test material shipped by ZATCA; readme: "dummy and for testing purposes only") | `$SDK/Data/Certificates/cert.pem` (base64 DER, no headers), `$SDK/Data/Certificates/ec-secp256k1-priv-key.pem` (secp256k1, no headers) |
| PIH file used by the `[PIH]` check | `$SDK/Data/PIH/pih.txt` = `NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ==` (verified: this is base64 of the lowercase hex string `5feceb66ffc86f38d952786c6d696c79c2dbc239dd4e91b46729d73a27fb57e9`, which is SHA-256 of the one-byte string `0` — i.e. the "first invoice in the chain" PIH value; see register R2 for the normative source) |
| **JDK 11** (required — see §1) | `<audit-workspace>/official/downloads/R2/jdk11/extracted/jdk-11.0.32.1+1` (Temurin 11.0.32.1+1, tarball sha256 `5c3f68887c325d36d852ba534303e1f5f1f5cae7d6cc1e951d73e0d8e98a058d`, from `api.adoptium.net`) |
| My SDK config (absolute paths; the SDK reads it through `SDK_CONFIG`) | `<audit-workspace>/official/R2-work/sdk-config.json` |
| Run logs | `<audit-workspace>/official/R2-work/validate-all-samples-jdk11.log`, `<audit-workspace>/official/R2-work/sample-hashes-jdk11.txt`, `<audit-workspace>/official/R2-work/validate-all-samples.log` (the Java-21 run, for comparison) |
| Working dirs for runs | `<audit-workspace>/official/R2-work/run`, `<audit-workspace>/official/R2-work/run-sign` (sign/qr/csr outputs) |

The SDK's own `install.sh` writes `~/.bash-profile`, `~/.zshrc` and rewrites `Configuration/config.json`; I did **not** run it (untrusted download). The equivalent is the `SDK_CONFIG`/`FATOORA_HOME` env vars below plus my own config file.

## 1. Two pitfalls you MUST handle (both reproduced here)

1. **Java 21 cannot verify/sign secp256k1.** The sandbox default `java` (OpenJDK 21.0.12.1) runs XSD/EN/KSA/PIH checks fine, but the `[SIGNATURE]` stage fails with `[ERROR] ECDSAUtil - Curve not supported: secp256k1 (1.3.132.0.10)` (JDK 16+ removed secp256k1 from SunEC). The SDK readme says Java "must be between 11 and 15". → use the Temurin JDK 11 above.
2. **JDK 11 + POSIX locale silently changes the hash.** This sandbox has `LANG=` (POSIX), so JDK 11's `file.encoding = ANSI_X3.4-1968`. The SDK then reads the Arabic seller name as `?` bytes and computes a **different invoice hash** (`hhFlJ5oPtv49uDM3J5s6BjbPwZ/jLloTy9Brk0nQOWU=` instead of the correct `z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=` for `Simplified_Invoice.xml`), and `-validate` then reports `QR … sellerName / hashedXml` and `SIGNATURE … invoiceSignedDataDigestValue: wrong invoice hashing` — all false negatives. Java 18+ defaults to UTF-8 (JEP 400) which is why Java 21 got the hash right. → **always pass `-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8`** on JDK 11 (or export `LANG=C.UTF-8`). With that, JDK 11 and Java 21 produce identical hashes for all 19 samples.

`JAVA_TOOL_OPTIONS` is preset by the sandbox (truststore + proxy settings). It is harmless for offline use; the JVM prints `Picked up JAVA_TOOL_OPTIONS: …` on stderr — filter it with `grep -v 'Picked up'`. Do not unset it.

## 2. Environment block (copy–paste; every command below assumes it)

```bash
SCR=<audit-workspace>
SDK=<audit-workspace>/official/downloads/R2/sdk-java/extracted/zatca-einvoicing-sdk-Java-238-R3.4.8
J11=<audit-workspace>/official/downloads/R2/jdk11/extracted/jdk-11.0.32.1+1
export SDK_CONFIG=<audit-workspace>/official/R2-work/sdk-config.json   # absolute paths to XSD/XSL/cert/key/pih
export FATOORA_HOME=$SDK/Apps                              # only needed by the fatoora wrapper script
JOPTS="-Dfile.encoding=UTF-8 -Dsun.jnu.encoding=UTF-8 -Djdk.module.illegalAccess=deny -Djdk.sunec.disableNative=false"
JAR=$SDK/Apps/zatca-einvoicing-sdk-238-R3.4.8.jar
fatoora() { "$J11/bin/java" $JOPTS -jar "$JAR" --globalVersion 238-R3.4.8 "$@" 2>&1 | grep -v 'Picked up JAVA_TOOL_OPTIONS'; }
mkdir -p <audit-workspace>/official/R2-work/run-<STREAM> && cd <audit-workspace>/official/R2-work/run-<STREAM>   # run from YOUR OWN dir, never from inside $SDK
```

Notes: the `-Djdk.module.illegalAccess=deny -Djdk.sunec.disableNative=false` flags are exactly what `$SDK/Apps/fatoora` passes. `--globalVersion 238-R3.4.8` is also passed by the wrapper (the jar prints its banner from it). The jar **never contacts the network** for `-validate/-generateHash/-qr/-sign/-csr/-invoiceRequest`; the `-nonprod`/`-sim` flags only change the CSR certificate-template name (§6). Do **not** use any other tool/flag that would submit anything.

Exit code: the jar returns **0 even when GLOBAL VALIDATION RESULT = FAILED** — parse the text (`GLOBAL VALIDATION RESULT = PASSED|FAILED`), never rely on `$?`.

## 3. (1) Validate an arbitrary invoice XML offline

```bash
fatoora -validate -invoice /absolute/path/to/invoice.xml
```

Stages printed (in this order), each `PASSED`/`FAILED`, followed by `*** GLOBAL VALIDATION RESULT = …`:

| Stage | What it checks (observed) |
|---|---|
| `[XSD]` | UBL 2.1 Invoice XSD (`UBL-Invoice-2.1.xsd`) |
| `[EN]` | EN 16931 Schematron (`CEN-EN16931-UBL.xsl`) — BR-xx / BR-CO-xx / BR-S/Z/E/O-xx rules |
| `[KSA]` | ZATCA Schematron (`20210819_ZATCA_E-invoice_Validation_Rules.xsl`) — BR-KSA-xx rules; **warnings** are printed as `ksa validation warnings` with `[WARN] CODE : BR-KSA-nn` and do not fail the stage (e.g. all 5 simplified samples print `BR-KSA-98` "should be submitted within 24 hours" because their issue dates are 2022) |
| `[QR]` | Only runs for **simplified** documents (InvoiceTypeCode/@name 2nd digit = 1 → `02xxxxx`). Decodes the base64 TLV in `cac:AdditionalDocumentReference[cbc:ID='QR']` and compares tags with the XML: errors seen are `sellerName`, `hashedXml` (tag 6 vs computed hash), etc. |
| `[SIGNATURE]` | Only for simplified documents. Re-computes the invoice hash (`invoiceSignedDataDigestValue`), the SignedProperties digest and verifies `ds:SignatureValue` with the certificate in `ds:X509Certificate` (error codes seen: `invoiceSignedDataDigestValue: wrong invoice hashing`, `signatureValue: wrong signature Value`). **For standard documents (`01xxxxx`) the QR and SIGNATURE stages are not executed at all** (the sample standard invoices carry a signature + QR, yet the validator prints only XSD/EN/KSA/PIH) — consistent with ZATCA signing standard invoices itself at clearance. |
| `[PIH]` | Compares `cac:AdditionalDocumentReference[cbc:ID='PIH']/…/cbc:EmbeddedDocumentBinaryObject` with the value in the file named by `pihPath` in `SDK_CONFIG` (default `Data/PIH/pih.txt`). To validate a chain, write the previous invoice's hash into your own pih file and point `pihPath` at it (copy `sdk-config.json` and edit `pihPath`). |

Error lines look like `[ERROR] ValidationProcessorImpl - CODE : BR-KSA-26, MESSAGE : [BR-KSA-26] - …` (Schematron rule id + message); warnings use `[WARN]`.

Proof (JDK 11 + UTF-8, `<audit-workspace>/official/R2-work/validate-all-samples-jdk11.log`): **19/19 samples → GLOBAL VALIDATION RESULT = PASSED**; the only messages are the 5 `BR-KSA-98` warnings. Under Java 21 the 14 standard samples pass and the 5 simplified ones fail only at `[SIGNATURE]` (curve error) — `<audit-workspace>/official/R2-work/validate-all-samples.log`.

### Fallbacks if the jar cannot be used
* XSD only: `xmllint --noout --schema $SDK/Data/Schemas/xsds/UBL2.1/xsd/maindoc/UBL-Invoice-2.1.xsd invoice.xml`
* Schematron (the SDK ships the compiled XSLT2 stylesheets, not raw .sch; libxslt is XSLT 1.0 so `xsltproc` will NOT run them). Saxon-HE is not in the SDK; if Maven can reach Maven Central, `mvn dependency:get -Dartifact=net.sf.saxon:Saxon-HE:12.5` then `java -cp Saxon-HE.jar net.sf.saxon.Transform -s:invoice.xml -xsl:$SDK/Data/Rules/Schematrons/20210819_ZATCA_E-invoice_Validation_Rules.xsl` produces an SVRL report (`svrl:failed-assert/@id` + `flag="fatal|warning"`). Not needed here because the jar works.

## 4. (2) Compute the invoice hash offline

```bash
fatoora -generateHash -invoice /absolute/path/to/invoice.xml
# → [INFO] HashGenerationService -  *** INVOICE HASH = <base64 of SHA-256>
```

Verified against the sample's own embedded value: `Simplified_Invoice.xml` → `z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=` = first `ds:DigestValue` in the file = QR tag 6. The hash is of the **canonicalised invoice with the `ext:UBLExtensions`, `cac:Signature` and the QR `cac:AdditionalDocumentReference` removed** (per the Security Features standard — see register R2 for the exact transform list). The command works with or without an existing signature in the file, and the result for all 19 samples is in `<audit-workspace>/official/R2-work/sample-hashes-jdk11.txt` (also in `R2-reference-samples/INDEX.md`).

To test an AWJ-generated XML byte-for-byte: run `-generateHash` on AWJ's unsigned output and compare with AWJ's own `invoiceHash`; then run `-validate` on AWJ's signed output.

## 5. (3) Generate a QR offline

```bash
fatoora -qr -invoice /absolute/path/to/invoice.xml
# → [INFO] QrGenerationService -  *** QR code = <base64 TLV>
```

The SDK signs the hash with the key in `privateKeyPath` and embeds the cert public key from `certPath`, so with the SDK dummy key the tag-7 signature will differ from what a real EGS would produce; tags 1–6 and 8 are deterministic. Decode with:

```bash
python3 -I - "$FILE_OR_B64" <<'EOF'
import sys,base64,re
s=sys.argv[1]
if s.endswith('.xml'):
    x=open(s,encoding='utf-8').read()
    s=re.search(r'<cbc:ID>QR</cbc:ID>.*?<cbc:EmbeddedDocumentBinaryObject[^>]*>([^<]*)<',x,re.S).group(1).strip()
b=base64.b64decode(s); i=0
while i<len(b):
    t,l=b[i],b[i+1]; v=b[i+2:i+2+l]; i+=2+l
    print(t,l, v.decode('utf-8') if t<=6 else base64.b64encode(v).decode())
EOF
```

Observed on `Simplified_Invoice.xml`: tag1 seller name (UTF-8, 111 bytes incl. Arabic), tag2 VAT `399999999900003`, tag3 `2022-08-17T17:41:08` (IssueDate + "T" + IssueTime, no zone), tag4 `231.15`, tag5 `30.15`, tag6 = invoice hash (base64 text, 44 bytes), tag7 = ECDSA signature (DER, raw bytes, 96 bytes here), tag8 = public key (DER SubjectPublicKeyInfo, 88 bytes), tag9 = certificate signature (71 bytes; simplified only). On the standard sample the SDK emitted tags 1–8 only (no tag 9). Note that the TLV length byte is a single byte (max 255) — a long seller name must fit.

## 6. (4) Generate a SYNTHETIC CSR + key offline (never send it anywhere)

```bash
cp $SDK/Data/Input/csr-config-example-EN.properties ./csr.properties   # edit values; keep the key format
fatoora -csr -csrConfig ./csr.properties -privateKey ./synthetic.key -generatedCsr ./synthetic.csr -pem -nonprod
# → [INFO] CsrGenerationService - csr and private key have been generated successfully.
openssl req -in ./synthetic.csr -noout -text      # inspect (do NOT cat the .key; delete it when done)
```

Properties (from `csr-config-template.properties`): `csr.common.name`, `csr.serial.number` (format `1-<solution>|2-<model>|3-<serial/uuid>`), `csr.organization.identifier` (15-digit VAT; VAT-group example uses `…10003` with `csr.organization.unit.name=3999999999` = 10-digit TIN), `csr.organization.unit.name`, `csr.organization.name`, `csr.country.name=SA`, `csr.invoice.type` (4 chars, e.g. `1100` = standard+simplified), `csr.location.address`, `csr.industry.business.category`.

Verified CSR content: subject `C=SA, OU=…, O=…, CN=…`; `id-ecPublicKey` on **secp256k1**, signed `ecdsa-with-SHA256`; requested extension OID `1.3.6.1.4.1.311.20.2` (certificate template name) = **`TSTZATCA-Code-Signing` with `-nonprod`, `PREZATCA-Code-Signing` with `-sim`, `ZATCA-Code-Signing` with neither (production)**; SAN = `DirName:/SN=1-TST|2-TST|3-ed22f1d8-…/UID=399999999900003/title=1100/registeredAddress=RRRD2929/businessCategory=Supply activities`. Without `-pem` the key file has no PEM header/footer (the SDK's own `privateKeyPath` expects that headerless form).

## 7. (5) Sign offline and build the API request body (offline only — do not POST)

```bash
fatoora -sign -invoice ./in.xml -signedInvoice ./in_signed.xml          # uses privateKeyPath/certPath from SDK_CONFIG
fatoora -invoice ./in_signed.xml -invoiceRequest -apiRequest ./req.json # {"invoiceHash","uuid","invoice"(base64 of the exact file bytes)}
```

Observed `-sign` on `Standard_Invoice.xml`: only the SignedProperties `ds:DigestValue`, `ds:SignatureValue`, `xades:SigningTime` and the QR were rewritten; the invoice-hash `ds:DigestValue` stayed `V4U5…` (content unchanged). `-invoiceRequest` output verified: `invoice` decodes to the exact input bytes (14 319 = 14 319), `uuid` = `cbc:UUID`, `invoiceHash` = the hash.

## 8. Proof run on the bundled samples (JDK 11 + UTF-8) — all PASS

| Sample (under `$SDK/Data/Samples/`) | GLOBAL | SDK invoice hash (`-generateHash`) |
|---|---|---|
| Simplified/Credit/Simplified_Credit_Note.xml | PASSED (warn BR-KSA-98) | `2kBYLvmDlvKUxK/0ma+P8jFkKoiPh5VKBWjXERwUfxk=` |
| Simplified/Debit/Simplified_Debit_Note.xml | PASSED (warn BR-KSA-98) | `dfjtLDke0UXB4HBHzHKazFkI7X4v9xuC0IqhSEo1q4s=` |
| Simplified/Invoice/Nominal supply invoice.xml | PASSED (warn BR-KSA-98) | `HAQHJtkf26inGt3FSEH+a9nsfwym2+E+USHMQsQ7LRQ=` |
| Simplified/Invoice/Simplified Tax Invoice with Zero Rated Item.xml | PASSED (warn BR-KSA-98) | `mEAt3zjZkWFMybqAd13/fzD9trjTH7IN/7fwCaY6x1w=` |
| Simplified/Invoice/Simplified_Invoice.xml | PASSED (warn BR-KSA-98) | `z5F9qsS6oWyDhehD8u8S0DaxV+2CUiUz9Y+UsR61JgQ=` |
| Standard/Credit/Standard_Credit_Note.xml | PASSED | `5Xlh01O838SAab0AS6EGBMdBKI0ySC0ORnrCmnU1Zyc=` |
| Standard/Debit/Standard_Debit_Note.xml | PASSED | `111hQXj+6NtfV62H0ITiDNgOJvcatTi3l41yDEE04F8=` |
| Standard/Invoice/Advance Payment adjustments with foreign currency invoice.xml | PASSED | `X8bJTYWHeDvj5LT5+3IYa+ZM1RsMCbb+jdiuJaLPtfI=` |
| Standard/Invoice/Advance Payment adjustments with rate change scenarios.xml | PASSED | `rTzrcdCxsy2AKggmE/GF/74nam3nWfyoKVAjw4i15DM=` |
| Standard/Invoice/Advance Payment adjustments.xml | PASSED | `HQjeJXzWRxy31s/6+c2/TnuhfJan+qs/crD+3KY7Ags=` |
| Standard/Invoice/Exempt Tax Invoice.xml | PASSED | `gWq83vY3XHm+IjotFLytOfFkICnSw7DQVh/HqPXO32c=` |
| Standard/Invoice/Export invoice.xml | PASSED | `XfSK7Mlkrfa7AxO0FGs239XaChGQEAEtA0yqbjWoXzo=` |
| Standard/Invoice/Out of Scope Standard Tax Invoice.xml | PASSED | `fip622GtqjPUX0MbZFLRnB2A1vm6dkreGppW7z/fz2M=` |
| Standard/Invoice/Self-billing invoice.xml | PASSED | `B1KniPzxb1Jzv9P8Gb1h2PWSmyGdcfQorHw6RdOjVrY=` |
| Standard/Invoice/Standard Invoice with Document Level Charge.xml | PASSED | `20+7kdZgFAtIBs6vlOThRd/i8EXnKFO6pNfl+4o/dzk=` |
| Standard/Invoice/Standard Invoice with Payable Rounding Adjustment.xml | PASSED | `zKThBQhq2W1tg4aF5W9eVrdDGdbDLsttg+PdYwWcDBk=` |
| Standard/Invoice/Standard_Invoice.xml | PASSED | `V4U5qlZ3yXQ/Si1AC/R8SLc3F+iNy27wdVe8IWRqFAQ=` |
| Standard/Invoice/Summary Invoice.xml | PASSED | `J5VXfDOuhTmOt62zD7Cd2NXrGaBSFYDF8vTVksI6Ne8=` |
| Standard/Invoice/Third party billing.xml | PASSED | `6MdujX85cX43ZUaFJMxJOodQXxMG+zzdWmNTqsK4lR0=` |

Copies of all 19 samples (+ `pih.txt`, dummy public cert) are in `<audit-workspace>/official/R2-reference-samples/` with `INDEX.md`.

## 8b. Byte-for-byte reference implementation of the three digests (VERIFIED on all 19 samples)

`<audit-workspace>/official/R2-reference-samples/zatca_hash_reference.py` (stdlib + lxml, run with `python3 -I`) reproduces, for any signed or unsigned invoice:

1. **Invoice hash** = base64(SHA-256(inclusive C14N of the document after removing `ext:UBLExtensions`, `cac:Signature` and `cac:AdditionalDocumentReference[cbc:ID='QR']` **while keeping each removed element's tail whitespace**)). Dropping the tail (what a naive DOM `remove()` does) gives a different hash — this was the only mistake in the first attempt.
2. **SignedProperties digest** (2nd `ds:DigestValue`) = base64(**hex**(SHA-256(UTF-8 text of the `xades:SignedProperties` element exactly as the SDK template writes it — see `R2-reference-samples/sdk-jar-templates/xml/ubl.xml` — i.e. 4-space indentation with the children at 36 spaces and the closing tag at 32 spaces, `xmlns:xades="http://uri.etsi.org/01903/v1.3.2#"` placed before `Id=` on the root, `xmlns:ds="http://www.w3.org/2000/09/xmldsig#"` on every `ds:*` element, `<ds:DigestMethod …/>` self-closed, LF line ends, no trailing newline))). It is **not** a C14N digest (inclusive and exclusive C14N both fail). The exact hashed text per sample is dumped in `R2-reference-samples/derived/<sample>.signedproperties-hashed-text.xml`.
3. **CertDigest** = base64(**hex**(SHA-256(the base64 *text* of `ds:X509Certificate`))) — not the DER bytes.

Run: `python3 -I <audit-workspace>/official/R2-reference-samples/zatca_hash_reference.py <invoice.xml> --dump-dir <dir>` → prints each computed value next to the value in the file with MATCH/MISMATCH, decodes the QR TLV (tag 7 is checked to be the ASCII base64 text of `ds:SignatureValue`, tags 8/9 raw DER). Log of the 19-sample run: `<audit-workspace>/official/R2-work/reference-script-run.log` (57 MATCH, 0 MISMATCH). Use it as the oracle for AWJ's canonicaliser/hasher before involving the jar.

## 9. Reading results programmatically

```bash
out=$(fatoora -validate -invoice "$f"); echo "$out" | grep -oE 'GLOBAL VALIDATION RESULT = [A-Z]+'
echo "$out" | grep -E '\[(ERROR|WARN)\] .*CODE :' | sed 's/^[0-9-]* [0-9:,]* //'   # rule ids + messages
```

Stage lines: `[INFO] ValidationProcessorImpl - [XSD|EN|KSA|QR|SIGNATURE|PIH] validation result : PASSED|FAILED`. The `[ERROR] … ksa validation warnings :` header line is printed even when the items under it are `[WARN]` — treat only `[ERROR] … CODE :` lines as failures.

Also available: `$SDK/Configuration/usage.txt` (full flag list), `$SDK/Readme/readme.md` (official readme, 401 lines).

# SDK validation extracts (ZATCA E-Invoice Java SDK 238-R3.4.8, offline, JDK 11, UTF-8)

Extracts of the validator output for AWJ-generated documents and for the arithmetic/rounding experiments cited in deliverable A §8.2. Timestamps stripped, paths sanitised, messages cut at 330 characters. The SDK, its rule files and the official sample documents are ZATCA's and are not redistributed here.

## AWJ standard invoice (unsigned, Phase-1 contract)

```text
[ERROR] XsdValidator - Schema validation failed due to SAXParseException
[INFO] ValidationProcessorImpl - [XSD] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : SAXParseException, MESSAGE : Schema validation failed; XML does not comply with UBL 2.1 standards in line with ZATCA specifications. ERROR: org.xml.sax.SAXParseException; lineNumber: 40; columnNumber: 94; cvc-complex-type.2.4.b: The content of element 'cac:PartyTaxScheme' is not complete.
[INFO] ValidationProcessorImpl - [EN] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-CO-18, MESSAGE : [BR-CO-18]-An Invoice shall at least have one VAT breakdown group (BG-23).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-15, MESSAGE : [BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-04, MESSAGE : [BR-CO-04]-Each Invoice line (BG-25) shall be categorized with an Invoiced item VAT category code (BT-151).
[WARN] ValidationProcessorImpl - CODE : BR-CO-10, MESSAGE : [BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
[WARN] ValidationProcessorImpl - CODE : BR-08, MESSAGE : [BR-08]-An Invoice shall contain the Seller postal address (BG-5)
[WARN] ValidationProcessorImpl - CODE : BR-CO-13, MESSAGE : [BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
[INFO] ValidationProcessorImpl - [KSA] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-52, MESSAGE : [BR-KSA-52]-The line VAT amount (KSA-11) is mandatory for tax invoice and associated credit notes and debit notes (KSA-2, position 1 and 2 = 01).
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-53, MESSAGE : [BR-KSA-53]-The line amount with VAT (KSA-12) is mandatory for tax invoice and associated credit notes and debit notes (KSA-2, position 1 and 2 = 01).
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-68, MESSAGE : [BR-KSA-68]-Tax currency code (BT-6) must exist in an invoice.
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-39, MESSAGE : [BR-KSA-39]-The invoice must contain the seller VAT registration number or seller group VAT registration number (BT-31).
[WARN] ValidationProcessorImpl - CODE : BR-KSA-08, MESSAGE : [BR-KSA-08]-The seller identification (BT-29) must exist only once with one of the scheme ID (BT-29-1) (CRN, MOM, MLS, SAG, OTH, 700) and must contain only alphanumeric characters. Commercial Registration number with "CRN" as schemeID. MOMRAH license with "MOM" as sche
[WARN] ValidationProcessorImpl - CODE : BR-KSA-F-06-C23, MESSAGE : [BR-KSA-F-06-C23] - Field character limits for the Buyer Address - Street field (BT-50) have not been met. The minimum limit is 1 character and the maximum limit is 1000 characters.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-81, MESSAGE : [BR-KSA-81]-The other Buyer ID (BT-46) must present in the tax invoice and associated debit notes and credit notes (KSA-2, position 1 and 2 = 01), where the buyer VAT registration number or buyer group VAT registration number (BT-48) is not provided.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-F-06-C25, MESSAGE : [BR-KSA-F-06-C25] - Field character limits for the Buyer Address - City field (BT-52) have not been met. The minimum limit is 1 character and the maximum limit is 127 characters.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-10, MESSAGE : [BR-KSA-10]-Where the Buyer Country Code (BT-55) is other than 'SA' Buyer address must contain a street (BT-50), city (BT-52), country code (BT-55). This rule does not apply on the simplified tax invoices and associated credit notes and debit notes (KSA-2, position 1 a
[WARN] ValidationProcessorImpl - CODE : BR-KSA-37, MESSAGE : [BR-KSA-37]-The seller address building number must contain 4 digits.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-15, MESSAGE : [BR-KSA-15]-The tax invoice ((invoice type code (BT-30) = 388) and (invoice transaction code (KSA-2) has "01" as first 2 digits)) must contain the supply date (KSA-5).
[WARN] ValidationProcessorImpl - CODE : BR-KSA-EN16931-08, MESSAGE : [BR-KSA-EN16931-08]-Only one tax total (BG-22) with tax subtotals must be provided.Refer to Calculation of VAT.
[INFO] ValidationProcessorImpl - [PIH] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : KSA-13, MESSAGE : PIH is inValid
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED 
```

## AWJ simplified invoice (unsigned)

```text
[ERROR] XsdValidator - Schema validation failed due to SAXParseException
[INFO] ValidationProcessorImpl - [XSD] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : SAXParseException, MESSAGE : Schema validation failed; XML does not comply with UBL 2.1 standards in line with ZATCA specifications. ERROR: org.xml.sax.SAXParseException; lineNumber: 40; columnNumber: 94; cvc-complex-type.2.4.b: The content of element 'cac:PartyTaxScheme' is not complete.
[INFO] ValidationProcessorImpl - [EN] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-CO-18, MESSAGE : [BR-CO-18]-An Invoice shall at least have one VAT breakdown group (BG-23).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-15, MESSAGE : [BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-04, MESSAGE : [BR-CO-04]-Each Invoice line (BG-25) shall be categorized with an Invoiced item VAT category code (BT-151).
[WARN] ValidationProcessorImpl - CODE : BR-CO-10, MESSAGE : [BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
[WARN] ValidationProcessorImpl - CODE : BR-08, MESSAGE : [BR-08]-An Invoice shall contain the Seller postal address (BG-5)
[WARN] ValidationProcessorImpl - CODE : BR-CO-13, MESSAGE : [BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
[INFO] ValidationProcessorImpl - [KSA] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-68, MESSAGE : [BR-KSA-68]-Tax currency code (BT-6) must exist in an invoice.
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-39, MESSAGE : [BR-KSA-39]-The invoice must contain the seller VAT registration number or seller group VAT registration number (BT-31).
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-28, MESSAGE : [BR-KSA-28]-If the cryptographic stamp (KSA-15) exists in the invoice, this cryptographic stamp (KSA-15) must contain the exact "urn:oasis:names:specification:ubl:signature:1" value for signature information ID.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-29, MESSAGE : [BR-KSA-29]-If the cryptographic stamp (KSA-15) exists in the invoice, this cryptographic stamp (KSA-15) must contain the exact "urn:oasis:names:specification:ubl:signature:Invoice" value for referenced signature ID and signature ID.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-08, MESSAGE : [BR-KSA-08]-The seller identification (BT-29) must exist only once with one of the scheme ID (BT-29-1) (CRN, MOM, MLS, SAG, OTH, 700) and must contain only alphanumeric characters. Commercial Registration number with "CRN" as schemeID. MOMRAH license with "MOM" as sche
[WARN] ValidationProcessorImpl - CODE : BR-KSA-37, MESSAGE : [BR-KSA-37]-The seller address building number must contain 4 digits.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-EN16931-08, MESSAGE : [BR-KSA-EN16931-08]-Only one tax total (BG-22) with tax subtotals must be provided.Refer to Calculation of VAT.
[INFO] ValidationProcessorImpl - [QR] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : QRCODE_INVALID, MESSAGE : Invalid QR code format, Please follow the ZATCA QR code specifications
[INFO] ValidationProcessorImpl - [SIGNATURE] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : NullPointerException, MESSAGE : null
[ERROR] ValidationProcessorImpl - CODE : certificate, MESSAGE : wrong invoiceCertificate  
[INFO] ValidationProcessorImpl - [PIH] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : KSA-13, MESSAGE : PIH is inValid
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED 
```

## AWJ simplified invoice (signed with the SDK's synthetic certificate chain)

```text
[ERROR] XsdValidator - Schema validation failed due to SAXParseException
[INFO] ValidationProcessorImpl - [XSD] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : SAXParseException, MESSAGE : Schema validation failed; XML does not comply with UBL 2.1 standards in line with ZATCA specifications. ERROR: org.xml.sax.SAXParseException; lineNumber: 2; columnNumber: 5150; cvc-complex-type.2.4.a: Invalid content was found starting with element '{"http://u
[INFO] ValidationProcessorImpl - [EN] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-CO-18, MESSAGE : [BR-CO-18]-An Invoice shall at least have one VAT breakdown group (BG-23).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-15, MESSAGE : [BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
[ERROR] ValidationProcessorImpl - CODE : BR-CO-04, MESSAGE : [BR-CO-04]-Each Invoice line (BG-25) shall be categorized with an Invoiced item VAT category code (BT-151).
[WARN] ValidationProcessorImpl - CODE : BR-CO-10, MESSAGE : [BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
[WARN] ValidationProcessorImpl - CODE : BR-08, MESSAGE : [BR-08]-An Invoice shall contain the Seller postal address (BG-5)
[WARN] ValidationProcessorImpl - CODE : BR-CO-13, MESSAGE : [BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
[INFO] ValidationProcessorImpl - [KSA] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-68, MESSAGE : [BR-KSA-68]-Tax currency code (BT-6) must exist in an invoice.
[ERROR] ValidationProcessorImpl - CODE : BR-KSA-39, MESSAGE : [BR-KSA-39]-The invoice must contain the seller VAT registration number or seller group VAT registration number (BT-31).
[WARN] ValidationProcessorImpl - CODE : BR-KSA-08, MESSAGE : [BR-KSA-08]-The seller identification (BT-29) must exist only once with one of the scheme ID (BT-29-1) (CRN, MOM, MLS, SAG, OTH, 700) and must contain only alphanumeric characters. Commercial Registration number with "CRN" as schemeID. MOMRAH license with "MOM" as sche
[WARN] ValidationProcessorImpl - CODE : BR-KSA-37, MESSAGE : [BR-KSA-37]-The seller address building number must contain 4 digits.
[WARN] ValidationProcessorImpl - CODE : BR-KSA-EN16931-08, MESSAGE : [BR-KSA-EN16931-08]-Only one tax total (BG-22) with tax subtotals must be provided.Refer to Calculation of VAT.
[INFO] ValidationProcessorImpl - [QR] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : digital signature, MESSAGE : invoice signature value in the invoice doesn't match the invoice signature value in tag 7 of the QR code or invoice signature value missing in invoice  
[ERROR] ValidationProcessorImpl - CODE : hashedXml, MESSAGE : hashedXml does not match with qr code hashedXml or the hashedXml is missing 
[ERROR] ValidationProcessorImpl - CODE : publicKey, MESSAGE : public key of the certificate does not match with qr code certificate or the public key is missing 
[WARN] ValidationProcessorImpl - CODE : timeStamp, MESSAGE : timeStamp does not match with qr code timeStamp or timeStamp missing in invoice
[INFO] ValidationProcessorImpl - [SIGNATURE] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : X509IssuerName, MESSAGE : wrong X509IssuerName  
[ERROR] ValidationProcessorImpl - CODE : NumberFormatException, MESSAGE : Zero length BigInteger
[ERROR] ValidationProcessorImpl - CODE : xadesSignedPropertiesDigestValue, MESSAGE : wrong xadesSignedPropertiesDigestValue  
[ERROR] ValidationProcessorImpl - CODE : signatureValue, MESSAGE : wrong signature Value 
[ERROR] ValidationProcessorImpl - CODE : signingCertificateDigestValue, MESSAGE : wrong signingCertificateDigestValue  
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED 
```

## Rounding: document-level VAT 0.15 (10 lines × 0.10 @ 15 %)

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Rounding: sum of rounded line VAT 0.20 (same basket)

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Arithmetic perturbation P1_vat_0.50_vs_expected_0.15

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-CO-17, MESSAGE : [BR-CO-17]-VAT category tax amount (BT-117) = VAT category taxable amount (BT-116) x (VAT category rate (BT-119) / 100), rounded to two decimals.
[WARN] ValidationProcessorImpl - CODE : BR-S-09, MESSAGE : [BR-S-09]-The VAT category tax amount (BT-117) in a VAT breakdown (BG-23) where VAT category code (BT-118) is "Standard rated" shall equal the VAT category taxable amount (BT-116) multiplied by the VAT category rate (BT-119) / 100), rounded to two decimals.
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Arithmetic perturbation P2_taxinclusive_1.20_vs_1.15

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-CO-15, MESSAGE : [BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
[WARN] ValidationProcessorImpl - CODE : BR-CO-16, MESSAGE : [BR-CO-16]-Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) -Pre-Paid amount (BT-113) + Rounding amount (BT-114).
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED 
```

## Arithmetic perturbation P3_lineext_total_1.20_vs_sum_1.00

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-CO-10, MESSAGE : [BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Arithmetic perturbation P4_taxexclusive_0.90_vs_1.00

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : FAILED
[ERROR] ValidationProcessorImpl - CODE : BR-CO-15, MESSAGE : [BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).
[WARN] ValidationProcessorImpl - CODE : BR-CO-13, MESSAGE : [BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = FAILED 
```

## Arithmetic perturbation P5_payable_1.25_vs_1.15

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-CO-16, MESSAGE : [BR-CO-16]-Amount due for payment (BT-115) = Invoice total amount with VAT (BT-112) -Pre-Paid amount (BT-113) + Rounding amount (BT-114).
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Arithmetic perturbation P6_line_price_0.115_vs_lineext_0.10

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-KSA-EN16931-11, MESSAGE : [BR-KSA-EN16931-11]-Invoice line net amount (BT-131) must equal (Invoiced quantity (BT-129) * (Item net price (BT-146) / item price base quantity (BT-149))-) + Sum of invoice line charge amount (BT-141) - Sum of invoice line allowance amount (BT-136).
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

## Arithmetic perturbation P7_line_lineext_0.20_vs_qty_x_price_0.10

```text
[INFO] ValidationProcessorImpl - [XSD] validation result : PASSED
[INFO] ValidationProcessorImpl - [EN] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-S-08, MESSAGE : [BR-S-08]-In a VAT breakdown (BG-23) where the VAT category code (BT-118) is " Standard rated" the VAT category taxable amount (BT-116) shall equal the sum of Invoice line net amounts (BT-131) minus the sum of Document level allowance amounts (BT-92) plus the sum of Docu
[WARN] ValidationProcessorImpl - CODE : BR-CO-10, MESSAGE : [BR-CO-10]-Sum of Invoice line net amount (BT-106) = Σ Invoice line net amount (BT-131).
[WARN] ValidationProcessorImpl - CODE : BR-CO-13, MESSAGE : [BR-CO-13]-Invoice total amount without VAT (BT-109) = Σ Invoice line net amount (BT-131) - Sum of allowances on document level (BT-107) + Sum of charges on document level (BT-108).
[INFO] ValidationProcessorImpl - [KSA] validation result : PASSED
[WARN] ValidationProcessorImpl - CODE : BR-KSA-51, MESSAGE : [BR-KSA-51]-The line amount with VAT (KSA-12) must be Invoice line net amount (BT-131) + Line VAT amount (KSA-11).
[WARN] ValidationProcessorImpl - CODE : BR-KSA-EN16931-11, MESSAGE : [BR-KSA-EN16931-11]-Invoice line net amount (BT-131) must equal (Invoiced quantity (BT-129) * (Item net price (BT-146) / item price base quantity (BT-149))-) + Sum of invoice line charge amount (BT-141) - Sum of invoice line allowance amount (BT-136).
[INFO] ValidationProcessorImpl - [PIH] validation result : PASSED
[INFO] InvoiceValidationService -  *** GLOBAL VALIDATION RESULT = PASSED 
```

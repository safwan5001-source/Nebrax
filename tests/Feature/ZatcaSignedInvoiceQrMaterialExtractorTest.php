<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Services\Accounting\ZatcaXadesSignatureAssembler;
use App\Services\Accounting\ZatcaXmlCanonicalizer;
use App\Services\Accounting\ZatcaXmlEcdsaSigner;
use DateTimeImmutable;
use DOMDocument;
use DOMElement;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

class ZatcaSignedInvoiceQrMaterialExtractorTest extends TestCase
{
    /** @test */
    public function it_extracts_raw_hash_and_signature_from_the_signed_invoice(): void
    {
        $signed = $this->signedInvoiceWithWrappedDigest('customInvoiceReference');
        $digest = app(ZatcaInvoiceHasher::class)->hash($signed);
        $material = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($signed);

        $this->assertSame(
            base64_decode($digest, true),
            $material['invoice_hash'],
        );
        $this->assertSame(32, strlen($material['invoice_hash']));
        $this->assertSame(64, strlen($material['ecdsa_signature']));
    }

    /** @test */
    public function it_rejects_an_invoice_changed_after_signing(): void
    {
        $signed = str_replace('115.00', '116.00', $this->signedInvoice());

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يطابق');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($signed);
    }

    /** @test */
    public function it_rejects_a_forged_signature_with_the_correct_raw_length(): void
    {
        $signed = $this->signedInvoice();
        preg_match('#<ds:SignatureValue>([^<]+)</ds:SignatureValue>#', $signed, $match);
        $this->assertArrayHasKey(1, $match);
        $forged = str_replace($match[1], base64_encode(str_repeat("\x7f", 64)), $signed);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يطابق');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($forged);
    }

    /** @test */
    public function it_rejects_signed_info_that_declares_unsupported_algorithms(): void
    {
        $signed = $this->signedInvoice();
        foreach ([
            ZatcaXmlCanonicalizer::ALGORITHM,
            \App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder::ECDSA_SHA256_ALGORITHM,
        ] as $algorithm) {
            $invalid = str_replace($algorithm, 'urn:unsupported:algorithm', $signed);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض خوارزمية SignedInfo غير المدعومة.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('خوارزمية', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_xpath_prefixes_rebound_to_non_ubl_namespaces(): void
    {
        $signed = $this->signedInvoice();
        foreach (['ext', 'cac', 'cbc'] as $prefix) {
            $invalid = $this->rebindXpathPrefix($signed, $prefix);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض ربط بادئة XPath بغير مساحة UBL الرسمية.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('بادئة', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_a_duplicate_signed_properties_id_anywhere_in_the_document(): void
    {
        $signed = $this->signedInvoice();
        $duplicate = str_replace(
            '</ext:ExtensionContent>',
            '<xades:SignedProperties Id="xadesSignedProperties"/></ext:ExtensionContent>',
            $signed,
        );
        $this->assertNotSame($signed, $duplicate);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('مكرر');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($duplicate);
    }

    /** @test */
    public function it_rejects_signed_properties_changed_after_signing(): void
    {
        $signed = $this->signedInvoice();
        $tampered = str_replace(
            'https://zatca.gov.sa/security-policy.pdf',
            'https://example.test/forged-policy.pdf',
            $signed,
        );
        $this->assertNotSame($signed, $tampered);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SignedProperties');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_a_replacement_key_info_certificate_even_when_resigned(): void
    {
        $signed = $this->signedInvoice();
        [$replacementKey, $replacementDer] = $this->certificate();
        $tampered = $this->replaceCertificateAndResign($signed, $replacementDer, $replacementKey);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('SigningCertificateV2');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_certificate_digests_distributed_between_certificate_entries(): void
    {
        $tampered = $this->signedInvoiceWithMalformedCertificateDigestDistribution();

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('CertDigest');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_a_signature_moved_outside_the_official_ubl_extension(): void
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $xpath->registerNamespace(
            'cac',
            'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2',
        );
        $signature = $xpath->query('//ds:Signature')?->item(0);
        $excludedContainer = $xpath->query('//cac:Signature')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $signature);
        $this->assertInstanceOf(DOMElement::class, $excludedContainer);
        $excludedContainer->appendChild($signature);
        $tampered = $document->saveXML();
        $this->assertIsString($tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('امتداد UBL');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_qualifying_properties_not_targeting_their_signature(): void
    {
        $signed = $this->signedInvoice();
        $tampered = str_replace('Target="#signature"', 'Target="#detachedSignature"', $signed);
        $this->assertNotSame($signed, $tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Target');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_duplicate_or_conflicting_ubl_signature_discriminators(): void
    {
        $signed = $this->signedInvoice();
        foreach ([
            '<ext:ExtensionURI>'.ZatcaXadesSignatureAssembler::EXTENSION_URI.'</ext:ExtensionURI>'
                => '<ext:ExtensionURI>'.ZatcaXadesSignatureAssembler::EXTENSION_URI.'</ext:ExtensionURI>'
                    .'<ext:ExtensionURI>urn:conflicting-extension</ext:ExtensionURI>',
            '<cbc:ID>'.ZatcaXadesSignatureAssembler::SIGNATURE_INFORMATION_ID.'</cbc:ID>'
                => '<cbc:ID>'.ZatcaXadesSignatureAssembler::SIGNATURE_INFORMATION_ID.'</cbc:ID>'
                    .'<cbc:ID>urn:conflicting-information</cbc:ID>',
            '<sbc:ReferencedSignatureID>'.ZatcaXadesSignatureAssembler::REFERENCED_SIGNATURE_ID
                .'</sbc:ReferencedSignatureID>'
                => '<sbc:ReferencedSignatureID>'.ZatcaXadesSignatureAssembler::REFERENCED_SIGNATURE_ID
                    .'</sbc:ReferencedSignatureID>'
                    .'<sbc:ReferencedSignatureID>urn:conflicting-reference</sbc:ReferencedSignatureID>',
        ] as $search => $replacement) {
            $tampered = str_replace($search, $replacement, $signed);
            $this->assertNotSame($signed, $tampered);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
                $this->fail('كان يجب رفض حقل مميز مكرر داخل حاوية توقيع UBL.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('UBL', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_an_additional_direct_signed_properties_element(): void
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($this->signedInvoice(), LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('xades', ZatcaXadesSignatureAssembler::XADES_NAMESPACE);
        $qualifyingProperties = $xpath->query('//xades:QualifyingProperties')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $qualifyingProperties);
        $extra = $document->createElementNS(
            ZatcaXadesSignatureAssembler::XADES_NAMESPACE,
            'xades:SignedProperties',
        );
        $extra->setAttribute('Id', 'additionalSignedProperties');
        $qualifyingProperties->appendChild($extra);
        $tampered = $document->saveXML();
        $this->assertIsString($tampered);

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('SignedProperties');

        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($tampered);
    }

    /** @test */
    public function it_rejects_missing_duplicate_or_malformed_signature_material(): void
    {
        $signed = $this->signedInvoice();
        preg_match('#<ds:SignatureValue>([^<]+)</ds:SignatureValue>#', $signed, $match);
        $this->assertArrayHasKey(1, $match);

        foreach ([
            str_replace($match[0], '', $signed),
            str_replace($match[0], $match[0].$match[0], $signed),
            str_replace($match[1], 'not-base64', $signed),
            preg_replace('#(<ds:SignedInfo\b.*?</ds:SignedInfo>)#s', '$1$1', $signed, 1),
        ] as $invalid) {
            $this->assertIsString($invalid);
            try {
                app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($invalid);
                $this->fail('كان يجب رفض مادة توقيع QR المفقودة أو المكررة أو التالفة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    private function signedInvoice(string $invoiceReferenceId = 'invoiceSignedData'): string
    {
        [$privateKey, $leaf] = $this->certificate();

        return app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            [base64_encode($leaf)],
            $privateKey,
            new DateTimeImmutable('2026-08-30T01:02:03+03:00'),
            'https://zatca.gov.sa/security-policy.pdf',
            base64_encode(hash('sha256', 'policy', true)),
            invoiceReferenceId: $invoiceReferenceId,
        );
    }

    private function signedInvoiceWithWrappedDigest(string $invoiceReferenceId): string
    {
        [$privateKey, $leaf] = $this->certificate();
        $signed = app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            [base64_encode($leaf)],
            $privateKey,
            new DateTimeImmutable('2026-08-30T01:02:03+03:00'),
            'https://zatca.gov.sa/security-policy.pdf',
            base64_encode(hash('sha256', 'policy', true)),
            invoiceReferenceId: $invoiceReferenceId,
        );

        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($signed, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $digest = $xpath->query("//ds:Reference[@URI='']/ds:DigestValue")?->item(0);
        $signedInfo = $xpath->query('//ds:Signature/ds:SignedInfo')?->item(0);
        $signatureValue = $xpath->query('//ds:Signature/ds:SignatureValue')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $digest);
        $this->assertInstanceOf(DOMElement::class, $signedInfo);
        $this->assertInstanceOf(DOMElement::class, $signatureValue);
        $digest->nodeValue = substr($digest->textContent, 0, 20)."\n".substr($digest->textContent, 20);
        $signatureValue->nodeValue = app(ZatcaXmlEcdsaSigner::class)->sign(
            app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($signedInfo),
            $privateKey,
        );
        $xml = $document->saveXML();
        $this->assertIsString($xml);

        return $xml;
    }

    private function rebindXpathPrefix(string $signedXml, string $prefix): string
    {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($signedXml, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $nodes = $xpath->query("//ds:SignedInfo//ds:XPath[contains(., '{$prefix}:')]");
        $this->assertNotFalse($nodes);
        $this->assertGreaterThan(0, $nodes->length);
        foreach ($nodes as $node) {
            $this->assertInstanceOf(DOMElement::class, $node);
            $node->setAttributeNS(
                'http://www.w3.org/2000/xmlns/',
                'xmlns:'.$prefix,
                'urn:wrong:'.$prefix,
            );
        }
        $xml = $document->saveXML();
        $this->assertIsString($xml);

        return $xml;
    }

    private function replaceCertificateAndResign(
        string $signedXml,
        string $replacementDer,
        string $replacementPrivateKey,
    ): string {
        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($signedXml, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $certificate = $xpath->query('//ds:KeyInfo/ds:X509Data/ds:X509Certificate')?->item(0);
        $keyInfo = $xpath->query('//ds:Signature/ds:KeyInfo')?->item(0);
        $x509Data = $xpath->query('//ds:KeyInfo/ds:X509Data')?->item(0);
        $signedInfo = $xpath->query('//ds:Signature/ds:SignedInfo')?->item(0);
        $signatureValue = $xpath->query('//ds:Signature/ds:SignatureValue')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $certificate);
        $this->assertInstanceOf(DOMElement::class, $keyInfo);
        $this->assertInstanceOf(DOMElement::class, $x509Data);
        $this->assertInstanceOf(DOMElement::class, $signedInfo);
        $this->assertInstanceOf(DOMElement::class, $signatureValue);
        $originalCertificate = $certificate->textContent;
        $certificate->nodeValue = base64_encode($replacementDer);
        $x509Data->appendChild($document->createElementNS(
            ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE,
            'ds:X509Certificate',
            $originalCertificate,
        ));

        // محاولة التفاف: SigningCertificateV2 غير موقعة قرب KeyInfo للمفتاح البديل.
        $unsignedSigningCertificate = $document->createElementNS(
            ZatcaXadesSignatureAssembler::XADES_NAMESPACE,
            'xades:SigningCertificateV2',
        );
        $cert = $document->createElementNS(ZatcaXadesSignatureAssembler::XADES_NAMESPACE, 'xades:Cert');
        $certDigest = $document->createElementNS(ZatcaXadesSignatureAssembler::XADES_NAMESPACE, 'xades:CertDigest');
        $digestMethod = $document->createElementNS(
            ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE,
            'ds:DigestMethod',
        );
        $digestMethod->setAttribute(
            'Algorithm',
            \App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder::SHA256_ALGORITHM,
        );
        $certDigest->appendChild($digestMethod);
        $certDigest->appendChild($document->createElementNS(
            ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE,
            'ds:DigestValue',
            base64_encode(hash('sha256', $replacementDer, true)),
        ));
        $cert->appendChild($certDigest);
        $unsignedSigningCertificate->appendChild($cert);
        $keyInfo->insertBefore($unsignedSigningCertificate, $x509Data);
        $signatureValue->nodeValue = app(ZatcaXmlEcdsaSigner::class)->sign(
            app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($signedInfo),
            $replacementPrivateKey,
        );
        $xml = $document->saveXML();
        $this->assertIsString($xml);

        return $xml;
    }

    private function signedInvoiceWithMalformedCertificateDigestDistribution(): string
    {
        [$privateKey, $leaf] = $this->certificate();
        [, $secondCertificate] = $this->certificate();
        $signed = app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            [base64_encode($leaf), base64_encode($secondCertificate)],
            $privateKey,
            new DateTimeImmutable('2026-08-30T01:02:03+03:00'),
            'https://zatca.gov.sa/security-policy.pdf',
            base64_encode(hash('sha256', 'policy', true)),
        );

        $document = new DOMDocument();
        $document->preserveWhiteSpace = true;
        $this->assertTrue($document->loadXML($signed, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE);
        $xpath->registerNamespace('xades', ZatcaXadesSignatureAssembler::XADES_NAMESPACE);
        $entries = $xpath->query('//xades:SigningCertificateV2/xades:Cert');
        $signedProperties = $xpath->query('//xades:SignedProperties')?->item(0);
        $signedInfo = $xpath->query('//ds:Signature/ds:SignedInfo')?->item(0);
        $signatureValue = $xpath->query('//ds:Signature/ds:SignatureValue')?->item(0);
        $propertiesDigest = $xpath->query(
            "//ds:SignedInfo/ds:Reference[@Type='".
            \App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder::SIGNED_PROPERTIES_TYPE.
            "']/ds:DigestValue",
        )?->item(0);
        $this->assertNotFalse($entries);
        $this->assertSame(2, $entries->length);
        $firstEntry = $entries->item(0);
        $secondEntry = $entries->item(1);
        $this->assertInstanceOf(DOMElement::class, $firstEntry);
        $this->assertInstanceOf(DOMElement::class, $secondEntry);
        $firstDigest = $xpath->query('./xades:CertDigest', $firstEntry)?->item(0);
        $this->assertInstanceOf(DOMElement::class, $firstDigest);
        $this->assertInstanceOf(DOMElement::class, $signedProperties);
        $this->assertInstanceOf(DOMElement::class, $signedInfo);
        $this->assertInstanceOf(DOMElement::class, $signatureValue);
        $this->assertInstanceOf(DOMElement::class, $propertiesDigest);
        $secondEntry->appendChild($firstDigest);
        $propertiesDigest->nodeValue = base64_encode(hash(
            'sha256',
            app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($signedProperties),
            true,
        ));
        $signatureValue->nodeValue = app(ZatcaXmlEcdsaSigner::class)->sign(
            app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($signedInfo),
            $privateKey,
        );
        $xml = $document->saveXML();
        $this->assertIsString($xml);

        return $xml;
    }

    /** @return array{string,string} private PEM, certificate DER */
    private function certificate(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'Signed QR Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return [$privateKey, $der];
    }

    private function invoiceXml(): string
    {
        return <<<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"
 xmlns:sig="urn:oasis:names:specification:ubl:schema:xsd:CommonSignatureComponents-2"
 xmlns:sac="urn:oasis:names:specification:ubl:schema:xsd:SignatureAggregateComponents-2"
 xmlns:sbc="urn:oasis:names:specification:ubl:schema:xsd:SignatureBasicComponents-2"
 xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
 xmlns:xades="http://uri.etsi.org/01903/v1.3.2#">
 <cbc:ID>INV-QR-MATERIAL-1</cbc:ID>
 <cbc:UUID>33333333-3333-4333-8333-333333333333</cbc:UUID>
 <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QR</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID></cac:Signature>
 <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>
XML;
    }
}

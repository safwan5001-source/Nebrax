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

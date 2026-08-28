<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaInvoiceHasher;
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

class ZatcaXadesSignatureAssemblerTest extends TestCase
{
    /** @test */
    public function it_assembles_and_verifies_the_complete_xades_signature_after_serialization(): void
    {
        [$privateKey, $leaf] = $this->certificate('Leaf Device');
        [, $root] = $this->certificate('Root CA');
        $chain = [base64_encode($leaf), base64_encode($root)];
        $policyDigest = base64_encode(hash('sha256', 'zatca-policy', true));

        $signed = app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            $chain,
            $privateKey,
            new DateTimeImmutable('2026-08-28 18:19:20+03:00'),
            'https://zatca.gov.sa/security-policy.pdf',
            $policyDigest,
        );

        $document = $this->document($signed);
        $xpath = $this->xpath($document);
        $this->assertSame(1, $xpath->query('/inv:Invoice/ext:UBLExtensions/ext:UBLExtension/ext:ExtensionContent/sig:UBLDocumentSignatures/sac:SignatureInformation/ds:Signature')?->length);
        $this->assertSame(ZatcaXadesSignatureAssembler::EXTENSION_URI, $xpath->evaluate('string(/inv:Invoice/ext:UBLExtensions/ext:UBLExtension/ext:ExtensionURI)'));
        $this->assertSame(ZatcaXadesSignatureAssembler::SIGNATURE_INFORMATION_ID, $xpath->evaluate('string(//sac:SignatureInformation/cbc:ID)'));
        $this->assertSame(ZatcaXadesSignatureAssembler::REFERENCED_SIGNATURE_ID, $xpath->evaluate('string(//sac:SignatureInformation/sbc:ReferencedSignatureID)'));
        $this->assertSame('#signature', $xpath->evaluate('string(//xades:QualifyingProperties/@Target)'));

        $certificates = $xpath->query('//ds:KeyInfo/ds:X509Data/ds:X509Certificate');
        $this->assertNotFalse($certificates);
        $this->assertSame(2, $certificates->length);
        $this->assertSame($chain[0], $certificates->item(0)?->textContent);
        $this->assertSame($chain[1], $certificates->item(1)?->textContent);

        $this->assertSame(
            app(ZatcaInvoiceHasher::class)->hash($signed),
            $xpath->evaluate("string(//ds:Reference[@Id='invoiceSignedData']/ds:DigestValue)")
        );

        $properties = $xpath->query("//xades:SignedProperties[@Id='xadesSignedProperties']")?->item(0);
        $this->assertInstanceOf(DOMElement::class, $properties);
        $propertiesDigest = base64_encode(hash('sha256', app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($properties), true));
        $this->assertSame($propertiesDigest, $xpath->evaluate("string(//ds:Reference[@URI='#xadesSignedProperties']/ds:DigestValue)"));

        $signedInfo = $xpath->query('//ds:Signature/ds:SignedInfo')?->item(0);
        $this->assertInstanceOf(DOMElement::class, $signedInfo);
        $signatureValue = $xpath->evaluate('string(//ds:Signature/ds:SignatureValue)');
        $this->assertTrue(app(ZatcaXmlEcdsaSigner::class)->verify(
            app(ZatcaXmlCanonicalizer::class)->canonicalizeElementInContext($signedInfo),
            $signatureValue,
            $this->publicKeyFromDer($leaf),
        ));
    }

    /** @test */
    public function it_preserves_unrelated_extensions_and_rejects_signing_twice(): void
    {
        [$privateKey, $leaf] = $this->certificate('Leaf Device');
        $invoice = str_replace(
            '<cbc:ID>INV-1</cbc:ID>',
            '<ext:UBLExtensions><ext:UBLExtension><ext:ExtensionURI>urn:example:other</ext:ExtensionURI><ext:ExtensionContent><cbc:Note>keep</cbc:Note></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:ID>INV-1</cbc:ID>',
            $this->invoiceXml()
        );
        $arguments = [[base64_encode($leaf)], $privateKey, new DateTimeImmutable(), 'https://zatca.gov.sa/policy', base64_encode(hash('sha256', 'policy', true))];
        $assembler = app(ZatcaXadesSignatureAssembler::class);
        $signed = $assembler->assemble($invoice, ...$arguments);
        $document = $this->document($signed);
        $xpath = $this->xpath($document);
        $this->assertSame(2, $xpath->query('/inv:Invoice/ext:UBLExtensions/ext:UBLExtension')?->length);
        $this->assertSame('keep', $xpath->evaluate("string(//ext:UBLExtension[ext:ExtensionURI='urn:example:other']//cbc:Note)"));

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('مسبقاً');
        $assembler->assemble($signed, ...$arguments);
    }

    /** @test */
    public function it_rejects_a_private_key_that_does_not_match_the_leaf_certificate(): void
    {
        [$privateKey] = $this->certificate('Different Device');
        [, $leaf] = $this->certificate('Leaf Device');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يطابق');

        app(ZatcaXadesSignatureAssembler::class)->assemble(
            $this->invoiceXml(),
            [base64_encode($leaf)],
            $privateKey,
            new DateTimeImmutable(),
            'https://zatca.gov.sa/policy',
            base64_encode(hash('sha256', 'policy', true)),
        );
    }

    /** @test */
    public function it_rejects_plain_or_xml_ids_that_collide_with_generated_signature_ids(): void
    {
        [$privateKey, $leaf] = $this->certificate('Leaf Device');
        $assembler = app(ZatcaXadesSignatureAssembler::class);

        foreach ([
            '<cbc:Note Id="signature">existing</cbc:Note>',
            '<cbc:Note xml:id="xadesSignedProperties">existing</cbc:Note>',
        ] as $existingId) {
            $invoice = str_replace('<cbc:ID>INV-1</cbc:ID>', $existingId.'<cbc:ID>INV-1</cbc:ID>', $this->invoiceXml());

            try {
                $assembler->assemble(
                    $invoice,
                    [base64_encode($leaf)],
                    $privateKey,
                    new DateTimeImmutable(),
                    'https://zatca.gov.sa/policy',
                    base64_encode(hash('sha256', 'policy', true)),
                );
                $this->fail('كان يجب رفض معرّف XML المتعارض مع التوقيع.');
            } catch (InvalidArgumentException $exception) {
                $this->assertStringContainsString('مستخدم مسبقاً', $exception->getMessage());
            }
        }
    }

    /** @test */
    public function it_rejects_dtd_non_invoice_documents_and_colliding_ids(): void
    {
        [$privateKey, $leaf] = $this->certificate('Leaf Device');
        $chain = [base64_encode($leaf)];
        $digest = base64_encode(hash('sha256', 'policy', true));
        $assembler = app(ZatcaXadesSignatureAssembler::class);

        foreach ([
            '<!DOCTYPE Invoice [<!ELEMENT Invoice ANY>]><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"/>',
            '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"/>',
        ] as $xml) {
            try {
                $assembler->assemble($xml, $chain, $privateKey, new DateTimeImmutable(), 'https://zatca.gov.sa/policy', $digest);
                $this->fail('كان يجب رفض مستند XML غير الآمن أو غير المطابق.');
            } catch (InvalidArgumentException|RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('فريدة');
        $assembler->assemble($this->invoiceXml(), $chain, $privateKey, new DateTimeImmutable(), 'https://zatca.gov.sa/policy', $digest, 'same', 'same', 'properties');
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
 <cbc:ID>INV-1</cbc:ID>
 <cbc:UUID>11111111-1111-4111-8111-111111111111</cbc:UUID>
 <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QR</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID></cac:Signature>
 <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>
XML;
    }

    /** @return array{string,string} private PEM, certificate DER */
    private function certificate(string $commonName): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => $commonName], $key, ['digest_alg' => 'sha256']);
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

    private function publicKeyFromDer(string $der): string
    {
        $pem = "-----BEGIN CERTIFICATE-----\n".chunk_split(base64_encode($der), 64, "\n")."-----END CERTIFICATE-----\n";
        $key = openssl_pkey_get_public($pem);
        $this->assertNotFalse($key);
        $details = openssl_pkey_get_details($key);
        $this->assertIsArray($details);
        $this->assertIsString($details['key'] ?? null);

        return $details['key'];
    }

    private function document(string $xml): DOMDocument
    {
        $document = new DOMDocument();
        $this->assertTrue($document->loadXML($xml, LIBXML_NONET));

        return $document;
    }

    private function xpath(DOMDocument $document): DOMXPath
    {
        $xpath = new DOMXPath($document);
        foreach ([
            'inv' => 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
            'ext' => ZatcaXadesSignatureAssembler::EXT_NAMESPACE,
            'sig' => ZatcaXadesSignatureAssembler::SIG_NAMESPACE,
            'sac' => ZatcaXadesSignatureAssembler::SAC_NAMESPACE,
            'sbc' => ZatcaXadesSignatureAssembler::SBC_NAMESPACE,
            'cbc' => ZatcaXadesSignatureAssembler::CBC_NAMESPACE,
            'ds' => ZatcaXadesSignatureAssembler::XMLDSIG_NAMESPACE,
            'xades' => ZatcaXadesSignatureAssembler::XADES_NAMESPACE,
        ] as $prefix => $namespace) {
            $xpath->registerNamespace($prefix, $namespace);
        }

        return $xpath;
    }
}

<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaInvoiceSigner;
use App\Tenancy\TenantContext;
use DateTimeImmutable;
use DOMDocument;
use DOMXPath;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class ZatcaInvoiceSignerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_signs_with_the_active_tenant_credential_and_pinned_policy_without_exposing_the_private_key(): void
    {
        $policyIdentifier = 'https://zatca.gov.sa/security-policy.pdf';
        $policyDigest = base64_encode(hash('sha256', 'pinned-policy', true));
        config()->set('zatca.signature_policy.identifier', $policyIdentifier);
        config()->set('zatca.signature_policy.digest', $policyDigest);
        $auth = $this->registerTenant('zatca-invoice-signer', 'zatca-invoice-signer@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$privateKey, $leaf] = $this->certificate('Tenant Device');
        $leafBase64 = base64_encode($leaf);

        ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                'certificate_chain' => [$leafBase64],
            ],
            'certificate_fingerprint' => hash('sha256', $leaf),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        $signed = app(ZatcaInvoiceSigner::class)->sign(
            $this->invoiceXml(),
            new DateTimeImmutable('2026-08-28 18:19:20+03:00'),
        );

        $document = new DOMDocument();
        $this->assertTrue($document->loadXML($signed, LIBXML_NONET));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', 'http://www.w3.org/2000/09/xmldsig#');
        $xpath->registerNamespace('xades', 'http://uri.etsi.org/01903/v1.3.2#');

        $this->assertSame($policyIdentifier, $xpath->evaluate('string(//xades:SigPolicyId/xades:Identifier)'));
        $this->assertSame($policyDigest, $xpath->evaluate('string(//xades:SigPolicyHash/ds:DigestValue)'));
        $this->assertSame($leafBase64, $xpath->evaluate('string(//ds:KeyInfo/ds:X509Data/ds:X509Certificate)'));
        $this->assertStringNotContainsString($privateKey, $signed);
    }

    /** @test */
    public function it_fails_closed_when_the_active_environment_has_no_credential(): void
    {
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
        $auth = $this->registerTenant('zatca-signer-no-credential', 'zatca-no-credential@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير مهيأة');

        app(ZatcaInvoiceSigner::class)->sign($this->invoiceXml(), new DateTimeImmutable());
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
 <cbc:ID>INV-SIGNER-1</cbc:ID>
 <cbc:UUID>22222222-2222-4222-8222-222222222222</cbc:UUID>
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
}

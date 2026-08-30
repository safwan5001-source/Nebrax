<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use App\Services\Accounting\ZatcaSignedInvoiceFinalizer;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Tenancy\TenantContext;
use DateTimeImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use InvalidArgumentException;
use Tests\TestCase;

class ZatcaSignedInvoiceFinalizerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_freezes_a_simplified_signed_invoice_with_one_verified_phase_two_qr(): void
    {
        [$privateKey, $leafDer] = $this->configureSigningCredential();
        $currentQr = base64_encode('phase-one-qr');
        $invoiceTime = new DateTimeImmutable('2026-08-30 12:13:14+03:00');

        $final = app(ZatcaSignedInvoiceFinalizer::class)->finalize(
            $this->invoiceXml($currentQr),
            $currentQr,
            'شركة أوج',
            '300000000000003',
            $invoiceTime,
            new DateTimeImmutable('2026-08-30 12:14:00+03:00'),
            '115.00',
            '15.00',
            'simplified',
        );

        $fields = $this->decodeQr($final['qr']);
        $signedMaterial = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($final['xml']);
        $certificateMaterial = app(ZatcaQrCertificateMaterialExtractor::class)->extract(base64_encode($leafDer));

        $this->assertSame(range(1, 9), array_keys($fields));
        $this->assertSame('شركة أوج', $fields[1]);
        $this->assertSame('2026-08-30T09:13:14Z', $fields[3]);
        $this->assertSame($signedMaterial['invoice_hash'], $fields[6]);
        $this->assertSame($signedMaterial['ecdsa_signature'], $fields[7]);
        $this->assertSame($certificateMaterial['public_key'], $fields[8]);
        $this->assertSame($certificateMaterial['certificate_signature'], $fields[9]);
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($final['xml']), $final['hash']);
        $this->assertSame(1, substr_count($final['xml'], $final['qr']));
        $this->assertStringContainsString('<ds:Signature', $final['xml']);
        $this->assertStringNotContainsString($currentQr, $final['xml']);
        $this->assertStringNotContainsString($privateKey, $final['xml']);
    }

    /** @test */
    public function it_omits_the_certificate_signature_for_a_standard_invoice(): void
    {
        $this->configureSigningCredential();
        $currentQr = base64_encode('standard-phase-one-qr');

        $final = app(ZatcaSignedInvoiceFinalizer::class)->finalize(
            $this->invoiceXml($currentQr),
            $currentQr,
            'AWJ',
            '300000000000003',
            new DateTimeImmutable('2026-08-30T09:13:14Z'),
            new DateTimeImmutable('2026-08-30T09:14:00Z'),
            '115.00',
            '15.00',
            'standard',
        );

        $this->assertSame(range(1, 8), array_keys($this->decodeQr($final['qr'])));
        app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($final['xml']);
        $this->addToAssertionCount(1);
    }

    /** @test */
    public function it_refuses_to_replace_a_qr_value_other_than_the_one_in_the_signed_invoice(): void
    {
        $this->configureSigningCredential();

        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('لا تطابق');

        app(ZatcaSignedInvoiceFinalizer::class)->finalize(
            $this->invoiceXml('stored-qr'),
            'different-qr',
            'AWJ',
            '300000000000003',
            new DateTimeImmutable('2026-08-30T09:13:14Z'),
            new DateTimeImmutable('2026-08-30T09:14:00Z'),
            '115.00',
            '15.00',
            'simplified',
        );
    }

    /** @return array{string,string} private PEM, leaf DER */
    private function configureSigningCredential(): array
    {
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
        $auth = $this->registerTenant('zatca-finalizer-'.bin2hex(random_bytes(3)), uniqid('zatca-finalizer-', true).'@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        [$caKey, $caCertificate] = $this->certificateAuthority();
        [$privateKey, $leafDer] = $this->leafCertificate($caKey, $caCertificate);
        ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                'certificate_chain' => [base64_encode($leafDer), base64_encode($this->certificateDer($caCertificate))],
            ],
            'certificate_fingerprint' => hash('sha256', $leafDer),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        return [$privateKey, $leafDer];
    }

    private function invoiceXml(string $qr): string
    {
        $qr = htmlspecialchars($qr, ENT_XML1 | ENT_QUOTES, 'UTF-8');

        return <<<XML
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
 <cbc:ID>INV-FINAL-1</cbc:ID>
 <cbc:UUID>22222222-2222-4222-8222-222222222222</cbc:UUID>
 <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">{$qr}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID></cac:Signature>
 <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="SAR">115.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>
XML;
    }

    /** @return array<int,string> */
    private function decodeQr(string $encoded): array
    {
        $payload = base64_decode($encoded, true);
        $this->assertIsString($payload);
        $fields = [];
        for ($offset = 0, $size = strlen($payload); $offset < $size;) {
            $tag = ord($payload[$offset++]);
            $length = ord($payload[$offset++]);
            $fields[$tag] = substr($payload, $offset, $length);
            $offset += $length;
        }

        return $fields;
    }

    /** @return array{\OpenSSLAsymmetricKey,\OpenSSLCertificate} */
    private function certificateAuthority(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'ZATCA Finalizer CA'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);

        return [$key, $certificate];
    }

    /** @return array{string,string} private PEM, leaf DER */
    private function leafCertificate(\OpenSSLAsymmetricKey $caKey, \OpenSSLCertificate $caCertificate): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'ZATCA Finalizer Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, $caCertificate, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));

        return [$privateKey, $this->certificateDer($certificate)];
    }

    private function certificateDer(\OpenSSLCertificate $certificate): string
    {
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return $der;
    }
}

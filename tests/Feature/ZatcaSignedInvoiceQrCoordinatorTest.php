<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use App\Services\Accounting\ZatcaSignedInvoiceQrCoordinator;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use DateTimeImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use InvalidArgumentException;
use Tests\TestCase;

class ZatcaSignedInvoiceQrCoordinatorTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_signs_and_builds_a_simplified_qr_from_the_same_active_leaf_certificate(): void
    {
        [$privateKey, $leafCertificate, $leafDer, $issuerCertificate] = $this->activeCredential();

        $result = app(ZatcaSignedInvoiceQrCoordinator::class)->build(
            $this->invoiceXml('0200000'),
            'شركة نبراكس',
            '310000000000003',
            new DateTimeImmutable('2026-08-30 03:04:05+03:00'),
            new DateTimeImmutable('2026-08-30 03:05:06+03:00'),
            '115.00',
            '15.00',
        );

        $signedMaterial = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($result->signedXml);
        $certificateMaterial = app(ZatcaQrCertificateMaterialExtractor::class)->extract(base64_encode($leafDer));
        $fields = $this->decode($result->qrCode);

        $this->assertSame(range(1, 9), array_keys($fields));
        $this->assertSame('شركة نبراكس', $fields[1]);
        $this->assertSame('310000000000003', $fields[2]);
        $this->assertSame('2026-08-30T00:04:05Z', $fields[3]);
        $this->assertSame('115.00', $fields[4]);
        $this->assertSame('15.00', $fields[5]);
        $this->assertSame($signedMaterial['invoice_hash'], $result->invoiceHash);
        $this->assertSame($signedMaterial['invoice_hash'], $fields[6]);
        $this->assertSame($signedMaterial['ecdsa_signature'], $fields[7]);
        $this->assertSame($certificateMaterial['public_key'], $fields[8]);
        $this->assertSame($certificateMaterial['certificate_signature'], $fields[9]);
        $this->assertStringContainsString(base64_encode($leafDer), $result->signedXml);
        $this->assertStringContainsString(base64_encode($this->certificateDer($issuerCertificate)), $result->signedXml);
        $this->assertStringNotContainsString($privateKey, $result->signedXml);

        $leafKey = openssl_pkey_get_public($leafCertificate);
        $details = $leafKey === false ? false : openssl_pkey_get_details($leafKey);
        $this->assertIsArray($details);
        $this->assertSame(
            "\x04".str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT)
                .str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT),
            $fields[8],
        );
    }

    /** @test */
    public function it_omits_the_certificate_signature_for_a_standard_invoice(): void
    {
        $this->activeCredential();

        $result = app(ZatcaSignedInvoiceQrCoordinator::class)->build(
            $this->invoiceXml('0100000'),
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-30T00:04:05Z'),
            new DateTimeImmutable('2026-08-30T00:05:06Z'),
            '115.00',
            '15.00',
        );

        $fields = $this->decode($result->qrCode);
        $signedMaterial = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($result->signedXml);

        $this->assertSame(range(1, 8), array_keys($fields));
        $this->assertArrayNotHasKey(9, $fields);
        $this->assertSame($signedMaterial['invoice_hash'], $result->invoiceHash);
        $this->assertSame($signedMaterial['invoice_hash'], $fields[6]);
        $this->assertSame($signedMaterial['ecdsa_signature'], $fields[7]);
    }

    /** @test */
    public function it_rejects_an_invoice_without_an_explicit_supported_transaction_code(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('InvoiceTypeCode');

        app(ZatcaSignedInvoiceQrCoordinator::class)->build(
            $this->invoiceXml(''),
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-30T00:04:05Z'),
            new DateTimeImmutable('2026-08-30T00:05:06Z'),
            '115.00',
            '15.00',
        );
    }

    /** @return array{string,\OpenSSLCertificate,string,\OpenSSLCertificate} */
    private function activeCredential(): array
    {
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set(
            'zatca.signature_policy.digest',
            base64_encode(hash('sha256', 'coordinator-policy', true)),
        );
        $auth = $this->registerTenant(
            'zatca-signed-qr-coordinator',
            'zatca-signed-qr-coordinator@example.test',
        );
        app(TenantContext::class)->set($auth['tenant_id']);
        Settings::put('zatca', ['active_environment' => 'simulation']);

        [$issuerKey, $issuerCertificate] = $this->certificateAuthority();
        [$privateKey, $leafCertificate, $leafDer] = $this->leafCertificate(
            $issuerKey,
            $issuerCertificate,
        );

        ZatcaCredential::create([
            'environment' => 'simulation',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                'certificate_chain' => [
                    base64_encode($leafDer),
                    base64_encode($this->certificateDer($issuerCertificate)),
                ],
            ],
            'certificate_fingerprint' => hash('sha256', $leafDer),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        return [$privateKey, $leafCertificate, $leafDer, $issuerCertificate];
    }

    /** @return array{\OpenSSLAsymmetricKey,\OpenSSLCertificate} */
    private function certificateAuthority(): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'Coordinator CA'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);

        return [$key, $certificate];
    }

    /** @return array{string,\OpenSSLCertificate,string} */
    private function leafCertificate(
        \OpenSSLAsymmetricKey $issuerKey,
        \OpenSSLCertificate $issuerCertificate,
    ): array {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'Coordinator Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign(
            $request,
            $issuerCertificate,
            $issuerKey,
            1,
            ['digest_alg' => 'sha256'],
        );
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));

        return [$privateKey, $certificate, $this->certificateDer($certificate)];
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

    /** @return array<int,string> */
    private function decode(string $encoded): array
    {
        $payload = base64_decode($encoded, true);
        $this->assertIsString($payload);
        $fields = [];
        for ($offset = 0, $size = strlen($payload); $offset < $size;) {
            $this->assertLessThanOrEqual($size, $offset + 2);
            $tag = ord($payload[$offset++]);
            $length = ord($payload[$offset++]);
            $this->assertLessThanOrEqual($size, $offset + $length);
            $fields[$tag] = substr($payload, $offset, $length);
            $offset += $length;
        }

        return $fields;
    }

    private function invoiceXml(string $transactionCode): string
    {
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
 <cbc:ID>INV-SIGNED-QR-1</cbc:ID>
 <cbc:UUID>44444444-4444-4444-8444-444444444444</cbc:UUID>
 <cbc:InvoiceTypeCode name="{$transactionCode}">388</cbc:InvoiceTypeCode>
 <cac:AdditionalDocumentReference><cbc:ID>QR</cbc:ID><cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="text/plain">QR</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>
 <cac:Signature><cbc:ID>urn:oasis:names:specification:ubl:signature:Invoice</cbc:ID></cac:Signature>
 <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="SAR">115.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>
XML;
    }
}

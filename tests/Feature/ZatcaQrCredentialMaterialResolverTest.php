<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaQrCredentialMaterialResolver;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ZatcaQrCredentialMaterialResolverTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function it_derives_qr_material_from_the_active_encrypted_leaf_certificate(): void
    {
        $auth = $this->registerTenant('zatca-qr-material', 'zatca-qr-material@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        [$caKey, $caCertificate] = $this->certificateAuthority();
        [$competingKey, , $competingDer] = $this->leafCertificate($caKey, $caCertificate);
        [$privateKey, $leafCertificate, $leafDer] = $this->leafCertificate($caKey, $caCertificate);

        ZatcaCredential::create([
            'environment' => 'developer',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $competingKey,
                'certificate_chain' => [base64_encode($competingDer)],
            ],
            'certificate_fingerprint' => hash('sha256', $competingDer),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);
        Settings::put('zatca', ['active_environment' => 'simulation']);

        $credential = ZatcaCredential::create([
            'environment' => 'simulation',
            'stage' => 'compliance',
            'status' => 'configured',
            'credentials' => [
                'private_key' => $privateKey,
                // leaf أولاً ثم شهادة المُصدر؛ يجب ألا يشتق المحلل المادة من CA.
                'certificate_chain' => [base64_encode($leafDer), base64_encode($this->certificateDer($caCertificate))],
            ],
            'certificate_fingerprint' => hash('sha256', $leafDer),
            'configured_at' => now(),
            'expires_at' => now()->addDay(),
        ]);

        $material = app(ZatcaQrCredentialMaterialResolver::class)->resolve();
        $leafKey = openssl_pkey_get_public($leafCertificate);
        $details = $leafKey === false ? false : openssl_pkey_get_details($leafKey);
        $this->assertIsArray($details);
        $this->assertSame(
            "\x04".str_pad($details['ec']['x'], 32, "\x00", STR_PAD_LEFT)
                .str_pad($details['ec']['y'], 32, "\x00", STR_PAD_LEFT),
            $material['public_key'],
        );
        $this->assertSame(65, strlen($material['public_key']));

        $caPublicKey = openssl_pkey_get_public($caCertificate);
        $this->assertNotFalse($caPublicKey);
        $this->assertSame(1, openssl_verify(
            $this->tbsCertificate($leafDer),
            $material['certificate_signature'],
            $caPublicKey,
            OPENSSL_ALGO_SHA256,
        ));

        $stored = $credential->fresh()->credentials;
        $this->assertArrayNotHasKey('qr_public_key', $stored);
        $this->assertArrayNotHasKey('qr_certificate_signature', $stored);
    }

    /** @return array{\OpenSSLAsymmetricKey,\OpenSSLCertificate} */
    private function certificateAuthority(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'QR Resolver CA'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);

        return [$key, $certificate];
    }

    /** @return array{string,\OpenSSLCertificate,string} */
    private function leafCertificate(\OpenSSLAsymmetricKey $caKey, \OpenSSLCertificate $caCertificate): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'QR Resolver Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, $caCertificate, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return [$privateKey, $certificate, $der];
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

    private function tbsCertificate(string $der): string
    {
        $outerOffset = 0;
        [, $outerContent] = $this->element($der, $outerOffset);
        $innerOffset = 0;
        [$tbs] = $this->element($outerContent, $innerOffset);

        return $tbs;
    }

    /** @return array{string,string} complete element, content */
    private function element(string $der, int &$offset): array
    {
        $start = $offset;
        $offset++;
        $first = ord($der[$offset++]);
        if ($first < 0x80) {
            $length = $first;
        } else {
            $octets = $first & 0x7f;
            $length = 0;
            for ($index = 0; $index < $octets; $index++) {
                $length = ($length << 8) | ord($der[$offset++]);
            }
        }
        $contentStart = $offset;
        $offset += $length;

        return [substr($der, $start, $offset - $start), substr($der, $contentStart, $length)];
    }
}

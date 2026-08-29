<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use InvalidArgumentException;
use Tests\TestCase;

class ZatcaQrCertificateMaterialExtractorTest extends TestCase
{
    /** @test */
    public function it_extracts_the_uncompressed_ec_key_and_verifiable_ca_signature(): void
    {
        [$caKey, $caCertificate] = $this->certificateAuthority();
        [$leafCertificate, $leafDer] = $this->leafCertificate($caKey, $caCertificate);

        $material = app(ZatcaQrCertificateMaterialExtractor::class)->extract(base64_encode($leafDer));
        $leafKey = openssl_pkey_get_public($leafCertificate);
        $details = $leafKey === false ? false : openssl_pkey_get_details($leafKey);
        $this->assertIsArray($details);
        $this->assertSame("\x04".$details['ec']['x'].$details['ec']['y'], $material['public_key']);
        $this->assertSame(65, strlen($material['public_key']));

        $caPublicKey = openssl_pkey_get_public($caCertificate);
        $this->assertNotFalse($caPublicKey);
        $this->assertSame(1, openssl_verify(
            $this->tbsCertificate($leafDer),
            $material['certificate_signature'],
            $caPublicKey,
            OPENSSL_ALGO_SHA256,
        ));
    }

    /** @test */
    public function it_rejects_non_der_and_non_ec_certificates(): void
    {
        $extractor = app(ZatcaQrCertificateMaterialExtractor::class);

        foreach ([
            'not-base64',
            base64_encode('not-a-certificate'),
            base64_encode($this->rsaCertificateDer()),
            base64_encode($this->ecCertificateDer('prime256v1')),
        ] as $material) {
            try {
                $extractor->extract($material);
                $this->fail('كان يجب رفض مادة شهادة غير صالحة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    private function rsaCertificateDer(): string
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_RSA, 'private_key_bits' => 2048]);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'RSA Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return $der;
    }

    private function ecCertificateDer(string $curveName): string
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => $curveName]);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'Wrong Curve Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return $der;
    }

    /** @return array{\OpenSSLAsymmetricKey,\OpenSSLCertificate} */
    private function certificateAuthority(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'QR Test CA'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);

        return [$key, $certificate];
    }

    /** @return array{\OpenSSLCertificate,string} */
    private function leafCertificate(\OpenSSLAsymmetricKey $caKey, \OpenSSLCertificate $caCertificate): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $request = openssl_csr_new(['commonName' => 'QR Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, $caCertificate, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/', '', $pem);
        $this->assertIsString($body);
        $der = base64_decode($body, true);
        $this->assertIsString($der);

        return [$certificate, $der];
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

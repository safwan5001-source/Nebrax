<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaXadesSignedPropertiesBuilder;
use DateTimeImmutable;
use DOMDocument;
use DOMXPath;
use InvalidArgumentException;
use Tests\TestCase;

class ZatcaXadesSignedPropertiesBuilderTest extends TestCase
{
    /** @test */
    public function it_builds_signed_properties_with_the_complete_certificate_chain_in_order(): void
    {
        $leaf = $this->certificateDer('Leaf Device');
        $root = $this->certificateDer('Root CA');
        $policyDigest = base64_encode(hash('sha256', 'zatca-policy', true));

        $xml = app(ZatcaXadesSignedPropertiesBuilder::class)->build(
            [base64_encode($leaf), base64_encode($root)],
            new DateTimeImmutable('2026-08-28 15:16:17+03:00'),
            'https://zatca.gov.sa/security-policy.pdf?version=1&language=en',
            $policyDigest,
            'signedProperties-1',
            '#invoice-data-1',
        );

        $document = new DOMDocument();
        $this->assertTrue($document->loadXML($xml));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('xades', ZatcaXadesSignedPropertiesBuilder::XADES_NAMESPACE);
        $xpath->registerNamespace('ds', ZatcaXadesSignedPropertiesBuilder::XMLDSIG_NAMESPACE);

        $this->assertSame('signedProperties-1', $xpath->evaluate('string(/xades:SignedProperties/@Id)'));
        $this->assertSame('2026-08-28T12:16:17Z', $xpath->evaluate('string(//xades:SigningTime)'));

        $certificateDigests = $xpath->query(
            '//xades:SigningCertificateV2/xades:Cert/xades:CertDigest/ds:DigestValue'
        );
        $this->assertNotFalse($certificateDigests);
        $this->assertSame(2, $certificateDigests->length);
        $this->assertSame(base64_encode(hash('sha256', $leaf, true)), $certificateDigests->item(0)?->textContent);
        $this->assertSame(base64_encode(hash('sha256', $root, true)), $certificateDigests->item(1)?->textContent);

        $digestMethods = $xpath->query('//xades:CertDigest/ds:DigestMethod');
        $this->assertNotFalse($digestMethods);
        $this->assertSame(2, $digestMethods->length);
        foreach ($digestMethods as $digestMethod) {
            $this->assertSame(
                ZatcaXadesSignedPropertiesBuilder::SHA256_ALGORITHM,
                $digestMethod->attributes?->getNamedItem('Algorithm')?->nodeValue
            );
        }

        $this->assertSame(
            'https://zatca.gov.sa/security-policy.pdf?version=1&language=en',
            $xpath->evaluate('string(//xades:SignaturePolicyId/xades:SigPolicyId/xades:Identifier)')
        );
        $this->assertSame($policyDigest, $xpath->evaluate('string(//xades:SigPolicyHash/ds:DigestValue)'));
        $this->assertSame(
            ZatcaXadesSignedPropertiesBuilder::SHA256_ALGORITHM,
            $xpath->evaluate('string(//xades:SigPolicyHash/ds:DigestMethod/@Algorithm)')
        );
        $this->assertSame('#invoice-data-1', $xpath->evaluate('string(//xades:DataObjectFormat/@ObjectReference)'));
        $this->assertSame('text/xml', $xpath->evaluate('string(//xades:DataObjectFormat/xades:MimeType)'));
    }

    /** @test */
    public function it_rejects_empty_malformed_or_non_x509_certificate_chains(): void
    {
        $builder = app(ZatcaXadesSignedPropertiesBuilder::class);
        $digest = base64_encode(str_repeat('x', 32));
        $validCertificate = $this->certificateDer('Trailing Bytes');
        $invalidChains = [
            [],
            [1 => 'certificate'],
            ['not-base64!'],
            [base64_encode('not-a-certificate')],
            [base64_encode($validCertificate.'trailing-bytes')],
        ];

        foreach ($invalidChains as $chain) {
            try {
                $builder->build(
                    $chain,
                    new DateTimeImmutable(),
                    'https://example.test/policy',
                    $digest,
                );
                $this->fail('كان يجب رفض سلسلة شهادات ZATCA غير الصالحة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function it_rejects_invalid_policy_and_xml_identifiers_after_validating_the_certificate(): void
    {
        $builder = app(ZatcaXadesSignedPropertiesBuilder::class);
        $chain = [base64_encode($this->certificateDer('Leaf Device'))];
        $digest = base64_encode(str_repeat('x', 32));
        $invalidInputs = [
            ['http://example.test/policy', $digest, 'properties', '#invoice'],
            ['https://example.test/policy', base64_encode(str_repeat('x', 31)), 'properties', '#invoice'],
            ['https://example.test/policy', 'not-base64!', 'properties', '#invoice'],
            ['https://example.test/policy', $digest, '1 properties', '#invoice'],
            ['https://example.test/policy', $digest, 'properties', 'invoice'],
            ['https://example.test/policy', $digest, 'properties', '#1 invoice'],
        ];

        foreach ($invalidInputs as [$policy, $policyDigest, $propertiesId, $objectReference]) {
            try {
                $builder->build(
                    $chain,
                    new DateTimeImmutable(),
                    $policy,
                    $policyDigest,
                    $propertiesId,
                    $objectReference,
                );
                $this->fail('كان يجب رفض مدخل XAdES غير الصالح.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    private function certificateDer(string $commonName): string
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => 'secp256k1',
        ]);
        $this->assertNotFalse($key);

        $request = openssl_csr_new(
            ['commonName' => $commonName],
            $key,
            ['digest_alg' => 'sha256']
        );
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
}

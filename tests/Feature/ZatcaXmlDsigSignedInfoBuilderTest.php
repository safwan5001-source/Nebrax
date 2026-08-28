<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaXmlCanonicalizer;
use App\Services\Accounting\ZatcaXmlDsigSignedInfoBuilder;
use DOMDocument;
use DOMXPath;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

class ZatcaXmlDsigSignedInfoBuilderTest extends TestCase
{
    /** @test */
    public function it_builds_the_two_required_zatca_references_without_detached_canonicalization(): void
    {
        $invoiceDigest = base64_encode(hash('sha256', 'invoice', true));
        $propertiesDigest = base64_encode(hash('sha256', 'properties', true));
        $builder = app(ZatcaXmlDsigSignedInfoBuilder::class);

        $xml = $builder->build(
            $invoiceDigest,
            $propertiesDigest,
            'invoice-data-1',
            'signed-properties-1',
        );
        $document = new DOMDocument();
        $this->assertTrue($document->loadXML($xml));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('ds', ZatcaXmlDsigSignedInfoBuilder::XMLDSIG_NAMESPACE);

        $this->assertSame(
            ZatcaXmlCanonicalizer::ALGORITHM,
            $xpath->evaluate('string(/ds:SignedInfo/ds:CanonicalizationMethod/@Algorithm)')
        );
        $this->assertSame(
            ZatcaXmlDsigSignedInfoBuilder::ECDSA_SHA256_ALGORITHM,
            $xpath->evaluate('string(/ds:SignedInfo/ds:SignatureMethod/@Algorithm)')
        );

        $references = $xpath->query('/ds:SignedInfo/ds:Reference');
        $this->assertNotFalse($references);
        $this->assertSame(2, $references->length);

        $this->assertSame('invoice-data-1', $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[1]/@Id)'));
        $this->assertSame('', $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[1]/@URI)'));
        $this->assertSame($invoiceDigest, $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[1]/ds:DigestValue)'));

        $xpathTransforms = $xpath->query(
            '/ds:SignedInfo/ds:Reference[1]/ds:Transforms/ds:Transform[@Algorithm="'
            .ZatcaXmlDsigSignedInfoBuilder::XPATH_ALGORITHM.'"]/ds:XPath'
        );
        $this->assertNotFalse($xpathTransforms);
        $this->assertSame(3, $xpathTransforms->length);
        $this->assertSame(
            [
                'not(//ancestor-or-self::ext:UBLExtensions)',
                'not(//ancestor-or-self::cac:Signature)',
                "not(//ancestor-or-self::cac:AdditionalDocumentReference[cbc:ID='QR'])",
            ],
            array_map(
                static fn ($node) => $node->textContent,
                iterator_to_array($xpathTransforms)
            )
        );

        $this->assertSame(
            '#signed-properties-1',
            $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[2]/@URI)')
        );
        $this->assertSame(
            ZatcaXmlDsigSignedInfoBuilder::SIGNED_PROPERTIES_TYPE,
            $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[2]/@Type)')
        );
        $this->assertSame(
            $propertiesDigest,
            $xpath->evaluate('string(/ds:SignedInfo/ds:Reference[2]/ds:DigestValue)')
        );
        $this->assertSame(
            2,
            $xpath->query('//ds:DigestMethod[@Algorithm="'.ZatcaXmlDsigSignedInfoBuilder::SHA256_ALGORITHM.'"]')?->length
        );
        $this->assertSame(
            2,
            $xpath->query('//ds:Transform[@Algorithm="'.ZatcaXmlCanonicalizer::ALGORITHM.'"]')?->length
        );
    }

    /** @test */
    public function it_rejects_wrong_digest_lengths_and_invalid_xml_ids(): void
    {
        $builder = app(ZatcaXmlDsigSignedInfoBuilder::class);
        $digest = base64_encode(str_repeat('x', 32));
        $invalid = [
            [base64_encode(str_repeat('x', 31)), $digest, 'invoice', 'properties'],
            ['not-base64!', $digest, 'invoice', 'properties'],
            [$digest, base64_encode(str_repeat('x', 33)), 'invoice', 'properties'],
            [$digest, $digest, '1 invoice', 'properties'],
            [$digest, $digest, 'invoice', '1 properties'],
            [$digest, $digest, 'same-id', 'same-id'],
        ];

        foreach ($invalid as [$invoiceDigest, $propertiesDigest, $invoiceId, $propertiesId]) {
            try {
                $builder->build($invoiceDigest, $propertiesDigest, $invoiceId, $propertiesId);
                $this->fail('كان يجب رفض مدخل SignedInfo غير الصالح.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function the_shared_canonicalizer_rejects_dtd_documents(): void
    {
        $this->expectException(RuntimeException::class);

        app(ZatcaXmlCanonicalizer::class)->canonicalize(
            '<!DOCTYPE root [<!ENTITY value "unsafe">]><root>&value;</root>'
        );
    }
}

<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaCertificateFields;
use App\Services\Accounting\ZatcaXadesSignedPropertiesBuilder;
use DateTimeImmutable;
use DOMDocument;
use DOMXPath;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * REM-17: SignedProperties بصيغة SDK الرسمي (SigningCertificate v1 + IssuerSerial، بصمات Base64(hex))، مع إبقاء
 * SignaturePolicyIdentifier وDataObjectFormat (معيار ميزات الأمان §2.3.3). المقارنة مع العيّنات الرسمية الـ19 تجري
 * في CI عبر scripts/zatca-sdk (crypto_checks) لأن محتوى SDK لا يُنسخ إلى المستودع.
 */
class ZatcaXadesSignedPropertiesBuilderTest extends TestCase
{
    private const POLICY = 'https://zatca.gov.sa/synthetic-test-policy';

    #[Test]
    public function it_writes_the_exact_official_layout_with_v1_signing_certificates_for_the_whole_chain(): void
    {
        $leaf = $this->certificateDer('Leaf Device', 7);
        $root = $this->certificateDer('Root CA', 255);
        $policyDigest = base64_encode(hash('sha256', 'zatca-policy', true));

        $built = app(ZatcaXadesSignedPropertiesBuilder::class)->build(
            [base64_encode($leaf), base64_encode($root)],
            new DateTimeImmutable('2026-08-28 15:16:17+03:00'),
            self::POLICY,
            $policyDigest,
            'signedProperties-1',
            '#invoice-data-1',
        );

        $cert = static fn (string $der, string $issuer, string $serial): array => [
            [2, '<xades:Cert>'],
            [3, '<xades:CertDigest>'],
            [4, '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>'],
            [4, '<ds:DigestValue>'.base64_encode(hash('sha256', base64_encode($der))).'</ds:DigestValue>'],
            [3, '</xades:CertDigest>'],
            [3, '<xades:IssuerSerial>'],
            [4, '<ds:X509IssuerName>'.$issuer.'</ds:X509IssuerName>'],
            [4, '<ds:X509SerialNumber>'.$serial.'</ds:X509SerialNumber>'],
            [3, '</xades:IssuerSerial>'],
            [2, '</xades:Cert>'],
        ];
        $lines = array_merge(
            [[0, '<xades:SignedSignatureProperties>'], [1, '<xades:SigningTime>2026-08-28T12:16:17Z</xades:SigningTime>'], [1, '<xades:SigningCertificate>']],
            $cert($leaf, 'CN=Leaf Device, O=AWJ Synthetic, C=SA', '7'),
            $cert($root, 'CN=Root CA, O=AWJ Synthetic, C=SA', '255'),
            [
                [1, '</xades:SigningCertificate>'],
                [1, '<xades:SignaturePolicyIdentifier>'], [2, '<xades:SignaturePolicyId>'], [3, '<xades:SigPolicyId>'],
                [4, '<xades:Identifier>'.self::POLICY.'</xades:Identifier>'], [3, '</xades:SigPolicyId>'], [3, '<xades:SigPolicyHash>'],
                [4, '<ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/>'],
                [4, '<ds:DigestValue>'.$policyDigest.'</ds:DigestValue>'], [3, '</xades:SigPolicyHash>'],
                [2, '</xades:SignaturePolicyId>'], [1, '</xades:SignaturePolicyIdentifier>'],
                [0, '</xades:SignedSignatureProperties>'], [0, '<xades:SignedDataObjectProperties>'],
                [1, '<xades:DataObjectFormat ObjectReference="#invoice-data-1">'], [2, '<xades:MimeType>text/xml</xades:MimeType>'],
                [1, '</xades:DataObjectFormat>'], [0, '</xades:SignedDataObjectProperties>'],
            ],
        );
        $expected = '<xades:SignedProperties Id="signedProperties-1">'."\n";
        foreach ($lines as [$depth, $line]) {
            $expected .= str_repeat(' ', 36 + 4 * $depth).$line."\n";
        }
        $expected .= str_repeat(' ', 32).'</xades:SignedProperties>';

        $this->assertSame($expected, $built['xml']);

        // T مكتوبة يدوياً من الناتج: إعلان xades على الجذر وds على كل عنصر ds، والمسافات كما هي.
        $standalone = str_replace(
            ['<xades:SignedProperties Id=', '<ds:DigestMethod ', '<ds:DigestValue>', '<ds:X509IssuerName>', '<ds:X509SerialNumber>'],
            [
                '<xades:SignedProperties xmlns:xades="http://uri.etsi.org/01903/v1.3.2#" Id=',
                '<ds:DigestMethod xmlns:ds="http://www.w3.org/2000/09/xmldsig#" ',
                '<ds:DigestValue xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
                '<ds:X509IssuerName xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
                '<ds:X509SerialNumber xmlns:ds="http://www.w3.org/2000/09/xmldsig#">',
            ],
            $expected,
        );
        $this->assertSame(base64_encode(hash('sha256', $standalone)), $built['digest']);

        $document = new DOMDocument();
        $this->assertTrue($document->loadXML(
            '<w xmlns:xades="'.ZatcaXadesSignedPropertiesBuilder::XADES_NAMESPACE.'" xmlns:ds="'.ZatcaXadesSignedPropertiesBuilder::XMLDSIG_NAMESPACE.'">'.$built['xml'].'</w>'
        ));
        $xpath = new DOMXPath($document);
        $xpath->registerNamespace('xades', ZatcaXadesSignedPropertiesBuilder::XADES_NAMESPACE);
        $this->assertSame(0, $xpath->query('//xades:SigningCertificateV2')?->length, 'SDK XSD يرفض SigningCertificateV2');
    }

    #[Test]
    public function the_documented_digest_encodings_match_the_official_guideline_examples(): void
    {
        // الدليل الفني التفصيلي، الخطوة 3: بصمة الشهادة = Base64 لنص الهاش الست عشري.
        $this->assertSame(
            'NjlhOTVmYzIzN2I0MjcxNGRjNDQ1N2EzM2I5NGNjNDUyZmQ5ZjExMDUwNGM2ODNjNDAxMTQ0ZDk1NDQ4OTRmYg==',
            base64_encode('69a95fc237b42714dc4457a33b94cc452fd9f110504c683c401144d9544894fb'),
        );
        // الخطوة 1: هاش الفاتورة = Base64 للبايتات الخام (مختلف عن الخطوة 3).
        $this->assertSame(
            'oRtv5YelD32v/jp/tC3MzzK0PumzfZ8lLQQkPlTBGj8=',
            base64_encode((string) hex2bin('a11b6fe587a50f7daffe3a7fb42dcccf32b43ee9b37d9f252d04243e54c11a3f')),
        );
        // ملاحظة موثَّقة: مثال الخطوة 5 في الدليل بصيغة البايتات الخام، لكن عيّنات SDK الرسمية ومدقّقه يستعملان
        // Base64(hex) ويرفضان الصيغة الخام (REM-17 Phase A) — فنتبع المدقّق والعيّنات.
    }

    #[Test]
    public function the_digest_is_whitespace_sensitive_and_refuses_ambiguous_input(): void
    {
        $builder = app(ZatcaXadesSignedPropertiesBuilder::class);
        $built = $builder->build([base64_encode($this->certificateDer('Leaf Device', 1))], new DateTimeImmutable(), self::POLICY, base64_encode(str_repeat('x', 32)));

        $this->assertSame($built['digest'], $builder->digest($built['xml']));
        $this->assertNotSame($built['digest'], $builder->digest(preg_replace('/\n {36}/', "\n  ", $built['xml'], 1)));

        foreach ([
            str_replace('<ds:DigestValue>', '<ds:DigestValue xmlns:ds="'.ZatcaXadesSignedPropertiesBuilder::XMLDSIG_NAMESPACE.'">', $built['xml']),
            str_replace("\n", "\r\n", $built['xml']),
            str_replace('text/xml', 'text&amp;xml', $built['xml']),
            str_replace('<xades:MimeType>', '<!-- c --><xades:MimeType>', $built['xml']),
            str_replace('xades:MimeType', 'other:MimeType', $built['xml']),
        ] as $ambiguous) {
            try {
                $builder->digest($ambiguous);
                $this->fail('كان يجب رفض SignedProperties ملتبسة التحويل.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function it_rejects_empty_malformed_or_non_x509_certificate_chains(): void
    {
        $builder = app(ZatcaXadesSignedPropertiesBuilder::class);
        $digest = base64_encode(str_repeat('x', 32));
        $validCertificate = $this->certificateDer('Trailing Bytes', 1);
        $invalidChains = [
            [],
            [1 => 'certificate'],
            ['not-base64!'],
            [base64_encode('not-a-certificate')],
            [base64_encode($validCertificate.'trailing-bytes')],
        ];

        foreach ($invalidChains as $chain) {
            try {
                $builder->build($chain, new DateTimeImmutable(), self::POLICY, $digest);
                $this->fail('كان يجب رفض سلسلة شهادات ZATCA غير الصالحة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function it_keeps_the_fail_closed_policy_checks_and_rejects_xml_special_characters(): void
    {
        $builder = app(ZatcaXadesSignedPropertiesBuilder::class);
        $chain = [base64_encode($this->certificateDer('Leaf Device', 1))];
        $digest = base64_encode(str_repeat('x', 32));
        $invalidInputs = [
            ['http://example.test/policy', $digest, 'properties', '#invoice'],
            ['https://example.test/policy?a=1&b=2', $digest, 'properties', '#invoice'],
            ['https://example.test/policy', base64_encode(str_repeat('x', 31)), 'properties', '#invoice'],
            ['https://example.test/policy', 'not-base64!', 'properties', '#invoice'],
            ['https://example.test/policy', $digest, '1 properties', '#invoice'],
            ['https://example.test/policy', $digest, 'properties', 'invoice'],
            ['https://example.test/policy', $digest, 'properties', '#1 invoice'],
        ];

        foreach ($invalidInputs as [$policy, $policyDigest, $propertiesId, $objectReference]) {
            try {
                $builder->build($chain, new DateTimeImmutable(), $policy, $policyDigest, $propertiesId, $objectReference);
                $this->fail('كان يجب رفض مدخل XAdES غير الصالح.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function an_issuer_name_that_cannot_be_represented_unambiguously_fails_closed(): void
    {
        $this->expectException(InvalidArgumentException::class);

        app(ZatcaXadesSignedPropertiesBuilder::class)->build(
            [base64_encode($this->certificateDer('Acme, Inc', 1))],
            new DateTimeImmutable(),
            self::POLICY,
            base64_encode(str_repeat('x', 32)),
        );
    }

    #[Test]
    public function certificate_fields_use_the_sdk_issuer_format_and_a_decimal_serial(): void
    {
        $der = $this->certificateDer('PRZEINVOICESCA4-CA', PHP_INT_MAX);
        $fields = app(ZatcaCertificateFields::class)->extract($der);

        $this->assertSame('CN=PRZEINVOICESCA4-CA, O=AWJ Synthetic, C=SA', $fields['issuer_name']);
        $this->assertSame((string) PHP_INT_MAX, $fields['serial_number']);
        $this->assertSame(88, strlen($fields['subject_public_key_info']));
        $this->assertStringStartsWith("\x30\x56\x30\x10\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01\x06\x05\x2B\x81\x04\x00\x0A", $fields['subject_public_key_info']);
    }

    private function certificateDer(string $commonName, int $serial): string
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);

        // إعداد OpenSSL أدنى حتى لا تضيف إعدادات النظام سمات افتراضية (مثل ST=Some-State) إلى الاسم.
        $config = tempnam(sys_get_temp_dir(), 'awj-cnf');
        file_put_contents($config, "[req]\ndistinguished_name=dn\n[dn]\n");
        try {
            $options = ['digest_alg' => 'sha256', 'config' => $config];
            $request = openssl_csr_new(['countryName' => 'SA', 'organizationName' => 'AWJ Synthetic', 'commonName' => $commonName], $key, $options);
            $this->assertNotFalse($request);
            $certificate = openssl_csr_sign($request, null, $key, 1, $options, $serial);
        } finally {
            @unlink($config);
        }
        $this->assertNotFalse($certificate);

        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $der = base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', $pem), true);
        $this->assertIsString($der);

        return $der;
    }
}

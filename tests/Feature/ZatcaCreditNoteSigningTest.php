<?php

namespace Tests\Feature;

use App\Models\ZatcaCredential;
use App\Services\Accounting\ZatcaInvoiceHasher;
use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use App\Services\Accounting\ZatcaSignedInvoiceFinalizer;
use App\Services\Accounting\ZatcaSignedInvoiceQrMaterialExtractor;
use App\Support\ZatcaCreditNoteXml;
use App\Tenancy\TenantContext;
use DateTimeImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * REM-18a — إشعار الدائن يمرّ في خط توقيع REM-17 **كما هو** (بلا تعديل عليه): `ZatcaSignedInvoiceFinalizer` الإنتاجي
 * يوقّعه، ويتحقق هذا الاختبار باستقلال (openssl_verify) من أن المرجع (BT-25) والسبب (KSA-10) ورمز الدفع سليمة بعد التوقيع،
 * وأن وسوم QR 6–9 هي المواد المطلوبة، وأن الحقول المحسوبة في XML غير الموقَّع لم تتغيّر. اعتماد ومفاتيح اصطناعية مؤقتة.
 */
class ZatcaCreditNoteSigningTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;
    use ZatcaCreditNoteFixtureSpecs;

    #[DataProvider('signedProvider')]
    public function test_a_credit_note_is_signed_by_the_unmodified_production_pipeline(string $name, string $class): void
    {
        [$privateKey, $leafDer] = $this->configureSigningCredential();
        $input = self::noteInputFromSpec($name);
        $unsigned = ZatcaCreditNoteXml::build($input);
        $phaseOne = ZatcaCreditNoteXml::phaseOneQr($input);
        $withQr = ZatcaCreditNoteXml::withQr($unsigned, $phaseOne);

        $final = app(ZatcaSignedInvoiceFinalizer::class)->finalize(
            $unsigned,
            ZatcaCreditNoteXml::QR_PLACEHOLDER,
            'Synthetic Seller Co',
            '300000000000003',
            $input->issuedAt,
            new DateTimeImmutable('2026-02-10T08:20:00Z'),
            number_format($input->total / 100, 2, '.', ''),
            number_format($input->taxAmount / 100, 2, '.', ''),
            $class,
        );

        // 1) المرجع والسبب ورمز الدفع والنوع كما في الإدخال بعد التوقيع.
        $doc = new \DOMDocument();
        $this->assertTrue($doc->loadXML($final['xml']));
        $xp = new \DOMXPath($doc);
        $xp->registerNamespace('inv', 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2');
        $xp->registerNamespace('cac', 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2');
        $xp->registerNamespace('cbc', 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2');
        $this->assertSame($input->originalInvoiceNumber, $xp->evaluate('string(/inv:Invoice/cac:BillingReference/cac:InvoiceDocumentReference/cbc:ID)'));
        $this->assertSame('381', $xp->evaluate('string(/inv:Invoice/cbc:InvoiceTypeCode)'));
        $this->assertSame('10', $xp->evaluate('string(/inv:Invoice/cac:PaymentMeans/cbc:PaymentMeansCode)'));
        $this->assertNotSame('', $xp->evaluate('string(/inv:Invoice/cac:PaymentMeans/cbc:InstructionNote)'));
        $this->assertSame(1, (int) $xp->evaluate('count(/inv:Invoice/cac:BillingReference)'));
        $this->assertSame($input->number, $xp->evaluate('string(/inv:Invoice/cbc:ID)'));
        $this->assertSame($input->previousHash, $xp->evaluate("string(/inv:Invoice/cac:AdditionalDocumentReference[cbc:ID='PIH']//cbc:EmbeddedDocumentBinaryObject)"));

        // 2) كل ما كان في XML غير الموقَّع باقٍ كما هو (التوقيع يضيف امتداداً ولا يعيد كتابة المستند).
        $stripped = (string) preg_replace('~<ext:UBLExtensions[^>]*>.*?</ext:UBLExtensions>\s*~s', '', $final['xml'], 1);
        $stripped = str_replace($final['qr'], ZatcaCreditNoteXml::QR_PLACEHOLDER, $stripped);
        $this->assertSame(1, substr_count($stripped, ZatcaCreditNoteXml::QR_PLACEHOLDER));
        $this->assertSame(
            preg_replace('~\s+~', '', $unsigned),
            preg_replace('~\s+~', '', $stripped),
            'التوقيع لا يغيّر محتوى الإشعار',
        );

        // 3) توقيع ECDSA يتحقق باستقلال، وهاش المستند هو هاش الخط الإنتاجي.
        $material = app(ZatcaSignedInvoiceQrMaterialExtractor::class)->extract($final['xml']);
        $leafKey = openssl_pkey_get_public("-----BEGIN CERTIFICATE-----\n".chunk_split(base64_encode($leafDer), 64, "\n")."-----END CERTIFICATE-----\n");
        $this->assertNotFalse($leafKey);
        $this->assertSame(1, openssl_verify($material['invoice_hash'], (string) base64_decode($material['signature_value'], true), $leafKey, OPENSSL_ALGO_SHA256));
        $this->assertSame(app(ZatcaInvoiceHasher::class)->hash($final['xml']), $final['hash']);
        $this->assertStringNotContainsString($privateKey, $final['xml']);

        // 4) QR: وسوم 1–5 مطابقة للمرحلة 1 المشتقة من اللقطة، و6–9 (المبسّط) أو 6–8 (القياسي) من المواد الموقَّعة.
        $fields = $this->decodeQr($final['qr']);
        $phaseOneFields = $this->decodeQr($phaseOne);
        foreach ([1, 2, 4, 5] as $tag) {
            $this->assertSame($phaseOneFields[$tag], $fields[$tag], "tag {$tag}");
        }
        $this->assertSame($final['hash'], $fields[6]);
        $this->assertSame($material['signature_value'], $fields[7]);
        $certificate = app(ZatcaQrCertificateMaterialExtractor::class)->extract(base64_encode($leafDer));
        $this->assertSame($certificate['public_key'], $fields[8]);
        $class === 'simplified'
            ? $this->assertSame($certificate['certificate_signature'], $fields[9])
            : $this->assertArrayNotHasKey(9, $fields);
        $this->assertNotSame($withQr, $final['xml']);
    }

    /** @return array<string, array{string,string}> */
    public static function signedProvider(): array
    {
        return [
            'standard single line' => ['awj-note-standard-refund-single-line', 'standard'],
            'standard multi line with discounts' => ['awj-note-standard-multi-line-discounts', 'standard'],
            'simplified single line' => ['awj-note-simplified-refund-single-line', 'simplified'],
            'simplified partial two lines' => ['awj-note-simplified-two-lines-partial', 'simplified'],
        ];
    }

    public function test_tampering_with_the_billing_reference_after_signing_changes_the_invoice_hash(): void
    {
        $this->configureSigningCredential();
        $input = self::noteInputFromSpec('awj-note-standard-refund-single-line');
        $unsigned = ZatcaCreditNoteXml::build($input);
        $final = app(ZatcaSignedInvoiceFinalizer::class)->finalize(
            $unsigned, ZatcaCreditNoteXml::QR_PLACEHOLDER, 'Synthetic Seller Co', '300000000000003', $input->issuedAt,
            new DateTimeImmutable('2026-02-10T08:20:00Z'), '575.00', '75.00', 'standard',
        );
        $tampered = str_replace(
            '<cbc:ID>'.$input->originalInvoiceNumber.'</cbc:ID>',
            '<cbc:ID>INV-999999</cbc:ID>',
            $final['xml'],
        );
        $this->assertNotSame($final['xml'], $tampered);
        $this->assertNotSame($final['hash'], app(ZatcaInvoiceHasher::class)->hash($tampered), 'the invoice hash covers the original-invoice reference');
    }

    public function test_the_note_envelope_has_no_extension_before_signing_so_the_assembler_inserts_it(): void
    {
        $xml = ZatcaCreditNoteXml::build(self::noteInputFromSpec('awj-note-standard-refund-single-line'));
        $this->assertStringNotContainsString('UBLExtensions', $xml);
        $this->assertStringContainsString('<cac:Signature>', $xml);
    }

    /** @return array{string,string} private PEM, leaf DER */
    private function configureSigningCredential(): array
    {
        config()->set('zatca.signature_policy.identifier', 'https://zatca.gov.sa/security-policy.pdf');
        config()->set('zatca.signature_policy.digest', base64_encode(hash('sha256', 'pinned-policy', true)));
        $auth = $this->registerTenant('zatca-note-'.bin2hex(random_bytes(3)), uniqid('zatca-note-', true).'@example.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        $caKey = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($caKey);
        $caCsr = openssl_csr_new(['commonName' => 'Synthetic Note CA'], $caKey, ['digest_alg' => 'sha256']);
        $ca = openssl_csr_sign($caCsr, null, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($ca);
        $leafKey = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($leafKey);
        $leafCsr = openssl_csr_new(['commonName' => 'Synthetic Note Device'], $leafKey, ['digest_alg' => 'sha256']);
        $leaf = openssl_csr_sign($leafCsr, $ca, $caKey, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($leaf);
        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($leafKey, $privateKey));
        $leafDer = $this->der($leaf);

        ZatcaCredential::create([
            'environment' => 'developer', 'stage' => 'compliance', 'status' => 'configured',
            'credentials' => ['private_key' => $privateKey, 'certificate_chain' => [base64_encode($leafDer), base64_encode($this->der($ca))]],
            'certificate_fingerprint' => hash('sha256', $leafDer), 'configured_at' => now(), 'expires_at' => now()->addDay(),
        ]);

        return [$privateKey, $leafDer];
    }

    private function der(\OpenSSLCertificate $certificate): string
    {
        $pem = '';
        $this->assertTrue(openssl_x509_export($certificate, $pem));

        return (string) base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', $pem), true);
    }

    /** @return array<int,string> */
    private function decodeQr(string $encoded): array
    {
        $payload = (string) base64_decode($encoded, true);
        $fields = [];
        for ($offset = 0, $size = strlen($payload); $offset < $size;) {
            $tag = ord($payload[$offset++]);
            $length = ord($payload[$offset++]);
            $fields[$tag] = substr($payload, $offset, $length);
            $offset += $length;
        }

        return $fields;
    }
}

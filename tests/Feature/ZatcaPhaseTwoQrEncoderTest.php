<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaPhaseTwoQrEncoder;
use App\Services\Accounting\ZatcaQrCertificateMaterialExtractor;
use DateTimeImmutable;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-17: ترميز وسوم QR 6–9 المتحقَّق منه. الوسم 3 بلا تغيير (Q1 غير محسومة).
 */
class ZatcaPhaseTwoQrEncoderTest extends TestCase
{
    /**
     * مثال QR المنشور في الدليل الفني التفصيلي (E-invoicing Detailed Technical Guidelines، §6.2) — بيانات مستند
     * رسمي عام لا مفاتيح فيه. يُستعمل مرجعاً لترميز الوسوم 6–9: 6 = نصّ Base64 (44)، 7 = نصّ Base64 لتوقيع DER
     * (96)، 8 = SPKI بترميز DER (88)، 9 = توقيع DER (72).
     */
    private const GUIDELINE_EXAMPLE = 'ARdBaG1lZCBNb2hhbWVkIEFMIEFobWFkeQIPMzAxMTIxOTcxNTAwMDAzAxQyMDIyLTAzLTEzVDE0OjQwOjQwWgQHMTEwOC45MAUFMTQ0LjkGLFFuVkVleFc0bld2NENhRTM5YS82NkpwL09YTy9ldkhROHBEbEc3d2VxLzQ9B2BNRVVDSVFENXp4eVhPQjdOdldmNjJyVkVaQVlVNzFqcHk5SEVFblowcTlPOTZ3ckw2UUlnUUp6Q0dIYnc2WUJITFlWZE8xd25VaEJnS204ak1UeXZjazlNK3JQOXhZWT0IWDBWMBAGByqGSM49AgEGBSuBBAAKA0IABGGDDKDmhWAITDv7LXqLX2cmr6+qddUkpcLCvWs5rC2O29W/hS4ajAK4Qdnahym6MaijX75Cg3j4aao7ouYXJ9EJSDBGAiEA7mHT6yg85jtQGWp3M7tPT7Jk2+zsvVHGs3bU5Z7YE68CIQD60ebQamYjYvdebnFjNfx4X4dop7LsEBFCNSsLY0IFaQ==';

    #[Test]
    public function the_cryptographic_tags_match_the_official_guideline_example_byte_for_byte(): void
    {
        $official = $this->decode(self::GUIDELINE_EXAMPLE);
        $this->assertSame([44, 96, 88, 72], [strlen($official[6]), strlen($official[7]), strlen($official[8]), strlen($official[9])]);

        $encoded = app(ZatcaPhaseTwoQrEncoder::class)->encode(
            $official[1],
            $official[2],
            new DateTimeImmutable($official[3]),
            $official[4],
            '144.90', // AWJ يكتب منزلتين دائماً؛ المثال يكتب 144.9 — الوسم 5 خارج نطاق REM-17.
            $official[6],
            $official[7],
            $official[8],
            'simplified',
            $official[9],
        );
        $ours = $this->decode($encoded);

        foreach ([1, 2, 3, 4, 6, 7, 8, 9] as $tag) {
            $this->assertSame($official[$tag], $ours[$tag], "الوسم {$tag}");
        }
    }

    #[Test]
    public function it_encodes_all_nine_simplified_invoice_fields_from_real_synthetic_material(): void
    {
        [$der, $spki, $certificateSignature] = $this->synthetic();
        $digest = base64_encode(hash('sha256', 'invoice', true));
        $signature = base64_encode($der);

        $encoded = app(ZatcaPhaseTwoQrEncoder::class)->encode(
            'شركة نبراكس',
            '310000000000003',
            new DateTimeImmutable('2026-08-29 03:04:05+03:00'),
            '1150.00',
            '150.00',
            $digest,
            $signature,
            $spki,
            'simplified',
            $certificateSignature,
        );

        $this->assertSame([
            1 => 'شركة نبراكس',
            2 => '310000000000003',
            3 => '2026-08-29T00:04:05Z', // عقد الوسم 3 كما هو (لم يُغيَّر في REM-17).
            4 => '1150.00',
            5 => '150.00',
            6 => $digest,
            7 => $signature,
            8 => $spki,
            9 => $certificateSignature,
        ], $this->decode($encoded));
        $this->assertSame(88, strlen($spki));
        $this->assertLessThanOrEqual(700, strlen($encoded));
    }

    #[Test]
    public function it_omits_tag_nine_for_standard_invoices(): void
    {
        [$der, $spki] = $this->synthetic();

        $encoded = app(ZatcaPhaseTwoQrEncoder::class)->encode(
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-29T00:00:00Z'),
            '100.00',
            '15.00',
            base64_encode(str_repeat("\x01", 32)),
            base64_encode($der),
            $spki,
            'standard',
        );

        $this->assertSame(range(1, 8), array_keys($this->decode($encoded)));
    }

    #[Test]
    public function it_rejects_pre_rem17_raw_forms_and_malformed_cryptographic_fields(): void
    {
        [$der, $spki, $certificateSignature] = $this->synthetic();
        $valid = [
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-29T00:00:00Z'),
            '100.00',
            '15.00',
            base64_encode(str_repeat("\x01", 32)),
            base64_encode($der),
            $spki,
        ];
        $with = static fn (int $index, string $value): array => array_replace($valid, [$index => $value]);
        $encoder = app(ZatcaPhaseTwoQrEncoder::class);

        foreach ([
            'simplified without tag 9' => [...$valid, 'simplified'],
            'raw 32-byte hash (pre-REM-17)' => [...$with(5, str_repeat("\x01", 32)), 'standard'],
            'non-canonical hash text' => [...$with(5, ' '.base64_encode(str_repeat("\x01", 32))), 'standard'],
            'hash of the wrong length' => [...$with(5, base64_encode(str_repeat("\x01", 31))), 'standard'],
            'raw r||s signature (pre-REM-17)' => [...$with(6, str_repeat("\x02", 64)), 'standard'],
            'base64 of a non-DER signature' => [...$with(6, base64_encode(str_repeat("\x02", 64))), 'standard'],
            'raw SEC1 point (pre-REM-17)' => [...$with(7, "\x04".str_repeat("\x03", 64)), 'standard'],
            'PEM public key' => [...$with(7, "-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----"), 'standard'],
            'SPKI of another curve' => [...$with(7, $this->otherCurveSpki()), 'standard'],
            'tag 9 on a standard invoice' => [...$valid, 'standard', $certificateSignature],
        ] as $label => $arguments) {
            try {
                $encoder->encode(...$arguments);
                $this->fail("كان يجب رفض: {$label}");
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function oversized_values_are_rejected_never_truncated(): void
    {
        [$der, $spki, $certificateSignature] = $this->synthetic();
        $encoder = app(ZatcaPhaseTwoQrEncoder::class);
        $arguments = static fn (string $seller): array => [
            $seller, '310000000000003', new DateTimeImmutable('2026-08-29T00:00:00Z'), '100.00', '15.00',
            base64_encode(str_repeat("\x01", 32)), base64_encode($der), $spki, 'simplified', $certificateSignature,
        ];

        try {
            $encoder->encode(...$arguments(str_repeat('س', 128))); // 256 بايت > حد البايت الواحد
            $this->fail('كان يجب رفض اسم بائع يتجاوز 255 بايت.');
        } catch (InvalidArgumentException $exception) {
            $this->assertStringContainsString('255', $exception->getMessage());
        }

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('700');
        $encoder->encode(...$arguments(str_repeat('س', 120)));
    }

    /** @return array{0:string,1:string,2:string} توقيع DER، SPKI بترميز DER، توقيع الشهادة */
    private function synthetic(): array
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'secp256k1']);
        $this->assertNotFalse($key);
        $this->assertTrue(openssl_sign(hash('sha256', 'invoice', true), $der, $key, OPENSSL_ALGO_SHA256));
        $details = openssl_pkey_get_details($key);
        $spki = base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', (string) ($details['key'] ?? '')), true);
        $this->assertIsString($spki);

        $request = openssl_csr_new(['commonName' => 'QR Device'], $key, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($request);
        $certificate = openssl_csr_sign($request, null, $key, 1, ['digest_alg' => 'sha256']);
        $this->assertNotFalse($certificate);
        $this->assertTrue(openssl_x509_export($certificate, $pem));
        $certificateDer = (string) base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', $pem), true);
        $material = app(ZatcaQrCertificateMaterialExtractor::class)->extract(base64_encode($certificateDer));
        $this->assertSame($spki, $material['public_key'], 'SPKI من الشهادة = SPKI من OpenSSL');

        return [$der, $spki, $material['certificate_signature']];
    }

    private function otherCurveSpki(): string
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        $this->assertNotFalse($key);
        $details = openssl_pkey_get_details($key);

        return (string) base64_decode((string) preg_replace('/-----[^-]+-----|\s+/', '', (string) ($details['key'] ?? '')), true);
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
}

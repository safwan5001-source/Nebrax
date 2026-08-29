<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaPhaseTwoQrEncoder;
use DateTimeImmutable;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

class ZatcaPhaseTwoQrEncoderTest extends TestCase
{
    /** @test */
    public function it_encodes_all_nine_simplified_invoice_fields_as_binary_tlv(): void
    {
        $hash = hash('sha256', 'invoice', true);
        $signature = str_repeat("\x7a", 64);
        $publicKey = "\x04".str_repeat("\x2b", 64);
        $certificateSignature = str_repeat("\x5c", 71);

        $encoded = app(ZatcaPhaseTwoQrEncoder::class)->encode(
            'شركة نبراكس',
            '310000000000003',
            new DateTimeImmutable('2026-08-29 03:04:05+03:00'),
            '1150.00',
            '150.00',
            $hash,
            $signature,
            $publicKey,
            'simplified',
            $certificateSignature,
        );

        $this->assertSame([
            1 => 'شركة نبراكس',
            2 => '310000000000003',
            3 => '2026-08-29T00:04:05Z',
            4 => '1150.00',
            5 => '150.00',
            6 => $hash,
            7 => $signature,
            8 => $publicKey,
            9 => $certificateSignature,
        ], $this->decode($encoded));
        $this->assertLessThanOrEqual(700, strlen($encoded));
    }

    /** @test */
    public function it_omits_tag_nine_for_standard_invoices(): void
    {
        $encoded = app(ZatcaPhaseTwoQrEncoder::class)->encode(
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-29T00:00:00Z'),
            '100.00',
            '15.00',
            str_repeat("\x01", 32),
            str_repeat("\x02", 64),
            str_repeat("\x03", 65),
            'standard',
        );

        $this->assertSame(range(1, 8), array_keys($this->decode($encoded)));
    }

    /** @test */
    public function it_rejects_ambiguous_or_malformed_cryptographic_fields(): void
    {
        $valid = [
            'Nebrax',
            '310000000000003',
            new DateTimeImmutable('2026-08-29T00:00:00Z'),
            '100.00',
            '15.00',
            str_repeat("\x01", 32),
            str_repeat("\x02", 64),
            str_repeat("\x03", 65),
        ];
        $encoder = app(ZatcaPhaseTwoQrEncoder::class);

        foreach ([
            [...$valid, 'simplified'],
            [...array_slice($valid, 0, 5), str_repeat("\x01", 31), ...array_slice($valid, 6), 'standard'],
            [...array_slice($valid, 0, 6), str_repeat("\x02", 63), $valid[7], 'standard'],
            [...array_slice($valid, 0, 7), str_repeat("\x03", 256), 'standard'],
            [...array_slice($valid, 0, 7), "-----BEGIN PUBLIC KEY-----\nZmFrZQ==\n-----END PUBLIC KEY-----", 'standard'],
            [...$valid, 'standard', str_repeat("\x04", 70)],
        ] as $arguments) {
            try {
                $encoder->encode(...$arguments);
                $this->fail('كان يجب رفض حقول QR التشفيرية الغامضة أو غير الصالحة.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function it_rejects_a_combined_payload_over_the_official_base64_limit(): void
    {
        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('700');

        app(ZatcaPhaseTwoQrEncoder::class)->encode(
            str_repeat('س', 120),
            '310000000000003',
            new DateTimeImmutable('2026-08-29T00:00:00Z'),
            '100.00',
            '15.00',
            str_repeat("\x01", 32),
            str_repeat("\x02", 64),
            str_repeat("\x03", 255),
            'simplified',
            str_repeat("\x04", 255),
        );
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

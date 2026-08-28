<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaXmlEcdsaSigner;
use InvalidArgumentException;
use RuntimeException;
use Tests\TestCase;

class ZatcaXmlEcdsaSignerTest extends TestCase
{
    /** @test */
    public function it_creates_the_xml_dsig_raw_signature_and_verifies_it(): void
    {
        [$privateKey, $publicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);
        $signedInfo = '<ds:SignedInfo>canonical-zatca-value</ds:SignedInfo>';

        $signatureValue = $signer->sign($signedInfo, $privateKey);
        $raw = base64_decode($signatureValue, true);

        $this->assertIsString($raw);
        $this->assertSame(64, strlen($raw));
        $this->assertSame(88, strlen($signatureValue));
        $this->assertTrue($signer->verify($signedInfo, $signatureValue, $publicKey));
        $this->assertFalse($signer->verify($signedInfo.'-tampered', $signatureValue, $publicKey));
    }

    /** @test */
    public function der_and_raw_encodings_round_trip_when_both_integers_need_different_padding(): void
    {
        $signer = app(ZatcaXmlEcdsaSigner::class);
        $raw = "\x80".str_repeat("\x11", 31)."\x7f".str_repeat("\x22", 31);

        $der = $signer->rawToDer($raw);

        $this->assertSame("\x30", $der[0]);
        $this->assertSame($raw, $signer->derToRaw($der));
    }

    /**
     * @test
     * @dataProvider malformedDerProvider
     */
    public function malformed_or_non_canonical_der_is_rejected(string $der): void
    {
        $this->expectException(InvalidArgumentException::class);

        app(ZatcaXmlEcdsaSigner::class)->derToRaw($der);
    }

    public static function malformedDerProvider(): array
    {
        return [
            'trailing bytes' => ["\x30\x06\x02\x01\x01\x02\x01\x01\x00"],
            'negative integer' => ["\x30\x06\x02\x01\x80\x02\x01\x01"],
            'redundant leading zero' => ["\x30\x07\x02\x02\x00\x01\x02\x01\x01"],
            'zero component' => ["\x30\x06\x02\x01\x00\x02\x01\x01"],
            'indefinite length' => ["\x30\x80\x02\x01\x01\x02\x01\x01\x00\x00"],
        ];
    }

    /** @test */
    public function invalid_base64_and_wrong_raw_length_are_rejected_before_openssl(): void
    {
        [, $publicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);

        foreach (['not-base64!', base64_encode(str_repeat('x', 63))] as $invalid) {
            try {
                $signer->verify('payload', $invalid, $publicKey);
                $this->fail('كان يجب رفض SignatureValue غير الصالح.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function a_different_ec_curve_is_rejected(): void
    {
        [$privateKey] = $this->keyPair('prime256v1');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('secp256k1');

        app(ZatcaXmlEcdsaSigner::class)->sign('payload', $privateKey);
    }

    private function keyPair(string $curveName): array
    {
        $key = openssl_pkey_new([
            'private_key_type' => OPENSSL_KEYTYPE_EC,
            'curve_name' => $curveName,
        ]);

        $this->assertNotFalse($key);

        $privateKey = '';
        $this->assertTrue(openssl_pkey_export($key, $privateKey));

        $details = openssl_pkey_get_details($key);
        $this->assertIsArray($details);
        $this->assertIsString($details['key'] ?? null);

        return [$privateKey, $details['key']];
    }
}

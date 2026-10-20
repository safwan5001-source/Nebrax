<?php

namespace Tests\Feature;

use App\Services\Accounting\ZatcaXmlEcdsaSigner;
use InvalidArgumentException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * REM-17: SignatureValue = ECDSA بترميز DER على بايتات هاش الفاتورة الخام (الدليل الفني، الخطوة 2).
 * كل تحقق «مستقل» هنا يمرّ عبر openssl_verify مباشرةً بالمفتاح العام، لا عبر الصنف المختبَر.
 */
class ZatcaXmlEcdsaSignerTest extends TestCase
{
    #[Test]
    public function it_signs_the_raw_32_byte_invoice_hash_with_a_der_signature_that_verifies_independently(): void
    {
        [$privateKey, $publicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);
        $invoiceHash = hash('sha256', '<Invoice>synthetic</Invoice>', true);

        $signatureValue = $signer->sign($invoiceHash, $privateKey);
        $der = base64_decode($signatureValue, true);

        $this->assertIsString($der);
        $this->assertSame("\x30", $der[0], 'ASN.1 SEQUENCE');
        $this->assertSame(strlen($der) - 2, ord($der[1]), 'طول DER قصير يغطي التسلسل كاملاً');
        $this->assertSame(base64_encode($der), $signatureValue);

        // تحقق مستقل: الرسالة الموقَّعة هي الـ32 بايت الخام، لا نصّها الست عشري ولا Base64.
        $this->assertSame(1, openssl_verify($invoiceHash, $der, $publicKey, OPENSSL_ALGO_SHA256));
        $this->assertSame(0, openssl_verify(bin2hex($invoiceHash), $der, $publicKey, OPENSSL_ALGO_SHA256));
        $this->assertSame(0, openssl_verify(base64_encode($invoiceHash), $der, $publicKey, OPENSSL_ALGO_SHA256));

        $this->assertTrue($signer->verify($invoiceHash, $signatureValue, $publicKey));
        $tampered = $invoiceHash;
        $tampered[0] = chr(ord($tampered[0]) ^ 0x01);
        $this->assertFalse($signer->verify($tampered, $signatureValue, $publicKey));
    }

    #[Test]
    public function a_signature_from_another_key_does_not_verify(): void
    {
        [$privateKey] = $this->keyPair('secp256k1');
        [, $otherPublicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);
        $invoiceHash = hash('sha256', 'x', true);

        $this->assertFalse($signer->verify($invoiceHash, $signer->sign($invoiceHash, $privateKey), $otherPublicKey));
    }

    #[Test]
    public function only_a_raw_32_byte_hash_is_accepted_as_the_signed_message(): void
    {
        [$privateKey, $publicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);

        foreach ([bin2hex(hash('sha256', 'x', true)), base64_encode(hash('sha256', 'x', true)), '<ds:SignedInfo/>'] as $message) {
            try {
                $signer->sign($message, $privateKey);
                $this->fail('كان يجب رفض رسالة ليست هاشاً خاماً بطول 32 بايت.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->expectException(InvalidArgumentException::class);
        $signer->verify(str_repeat('x', 31), base64_encode("\x30\x06\x02\x01\x01\x02\x01\x01"), $publicKey);
    }

    #[Test]
    #[DataProvider('malformedDerProvider')]
    public function malformed_or_non_canonical_der_is_rejected(string $der): void
    {
        $this->expectException(InvalidArgumentException::class);

        app(ZatcaXmlEcdsaSigner::class)->assertCanonicalDer($der);
    }

    public static function malformedDerProvider(): array
    {
        return [
            'trailing bytes' => ["\x30\x06\x02\x01\x01\x02\x01\x01\x00"],
            'negative integer' => ["\x30\x06\x02\x01\x80\x02\x01\x01"],
            'redundant leading zero' => ["\x30\x07\x02\x02\x00\x01\x02\x01\x01"],
            'zero component' => ["\x30\x06\x02\x01\x00\x02\x01\x01"],
            'indefinite length' => ["\x30\x80\x02\x01\x01\x02\x01\x01\x00\x00"],
            'pre-REM-17 raw r||s' => [str_repeat("\x11", 64)],
        ];
    }

    #[Test]
    public function non_canonical_base64_and_raw_signatures_are_rejected_before_openssl(): void
    {
        [, $publicKey] = $this->keyPair('secp256k1');
        $signer = app(ZatcaXmlEcdsaSigner::class);
        $hash = hash('sha256', 'payload', true);

        foreach (['not-base64!', base64_encode(str_repeat("\x11", 64)), " MEUCIQ"] as $invalid) {
            try {
                $signer->verify($hash, $invalid, $publicKey);
                $this->fail('كان يجب رفض SignatureValue غير الصالح.');
            } catch (InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function a_different_ec_curve_is_rejected(): void
    {
        [$privateKey] = $this->keyPair('prime256v1');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('secp256k1');

        app(ZatcaXmlEcdsaSigner::class)->sign(hash('sha256', 'payload', true), $privateKey);
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

<?php

namespace App\Services\Accounting;

use InvalidArgumentException;
use RuntimeException;

/**
 * توقيع ECDSA لفاتورة ZATCA — REM-17.
 *
 * الدليل الرسمي (E-invoicing Detailed Technical Guidelines، الخطوة 2): «وقّع هاش الفاتورة الناتج من الخطوة 1
 * (غير مُرمَّز) بـ ECDSA والمفتاح الخاص». أي أن الرسالة الموقَّعة هي **بايتات SHA-256 الخام (32 بايت) لهاش الفاتورة**،
 * لا SignedInfo المعياري كما في XMLDSig العام. وناتج التوقيع **ASN.1 DER** (مثال الدليل `MEQCIG…` = 0x30 0x44)
 * يوضع في SignatureValue بترميز Base64.
 *
 * تحقّق مستقل (REM-17 Phase A): `openssl dgst -sha256 -verify` على عيّنة ZATCA الرسمية ينجح على الـ32 بايت الخام
 * ويفشل على نص الهاش الست عشري وعلى نصّ Base64.
 */
final class ZatcaXmlEcdsaSigner
{
    private const COMPONENT_LENGTH = 32;
    private const INVOICE_HASH_LENGTH = 32;

    /**
     * يوقّع بايتات هاش الفاتورة الخام ويعيد SignatureValue بصيغة Base64 لتوقيع DER.
     */
    public function sign(string $invoiceHash, string $privateKeyPem): string
    {
        $this->assertInvoiceHash($invoiceHash);

        $privateKey = openssl_pkey_get_private($privateKeyPem);
        if ($privateKey === false) {
            throw new RuntimeException('مفتاح ZATCA الخاص غير صالح للتوقيع.');
        }

        $this->assertSecp256k1($privateKey);

        if (! openssl_sign($invoiceHash, $derSignature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('تعذر إنشاء توقيع ECDSA الخاص بـ ZATCA.');
        }

        $this->assertCanonicalDer($derSignature);

        return base64_encode($derSignature);
    }

    /**
     * يتحقق من SignatureValue (Base64 لتوقيع DER قانوني) على بايتات هاش الفاتورة الخام.
     */
    public function verify(string $invoiceHash, string $signatureValue, string $publicKeyPem): bool
    {
        $this->assertInvoiceHash($invoiceHash);

        $derSignature = base64_decode($signatureValue, true);
        if ($derSignature === false || base64_encode($derSignature) !== $signatureValue) {
            throw new InvalidArgumentException('قيمة توقيع ZATCA ليست Base64 قياسياً.');
        }
        $this->assertCanonicalDer($derSignature);

        $publicKey = openssl_pkey_get_public($publicKeyPem);
        if ($publicKey === false) {
            throw new RuntimeException('مفتاح ZATCA العام غير صالح للتحقق.');
        }

        $this->assertSecp256k1($publicKey);

        $result = openssl_verify($invoiceHash, $derSignature, $publicKey, OPENSSL_ALGO_SHA256);

        if ($result === -1) {
            throw new RuntimeException('تعذر التحقق من توقيع ECDSA الخاص بـ ZATCA.');
        }

        return $result === 1;
    }

    /**
     * يرفض أي ترميز ليس DER قانونياً لتوقيع ECDSA على secp256k1: SEQUENCE من عددين موجبين بأقصر ترميز، بلا بيانات زائدة.
     */
    public function assertCanonicalDer(string $derSignature): void
    {
        $offset = 0;
        $this->expectTag($derSignature, $offset, 0x30, 'تسلسل ECDSA');
        $sequenceLength = $this->readLength($derSignature, $offset);
        $sequenceEnd = $offset + $sequenceLength;

        if ($sequenceEnd !== strlen($derSignature)) {
            throw new InvalidArgumentException('ترميز DER لتوقيع ECDSA يحتوي بيانات زائدة أو طولاً خاطئاً.');
        }

        $this->readInteger($derSignature, $offset, $sequenceEnd);
        $this->readInteger($derSignature, $offset, $sequenceEnd);

        if ($offset !== $sequenceEnd) {
            throw new InvalidArgumentException('ترميز DER لتوقيع ECDSA يحتوي عناصر غير متوقعة.');
        }
    }

    private function assertInvoiceHash(string $invoiceHash): void
    {
        if (strlen($invoiceHash) !== self::INVOICE_HASH_LENGTH) {
            throw new InvalidArgumentException('توقيع ZATCA يُحسب على هاش الفاتورة الخام بطول 32 بايت.');
        }
    }

    /**
     * @param \OpenSSLAsymmetricKey $key
     */
    private function assertSecp256k1($key): void
    {
        $details = openssl_pkey_get_details($key);
        $curveName = is_array($details) ? ($details['ec']['curve_name'] ?? null) : null;

        if (($details['type'] ?? null) !== OPENSSL_KEYTYPE_EC || $curveName !== 'secp256k1') {
            throw new RuntimeException('توقيع ZATCA يتطلب مفتاح EC على منحنى secp256k1.');
        }
    }

    private function readInteger(string $der, int &$offset, int $limit): void
    {
        $this->expectTag($der, $offset, 0x02, 'عدد ECDSA');
        $length = $this->readLength($der, $offset);

        if ($length < 1 || $offset + $length > $limit) {
            throw new InvalidArgumentException('طول عدد ECDSA في DER غير صالح.');
        }

        $integer = substr($der, $offset, $length);
        $offset += $length;

        if ((ord($integer[0]) & 0x80) !== 0) {
            throw new InvalidArgumentException('عدد ECDSA السالب غير مسموح.');
        }

        if ($length > 1 && $integer[0] === "\x00") {
            if ((ord($integer[1]) & 0x80) === 0) {
                throw new InvalidArgumentException('عدد ECDSA يستخدم صفراً بادئاً غير قياسي.');
            }

            $integer = substr($integer, 1);
        }

        if (strlen($integer) > self::COMPONENT_LENGTH || trim($integer, "\x00") === '') {
            throw new InvalidArgumentException('عدد ECDSA خارج نطاق المنحنى.');
        }
    }

    private function expectTag(string $der, int &$offset, int $expected, string $label): void
    {
        if ($offset >= strlen($der) || ord($der[$offset]) !== $expected) {
            throw new InvalidArgumentException("ترميز DER يفتقد {$label}.");
        }

        $offset++;
    }

    private function readLength(string $der, int &$offset): int
    {
        if ($offset >= strlen($der)) {
            throw new InvalidArgumentException('طول DER مفقود.');
        }

        $first = ord($der[$offset++]);
        if ($first < 0x80) {
            return $first;
        }

        $octets = $first & 0x7f;
        if ($octets < 1 || $octets > 2 || $offset + $octets > strlen($der)) {
            throw new InvalidArgumentException('صيغة طول DER غير مدعومة.');
        }

        if ($der[$offset] === "\x00") {
            throw new InvalidArgumentException('طول DER غير قياسي.');
        }

        $length = 0;
        for ($i = 0; $i < $octets; $i++) {
            $length = ($length << 8) | ord($der[$offset++]);
        }

        if ($length < 0x80) {
            throw new InvalidArgumentException('طول DER يستخدم الصيغة الطويلة دون حاجة.');
        }

        return $length;
    }
}

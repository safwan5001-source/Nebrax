<?php

namespace App\Services\Accounting;

use InvalidArgumentException;
use RuntimeException;

/**
 * يحوّل توقيع ECDSA بين DER الذي يعيده OpenSSL وصيغة XMLDSig الخام r || s.
 *
 * معيار XMLDSig يفرض مكوّنين ثابتين بطول 32 بايت لمنحنى secp256k1،
 * بينما OpenSSL يوقّع ويَتحقق باستخدام ASN.1 DER داخلياً.
 */
final class ZatcaXmlEcdsaSigner
{
    private const COMPONENT_LENGTH = 32;
    private const RAW_SIGNATURE_LENGTH = self::COMPONENT_LENGTH * 2;

    /**
     * يوقّع SignedInfo المعياري ويعيد SignatureValue بصيغة Base64 لـ r || s.
     */
    public function sign(string $canonicalSignedInfo, string $privateKeyPem): string
    {
        $privateKey = openssl_pkey_get_private($privateKeyPem);
        if ($privateKey === false) {
            throw new RuntimeException('مفتاح ZATCA الخاص غير صالح للتوقيع.');
        }

        $this->assertSecp256k1($privateKey);

        if (! openssl_sign($canonicalSignedInfo, $derSignature, $privateKey, OPENSSL_ALGO_SHA256)) {
            throw new RuntimeException('تعذر إنشاء توقيع ECDSA الخاص بـ ZATCA.');
        }

        return base64_encode($this->derToRaw($derSignature));
    }

    /**
     * يتحقق من SignatureValue مع رفض Base64 أو الأطوال غير المطابقة قبل OpenSSL.
     */
    public function verify(string $canonicalSignedInfo, string $signatureValue, string $publicKeyPem): bool
    {
        $rawSignature = base64_decode($signatureValue, true);
        if ($rawSignature === false || strlen($rawSignature) !== self::RAW_SIGNATURE_LENGTH) {
            throw new InvalidArgumentException('قيمة توقيع ZATCA ليست Base64 صالحاً بطول 64 بايت.');
        }

        $publicKey = openssl_pkey_get_public($publicKeyPem);
        if ($publicKey === false) {
            throw new RuntimeException('مفتاح ZATCA العام غير صالح للتحقق.');
        }

        $this->assertSecp256k1($publicKey);

        $result = openssl_verify(
            $canonicalSignedInfo,
            $this->rawToDer($rawSignature),
            $publicKey,
            OPENSSL_ALGO_SHA256
        );

        if ($result === -1) {
            throw new RuntimeException('تعذر التحقق من توقيع ECDSA الخاص بـ ZATCA.');
        }

        return $result === 1;
    }

    /**
     * @internal متاح علناً لاختبار حدّ التوافق بين OpenSSL وXMLDSig.
     */
    public function derToRaw(string $derSignature): string
    {
        $offset = 0;
        $this->expectTag($derSignature, $offset, 0x30, 'تسلسل ECDSA');
        $sequenceLength = $this->readLength($derSignature, $offset);
        $sequenceEnd = $offset + $sequenceLength;

        if ($sequenceEnd !== strlen($derSignature)) {
            throw new InvalidArgumentException('ترميز DER لتوقيع ECDSA يحتوي بيانات زائدة أو طولاً خاطئاً.');
        }

        $r = $this->readInteger($derSignature, $offset, $sequenceEnd);
        $s = $this->readInteger($derSignature, $offset, $sequenceEnd);

        if ($offset !== $sequenceEnd) {
            throw new InvalidArgumentException('ترميز DER لتوقيع ECDSA يحتوي عناصر غير متوقعة.');
        }

        return $r.$s;
    }

    /**
     * @internal متاح علناً لاختبار حدّ التوافق بين XMLDSig وOpenSSL.
     */
    public function rawToDer(string $rawSignature): string
    {
        if (strlen($rawSignature) !== self::RAW_SIGNATURE_LENGTH) {
            throw new InvalidArgumentException('توقيع ECDSA الخام يجب أن يكون بطول 64 بايت.');
        }

        $r = $this->encodeInteger(substr($rawSignature, 0, self::COMPONENT_LENGTH));
        $s = $this->encodeInteger(substr($rawSignature, self::COMPONENT_LENGTH));
        $sequence = $r.$s;

        return "\x30".$this->encodeLength(strlen($sequence)).$sequence;
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

    private function readInteger(string $der, int &$offset, int $limit): string
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

        return str_pad($integer, self::COMPONENT_LENGTH, "\x00", STR_PAD_LEFT);
    }

    private function encodeInteger(string $component): string
    {
        if (trim($component, "\x00") === '') {
            throw new InvalidArgumentException('مكوّن ECDSA الصفري غير صالح.');
        }

        $integer = ltrim($component, "\x00");
        if ((ord($integer[0]) & 0x80) !== 0) {
            $integer = "\x00".$integer;
        }

        return "\x02".$this->encodeLength(strlen($integer)).$integer;
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

    private function encodeLength(int $length): string
    {
        if ($length < 0x80) {
            return chr($length);
        }

        $encoded = '';
        while ($length > 0) {
            $encoded = chr($length & 0xff).$encoded;
            $length >>= 8;
        }

        return chr(0x80 | strlen($encoded)).$encoded;
    }
}

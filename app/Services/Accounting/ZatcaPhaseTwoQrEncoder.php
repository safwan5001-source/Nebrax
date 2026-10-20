<?php

namespace App\Services\Accounting;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use InvalidArgumentException;
use RuntimeException;

/**
 * يبني حمولة QR للمرحلة الثانية — ترميزات الوسوم 6–9 متحقَّقة في REM-17 (الدليل الفني التفصيلي §6.2 ومثاله المفكوك،
 * وعيّنات SDK الرسمية):
 *  • 6: نصّ Base64 لهاش الفاتورة (DigestValue) — 44 بايت.
 *  • 7: نصّ Base64 لتوقيع ECDSA بترميز DER (SignatureValue) — نصّ `MEUC…`.
 *  • 8: بنية SubjectPublicKeyInfo بترميز DER (secp256k1؛ 88 بايت للمفتاح غير المضغوط).
 *  • 9 (المبسّطة وإشعاراتها فقط): توقيع CA على الشهادة بترميز DER — بلا تغيير.
 * صيغة الوسم 3 **لم تتغيّر** في REM-17 (Q1 غير محسومة).
 */
final class ZatcaPhaseTwoQrEncoder
{
    private const MAX_VALUE_BYTES = 255;
    private const MAX_BASE64_LENGTH = 700;

    /** رأس SPKI لمفتاح EC على secp256k1: غير مضغوط (65 بايت للنقطة) ومضغوط (33). */
    private const SPKI_UNCOMPRESSED_PREFIX = "\x30\x56\x30\x10\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01\x06\x05\x2B\x81\x04\x00\x0A\x03\x42\x00\x04";
    private const SPKI_COMPRESSED_PREFIX = "\x30\x36\x30\x10\x06\x07\x2A\x86\x48\xCE\x3D\x02\x01\x06\x05\x2B\x81\x04\x00\x0A\x03\x22\x00";

    public function encode(
        string $sellerName,
        string $vatNumber,
        DateTimeInterface $invoiceTime,
        string $invoiceTotal,
        string $vatTotal,
        string $invoiceDigest,
        string $signatureValue,
        string $publicKey,
        string $documentType,
        ?string $certificateSignature = null,
    ): string {
        if (! in_array($documentType, ['standard', 'simplified'], true)) {
            throw new InvalidArgumentException('نوع مستند ZATCA غير صالح لبناء QR.');
        }
        if (preg_match('/^3\d{13}3$/D', $vatNumber) !== 1) {
            throw new InvalidArgumentException('الرقم الضريبي للبائع يجب أن يكون 15 رقماً ويبدأ وينتهي بالرقم 3.');
        }
        foreach ([$invoiceTotal, $vatTotal] as $amount) {
            if (preg_match('/^\d+\.\d{2}$/D', $amount) !== 1) {
                throw new InvalidArgumentException('مبالغ QR يجب أن تكون أعداداً عشرية بمنزلتين.');
            }
        }
        $hash = base64_decode($invoiceDigest, true);
        if (! is_string($hash) || strlen($hash) !== 32 || base64_encode($hash) !== $invoiceDigest) {
            throw new InvalidArgumentException('وسم QR 6 يجب أن يكون نصّ Base64 قياسياً لهاش SHA-256 (44 محرفاً).');
        }
        $signature = base64_decode($signatureValue, true);
        if (! is_string($signature) || base64_encode($signature) !== $signatureValue
            || strlen($signature) < 8 || strlen($signature) > 72 || $signature[0] !== "\x30"
        ) {
            throw new InvalidArgumentException('وسم QR 7 يجب أن يكون نصّ Base64 لتوقيع ECDSA بترميز DER.');
        }
        $uncompressed = strlen($publicKey) === 88 && str_starts_with($publicKey, self::SPKI_UNCOMPRESSED_PREFIX);
        $compressed = strlen($publicKey) === 56 && str_starts_with($publicKey, self::SPKI_COMPRESSED_PREFIX)
            && ($publicKey[23] === "\x02" || $publicKey[23] === "\x03");
        if (! $uncompressed && ! $compressed) {
            throw new InvalidArgumentException('وسم QR 8 يجب أن يكون SubjectPublicKeyInfo بترميز DER لمفتاح secp256k1.');
        }
        if ($documentType === 'simplified' && ($certificateSignature === null || $certificateSignature === '')) {
            throw new InvalidArgumentException('توقيع شهادة الختم مطلوب لـQR الفاتورة المبسطة.');
        }
        if ($documentType === 'standard' && $certificateSignature !== null) {
            throw new InvalidArgumentException('وسم توقيع شهادة الختم يخص الفاتورة المبسطة فقط.');
        }

        $timestamp = DateTimeImmutable::createFromInterface($invoiceTime)
            ->setTimezone(new DateTimeZone('UTC'))
            ->format('Y-m-d\TH:i:s\Z');
        $values = [
            1 => $this->utf8($sellerName, 'اسم البائع'),
            2 => $vatNumber,
            3 => $timestamp,
            4 => $invoiceTotal,
            5 => $vatTotal,
            6 => $invoiceDigest,
            7 => $signatureValue,
            8 => $publicKey,
        ];
        if ($documentType === 'simplified') {
            $values[9] = $certificateSignature;
        }

        $payload = '';
        foreach ($values as $tag => $value) {
            $payload .= $this->tlv($tag, $value);
        }

        $encoded = base64_encode($payload);
        if (strlen($encoded) > self::MAX_BASE64_LENGTH) {
            throw new RuntimeException('حمولة QR للمرحلة الثانية تتجاوز 700 حرف Base64.');
        }

        return $encoded;
    }

    private function utf8(string $value, string $label): string
    {
        if ($value === '' || preg_match('//u', $value) !== 1) {
            throw new InvalidArgumentException("{$label} مفقود أو ليس UTF-8 صالحاً.");
        }

        return $value;
    }

    private function tlv(int $tag, string $value): string
    {
        $length = strlen($value);
        if ($length < 1 || $length > self::MAX_VALUE_BYTES) {
            throw new InvalidArgumentException("قيمة وسم QR رقم {$tag} يجب أن تكون بين 1 و255 بايت.");
        }

        return chr($tag).chr($length).$value;
    }
}

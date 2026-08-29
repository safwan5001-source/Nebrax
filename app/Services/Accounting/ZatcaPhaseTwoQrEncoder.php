<?php

namespace App\Services\Accounting;

use DateTimeImmutable;
use DateTimeInterface;
use DateTimeZone;
use InvalidArgumentException;
use RuntimeException;

/** يبني حمولة QR للمرحلة الثانية من قيم نصية وبايتات تشفير صريحة. */
final class ZatcaPhaseTwoQrEncoder
{
    private const MAX_VALUE_BYTES = 255;
    private const MAX_BASE64_LENGTH = 700;

    public function encode(
        string $sellerName,
        string $vatNumber,
        DateTimeInterface $invoiceTime,
        string $invoiceTotal,
        string $vatTotal,
        string $invoiceHash,
        string $ecdsaSignature,
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
        if (strlen($invoiceHash) !== 32) {
            throw new InvalidArgumentException('هاش فاتورة ZATCA في QR يجب أن يكون 32 بايت خاماً.');
        }
        if (strlen($ecdsaSignature) !== 64) {
            throw new InvalidArgumentException('توقيع ECDSA في QR يجب أن يكون 64 بايت خاماً.');
        }
        if ($publicKey === '' || str_contains($publicKey, '-----BEGIN') || str_contains($publicKey, 'PUBLIC KEY')) {
            throw new InvalidArgumentException('المفتاح العام في QR يجب أن يكون بايتات خاماً لا نص PEM.');
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
            6 => $invoiceHash,
            7 => $ecdsaSignature,
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

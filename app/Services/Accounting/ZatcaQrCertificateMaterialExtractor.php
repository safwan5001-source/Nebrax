<?php

namespace App\Services\Accounting;

use InvalidArgumentException;

/** يستخرج من شهادة CSID البايتات اللازمة لوسمي QR رقم 8 و9 فقط. */
final class ZatcaQrCertificateMaterialExtractor
{
    private const EC_COMPONENT_BYTES = 32;

    /** @return array{public_key:string, certificate_signature:string} */
    public function extract(string $certificateBase64Der): array
    {
        $der = base64_decode($certificateBase64Der, true);
        if (! is_string($der) || $der === '') {
            throw new InvalidArgumentException('شهادة CSID يجب أن تكون DER بترميز Base64 صالح.');
        }

        $pem = "-----BEGIN CERTIFICATE-----\n"
            .chunk_split(base64_encode($der), 64, "\n")
            ."-----END CERTIFICATE-----\n";
        $certificate = @openssl_x509_read($pem);
        $key = $certificate === false ? false : openssl_pkey_get_public($certificate);
        $details = $key === false ? false : openssl_pkey_get_details($key);
        $certificateDetails = $certificate === false ? false : openssl_x509_parse($certificate, false);
        $x = is_array($details) ? ($details['ec']['x'] ?? null) : null;
        $y = is_array($details) ? ($details['ec']['y'] ?? null) : null;
        if (($details['type'] ?? null) !== OPENSSL_KEYTYPE_EC
            || ($details['ec']['curve_name'] ?? null) !== 'secp256k1'
            || ! is_string($x) || strlen($x) !== self::EC_COMPONENT_BYTES
            || ! is_string($y) || strlen($y) !== self::EC_COMPONENT_BYTES
        ) {
            throw new InvalidArgumentException('شهادة CSID لا تحتوي مفتاح secp256k1 عاماً صالحاً.');
        }
        if (! is_array($certificateDetails)
            || ($certificateDetails['signatureTypeSN'] ?? null) !== 'ecdsa-with-SHA256'
        ) {
            throw new InvalidArgumentException('شهادة CSID لا تستخدم توقيع ECDSA-SHA256 المطلوب.');
        }

        return [
            // تمثيل SEC1 غير المضغوط: 0x04 ثم X ثم Y.
            'public_key' => "\x04".$x.$y,
            // X.509 يخزن توقيع CA بصيغة DER داخل BIT STRING بلا بايت unused-bits.
            'certificate_signature' => $this->certificateSignature($der),
        ];
    }

    private function certificateSignature(string $der): string
    {
        $offset = 0;
        $outer = $this->readElement($der, $offset, strlen($der));
        if ($outer['tag'] !== 0x30 || $offset !== strlen($der)) {
            throw new InvalidArgumentException('بنية DER الخارجية لشهادة CSID غير صالحة.');
        }

        $inner = $outer['content_start'];
        $this->expectElement($der, $inner, $outer['content_end'], 0x30, 'TBSCertificate');
        $this->expectElement($der, $inner, $outer['content_end'], 0x30, 'signatureAlgorithm');
        $signature = $this->expectElement($der, $inner, $outer['content_end'], 0x03, 'signatureValue');
        if ($inner !== $outer['content_end']) {
            throw new InvalidArgumentException('شهادة CSID تحتوي عناصر DER خارج بنية X.509 المتوقعة.');
        }

        $value = substr($der, $signature['content_start'], $signature['content_end'] - $signature['content_start']);
        if ($value === '' || $value[0] !== "\x00") {
            throw new InvalidArgumentException('BIT STRING لتوقيع شهادة CSID يستخدم unused bits غير مدعومة.');
        }

        $signatureDer = substr($value, 1);
        if ($signatureDer === '' || strlen($signatureDer) > 255 || ord($signatureDer[0]) !== 0x30) {
            throw new InvalidArgumentException('توقيع شهادة CSID ليس ECDSA DER صالحاً لوسم QR.');
        }

        return $signatureDer;
    }

    /** @return array{tag:int,content_start:int,content_end:int} */
    private function expectElement(string $der, int &$offset, int $limit, int $tag, string $label): array
    {
        $element = $this->readElement($der, $offset, $limit);
        if ($element['tag'] !== $tag) {
            throw new InvalidArgumentException("شهادة CSID تفتقد عنصر {$label} المتوقع.");
        }

        return $element;
    }

    /** @return array{tag:int,content_start:int,content_end:int} */
    private function readElement(string $der, int &$offset, int $limit): array
    {
        if ($offset >= $limit || $limit > strlen($der)) {
            throw new InvalidArgumentException('عنصر DER في شهادة CSID خارج الحدود.');
        }

        $tag = ord($der[$offset++]);
        $length = $this->readLength($der, $offset, $limit);
        if ($length > $limit - $offset) {
            throw new InvalidArgumentException('طول عنصر DER في شهادة CSID يتجاوز حدوده.');
        }

        $start = $offset;
        $offset += $length;

        return ['tag' => $tag, 'content_start' => $start, 'content_end' => $offset];
    }

    private function readLength(string $der, int &$offset, int $limit): int
    {
        if ($offset >= $limit) {
            throw new InvalidArgumentException('طول DER في شهادة CSID مفقود.');
        }

        $first = ord($der[$offset++]);
        if ($first < 0x80) {
            return $first;
        }

        $octets = $first & 0x7f;
        if ($octets < 1 || $octets > 4 || $octets > $limit - $offset || $der[$offset] === "\x00") {
            throw new InvalidArgumentException('صيغة طول DER في شهادة CSID غير قياسية.');
        }

        $length = 0;
        for ($index = 0; $index < $octets; $index++) {
            $length = ($length << 8) | ord($der[$offset++]);
        }
        if ($length < 0x80) {
            throw new InvalidArgumentException('طول DER في شهادة CSID يستخدم الصيغة الطويلة دون حاجة.');
        }

        return $length;
    }
}

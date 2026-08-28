<?php

namespace App\Services\Accounting;

use OpenSSLCertificate;
use OpenSSLAsymmetricKey;
use Illuminate\Validation\ValidationException;

/**
 * يتحقق من أن CSID شهادة X.509 حقيقية مرتبطة بمفتاح EC ذي 256 بت.
 *
 * يقبل Binary Security Token بصيغة PEM أو Base64 لـ DER/PEM، ويعيد فقط
 * بيانات مشتقة آمنة يحتاجها التوقيع وQR لاحقاً.
 */
final class ZatcaCredentialMaterialValidator
{
    /**
     * @return array{public_key:string, curve_name:string, fingerprint:string, valid_from:int, expires_at:int}
     */
    public function validate(string $environment, string $binarySecurityToken, string $privateKey): array
    {
        $certificate = $this->readCertificate($binarySecurityToken);
        $signingKey = $this->readPrivateKey($privateKey);

        $privateDetails = openssl_pkey_get_details($signingKey);
        if (! is_array($privateDetails)
            || ($privateDetails['type'] ?? null) !== OPENSSL_KEYTYPE_EC
            || ($privateDetails['bits'] ?? null) !== 256
            || ($privateDetails['ec']['curve_name'] ?? null) !== 'secp256k1'
        ) {
            $this->invalid('private_key', 'يجب أن يكون مفتاح ZATCA الخاص من نوع EC على منحنى secp256k1.');
        }

        $certificateKey = openssl_pkey_get_public($certificate);
        $certificateDetails = $certificateKey === false
            ? false
            : openssl_pkey_get_details($certificateKey);
        if (! is_array($certificateDetails)
            || ($certificateDetails['type'] ?? null) !== OPENSSL_KEYTYPE_EC
            || ($certificateDetails['bits'] ?? null) !== 256
            || ($certificateDetails['ec']['curve_name'] ?? null) !== 'secp256k1'
        ) {
            $this->invalid('binary_security_token', 'يجب أن تحتوي شهادة CSID على مفتاح EC عام على منحنى secp256k1.');
        }

        $privatePublicKey = $this->pemBody((string) ($privateDetails['key'] ?? ''));
        $certificatePublicKey = $this->pemBody((string) ($certificateDetails['key'] ?? ''));
        if ($privatePublicKey === ''
            || $certificatePublicKey === ''
            || ! hash_equals($certificatePublicKey, $privatePublicKey)
        ) {
            $this->invalid('private_key', 'مفتاح ZATCA الخاص لا يطابق المفتاح العام في شهادة CSID.');
        }

        $trustAnchor = config("zatca.trust_anchors.{$environment}");
        if (! is_string($trustAnchor) || $trustAnchor === '' || ! is_readable($trustAnchor)) {
            $this->invalid(
                'binary_security_token',
                "حزمة ثقة ZATCA لبيئة {$environment} غير مهيأة أو غير قابلة للقراءة."
            );
        }

        $trusted = @openssl_x509_checkpurpose(
            $certificate,
            X509_PURPOSE_ANY,
            [$trustAnchor]
        );
        if ($trusted !== true && $trusted !== 1) {
            $this->invalid(
                'binary_security_token',
                "شهادة CSID لا تتسلسل إلى مرجع ثقة ZATCA المهيأ لبيئة {$environment}."
            );
        }

        $certificateData = openssl_x509_parse($certificate, false);
        $extensions = is_array($certificateData)
            && is_array($certificateData['extensions'] ?? null)
                ? $certificateData['extensions']
                : [];
        $basicConstraints = strtolower((string) ($extensions['basicConstraints'] ?? ''));
        if (str_contains(str_replace(' ', '', $basicConstraints), 'ca:true')) {
            $this->invalid(
                'binary_security_token',
                'يجب أن تكون شهادة CSID شهادة نهائية وليست شهادة سلطة تصديق CA.'
            );
        }

        $keyUsage = strtolower((string) ($extensions['keyUsage'] ?? ''));
        if (! str_contains(str_replace([' ', '-'], '', $keyUsage), 'digitalsignature')) {
            $this->invalid(
                'binary_security_token',
                'شهادة CSID غير مخولة للاستخدام digitalSignature.'
            );
        }

        $extendedKeyUsages = preg_split(
            '/\\s*,\\s*/',
            strtolower((string) ($extensions['extendedKeyUsage'] ?? '')),
            -1,
            PREG_SPLIT_NO_EMPTY
        );
        $extendedKeyUsages = array_map(
            static fn (string $usage): string => trim($usage),
            is_array($extendedKeyUsages) ? $extendedKeyUsages : []
        );
        $clientAuth = in_array('tls web client authentication', $extendedKeyUsages, true)
            || in_array('clientauth', $extendedKeyUsages, true)
            || in_array('1.3.6.1.5.5.7.3.2', $extendedKeyUsages, true);
        if (! $clientAuth) {
            $this->invalid(
                'binary_security_token',
                'شهادة CSID لا تحتوي Extended Key Usage المطلوب clientAuth.'
            );
        }

        $validFrom = is_array($certificateData) ? ($certificateData['validFrom_time_t'] ?? null) : null;
        $expiresAt = is_array($certificateData) ? ($certificateData['validTo_time_t'] ?? null) : null;
        if (! is_int($validFrom) || ! is_int($expiresAt)) {
            $this->invalid('binary_security_token', 'تعذر قراءة فترة صلاحية شهادة CSID.');
        }

        $now = time();
        if ($validFrom > $now) {
            $this->invalid('binary_security_token', 'شهادة CSID لم تبدأ صلاحيتها بعد.');
        }
        if ($expiresAt <= $now) {
            $this->invalid('binary_security_token', 'شهادة CSID منتهية الصلاحية.');
        }

        $fingerprint = openssl_x509_fingerprint($certificate, 'sha256');
        if (! is_string($fingerprint) || $fingerprint === '') {
            $this->invalid('binary_security_token', 'تعذر حساب بصمة شهادة CSID.');
        }

        return [
            'public_key' => (string) $certificateDetails['key'],
            'curve_name' => (string) ($certificateDetails['ec']['curve_name'] ?? 'unknown'),
            'fingerprint' => strtolower(str_replace(':', '', $fingerprint)),
            'valid_from' => $validFrom,
            'expires_at' => $expiresAt,
        ];
    }

    private function readCertificate(string $material): OpenSSLCertificate
    {
        $material = trim($material);
        $candidates = [$material];

        $compact = preg_replace('/\s+/', '', $material);
        $decoded = is_string($compact) ? base64_decode($compact, true) : false;
        if (is_string($decoded) && $decoded !== '') {
            $candidates[] = $decoded;
        }
        if (is_string($compact) && $compact !== '') {
            $candidates[] = "-----BEGIN CERTIFICATE-----\n"
                . chunk_split($compact, 64, "\n")
                . "-----END CERTIFICATE-----\n";
        }

        foreach ($candidates as $candidate) {
            $certificate = @openssl_x509_read($candidate);
            if ($certificate !== false) {
                return $certificate;
            }
        }

        $this->invalid('binary_security_token', 'Binary Security Token لا يحتوي شهادة CSID بصيغة X.509 صالحة.');
    }

    private function readPrivateKey(string $material): OpenSSLAsymmetricKey
    {
        $material = trim($material);
        $candidates = [$material];

        $compact = preg_replace('/\s+/', '', $material);
        $decoded = is_string($compact) ? base64_decode($compact, true) : false;
        if (is_string($decoded) && $decoded !== '') {
            $candidates[] = $decoded;
        }

        foreach ($candidates as $candidate) {
            $key = @openssl_pkey_get_private($candidate);
            if ($key !== false) {
                return $key;
            }
        }

        $this->invalid('private_key', 'مفتاح ZATCA الخاص غير صالح أو ليس بصيغة يدعمها OpenSSL.');
    }

    private function pemBody(string $pem): string
    {
        return (string) preg_replace('/-----[^-]+-----|\s+/', '', $pem);
    }

    private function invalid(string $field, string $message): never
    {
        throw ValidationException::withMessages([$field => $message]);
    }
}

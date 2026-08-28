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
     * @return array{public_key:string, curve_name:string, fingerprint:string, valid_from:int, expires_at:int, certificate_chain:list<string>}
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

        $certificateChain = $this->buildCertificateChain($certificate, $trustAnchor);

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
            'certificate_chain' => $certificateChain,
        ];
    }

    /**
     * يبني السلسلة من شهادة CSID إلى جذر الثقة، ويتحقق من توقيع كل وصلة.
     *
     * @return list<string> شهادات DER مرمّزة Base64، تبدأ بشهادة التوقيع
     */
    private function buildCertificateChain(OpenSSLCertificate $leaf, string $bundlePath): array
    {
        $bundle = file_get_contents($bundlePath);
        if (! is_string($bundle)
            || preg_match_all('/-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----/s', $bundle, $matches) < 1
        ) {
            $this->invalid('binary_security_token', 'حزمة ثقة ZATCA لا تحتوي شهادات PEM صالحة.');
        }

        /** @var array<string, OpenSSLCertificate> $authorities */
        $authorities = [];
        foreach ($matches[0] as $pem) {
            $authority = @openssl_x509_read($pem);
            $fingerprint = $authority === false ? false : openssl_x509_fingerprint($authority, 'sha256');
            if ($authority === false || ! is_string($fingerprint) || $fingerprint === '') {
                $this->invalid('binary_security_token', 'تعذر قراءة شهادة داخل حزمة ثقة ZATCA.');
            }

            $authorities[strtolower(str_replace(':', '', $fingerprint))] = $authority;
        }

        $leafFingerprint = openssl_x509_fingerprint($leaf, 'sha256');
        if (! is_string($leafFingerprint) || $leafFingerprint === '') {
            $this->invalid('binary_security_token', 'تعذر حساب بصمة شهادة CSID لبناء السلسلة.');
        }

        $current = $leaf;
        $currentFingerprint = strtolower(str_replace(':', '', $leafFingerprint));
        $seen = [$currentFingerprint => true];
        $chain = [$this->certificateBody($leaf)];

        while (true) {
            $currentKey = openssl_pkey_get_public($current);
            if (isset($authorities[$currentFingerprint])
                && $currentKey !== false
                && openssl_x509_verify($current, $currentKey) === 1
            ) {
                break;
            }

            $currentData = openssl_x509_parse($current, false);
            $issuer = is_array($currentData) ? ($currentData['issuer'] ?? null) : null;
            $authorityKeyId = is_array($currentData)
                ? $this->keyIdentifier($currentData['extensions']['authorityKeyIdentifier'] ?? null, true)
                : null;

            $parents = [];
            foreach ($authorities as $fingerprint => $authority) {
                if (isset($seen[$fingerprint])) {
                    continue;
                }

                $authorityData = openssl_x509_parse($authority, false);
                $subject = is_array($authorityData) ? ($authorityData['subject'] ?? null) : null;
                if (! $this->sameDistinguishedName($issuer, $subject)) {
                    continue;
                }

                $subjectKeyId = is_array($authorityData)
                    ? $this->keyIdentifier($authorityData['extensions']['subjectKeyIdentifier'] ?? null, false)
                    : null;
                if ($authorityKeyId !== null
                    && $subjectKeyId !== null
                    && ! hash_equals($authorityKeyId, $subjectKeyId)
                ) {
                    continue;
                }

                $authorityKey = openssl_pkey_get_public($authority);
                if ($authorityKey !== false && openssl_x509_verify($current, $authorityKey) === 1) {
                    $parents[$fingerprint] = $authority;
                }
            }

            if (count($parents) !== 1) {
                $this->invalid(
                    'binary_security_token',
                    count($parents) === 0
                        ? 'حزمة ثقة ZATCA لا تحتوي سلسلة الشهادة كاملة حتى جذر الثقة.'
                        : 'حزمة ثقة ZATCA تحتوي أكثر من مسار صالح لشهادة CSID.'
                );
            }

            $currentFingerprint = array_key_first($parents);
            $current = $parents[$currentFingerprint];
            $seen[$currentFingerprint] = true;
            $chain[] = $this->certificateBody($current);
        }

        return $chain;
    }

    private function sameDistinguishedName(mixed $issuer, mixed $subject): bool
    {
        if (! is_array($issuer) || ! is_array($subject)) {
            return false;
        }

        return $this->normalizeDistinguishedName($issuer) === $this->normalizeDistinguishedName($subject);
    }

    private function normalizeDistinguishedName(array $name): array
    {
        foreach ($name as &$value) {
            if (is_array($value)) {
                $value = $this->normalizeDistinguishedName($value);
            }
        }
        unset($value);

        ksort($name);

        return $name;
    }

    private function keyIdentifier(mixed $value, bool $authority): ?string
    {
        if (! is_string($value) || $value === '') {
            return null;
        }

        $pattern = $authority
            ? '/keyid:([0-9a-f:]+)/i'
            : '/([0-9a-f]{2}(?::[0-9a-f]{2})+)/i';
        if (preg_match($pattern, $value, $matches) !== 1) {
            return null;
        }

        return strtolower(str_replace(':', '', $matches[1]));
    }

    private function certificateBody(OpenSSLCertificate $certificate): string
    {
        if (! openssl_x509_export($certificate, $pem)) {
            $this->invalid('binary_security_token', 'تعذر تسلسل شهادة في سلسلة CSID.');
        }

        $body = preg_replace('/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\\s+/', '', $pem);
        if (! is_string($body) || $body === '' || base64_decode($body, true) === false) {
            $this->invalid('binary_security_token', 'تعذر ترميز شهادة في سلسلة CSID.');
        }

        return $body;
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

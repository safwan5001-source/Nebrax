<?php

namespace App\Services\Accounting;

use RuntimeException;

/** يحل سياسة XAdES من إعدادات النشر ويتوقف إن لم تكن قيمة رسمية مثبتة. */
final class ZatcaSignaturePolicyResolver
{
    public function resolve(): ZatcaSignaturePolicy
    {
        $identifier = config('zatca.signature_policy.identifier');
        $digest = config('zatca.signature_policy.digest');

        if (! is_string($identifier) || ! is_string($digest)) {
            throw new RuntimeException('سياسة توقيع ZATCA غير مهيأة في إعدادات النشر.');
        }
        $identifier = trim($identifier);
        $digest = trim($digest);

        if (! $this->isValidPolicyIdentifier($identifier)) {
            throw new RuntimeException('معرّف سياسة توقيع ZATCA غير مهيأ أو ليس URI مطلقاً.');
        }
        if ($digest === '') {
            throw new RuntimeException('بصمة سياسة توقيع ZATCA غير مهيأة.');
        }

        $decoded = base64_decode($digest, true);
        if ($decoded === false || strlen($decoded) !== 32 || base64_encode($decoded) !== $digest) {
            throw new RuntimeException('بصمة سياسة توقيع ZATCA يجب أن تكون SHA-256 بترميز Base64 قياسي.');
        }

        return new ZatcaSignaturePolicy($identifier, $digest);
    }

    private function isValidPolicyIdentifier(string $identifier): bool
    {
        if ($identifier === '' || preg_match('/%(?![0-9A-Fa-f]{2})/', $identifier) === 1) {
            return false;
        }

        if (str_starts_with(strtolower($identifier), 'https://')) {
            return filter_var($identifier, FILTER_VALIDATE_URL) !== false
                && is_string(parse_url($identifier, PHP_URL_HOST));
        }

        return preg_match(
            '/^urn:[A-Za-z0-9][A-Za-z0-9-]{0,31}:[A-Za-z0-9._~!$&\'()*+,;=:@\/?%#-]+$/D',
            $identifier
        ) === 1;
    }
}

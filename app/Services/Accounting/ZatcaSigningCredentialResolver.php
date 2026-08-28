<?php

namespace App\Services\Accounting;

use App\Models\ZatcaCredential;
use App\Support\Settings;
use RuntimeException;

/** يحل مادة التوقيع للبيئة المختارة صراحةً من دون fallback بين البيئات. */
final class ZatcaSigningCredentialResolver
{
    public function resolve(?string $environment = null): ZatcaSigningMaterial
    {
        $environment ??= (string) Settings::get('zatca', 'active_environment');
        if (! in_array($environment, ZatcaCredentialService::ENVIRONMENTS, true)) {
            throw new RuntimeException('بيئة توقيع ZATCA النشطة غير صالحة.');
        }

        $credential = ZatcaCredential::query()
            ->where('environment', $environment)
            ->where('status', 'configured')
            ->first();

        if (! $credential) {
            throw new RuntimeException("بيانات اعتماد ZATCA لبيئة {$environment} غير مهيأة.");
        }
        if ($credential->expires_at === null || ! $credential->expires_at->isFuture()) {
            throw new RuntimeException("شهادة ZATCA لبيئة {$environment} منتهية أو بلا تاريخ صلاحية.");
        }

        $payload = is_array($credential->credentials) ? $credential->credentials : [];
        $privateKey = $payload['private_key'] ?? null;
        $certificateChain = $payload['certificate_chain'] ?? null;
        if (! is_string($privateKey) || trim($privateKey) === '') {
            throw new RuntimeException("مفتاح توقيع ZATCA لبيئة {$environment} مفقود.");
        }
        if (! is_array($certificateChain) || ! array_is_list($certificateChain) || $certificateChain === []) {
            throw new RuntimeException("سلسلة شهادات ZATCA لبيئة {$environment} مفقودة.");
        }
        foreach ($certificateChain as $certificate) {
            if (! is_string($certificate) || $certificate === '' || base64_decode($certificate, true) === false) {
                throw new RuntimeException("سلسلة شهادات ZATCA لبيئة {$environment} غير صالحة.");
            }
        }

        return new ZatcaSigningMaterial(
            $environment,
            $credential->stage,
            $privateKey,
            $certificateChain,
        );
    }
}

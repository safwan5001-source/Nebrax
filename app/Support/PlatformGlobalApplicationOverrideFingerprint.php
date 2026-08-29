<?php

namespace App\Support;

use RuntimeException;

/**
 * بصمة حتمية لنتيجة المعاينة — tenant outcomes + (all-apps) planned application outcomes.
 */
class PlatformGlobalApplicationOverrideFingerprint
{
    /**
     * @param  array<string, string>  $tenantOutcomes
     * @param  array<string, array<string, string>>|null  $applicationOutcomes
     */
    public static function hash(array $tenantOutcomes, ?array $applicationOutcomes = null): string
    {
        ksort($tenantOutcomes);

        if ($applicationOutcomes !== null) {
            ksort($applicationOutcomes);
            foreach ($applicationOutcomes as &$applications) {
                ksort($applications);
            }
            unset($applications);
        }

        return hash('sha256', json_encode([
            'tenants' => $tenantOutcomes,
            'applications' => $applicationOutcomes,
        ], JSON_UNESCAPED_UNICODE));
    }

    public static function assertMatches(string $cachedFingerprint, string $freshFingerprint): void
    {
        if (! hash_equals($cachedFingerprint, $freshFingerprint)) {
            throw new RuntimeException('تغيّرت حالة المستأجرين منذ آخر معاينة؛ أعد المعاينة.');
        }
    }
}

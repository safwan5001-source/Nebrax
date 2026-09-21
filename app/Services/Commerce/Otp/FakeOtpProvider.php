<?php

namespace App\Services\Commerce\Otp;

use Illuminate\Support\Facades\Log;

/**
 * The only bound `OtpProvider` today (see `CommerceApiServiceProvider`) —
 * there is no real SMS/OTP vendor integrated yet (explicit product decision,
 * COM-MOBILE-AUTH-1-IDENTITY-MECHANISM). It never sends a real message; it
 * only logs delivery *metadata* (never the code itself — ADR-05 §19: "logs
 * must avoid unnecessary exposure of secrets/OTP values/tokens") and keeps
 * the plaintext code in process memory so tests can retrieve and submit it
 * without a real transport. No production code path ever reads
 * `lastCodeFor()`.
 */
class FakeOtpProvider implements OtpProvider
{
    /** @var array<string, string> */
    private static array $sentCodes = [];

    public function send(string $tenantId, string $phoneE164, string $code, string $purpose): void
    {
        self::$sentCodes[self::key($tenantId, $phoneE164, $purpose)] = $code;

        Log::info('commerce.otp.fake_provider_send', [
            'tenant_id' => $tenantId,
            'purpose' => $purpose,
        ]);
    }

    /** Test-only accessor — no production code path calls this. */
    public static function lastCodeFor(string $tenantId, string $phoneE164, string $purpose): ?string
    {
        return self::$sentCodes[self::key($tenantId, $phoneE164, $purpose)] ?? null;
    }

    private static function key(string $tenantId, string $phoneE164, string $purpose): string
    {
        return $tenantId.'|'.$phoneE164.'|'.$purpose;
    }
}

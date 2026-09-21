<?php

namespace App\Services\Commerce\Otp;

use App\Models\CustomerOtpCode;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * COM-MOBILE-AUTH-1 — OTP code lifecycle: issue, deliver (via `OtpProvider`),
 * and verify. Provider-neutral: this class never knows how a code is
 * delivered, only that it was.
 *
 * Security controls (ADR-05 §19):
 *  - `code_hash` is a bcrypt hash (`Hash::make()`), not a bare digest — a
 *    6-digit code has only 10^6 possibilities, so an unsalted/fast hash
 *    would be trivially precomputable if the table ever leaked.
 *  - a fresh request invalidates any prior unconsumed code for the same
 *    phone+purpose (`AuthRecoveryService`'s own "invalidate prior" pattern).
 *  - verification is attempt-limited per code (`MAX_VERIFY_ATTEMPTS`) and
 *    time-limited (`TTL_MINUTES`).
 *  - issuance itself is throttled per phone+purpose independently of the
 *    `/commerce/v1` per-client rate limit, which only sees the ApiClient/IP,
 *    never the phone number.
 */
class CustomerOtpService
{
    private const CODE_LENGTH = 6;
    private const TTL_MINUTES = 5;
    private const MAX_VERIFY_ATTEMPTS = 5;
    private const MAX_ISSUANCE_PER_WINDOW = 3;
    private const ISSUANCE_WINDOW_MINUTES = 10;

    public function __construct(
        private TenantContext $tenantContext,
        private OtpProvider $provider,
    ) {}

    public function requestCode(string $phoneE164, string $purpose): void
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required before issuing an OTP code.');
        }

        $tenantId = $this->tenantContext->id();

        DB::transaction(function () use ($tenantId, $phoneE164, $purpose) {
            // No lockForUpdate() on a bare aggregate: PostgreSQL rejects
            // `FOR UPDATE` combined with `count()`. This is an abuse-rate
            // guard, not a correctness invariant — a rare concurrent race
            // allowing one extra issuance is an acceptable cost, unlike the
            // row-locked invalidate/consume paths below and in `verify()`.
            $recentIssuances = CustomerOtpCode::query()
                ->where('tenant_id', $tenantId)
                ->where('phone_e164', $phoneE164)
                ->where('purpose', $purpose)
                ->where('created_at', '>=', now()->subMinutes(self::ISSUANCE_WINDOW_MINUTES))
                ->count();

            if ($recentIssuances >= self::MAX_ISSUANCE_PER_WINDOW) {
                throw ValidationException::withMessages([
                    'phone' => ['تم تجاوز الحدّ المسموح لطلب رموز التحقق؛ حاول لاحقاً.'],
                ]);
            }

            CustomerOtpCode::query()
                ->where('tenant_id', $tenantId)
                ->where('phone_e164', $phoneE164)
                ->where('purpose', $purpose)
                ->whereNull('consumed_at')
                ->update(['consumed_at' => now()]);

            $code = str_pad((string) random_int(0, 999999), self::CODE_LENGTH, '0', STR_PAD_LEFT);

            CustomerOtpCode::create([
                'tenant_id' => $tenantId,
                'phone_e164' => $phoneE164,
                'purpose' => $purpose,
                'code_hash' => Hash::make($code),
                'attempts' => 0,
                'expires_at' => now()->addMinutes(self::TTL_MINUTES),
            ]);

            $this->provider->send($tenantId, $phoneE164, $code, $purpose);
        });
    }

    public function verify(string $phoneE164, string $code, string $purpose): bool
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required before verifying an OTP code.');
        }

        $tenantId = $this->tenantContext->id();

        return DB::transaction(function () use ($tenantId, $phoneE164, $code, $purpose) {
            $record = CustomerOtpCode::query()
                ->where('tenant_id', $tenantId)
                ->where('phone_e164', $phoneE164)
                ->where('purpose', $purpose)
                ->whereNull('consumed_at')
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();

            if ($record === null || $record->attempts >= self::MAX_VERIFY_ATTEMPTS) {
                return false;
            }

            if (! Hash::check($code, $record->code_hash)) {
                $record->increment('attempts');

                return false;
            }

            $record->forceFill(['consumed_at' => now()])->save();

            return true;
        });
    }
}

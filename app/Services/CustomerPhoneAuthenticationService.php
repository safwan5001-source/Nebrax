<?php

namespace App\Services;

use App\Models\CustomerIdentity;
use App\Services\Commerce\Otp\CustomerOtpService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

/**
 * COM-MOBILE-AUTH-1 — phone + OTP is a unified register-or-login flow: OTP
 * verification is itself the proof of phone ownership (ADR-05 §16), so a
 * first-time phone creates a new, already phone-verified `CustomerIdentity`
 * in the same step a returning phone logs into its existing one. This
 * mirrors `CustomerAuthenticationService` (email+password) in shape/token
 * issuance, but phone has no separate unverified-registration step — there
 * is nothing left to verify by the time `verifyAndAuthenticate()` succeeds.
 *
 * Matches an existing identity by `phone_e164` only when that identity's
 * phone was itself already proven via OTP (`phone_verified_at` set) — never
 * a self-declared, unverified phone entered through the email+password
 * registration request. See the guard inside `verifyAndAuthenticate()`.
 */
class CustomerPhoneAuthenticationService
{
    private const TOKEN_TTL_DAYS = 7;
    private const OTP_PURPOSE = 'login';

    public function __construct(
        private TenantContext $tenantContext,
        private CustomerOtpService $otp,
    ) {}

    public function requestCode(string $phoneE164): void
    {
        $this->otp->requestCode($phoneE164, self::OTP_PURPOSE);
    }

    /** @return array{identity:CustomerIdentity,token:string} */
    public function verifyAndAuthenticate(string $phoneE164, string $code): array
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required before phone authentication.');
        }

        if (! $this->otp->verify($phoneE164, $code, self::OTP_PURPOSE)) {
            throw ValidationException::withMessages([
                'code' => ['رمز التحقق غير صحيح أو منتهي الصلاحية.'],
            ]);
        }

        $tenantId = $this->tenantContext->id();

        $identity = DB::transaction(function () use ($tenantId, $phoneE164) {
            $identity = CustomerIdentity::query()
                ->where('tenant_id', $tenantId)
                ->where('phone_e164', $phoneE164)
                ->lockForUpdate()
                ->first();

            if ($identity === null) {
                return CustomerIdentity::create([
                    'tenant_id' => $tenantId,
                    'display_name' => 'عميل',
                    'phone' => $phoneE164,
                    'phone_verified_at' => now(),
                    'is_active' => true,
                ]);
            }

            // The phone column also accepts a self-declared, never-proven
            // value via the email+password registration request. Matching
            // on it here regardless would let anyone who later proves real
            // control of that number (OTP) silently log into a stranger's
            // identity and see its email/profile — an account-takeover-
            // adjacent leak, not a login. Only an identity whose phone was
            // itself established through proven OTP control is eligible;
            // an unverified claim never resolves an OTP login (ADR-05 §16:
            // account linking requires proof of control; the exact
            // claim/dispute mechanism for a squatted number is deferred).
            if ($identity->phone_verified_at === null) {
                throw ValidationException::withMessages([
                    'phone' => ['تعذّر إكمال تسجيل الدخول بهذا الرقم.'],
                ]);
            }

            return $identity;
        });

        if (! $identity->is_active) {
            throw ValidationException::withMessages([
                'code' => ['تعذّر إكمال تسجيل الدخول.'],
            ]);
        }

        $identity->forceFill(['last_login_at' => now()])->save();

        return [
            'identity' => $identity,
            'token' => $identity
                ->createToken('customer', ['customer:access'], now()->addDays(self::TOKEN_TTL_DAYS))
                ->plainTextToken,
        ];
    }
}

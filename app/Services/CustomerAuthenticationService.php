<?php

namespace App\Services;

use App\Models\CustomerIdentity;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use LogicException;

class CustomerAuthenticationService
{
    private const TOKEN_TTL_DAYS = 7;

    private static ?string $dummyHash = null;

    public function __construct(private TenantContext $tenantContext) {}

    /**
     * @param  list<string>  $extraAbilities  additional token abilities (default none — unchanged behaviour). The
     *                                        store-host buyer flow passes a channel-binding ability so the token
     *                                        is only valid on the host/channel it was issued for.
     * @param  int|null  $ttlDays  token lifetime override (B2C-ACCOUNTS "remember me"); null keeps the 7-day default
     * @return array{identity:CustomerIdentity,token:string}
     */
    public function login(string $email, string $password, array $extraAbilities = [], ?int $ttlDays = null): array
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required before customer credential lookup.');
        }

        $identity = CustomerIdentity::query()
            ->where('email_normalized', CustomerIdentity::normalizeEmail($email))
            ->first();

        $passwordValid = Hash::check($password, $identity?->password ?? $this->dummyHash());

        if (
            $identity === null
            || ! $passwordValid
            || ! $identity->is_active
            || $identity->email_verified_at === null
        ) {
            throw ValidationException::withMessages([
                'email' => ['تعذّر إكمال تسجيل الدخول بالبيانات المقدمة.'],
            ]);
        }

        $identity->forceFill(['last_login_at' => now()])->save();

        return [
            'identity' => $identity,
            'token' => $identity
                ->createToken('customer', ['customer:access', ...$extraAbilities], now()->addDays($ttlDays ?? self::TOKEN_TTL_DAYS))
                ->plainTextToken,
        ];
    }

    private function dummyHash(): string
    {
        return self::$dummyHash ??= Hash::make('awj-customer-dummy-password');
    }
}

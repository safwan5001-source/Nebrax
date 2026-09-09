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

    /** @return array{identity:CustomerIdentity,token:string} */
    public function login(string $email, string $password): array
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
                ->createToken('customer', ['customer:access'], now()->addDays(self::TOKEN_TTL_DAYS))
                ->plainTextToken,
        ];
    }

    private function dummyHash(): string
    {
        return self::$dummyHash ??= Hash::make('awj-customer-dummy-password');
    }
}

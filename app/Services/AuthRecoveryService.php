<?php

namespace App\Services;

use App\Models\User;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class AuthRecoveryService
{
    public const PASSWORD_RESET = 'password_reset';
    public const EMAIL_VERIFICATION = 'email_verification';
    private const TTL_MINUTES = 60;

    public function issue(User $user, string $type): string
    {
        if (! in_array($type, [self::PASSWORD_RESET, self::EMAIL_VERIFICATION], true)) {
            throw new RuntimeException('Unsupported auth token type.');
        }

        DB::table('auth_action_tokens')
            ->where('user_id', $user->id)
            ->where('type', $type)
            ->whereNull('used_at')
            ->update(['used_at' => now()]);

        $plain = Str::random(64);
        DB::table('auth_action_tokens')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $user->tenant_id,
            'user_id' => $user->id,
            'type' => $type,
            'token_hash' => hash('sha256', $plain),
            'expires_at' => now()->addMinutes(self::TTL_MINUTES),
            'used_at' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $plain;
    }

    public function consume(string $plain, string $type): ?User
    {
        return DB::transaction(function () use ($plain, $type) {
            $record = DB::table('auth_action_tokens')
                ->where('type', $type)
                ->where('token_hash', hash('sha256', $plain))
                ->whereNull('used_at')
                ->where('expires_at', '>', now())
                ->lockForUpdate()
                ->first();

            if (! $record || ! $this->matchesHostname($record->tenant_id)) {
                return null;
            }

            DB::table('auth_action_tokens')->where('id', $record->id)->update([
                'used_at' => now(),
                'updated_at' => now(),
            ]);

            return User::whereKey($record->user_id)
                ->where('tenant_id', $record->tenant_id)
                ->where('is_active', true)
                ->first();
        });
    }

    public function revokeForUser(User $user, string $type): void
    {
        DB::table('auth_action_tokens')
            ->where('user_id', $user->id)
            ->where('type', $type)
            ->whereNull('used_at')
            ->update(['used_at' => now()]);
    }

    private function matchesHostname(string $tenantId): bool
    {
        $hostnameTenantId = app(HostnameTenantContext::class)->id();

        return $hostnameTenantId === null || $hostnameTenantId === $tenantId;
    }
}

<?php

namespace App\Services;

use App\Models\User;
use App\Tenancy\HostnameTenantContext;
use App\Tenancy\TenantHostnameResolver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

class AuthRecoveryService
{
    public const PASSWORD_RESET = 'password_reset';
    public const EMAIL_VERIFICATION = 'email_verification';

    /**
     * TENANT-PROVISIONING-E2E-1 — انتقال ما بعد التسجيل عبر نطاق فرعي مختلف
     * (`test.{base}` → `{slug}.{base}`). نفس بنية `auth_action_tokens`
     * تماماً (رمز عشوائي، هاش مخزَّن، استهلاك مرة واحدة، ربط بالمستأجر عبر
     * `matchesHostname()`) — لا جدول جديد ولا آلية تشفير جديدة. TTL أقصر
     * بكثير (دقيقتان لا ساعة) لأنه يُستهلك خلال ثوانٍ من التسجيل مباشرة،
     * لا من رابط بريد قد يُفتح لاحقاً.
     */
    public const TENANT_HANDOFF = 'tenant_handoff';

    private const TTL_MINUTES = 60;

    private const HANDOFF_TTL_MINUTES = 2;

    public function frontendLink(User $user, string $path, string $token): string
    {
        $slug = (string) $user->tenant()->value('slug');

        return app(TenantHostnameResolver::class)->frontendUrlForTenant($slug, $path, ['token' => $token]);
    }

    public function issue(User $user, string $type): string
    {
        if (! in_array($type, [self::PASSWORD_RESET, self::EMAIL_VERIFICATION, self::TENANT_HANDOFF], true)) {
            throw new RuntimeException('Unsupported auth token type.');
        }

        DB::table('auth_action_tokens')
            ->where('user_id', $user->id)
            ->where('type', $type)
            ->whereNull('used_at')
            ->update(['used_at' => now()]);

        $ttlMinutes = $type === self::TENANT_HANDOFF ? self::HANDOFF_TTL_MINUTES : self::TTL_MINUTES;

        $plain = Str::random(64);
        DB::table('auth_action_tokens')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $user->tenant_id,
            'user_id' => $user->id,
            'type' => $type,
            'token_hash' => hash('sha256', $plain),
            'expires_at' => now()->addMinutes($ttlMinutes),
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

        return $hostnameTenantId !== null && $hostnameTenantId === $tenantId;
    }
}

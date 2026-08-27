<?php

namespace App\Services\Accounting;

use App\Models\User;
use App\Models\Tenant;
use App\Models\ZatcaCredential;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;

class ZatcaCredentialService
{
    public const ENVIRONMENTS = ['developer', 'simulation', 'production'];
    public const STAGES = ['compliance', 'production'];

    private const SECRET_FIELDS = ['binary_security_token', 'secret', 'private_key', 'request_id'];

    public function store(User $user, string $environment, array $validated): ZatcaCredential
    {
        if (! in_array($environment, self::ENVIRONMENTS, true)) {
            throw ValidationException::withMessages(['environment' => 'بيئة ZATCA غير صالحة.']);
        }
        if (! Hash::check((string) ($validated['current_password'] ?? ''), $user->password)) {
            throw ValidationException::withMessages(['current_password' => 'كلمة مرور المستخدم غير صحيحة.']);
        }
        unset($validated['current_password']);

        return DB::transaction(function () use ($user, $environment, $validated): ZatcaCredential {
            // صف المستأجر موجود دائماً، لذلك يقفل أيضاً أول تهيئة حين لا يوجد
            // بعد صف credential يمكن قفله. يمنع هذا إدراجين متزامنين لنفس البيئة.
            Tenant::whereKey($user->tenant_id)->lockForUpdate()->firstOrFail();

            $record = ZatcaCredential::where('environment', $environment)->lockForUpdate()->first();
            $credentials = is_array($record?->credentials) ? $record->credentials : [];

            if ($record !== null && $record->stage !== $validated['stage']) {
                foreach (['binary_security_token', 'secret', 'private_key'] as $required) {
                    if (! filled($validated[$required] ?? null)) {
                        throw ValidationException::withMessages([
                            $required => 'تغيير مرحلة CSID يتطلّب مجموعة بيانات اعتماد جديدة كاملة.',
                        ]);
                    }
                }
            }

            foreach (self::SECRET_FIELDS as $field) {
                if (array_key_exists($field, $validated) && filled($validated[$field])) {
                    $credentials[$field] = trim((string) $validated[$field]);
                }
            }
            foreach (['binary_security_token', 'secret', 'private_key'] as $required) {
                if (! filled($credentials[$required] ?? null)) {
                    throw ValidationException::withMessages([
                        $required => 'هذا الحقل مطلوب عند تهيئة بيانات اعتماد ZATCA لأول مرة.',
                    ]);
                }
            }

            $record ??= new ZatcaCredential(['environment' => $environment]);
            $record->fill([
                'stage' => $validated['stage'],
                'status' => 'configured',
                'credentials' => $credentials,
                'certificate_fingerprint' => hash('sha256', $credentials['binary_security_token']),
                'configured_at' => now('UTC'),
                'expires_at' => array_key_exists('expires_at', $validated)
                    ? $validated['expires_at']
                    : $record->expires_at,
                'updated_by' => $user->id,
            ])->save();

            return $record->fresh();
        }, 3);
    }

    /** @return array<string, mixed> */
    public function publicMetadata(ZatcaCredential $credential): array
    {
        $secrets = is_array($credential->credentials) ? $credential->credentials : [];

        return [
            'id' => $credential->id,
            'environment' => $credential->environment,
            'stage' => $credential->stage,
            'status' => $credential->status,
            'has_binary_security_token' => filled($secrets['binary_security_token'] ?? null),
            'has_secret' => filled($secrets['secret'] ?? null),
            'has_private_key' => filled($secrets['private_key'] ?? null),
            'has_request_id' => filled($secrets['request_id'] ?? null),
            'certificate_fingerprint' => $credential->certificate_fingerprint,
            'configured_at' => $credential->configured_at?->toIso8601String(),
            'expires_at' => $credential->expires_at?->toIso8601String(),
            'updated_at' => $credential->updated_at?->toIso8601String(),
        ];
    }
}

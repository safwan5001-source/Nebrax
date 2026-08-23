<?php

namespace App\Services;

use App\Contracts\DocumentSafetyScanner;
use App\Models\DocumentProcessingRun;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Models\PlatformIntegrationSetting;
use App\Models\PlatformRuntimeHeartbeat;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Support\DocumentProcessingStatus;
use Illuminate\Support\Arr;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Validation\ValidationException;
use Throwable;

class PlatformIntegrationService
{
    public const KEYS = ['document_storage', 'malware_scanner', 'document_processing', 'document_ai'];

    private const SECRETS = ['access_key_id', 'secret_access_key', 'api_key'];

    public function __construct(
        private readonly DocumentStorageService $storage,
        private readonly DocumentSafetyScanner $scanner,
    ) {
    }

    /** @return array<string, mixed> */
    public function overview(): array
    {
        $settings = PlatformIntegrationSetting::query()
            ->whereIn('integration_key', self::KEYS)
            ->get()
            ->keyBy('integration_key');

        return [
            'integrations' => collect(self::KEYS)->map(function (string $key) use ($settings): array {
                /** @var PlatformIntegrationSetting|null $setting */
                $setting = $settings->get($key);
                $configuration = is_array($setting?->configuration) ? $setting->configuration : [];

                return [
                    'key' => $key,
                    'provider' => $setting?->provider,
                    'enabled' => (bool) $setting?->enabled,
                    'configured' => $setting !== null,
                    'configuration' => $this->publicConfiguration($key, $configuration),
                    'configured_at' => $setting?->configured_at?->toIso8601String(),
                    'updated_at' => $setting?->updated_at?->toIso8601String(),
                ];
            })->values()->all(),
            'runtime' => $this->runtime(),
        ];
    }

    public function update(
        PlatformAdministrator $administrator,
        string $key,
        array $validated,
    ): PlatformIntegrationSetting {
        $this->assertKey($key);
        if (! Hash::check((string) ($validated['current_password'] ?? ''), $administrator->password)) {
            throw ValidationException::withMessages([
                'current_password' => 'كلمة مرور مدير المنصة غير صحيحة.',
            ]);
        }
        unset($validated['current_password']);

        return DB::transaction(function () use ($administrator, $key, $validated): PlatformIntegrationSetting {
            $setting = PlatformIntegrationSetting::query()
                ->where('integration_key', $key)
                ->lockForUpdate()
                ->first();
            $previous = is_array($setting?->configuration) ? $setting->configuration : [];
            $configuration = Arr::except($validated, ['enabled', 'provider']);

            foreach (self::SECRETS as $secret) {
                if (array_key_exists($secret, $configuration) && blank($configuration[$secret])) {
                    unset($configuration[$secret]);
                }
                if (! array_key_exists($secret, $configuration) && array_key_exists($secret, $previous)) {
                    $configuration[$secret] = $previous[$secret];
                }
            }

            $this->assertRequiredSecrets($key, (bool) $validated['enabled'], $configuration);

            $changedKeys = $this->changedKeys(
                $previous,
                $configuration,
                $setting?->enabled,
                (bool) $validated['enabled'],
                $setting?->provider,
                $validated['provider'] ?? null,
            );

            $setting ??= new PlatformIntegrationSetting(['integration_key' => $key]);
            $setting->fill([
                'provider' => $validated['provider'] ?? null,
                'enabled' => (bool) $validated['enabled'],
                'configuration' => $configuration,
                'configured_at' => now('UTC'),
                'updated_by' => $administrator->id,
            ])->save();

            PlatformIntegrationAuditEvent::create([
                'platform_administrator_id' => $administrator->id,
                'integration_key' => $key,
                'action' => 'configuration_updated',
                'changed_keys' => $changedKeys,
                'occurred_at' => now('UTC'),
            ]);

            return $setting->fresh();
        }, 3);
    }

    /** @return array{ok:bool, message:string} */
    public function test(string $key): array
    {
        $this->assertKey($key);

        try {
            return match ($key) {
                'document_storage' => $this->storage->healthCheck()
                    ? ['ok' => true, 'message' => 'تم الاتصال بالتخزين الخاص والكتابة والحذف بنجاح.']
                    : ['ok' => false, 'message' => 'تعذر التحقق من التخزين الخاص.'],
                'malware_scanner' => $this->scanner->ping()
                    ? ['ok' => true, 'message' => 'استجاب فاحص الملفات بنجاح.']
                    : ['ok' => false, 'message' => 'لم يستجب فاحص الملفات.'],
                'document_processing' => $this->queueTest(),
                'document_ai' => throw ValidationException::withMessages([
                    'integration' => 'اختبار مزود الذكاء الاصطناعي يضاف مع عقد الاستخراج في PR-4.',
                ]),
            };
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw ValidationException::withMessages([
                'integration' => 'فشل اختبار الاتصال. تحقق من الإعدادات ومن إتاحة الخدمة الخاصة.',
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function runtime(): array
    {
        $heartbeat = PlatformRuntimeHeartbeat::query()
            ->where('component', 'document-worker')
            ->first();
        $lastSeen = $heartbeat?->last_seen_at;

        return [
            'queue_connection' => (string) config('queue.default', 'sync'),
            'queue_configured' => config('queue.default') === 'redis' && filled(config('database.redis.default.url')),
            'worker_status' => $lastSeen?->isAfter(now('UTC')->subMinutes(2)) ? 'online' : 'offline',
            'worker_last_seen_at' => $lastSeen?->toIso8601String(),
            'queued_runs' => DocumentProcessingRun::query()->where('status', DocumentProcessingStatus::QUEUED->value)->count(),
            'running_runs' => DocumentProcessingRun::query()->where('status', DocumentProcessingStatus::RUNNING->value)->count(),
            'failed_runs' => DocumentProcessingRun::query()->where('status', DocumentProcessingStatus::FAILED->value)->count(),
        ];
    }

    /** @return array{ok:bool, message:string} */
    private function queueTest(): array
    {
        $runtime = $this->runtime();
        if (! $runtime['queue_configured']) {
            return ['ok' => false, 'message' => 'اتصال Redis/Valkey غير مضبوط في بيئة تشغيل Render.'];
        }

        return ['ok' => true, 'message' => 'اتصال Queue مضبوط؛ تظهر نبضة العامل بعد إقلاعه.'];
    }

    /** @return array<string, mixed> */
    private function publicConfiguration(string $key, array $configuration): array
    {
        $public = Arr::except($configuration, self::SECRETS);
        foreach (self::SECRETS as $secret) {
            if (filled($configuration[$secret] ?? null)) {
                $public[$secret . '_masked'] = $this->mask((string) $configuration[$secret]);
                $public['has_' . $secret] = true;
            }
        }

        return $public;
    }

    /** @return list<string> */
    private function changedKeys(
        array $before,
        array $after,
        ?bool $beforeEnabled,
        bool $afterEnabled,
        ?string $beforeProvider,
        ?string $afterProvider,
    ): array {
        $keys = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $key) {
            if (($before[$key] ?? null) !== ($after[$key] ?? null)) {
                $keys[] = (string) $key;
            }
        }
        if ($beforeEnabled !== $afterEnabled) {
            $keys[] = 'enabled';
        }
        if ($beforeProvider !== $afterProvider) {
            $keys[] = 'provider';
        }

        return array_values(array_unique($keys));
    }

    private function mask(string $value): string
    {
        return '••••••••' . mb_substr($value, -4);
    }

    private function assertKey(string $key): void
    {
        if (! in_array($key, self::KEYS, true)) {
            abort(404);
        }
    }

    private function assertRequiredSecrets(string $key, bool $enabled, array $configuration): void
    {
        if (! $enabled) {
            return;
        }

        $required = match ($key) {
            'document_storage' => ['access_key_id', 'secret_access_key'],
            'document_ai' => ['api_key'],
            default => [],
        };
        foreach ($required as $field) {
            if (blank($configuration[$field] ?? null)) {
                throw ValidationException::withMessages([
                    $field => 'هذا السر مطلوب عند تفعيل التكامل لأول مرة.',
                ]);
            }
        }
    }
}

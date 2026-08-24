<?php

namespace App\Services;

use App\Contracts\DocumentSafetyScanner;
use App\Models\DocumentProcessingRun;
use App\Models\PlatformAdministrator;
use App\Models\PlatformIntegrationAuditEvent;
use App\Models\PlatformIntegrationSetting;
use App\Models\PlatformRuntimeHeartbeat;
use App\Services\DocumentCenter\DocumentExtractionProviderRegistry;
use App\Services\DocumentCenter\DocumentProviderConfiguration;
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

    /** @var list<string> */
    private const AI_PROVIDER_KEYS = ['openai', 'anthropic', 'google_gemini'];

    /** @var list<string> */
    private const SECRETS = ['access_key_id', 'secret_access_key', 'api_key'];

    public function __construct(
        private readonly DocumentStorageService $storage,
        private readonly DocumentSafetyScanner $scanner,
        private readonly DocumentExtractionProviderRegistry $documentProviders,
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
            if ($key === 'document_ai') {
                return $this->updateDocumentAi($administrator, $validated);
            }

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

            $this->audit($administrator, $key, 'configuration_updated', $changedKeys);

            return $setting->fresh();
        }, 3);
    }

    /** @return array{ok:bool, message:string} */
    public function test(PlatformAdministrator $administrator, string $key, ?string $provider = null): array
    {
        $this->assertKey($key);

        try {
            if ($key === 'document_ai') {
                return $this->testDocumentAiProvider($administrator, $provider);
            }

            return match ($key) {
                'document_storage' => $this->storage->healthCheck()
                    ? ['ok' => true, 'message' => 'تم الاتصال بالتخزين الخاص والكتابة والحذف بنجاح.']
                    : ['ok' => false, 'message' => 'تعذر التحقق من التخزين الخاص.'],
                'malware_scanner' => $this->scanner->ping()
                    ? ['ok' => true, 'message' => 'استجاب فاحص الملفات بنجاح.']
                    : ['ok' => false, 'message' => 'لم يستجب فاحص الملفات.'],
                'document_processing' => $this->queueTest(),
            };
        } catch (ValidationException $exception) {
            throw $exception;
        } catch (Throwable) {
            throw ValidationException::withMessages([
                'integration' => 'فشل اختبار الاتصال. تحقق من الإعدادات ومن إتاحة الخدمة الخاصة.',
            ]);
        }
    }

    /** @return array{ok:bool, message:string} */
    private function testDocumentAiProvider(PlatformAdministrator $administrator, ?string $provider): array
    {
        if (! in_array($provider, self::AI_PROVIDER_KEYS, true)) {
            throw ValidationException::withMessages(['provider' => 'اختر مزود ذكاء اصطناعي مسجلاً لاختبار الاتصال.']);
        }

        $setting = PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')
            ->lockForUpdate()
            ->first();
        $configuration = is_array($setting?->configuration) ? $this->upgradeLegacyAiConfiguration($setting->configuration) : [];
        $providerConfiguration = DocumentProviderConfiguration::fromArray(
            $provider,
            is_array($configuration['providers'][$provider] ?? null) ? $configuration['providers'][$provider] : [],
        );
        $result = $this->documentProviders->resolve($provider)->testConnection($providerConfiguration);

        if ($setting !== null) {
            $configuration['providers'][$provider] ??= [];
            $configuration['providers'][$provider]['last_test_status'] = $result->ok ? 'passed' : 'failed';
            $configuration['providers'][$provider]['last_tested_at'] = now('UTC')->toIso8601String();
            $configuration['providers'][$provider]['last_test_message_safe'] = mb_substr($result->message, 0, 500);
            $setting->fill([
                'configuration' => $configuration,
                'updated_by' => $administrator->id,
            ])->save();
            $this->audit($administrator, 'document_ai', 'connection_tested', [
                "providers.{$provider}.last_test_status",
                "providers.{$provider}.last_tested_at",
                "providers.{$provider}.last_test_message_safe",
            ]);
        }

        return ['ok' => $result->ok, 'message' => $result->message];
    }

    private function updateDocumentAi(PlatformAdministrator $administrator, array $validated): PlatformIntegrationSetting
    {
        $setting = PlatformIntegrationSetting::query()
            ->where('integration_key', 'document_ai')
            ->lockForUpdate()
            ->first();
        $previous = is_array($setting?->configuration) ? $this->upgradeLegacyAiConfiguration($setting->configuration) : [];
        $configuration = $this->normalizeDocumentAiConfiguration($validated, $previous);
        $engineEnabled = (bool) $configuration['engine_enabled'];
        $this->assertDocumentAiConfiguration($configuration, $engineEnabled);
        $primary = $configuration['primary_provider'];
        $changedKeys = $this->changedKeys(
            $previous,
            $configuration,
            $setting?->enabled,
            $engineEnabled,
            $setting?->provider,
            $primary,
        );

        $setting ??= new PlatformIntegrationSetting(['integration_key' => 'document_ai']);
        $setting->fill([
            'provider' => $primary,
            'enabled' => $engineEnabled,
            'configuration' => $configuration,
            'configured_at' => now('UTC'),
            'updated_by' => $administrator->id,
        ])->save();

        $this->audit($administrator, 'document_ai', 'configuration_updated', $changedKeys);

        return $setting->fresh();
    }

    /** @param array<string, mixed> $validated
     *  @param array<string, mixed> $previous
     *  @return array<string, mixed>
     */
    private function normalizeDocumentAiConfiguration(array $validated, array $previous): array
    {
        $incomingProviders = is_array($validated['providers'] ?? null) ? $validated['providers'] : [];
        $previousProviders = is_array($previous['providers'] ?? null) ? $previous['providers'] : [];
        $providers = [];

        foreach (self::AI_PROVIDER_KEYS as $key) {
            $incoming = is_array($incomingProviders[$key] ?? null) ? $incomingProviders[$key] : [];
            $before = is_array($previousProviders[$key] ?? null) ? $previousProviders[$key] : [];
            $clearApiKey = (bool) ($incoming['clear_api_key'] ?? false);
            $apiKey = $clearApiKey
                ? ''
                : (array_key_exists('api_key', $incoming) && filled($incoming['api_key'])
                    ? (string) $incoming['api_key']
                    : (string) ($before['api_key'] ?? ''));
            $providers[$key] = [
                'enabled' => (bool) ($incoming['enabled'] ?? $before['enabled'] ?? false),
                'api_key' => $apiKey,
                'model' => mb_substr(trim((string) ($incoming['model'] ?? $before['model'] ?? '')), 0, 128),
                'connection_timeout_seconds' => $this->boundedInt($incoming['connection_timeout_seconds'] ?? $before['connection_timeout_seconds'] ?? 15, 5, 60),
                'processing_timeout_seconds' => $this->boundedInt($incoming['processing_timeout_seconds'] ?? $before['processing_timeout_seconds'] ?? 90, 15, 180),
                'max_attempts' => $this->boundedInt($incoming['max_attempts'] ?? $before['max_attempts'] ?? 2, 1, 5),
                'allow_document_sending' => (bool) ($incoming['allow_document_sending'] ?? $before['allow_document_sending'] ?? false),
                'monthly_operation_limit' => $this->nullablePositiveInt($incoming['monthly_operation_limit'] ?? $before['monthly_operation_limit'] ?? null),
                'monthly_page_limit' => $this->nullablePositiveInt($incoming['monthly_page_limit'] ?? $before['monthly_page_limit'] ?? null),
                'data_region' => mb_substr(trim((string) ($incoming['data_region'] ?? $before['data_region'] ?? '')), 0, 128),
                'retention_policy' => mb_substr(trim((string) ($incoming['retention_policy'] ?? $before['retention_policy'] ?? '')), 0, 500),
                'last_test_status' => $before['last_test_status'] ?? 'not_tested',
                'last_tested_at' => $before['last_tested_at'] ?? null,
                'last_test_message_safe' => $before['last_test_message_safe'] ?? null,
            ];
        }

        $fallbacks = array_values(array_filter(
            $validated['fallback_providers'] ?? $previous['fallback_providers'] ?? [],
            fn (mixed $provider): bool => is_string($provider) && $provider !== '',
        ));

        return [
            'engine_enabled' => (bool) ($validated['enabled'] ?? false),
            'primary_provider' => $this->nullableProvider($validated['primary_provider'] ?? null),
            'fallback_enabled' => (bool) ($validated['fallback_enabled'] ?? false),
            'fallback_providers' => array_slice($fallbacks, 0, 2),
            'confidence_threshold_percent' => $this->boundedInt($validated['confidence_threshold_percent'] ?? 0, 0, 100),
            'default_language' => mb_substr(trim((string) ($validated['default_language'] ?? 'ar')), 0, 16),
            'max_files_per_batch' => $this->boundedInt($validated['max_files_per_batch'] ?? 10, 1, 100),
            'max_pages_per_file' => $this->boundedInt($validated['max_pages_per_file'] ?? 100, 1, 1000),
            'max_file_size_bytes' => $this->boundedInt($validated['max_file_size_bytes'] ?? 10485760, 1, 52428800),
            'test_mode' => (bool) ($validated['test_mode'] ?? false),
            'providers' => $providers,
        ];
    }

    /** @param array<string, mixed> $configuration */
    private function assertDocumentAiConfiguration(array $configuration, bool $engineEnabled): void
    {
        $primary = $configuration['primary_provider'] ?? null;
        $fallbacks = $configuration['fallback_providers'] ?? [];
        $all = array_values(array_filter([$primary, ...$fallbacks], 'is_string'));
        if (count($all) !== count(array_unique($all))) {
            throw ValidationException::withMessages(['fallback_providers' => 'لا يمكن تكرار مزود الذكاء الاصطناعي في الترتيب.']);
        }
        foreach ($all as $provider) {
            if (! in_array($provider, self::AI_PROVIDER_KEYS, true)) {
                throw ValidationException::withMessages(['primary_provider' => 'يجب اختيار مزود ذكاء اصطناعي مسجل.']);
            }
        }
        if (! $engineEnabled) {
            return;
        }
        if (! is_string($primary) || $primary === '') {
            throw ValidationException::withMessages(['primary_provider' => 'اختر مزودًا أساسيًا قبل تفعيل محرك الاستخراج.']);
        }

        foreach ($all as $provider) {
            $providerConfiguration = DocumentProviderConfiguration::fromArray($provider, $configuration['providers'][$provider] ?? []);
            if (! $providerConfiguration->isOperationallyReady()) {
                throw ValidationException::withMessages(["providers.{$provider}" => 'فعّل المزود، واحفظ مفتاحه ونموذجه، واسمح بإرسال المستندات إليه قبل اختياره.']);
            }
            $validation = $this->documentProviders->resolve($provider)->validateConfiguration($providerConfiguration);
            if (! $validation->valid) {
                throw ValidationException::withMessages(["providers.{$provider}" => $validation->errors]);
            }
        }
    }

    /** @param array<string, mixed> $configuration
     *  @return array<string, mixed>
     */
    private function upgradeLegacyAiConfiguration(array $configuration): array
    {
        if (is_array($configuration['providers'] ?? null)) {
            return $configuration;
        }

        $legacyProvider = in_array($configuration['provider'] ?? null, self::AI_PROVIDER_KEYS, true)
            ? $configuration['provider']
            : 'openai';
        $providers = [];
        foreach (self::AI_PROVIDER_KEYS as $key) {
            $providers[$key] = $key === $legacyProvider ? [
                'enabled' => (bool) ($configuration['enabled'] ?? false),
                'api_key' => (string) ($configuration['api_key'] ?? ''),
                'model' => (string) ($configuration['model'] ?? ''),
            ] : [];
        }

        return [
            'engine_enabled' => (bool) ($configuration['enabled'] ?? false),
            'primary_provider' => $legacyProvider,
            'fallback_enabled' => false,
            'fallback_providers' => [],
            'confidence_threshold_percent' => 0,
            'default_language' => 'ar',
            'max_files_per_batch' => 10,
            'max_pages_per_file' => 100,
            'max_file_size_bytes' => 10485760,
            'test_mode' => false,
            'providers' => $providers,
        ];
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
        if ($key === 'document_ai') {
            $configuration = $this->upgradeLegacyAiConfiguration($configuration);
        }

        return $this->maskConfiguration($configuration);
    }

    /** @return array<string, mixed> */
    private function maskConfiguration(array $configuration): array
    {
        $public = [];
        foreach ($configuration as $key => $value) {
            if (is_array($value)) {
                $public[$key] = $this->maskConfiguration($value);
                continue;
            }
            if (in_array($key, self::SECRETS, true)) {
                if (filled($value)) {
                    $public[$key . '_masked'] = $this->mask((string) $value);
                    $public['has_' . $key] = true;
                }
                continue;
            }
            $public[$key] = $value;
        }

        return $public;
    }

    /** @param array<string, mixed> $before
     *  @param array<string, mixed> $after
     *  @return list<string>
     */
    private function changedKeys(array $before, array $after, ?bool $beforeEnabled, bool $afterEnabled, ?string $beforeProvider, ?string $afterProvider): array
    {
        $beforeFlattened = $this->flatten($before);
        $afterFlattened = $this->flatten($after);
        $keys = [];
        foreach (array_unique([...array_keys($beforeFlattened), ...array_keys($afterFlattened)]) as $key) {
            if (($beforeFlattened[$key] ?? null) !== ($afterFlattened[$key] ?? null)) {
                $keys[] = $key;
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

    /** @param array<string, mixed> $configuration
     *  @return array<string, mixed>
     */
    private function flatten(array $configuration, string $prefix = ''): array
    {
        $flattened = [];
        foreach ($configuration as $key => $value) {
            $path = $prefix === '' ? (string) $key : "{$prefix}.{$key}";
            if (is_array($value)) {
                $flattened += $this->flatten($value, $path);
            } else {
                $flattened[$path] = $value;
            }
        }

        return $flattened;
    }

    private function audit(PlatformAdministrator $administrator, string $key, string $action, array $changedKeys): void
    {
        PlatformIntegrationAuditEvent::create([
            'platform_administrator_id' => $administrator->id,
            'integration_key' => $key,
            'action' => $action,
            'changed_keys' => $changedKeys,
            'occurred_at' => now('UTC'),
        ]);
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

    private function nullableProvider(mixed $value): ?string
    {
        return is_string($value) && $value !== '' ? $value : null;
    }

    private function boundedInt(mixed $value, int $minimum, int $maximum): int
    {
        return max($minimum, min($maximum, (int) $value));
    }

    private function nullablePositiveInt(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $number = (int) $value;

        return $number > 0 ? $number : null;
    }
}

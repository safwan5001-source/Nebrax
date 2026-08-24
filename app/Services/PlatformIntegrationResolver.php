<?php

namespace App\Services;

use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentExtractionPolicy;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** قراءة إعدادات التكاملات المشفرة مع سقوط آمن حين لا يكون الجدول مرحّلاً بعد. */
class PlatformIntegrationResolver
{
    /** @return array<string, mixed> */
    public function activeConfiguration(string $key): array
    {
        try {
            if (! Schema::hasTable('platform_integration_settings')) {
                return [];
            }

            $setting = PlatformIntegrationSetting::query()
                ->where('integration_key', $key)
                ->where('enabled', true)
                ->first();

            return is_array($setting?->configuration) ? $setting->configuration : [];
        } catch (Throwable) {
            return [];
        }
    }

    public function activeProvider(string $key): ?string
    {
        try {
            if (! Schema::hasTable('platform_integration_settings')) {
                return null;
            }

            return PlatformIntegrationSetting::query()
                ->where('integration_key', $key)
                ->where('enabled', true)
                ->value('provider');
        } catch (Throwable) {
            return null;
        }
    }

    /** @return array{max_attempts:int, timeout_seconds:int, backoff_seconds:list<int>} */
    public function processingPolicy(): array
    {
        $configuration = $this->activeConfiguration('document_processing');

        return [
            'max_attempts' => max(1, min(5, (int) ($configuration['max_attempts'] ?? 3))),
            'timeout_seconds' => max(10, min(120, (int) ($configuration['timeout_seconds'] ?? 90))),
            'backoff_seconds' => $this->backoff($configuration['backoff_seconds'] ?? [30, 120, 300]),
        ];
    }

    public function documentExtractionPolicy(): DocumentExtractionPolicy
    {
        $configuration = $this->activeConfiguration('document_ai');

        return $configuration === [] ? DocumentExtractionPolicy::disabled() : new DocumentExtractionPolicy($configuration);
    }

    /** @return list<int> */
    private function backoff(mixed $value): array
    {
        if (! is_array($value)) {
            return [30, 120, 300];
        }

        $seconds = array_values(array_map(
            fn (mixed $item): int => max(1, min(3600, (int) $item)),
            array_slice($value, 0, 5),
        ));

        return $seconds === [] ? [30, 120, 300] : $seconds;
    }
}

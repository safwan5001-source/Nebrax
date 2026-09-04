<?php

namespace App\Services;

use App\Models\PlatformIntegrationSetting;
use App\Services\DocumentCenter\DocumentExtractionPolicy;
use Illuminate\Support\Facades\Schema;
use Throwable;

/** قراءة إعدادات التكاملات المشفرة مع سقوط آمن حين لا يكون الجدول مرحّلاً بعد. */
class PlatformIntegrationResolver
{
    /** @var array<string, PlatformIntegrationSetting|null> */
    private array $rows = [];

    /** @var array<string, true> Keys whose settings could not be read authoritatively. */
    private array $unavailable = [];

    /** @return array<string, mixed> */
    public function activeConfiguration(string $key): array
    {
        $setting = $this->row($key);
        if ($setting === null || ! $setting->enabled) {
            return [];
        }

        return is_array($setting->configuration) ? $setting->configuration : [];
    }

    /**
     * A scan-exception admission may bypass the scanner only when its state is
     * known to be inactive. A missing row is unconfigured; a disabled row is
     * disabled. Missing tables and read failures remain ambiguous and fail closed.
     */
    public function malwareScannerIsAuthoritativelyDisabledOrUnconfigured(): bool
    {
        $setting = $this->row('malware_scanner');

        return ! isset($this->unavailable['malware_scanner'])
            && ($setting === null || ! $setting->enabled);
    }

    /**
     * "document_processing" يحمل سياسة تنفيذ اختيارية (مهلات/محاولات) لها افتراضات
     * صلبة في processingPolicy() — لا يحتاج المسار إعداداً غير فارغ ليعمل. التعطيل
     * المعتبر الوحيد صفٌّ صريح `enabled = false`؛ صفٌّ غائب (كإنتاج لم يُهيَّأ بعد)
     * أو قراءة متعذرة ليسا تعطيلاً، فلا يُستعمل فراغ configuration بديلاً عن enabled.
     */
    public function documentProcessingIsAuthoritativelyDisabled(): bool
    {
        $setting = $this->row('document_processing');

        return ! isset($this->unavailable['document_processing'])
            && $setting !== null
            && ! $setting->enabled;
    }

    public function activeProvider(string $key): ?string
    {
        $setting = $this->row($key);
        if ($setting === null || ! $setting->enabled) {
            return null;
        }

        $provider = $setting->provider;

        return is_string($provider) && $provider !== '' ? $provider : null;
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

    /**
     * نمط التنفيذ المخزّن حتى لو كان المحرك متوقفاً. الافتراض الآمن `async`.
     * لا يُقرأ من إعداد المستأجر.
     */
    public function documentProcessingMode(): string
    {
        $setting = $this->row('document_ai');
        $configuration = is_array($setting?->configuration) ? $setting->configuration : [];

        return DocumentExtractionPolicy::normalizeMode($configuration['processing_mode'] ?? null);
    }

    /**
     * تحميل صفوف التكامل مرة واحدة داخل الطلب حتى لا تتكرر قراءات مركز المستندات.
     *
     * @param  list<string>  $keys
     */
    public function prime(array $keys): void
    {
        $this->load($keys);
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

    private function row(string $key): ?PlatformIntegrationSetting
    {
        if (! array_key_exists($key, $this->rows)) {
            $this->load([$key]);
        }

        return $this->rows[$key] ?? null;
    }

    /** @param list<string> $keys */
    private function load(array $keys): void
    {
        $missing = array_values(array_filter(
            $keys,
            fn (string $key): bool => ! array_key_exists($key, $this->rows),
        ));
        if ($missing === []) {
            return;
        }

        try {
            if (! Schema::hasTable('platform_integration_settings')) {
                foreach ($missing as $key) {
                    $this->rows[$key] = null;
                    $this->unavailable[$key] = true;
                }

                return;
            }

            $found = PlatformIntegrationSetting::query()
                ->whereIn('integration_key', $missing)
                ->get()
                ->keyBy('integration_key');
            foreach ($missing as $key) {
                $this->rows[$key] = $found->get($key);
                unset($this->unavailable[$key]);
            }
        } catch (Throwable) {
            foreach ($missing as $key) {
                $this->rows[$key] = null;
                $this->unavailable[$key] = true;
            }
        }
    }
}

<?php

namespace App\Services\DocumentCenter;

final class DocumentExtractionPolicy
{
    public const MODE_SYNC = 'sync';

    public const MODE_ASYNC = 'async';

    /** @param array<string, mixed> $configuration */
    public function __construct(private readonly array $configuration)
    {
    }

    public static function disabled(): self
    {
        return new self([]);
    }

    public static function normalizeMode(mixed $value): string
    {
        return $value === self::MODE_SYNC ? self::MODE_SYNC : self::MODE_ASYNC;
    }

    public function enabled(): bool
    {
        return (bool) ($this->configuration['engine_enabled'] ?? false)
            && $this->primaryProvider() !== null;
    }

    public function processingMode(): string
    {
        return self::normalizeMode($this->configuration['processing_mode'] ?? null);
    }

    public function processesSynchronously(): bool
    {
        return $this->processingMode() === self::MODE_SYNC;
    }

    public function primaryProvider(): ?string
    {
        $provider = $this->configuration['primary_provider'] ?? null;

        return is_string($provider) && $provider !== '' ? $provider : null;
    }

    /** @return list<string> */
    public function orderedProviders(): array
    {
        $primary = $this->primaryProvider();
        if ($primary === null) {
            return [];
        }

        $providers = [$primary];
        if ((bool) ($this->configuration['fallback_enabled'] ?? false)) {
            foreach ($this->configuration['fallback_providers'] ?? [] as $provider) {
                if (is_string($provider) && $provider !== '') {
                    $providers[] = $provider;
                }
            }
        }

        return array_values(array_unique($providers));
    }

    public function provider(string $key): DocumentProviderConfiguration
    {
        $providers = $this->configuration['providers'] ?? [];
        $configuration = is_array($providers) && is_array($providers[$key] ?? null) ? $providers[$key] : [];

        return DocumentProviderConfiguration::fromArray($key, $configuration);
    }

    public function defaultLanguage(): string
    {
        $language = trim((string) ($this->configuration['default_language'] ?? 'ar'));

        return $language === '' ? 'ar' : mb_substr($language, 0, 16);
    }

    public function confidenceThresholdBasisPoints(): int
    {
        $percentage = max(0, min(100, (int) ($this->configuration['confidence_threshold_percent'] ?? 0)));

        return $percentage * 100;
    }

    public function allowsFile(int $sizeBytes, int $pageCount): bool
    {
        $maximumSize = max(1, min(52428800, (int) ($this->configuration['max_file_size_bytes'] ?? 10485760)));
        $maximumPages = max(1, min(1000, (int) ($this->configuration['max_pages_per_file'] ?? 100)));

        return $sizeBytes <= $maximumSize && $pageCount <= $maximumPages;
    }

    public function allowsBatchFileCount(int $count): bool
    {
        $maximum = max(1, min(100, (int) ($this->configuration['max_files_per_batch'] ?? 10)));

        return $count <= $maximum;
    }

    public function testMode(): bool
    {
        return (bool) ($this->configuration['test_mode'] ?? false);
    }
}

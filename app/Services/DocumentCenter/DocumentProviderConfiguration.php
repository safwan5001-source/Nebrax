<?php

namespace App\Services\DocumentCenter;

final class DocumentProviderConfiguration
{
    public function __construct(
        public readonly string $key,
        public readonly bool $enabled,
        public readonly string $apiKey,
        public readonly string $model,
        public readonly int $connectionTimeoutSeconds,
        public readonly int $processingTimeoutSeconds,
        public readonly int $maxAttempts,
        public readonly bool $allowDocumentSending,
        public readonly ?int $monthlyOperationLimit,
        public readonly ?int $monthlyPageLimit,
        public readonly string $dataRegion,
        public readonly string $retentionPolicy,
        public readonly string $lastTestStatus,
        public readonly ?string $lastTestedAt,
        public readonly ?string $lastTestMessageSafe,
    ) {
    }

    /** @param array<string, mixed> $configuration */
    public static function fromArray(string $key, array $configuration): self
    {
        return new self(
            key: $key,
            enabled: (bool) ($configuration['enabled'] ?? false),
            apiKey: (string) ($configuration['api_key'] ?? ''),
            model: (string) ($configuration['model'] ?? ''),
            connectionTimeoutSeconds: self::boundedInt($configuration['connection_timeout_seconds'] ?? 15, 5, 60),
            processingTimeoutSeconds: self::boundedInt($configuration['processing_timeout_seconds'] ?? 90, 15, 180),
            maxAttempts: self::boundedInt($configuration['max_attempts'] ?? 2, 1, 5),
            allowDocumentSending: (bool) ($configuration['allow_document_sending'] ?? false),
            monthlyOperationLimit: self::optionalPositiveInt($configuration['monthly_operation_limit'] ?? null),
            monthlyPageLimit: self::optionalPositiveInt($configuration['monthly_page_limit'] ?? null),
            dataRegion: mb_substr(trim((string) ($configuration['data_region'] ?? '')), 0, 128),
            retentionPolicy: mb_substr(trim((string) ($configuration['retention_policy'] ?? '')), 0, 500),
            lastTestStatus: in_array($configuration['last_test_status'] ?? null, ['passed', 'failed'], true)
                ? (string) $configuration['last_test_status']
                : 'not_tested',
            lastTestedAt: filled($configuration['last_tested_at'] ?? null) ? (string) $configuration['last_tested_at'] : null,
            lastTestMessageSafe: filled($configuration['last_test_message_safe'] ?? null)
                ? mb_substr((string) $configuration['last_test_message_safe'], 0, 500)
                : null,
        );
    }

    public function isOperationallyReady(): bool
    {
        return $this->enabled && $this->allowDocumentSending && $this->apiKey !== '' && $this->model !== '';
    }

    private static function boundedInt(mixed $value, int $minimum, int $maximum): int
    {
        return max($minimum, min($maximum, (int) $value));
    }

    private static function optionalPositiveInt(mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        $number = (int) $value;

        return $number > 0 ? $number : null;
    }
}

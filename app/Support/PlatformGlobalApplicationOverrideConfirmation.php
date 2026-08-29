<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use RuntimeException;

/**
 * تخزين one-time لنتيجة المعاينة وربط apply بها مع فحص stale fingerprint.
 */
class PlatformGlobalApplicationOverrideConfirmation
{
    public const TTL_SECONDS = 900;

    private const CACHE_PREFIX = 'platform_global_application_override:';

    /**
     * @param  array<string, mixed>  $payload
     */
    public static function store(string $confirmationToken, array $payload): void
    {
        Cache::put(self::CACHE_PREFIX . $confirmationToken, $payload, self::TTL_SECONDS);
    }

    /**
     * @param  list<string>|null  $tenantIds
     * @return array<string, mixed>
     */
    public static function consume(
        string $confirmationToken,
        string $administratorId,
        string $operation,
        ?string $applicationKey,
        ?array $tenantIds,
    ): array {
        /** @var array<string, mixed>|null $cached */
        $cached = Cache::pull(self::CACHE_PREFIX . $confirmationToken);
        if ($cached === null) {
            throw new RuntimeException('انتهت صلاحية المعاينة أو استُخدمت مسبقاً.');
        }

        if (($cached['administrator_id'] ?? null) !== $administratorId) {
            throw new RuntimeException('رمز التأكيد لا يطابق مدير المنصة الحالي.');
        }

        if (($cached['operation'] ?? null) !== $operation) {
            throw new RuntimeException('رمز التأكيد لا يطابق العملية المطلوبة.');
        }

        if (($cached['application_key'] ?? null) !== $applicationKey) {
            throw new RuntimeException('رمز التأكيد لا يطابق التطبيق المطلوب.');
        }

        if (! self::tenantScopeMatches($cached['tenant_ids'] ?? null, $tenantIds)) {
            throw new RuntimeException('رمز التأكيد لا يطابق نطاق المستأجرين المطلوب.');
        }

        return $cached;
    }

    /** @param  list<string>|null  $cached @param  list<string>|null  $requested */
    private static function tenantScopeMatches(?array $cached, ?array $requested): bool
    {
        $normalize = static function (?array $ids): ?array {
            if ($ids === null || $ids === []) {
                return null;
            }

            $sorted = array_values($ids);
            sort($sorted);

            return $sorted;
        };

        return $normalize($cached) === $normalize($requested);
    }
}

<?php

namespace App\Support;

use App\Models\PlatformRuntimeHeartbeat;
use Carbon\CarbonImmutable;
use DateTimeInterface;

/**
 * نبضة المجدول (ADR-0004 §5 / D-25): دليل أن `schedule:run` يعمل فعلاً في البيئة، لا افتراضاً من وجود التعريف في
 * `routes/console.php`. الأمر `platform:scheduler-heartbeat` يكتبها كل خمس دقائق عبر خدمة `awj-scheduler`؛ وتُعدّ طازجة
 * ما دامت أحدث من ضعف الفاصل. غير مستأجرية (مكوّن `scheduler` في `platform_runtime_heartbeats`).
 */
final class SchedulerHeartbeat
{
    public const COMPONENT = 'scheduler';

    public const INTERVAL_MINUTES = 5;

    public const MAX_AGE_MINUTES = self::INTERVAL_MINUTES * 2;

    public static function record(): void
    {
        PlatformRuntimeHeartbeat::query()->updateOrCreate(
            ['component' => self::COMPONENT],
            [
                'instance_id' => gethostname() ?: null,
                'status' => 'online',
                'metadata' => ['interval_minutes' => self::INTERVAL_MINUTES],
                'last_seen_at' => now('UTC'),
            ],
        );
    }

    public static function lastSeenAt(): ?CarbonImmutable
    {
        $lastSeen = PlatformRuntimeHeartbeat::query()->where('component', self::COMPONENT)->value('last_seen_at');
        if ($lastSeen === null) {
            return null;
        }

        return $lastSeen instanceof DateTimeInterface
            ? CarbonImmutable::instance($lastSeen)
            : CarbonImmutable::parse((string) $lastSeen, 'UTC');
    }

    public static function isFresh(): bool
    {
        $lastSeen = self::lastSeenAt();

        return $lastSeen !== null && $lastSeen->isAfter(now('UTC')->subMinutes(self::MAX_AGE_MINUTES));
    }
}

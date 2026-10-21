<?php

namespace App\Support;

/**
 * نتيجة محاولة تغيير ضابط تفعيل — REM-18b-3a. `changed = false` ⇒ الحالة المطلوبة قائمة أصلاً (لا صف ولا حدث).
 */
final class ZatcaRolloutChange
{
    public function __construct(
        public readonly bool $changed,
        public readonly bool $previousEnabled,
        public readonly bool $currentEnabled,
        public readonly ?string $eventId,
    ) {}
}

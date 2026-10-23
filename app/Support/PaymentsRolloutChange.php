<?php

namespace App\Support;

/**
 * نتيجة محاولة تغيير ضابط تفعيل — PAY-H1-02. `changed = false` ⇒ الحالة المطلوبة قائمة أصلاً (لا صف ولا حدث).
 */
final class PaymentsRolloutChange
{
    public function __construct(
        public readonly bool $changed,
        public readonly bool $previousEnabled,
        public readonly bool $currentEnabled,
        public readonly ?string $eventId,
    ) {}
}

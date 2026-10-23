<?php

namespace App\Support;

/** نتيجة محاولة تغيير ضابط — IMP-X-01a. `changed = false` ⇒ الحالة المطلوبة قائمة أصلاً (لا صف ولا حدث). */
final class AiActionControlChange
{
    public function __construct(
        public readonly bool $changed,
        public readonly bool $previousEnabled,
        public readonly bool $currentEnabled,
        public readonly ?string $eventId,
    ) {}
}

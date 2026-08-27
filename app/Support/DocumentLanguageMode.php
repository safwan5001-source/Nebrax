<?php

namespace App\Support;

use RuntimeException;

/**
 * عقد أوضاع لغة المستندات القابلة للحفظ داخل مراجعة قالب الطباعة.
 * غياب language_mode من مراجعة تاريخية مقصود ويُفسَّر في الواجهة كسلوك legacy.
 */
final class DocumentLanguageMode
{
    public const ARABIC = 'ar';
    public const ENGLISH = 'en';
    public const BILINGUAL = 'bilingual';

    public const VALUES = [
        self::ARABIC,
        self::ENGLISH,
        self::BILINGUAL,
    ];

    public static function assert(mixed $value): string
    {
        if (! is_string($value) || ! in_array($value, self::VALUES, true)) {
            throw new RuntimeException('وضع لغة المستند غير مدعوم.');
        }

        return $value;
    }
}

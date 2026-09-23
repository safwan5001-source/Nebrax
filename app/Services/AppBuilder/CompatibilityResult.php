<?php

namespace App\Services\AppBuilder;

/**
 * نتيجة `CompatibilityResolver::resolve()` — مطابقة لمفهوم
 * `CompatibilityResult` المختوم (sealed) في Dart، بصيغة PHP بسيطة (لا union
 * types حقيقية): إمّا متوافقة (مع قائمة تجاوزات اختيارية أُسقطت أمناً) أو
 * غير متوافقة (بسببٍ ورسالة). لا شجرة "مُقلَّمة" هنا كما في Dart —
 * `RenderableExperience.pages` غاية عرضية (بناء واجهة فعلية)، والخادم لا
 * يعرض شيئاً؛ مهمّته إجازة/رفض النشر فقط.
 */
final class CompatibilityResult
{
    public const REASON_SCHEMA_VERSION_TOO_NEW = 'schemaVersionTooNew';

    public const REASON_SCHEMA_VERSION_TOO_OLD = 'schemaVersionTooOld';

    public const REASON_RUNTIME_TOO_OLD = 'runtimeTooOld';

    public const REASON_MISSING_REQUIRED_CAPABILITY = 'missingRequiredCapability';

    /**
     * @param  array<int, array{componentId: string, componentType: string, reason: string}>  $fallbacks
     */
    private function __construct(
        public readonly bool $compatible,
        public readonly ?string $reason,
        public readonly ?string $message,
        public readonly array $fallbacks,
    ) {}

    /**
     * @param  array<int, array{componentId: string, componentType: string, reason: string}>  $fallbacks
     */
    public static function compatible(array $fallbacks = []): self
    {
        return new self(true, null, null, $fallbacks);
    }

    public static function incompatible(string $reason, string $message): self
    {
        return new self(false, $reason, $message, []);
    }
}

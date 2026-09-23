<?php

namespace App\Services\AppBuilder;

use App\Models\BuilderDraftExperience;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تحقق سطحي من شكل App Schema — APP-BUILDER-1
 * ═══════════════════════════════════════════════════════════════
 *
 * يتحقق فقط من الشكل الأعلى المطابق لـ`APP_SCHEMA_V1.md` §4 (مفاتيح
 * معروفة، أنواع أساسية، `defaultLocale` ضمن `locales`) — **لا** يتحقق من
 * محتوى `pages`/الإجراءات/الروابط لأن سجلّات المكوّنات/الإجراءات/الموارد
 * (`COMPONENT_REGISTRY_V1`/`ACTION_REGISTRY_V1`/`DATA_RESOURCE_REGISTRY_V1`)
 * لا وجود لها بعد — ذلك التحقق العميق هو APP-BUILDER-2 بالضبط (محقّق
 * التوافق مع سجلّات المكوّنات)، لا إعادة كتابة لهذا الصنف، بل امتداد له.
 *
 * سلطة التحقق الوحيدة قبل الحفظ (Authoring validation) وقبل النشر (Publish
 * validation، أشدّ صراحةً في `APP_SCHEMA_V1.md` §21) — يُستدعى من كلا
 * `BuilderDraftExperienceService::save()` و`BuilderPublishedExperienceVersionService::publish()`.
 */
final class AppSchemaStructuralValidator
{
    /**
     * سقفٌ دفاعي بحت (لا قاعدة عمل) — بلا سجلّات مكوّنات فعلية بعد
     * (APP-BUILDER-3) لا حدّ طبيعي لحجم `pages` سوى هذا. يمنع تخزين/بثّ
     * حمولة ضخمة عبر JSON بلا سبب تجاري يبرره اليوم؛ يُعاد النظر فيه عند
     * وجود شجرة مكوّنات حقيقية لها حدود دلالية أدق.
     */
    private const MAX_SERIALIZED_BYTES = 1_048_576; // 1 MiB

    /**
     * @param  array<string, mixed>  $schema
     *
     * @throws RuntimeException مخطط غير صالح بنيوياً.
     */
    public function validate(array $schema): void
    {
        if (strlen(json_encode($schema) ?: '') > self::MAX_SERIALIZED_BYTES) {
            throw new RuntimeException('حجم مخطط التجربة يتجاوز الحدّ المسموح.');
        }

        $unknown = array_diff(array_keys($schema), BuilderDraftExperience::SCHEMA_KEYS);
        if ($unknown !== []) {
            throw new RuntimeException('مخطط التجربة يحتوي مفاتيح غير معروفة: ' . implode(', ', $unknown));
        }

        if (! isset($schema['schemaVersion']) || ! is_string($schema['schemaVersion']) || $schema['schemaVersion'] === '') {
            throw new RuntimeException('مخطط التجربة يجب أن يحدد schemaVersion.');
        }

        $locales = $schema['locales'] ?? null;
        if (! is_array($locales) || $locales === [] || array_is_list($locales) === false
            || array_filter($locales, static fn ($l) => ! is_string($l) || $l === '') !== []) {
            throw new RuntimeException('مخطط التجربة يجب أن يحدد قائمة locales غير فارغة من نصوص.');
        }

        $defaultLocale = $schema['defaultLocale'] ?? null;
        if (! is_string($defaultLocale) || $defaultLocale === '' || ! in_array($defaultLocale, $locales, true)) {
            throw new RuntimeException('defaultLocale يجب أن يكون ضمن locales المعرَّفة.');
        }

        foreach (['theme', 'navigation', 'metadata'] as $objectKey) {
            if (isset($schema[$objectKey]) && ! is_array($schema[$objectKey])) {
                throw new RuntimeException("الحقل {$objectKey} يجب أن يكون كائناً.");
            }
        }

        foreach (['pages', 'assets'] as $listKey) {
            if (isset($schema[$listKey]) && (! is_array($schema[$listKey]) || array_is_list($schema[$listKey]) === false)) {
                throw new RuntimeException("الحقل {$listKey} يجب أن يكون قائمة.");
            }
        }
    }
}

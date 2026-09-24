<?php

namespace App\Services\AppBuilder;

/**
 * وصف حقل واحد قابل للقراءة ضمن مورد بيانات — يغذّي محرِّر الربط
 * (`APP-BUILDER-15`) ويُستهلَك عند التحقّق من `itemProps` في وقت النشر
 * (`APP-BUILDER-14`، `CompatibilityResolver`): مفتاح `itemProps` غير موجود في
 * `readableFields()` لموردٍ معيّن يُرفَض هناك — لا يُتحقَّق هنا.
 *
 * `localized: true` يعني وجود حقلين شقيقين `key`/`key_en` على الاستجابة
 * الحقيقية (مطابقةً لِـ`name`/`name_en` في `commerce/v1`) — العميل يختار
 * أيّهما يعرض؛ لا تفاوض `Accept-Language` على مستوى الحقل نفسه اليوم.
 */
final class ResourceFieldDefinition
{
    public function __construct(
        public readonly string $key,
        public readonly string $type,
        public readonly bool $localized = false,
        public readonly string $notes = '',
    ) {}
}

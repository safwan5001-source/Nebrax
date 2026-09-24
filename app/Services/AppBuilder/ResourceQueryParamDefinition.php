<?php

namespace App\Services\AppBuilder;

/**
 * وصف معامل استعلام واحد (ترشيح أو فرز) مسموح به فعلياً على مورد بيانات —
 * منسوخ حرفياً من قيد الخادم الحقيقي (مثال: `CommerceProductController::SORTS`)،
 * لا مُخترَع. أي مفتاح `query` في `binding` (`APP-BUILDER-14`) غير موجود ضمن
 * `ResourceDefinition::$filters`/`$sorts` لموردٍ معيّن يُرفَض وقت النشر — لا
 * يمرَّر كنص حرّ إلى `commerce/v1` أبداً.
 */
final class ResourceQueryParamDefinition
{
    public const KIND_FILTER = 'filter';

    public const KIND_SORT = 'sort';

    public function __construct(
        public readonly string $key,
        public readonly string $kind,
        public readonly string $notes = '',
    ) {}
}

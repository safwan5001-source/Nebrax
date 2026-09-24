<?php

namespace App\Services\AppBuilder;

/**
 * أنواع حقول موارد البيانات (`ResourceDefinition::$fields`) — تصف شكل ما
 * يعيده فعلياً `commerce/v1` (`StorefrontCategoryResource`,
 * `StorefrontProductResource`, `CommerceCartService::serialize()`), لا شكلاً
 * مُتخيَّلاً. القائمة هنا تذكر فقط الأنواع التي شهدتها استجابات `commerce/v1`
 * الثلاث المرصودة اليوم (categories/products/cart) — توسيعها لاحقاً قرارٌ
 * يقتضي دليلاً جديداً، تماماً كقيد `PropType`.
 */
final class ResourceFieldType
{
    private function __construct() {}

    /** معرّف UUID. */
    public const ID = 'id';

    /** نص عادٍ. */
    public const STRING = 'string';

    /** قيمة منطقية قد تكون `null` (مثال: `in_stock` حين لا توجد سياسة تجهيز). */
    public const NULLABLE_BOOLEAN = 'nullableBoolean';

    /** عدد صحيح عام. */
    public const INTEGER = 'integer';

    /** كائن نقدي `{amount_minor:int, currency:string}` — الهللات دوماً، أبداً float. */
    public const MONEY = 'money';

    /** كائن متداخل بحقول ثابتة (مثال: `category:{id,name}`). */
    public const OBJECT = 'object';

    /** مصفوفة كائنات من نفس الشكل (مثال: `items`, `variants`, `options`). */
    public const LIST = 'list';

    /** طابع زمني ISO 8601. */
    public const TIMESTAMP = 'timestamp';
}

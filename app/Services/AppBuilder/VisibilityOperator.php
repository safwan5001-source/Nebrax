<?php

namespace App\Services\AppBuilder;

/**
 * مُشغّلات مقارنة `visibility` المسموحة — مجموعة مُعرَّفة ومغلقة، لا محرّك
 * تعابير عام (`ADR-01`). كل مُشغّل يفرض شكل `value` الخاص به: `isTrue`/`isFalse`
 * يرفضان `value` إطلاقاً، `in` يشترط قائمة سكالرات غير فارغة، البقية يشترط
 * سكالراً واحداً بالضبط — يتحقّق منه `CompatibilityResolver` عند التحليل
 * الدلالي، لا هنا (هذا الصنف قاموس هويات فقط، تماماً كـ`ResourceQueryParamDefinition`).
 */
final class VisibilityOperator
{
    private function __construct() {}

    public const EQUALS = 'equals';

    public const NOT_EQUALS = 'notEquals';

    public const GREATER_THAN = 'gt';

    public const LESS_THAN = 'lt';

    public const GREATER_THAN_OR_EQUAL = 'gte';

    public const LESS_THAN_OR_EQUAL = 'lte';

    public const IN = 'in';

    public const IS_TRUE = 'isTrue';

    public const IS_FALSE = 'isFalse';

    /** @var array<int, string> */
    public const ALL = [
        self::EQUALS, self::NOT_EQUALS,
        self::GREATER_THAN, self::LESS_THAN, self::GREATER_THAN_OR_EQUAL, self::LESS_THAN_OR_EQUAL,
        self::IN, self::IS_TRUE, self::IS_FALSE,
    ];

    /** @var array<int, string> لا يقبل `value` إطلاقاً. */
    public const NO_VALUE = [self::IS_TRUE, self::IS_FALSE];

    /** @var array<int, string> يشترط `value` قائمة سكالرات غير فارغة. */
    public const LIST_VALUE = [self::IN];
}

<?php

namespace App\Services\AppBuilder;

/**
 * البيان الوصفي الكامل لمورد بيانات واحد قابل للربط من App Schema
 * (`ADR-01`, `APP-BUILDER-13`). كل حقل هنا مُستخرَج من قراءة مباشرة لمتحكّم
 * `commerce/v1` الحقيقي المسؤول عنه — لا من وثيقة توضيحية.
 *
 * وصفي بحت هنا: لا يغيّر هذا الصنف سلوك أي شيء وحده. `APP-BUILDER-14` يستهلكه
 * في `CompatibilityResolver` للتحقّق من هوية المورد + حقول `itemProps` +
 * معاملات `query` وقت النشر، ومحرِّر الربط (`APP-BUILDER-15`) يستهلكه لعرض
 * الخيارات المتاحة للتاجر.
 *
 * **النطاق مقفل عمداً على `commerce/v1`** (`ADR-01` §١) — ليس `store/v1` ولا
 * `storefront/` (متجر Spree الانتقالي). موارد بيانات العميل
 * (`commerce.customer.profile`/`commerce.orders`) مُستبعدة صراحةً من V1
 * (نقطة القرار الثانية) لعدم وجود شاشة دخول في تطبيق الجوال بعد.
 */
final class ResourceDefinition
{
    public const SHAPE_LIST = 'list';

    public const SHAPE_SINGLE = 'single';

    public const AUTH_STORE_BEARER = 'storeBearer';

    public const AUTH_STORE_BEARER_AND_CART_TOKEN = 'storeBearer+cartToken';

    /**
     * @param  array<int, ResourceFieldDefinition>  $fields  الحقول القابلة للقراءة (تُستهلك بواسطة `itemProps`).
     * @param  array<int, ResourceQueryParamDefinition>  $queryParams  معاملات الترشيح/الفرز المسموحة فعلياً في `binding.query`.
     */
    public function __construct(
        public readonly string $id,
        public readonly int $version,
        public readonly string $apiSurface,
        public readonly string $listEndpoint,
        public readonly ?string $detailEndpoint,
        public readonly string $shape,
        public readonly array $fields,
        public readonly array $queryParams,
        public readonly bool $paginated,
        public readonly string $auth,
        public readonly string $notes,
    ) {}

    /** @return array<int, string> مفاتيح الحقول القابلة للقراءة فقط، لتحقّق `itemProps` السريع. */
    public function readableFieldKeys(): array
    {
        return array_map(fn (ResourceFieldDefinition $field) => $field->key, $this->fields);
    }

    /**
     * نوع حقل معلَن بمفتاحه المباشر (`ResourceFieldType::*`)، أو `null` إن لم
     * يكن هذا الحقل معلَناً إطلاقاً — يستعمله `CompatibilityResolver::bindingSupported()`
     * للتحقّق من أن هدف `binding.collect` هو تحديداً حقل `LIST` (`APP-BUILDER-17`
     * slice 3)، لا أي حقل قابل للقراءة عشوائياً.
     */
    public function fieldType(string $key): ?string
    {
        foreach ($this->fields as $field) {
            if ($field->key === $key) {
                return $field->type;
            }
        }

        return null;
    }

    /** @return array<int, string> مفاتيح الترشيح المسموحة في `binding.query`. */
    public function filterKeys(): array
    {
        return array_map(
            fn (ResourceQueryParamDefinition $param) => $param->key,
            array_values(array_filter($this->queryParams, fn (ResourceQueryParamDefinition $p) => $p->kind === ResourceQueryParamDefinition::KIND_FILTER)),
        );
    }

    /** @return array<int, string> مفاتيح الفرز المسموحة (بلا بادئة `-` — الاتجاه العكسي مسموح دوماً لكل مفتاح مسموح). */
    public function sortKeys(): array
    {
        return array_map(
            fn (ResourceQueryParamDefinition $param) => $param->key,
            array_values(array_filter($this->queryParams, fn (ResourceQueryParamDefinition $p) => $p->kind === ResourceQueryParamDefinition::KIND_SORT)),
        );
    }
}

<?php

namespace App\Services\AppBuilder;

/**
 * ═══════════════════════════════════════════════════════════════
 *  سجلّ موارد البيانات — مُعبَّأ V1 (APP-BUILDER-13، بموجب ADR-01)
 * ═══════════════════════════════════════════════════════════════
 *
 * كان هذا السجلّ فارغاً عمداً منذ APP-BUILDER-3 لغياب عقد ربط حقيقي في
 * المخطط ولغياب دليل جاهزية API. بعد `AWJ_APP_BUILDER_COMMERCE_RUNTIME_V1_EVIDENCE.md`
 * والموافقة على `ADR-01`، يُقفَل هنا **نطاق V1 الثلاثي فقط**، مربوطاً حصراً
 * بسطح `commerce/v1` الحقيقي (لا `store/v1`، ولا متجر Spree الانتقالي
 * `storefront/`) — كل حقل/معامل مذكور هنا مُستخرَج من قراءة مباشرة للمتحكّم
 * المسؤول، لا من تخمين:
 *
 * - `commerce.categories` ← `CommerceCategoryController` (`GET commerce/v1/categories[/{id}]`).
 *   **بلا ترقيم صفحات وبلا `name_en`** — كلاهما غياب حقيقي في الاستجابة اليوم
 *   (`StorefrontCategoryResource::toArray()`)، لا نقصٌ سهواً هنا.
 * - `commerce.products` ← `CommerceProductController` (`GET commerce/v1/products[/{id}]`).
 *   الترشيح/الفرز مطابقان حرفياً لِـ`CommerceProductController::SORTS` وقائمة
 *   `$filters` المتحقَّقة فعلياً — لا حقل واحد إضافي.
 * - `commerce.cart` ← `CommerceCartController::show()` عبر `CommerceCartService::serialize()`
 *   (`GET commerce/v1/cart`). بلا معرّف مسار (سلّة "الحالي" وحدها)، بلا ترشيح/فرز.
 *
 * **مُستبعَد عمداً من V1** (نقطة القرار الثانية في `ADR-01`): `commerce.customer.profile`
 * و`commerce.orders` — endpoints حقيقية موجودة (`CommerceCustomerAuthController`,
 * `CommerceOrderController`) لكن لا شاشة دخول موصولة في `mobile/` بعد؛ ربطها
 * اليوم كان سيكون افتراضياً بلا سياق تشغيلي حقيقي. `commerce.promotions` غير
 * موجود إطلاقاً كمورد خلفي — لا endpoint له على `commerce/v1` اليوم.
 *
 * `RESOURCES` (هوية + إصدار) يوازي نمط `RuntimeCapabilities::COMPONENTS`/`ACTIONS`.
 * **هذا الصنف نفسه لا يمثّل ما يستهلكه التشغيل المُثبَت فعلياً** — ذلك حصراً
 * `RuntimeCapabilities::DATA_RESOURCES` (`APP-BUILDER-17`)، الذي يقتصر اليوم
 * على `commerce.products`/`commerce.cart` فقط رغم أن هذا السجلّ يعرف
 * `commerce.categories` أيضاً بنيوياً — فجوةٌ مقصودة لا سهو: معرفة الخادم
 * بمورد لا تعني تلقائياً أن أي بناء جوال مُثبَت يعرضه.
 */
final class DataResourceRegistry
{
    private function __construct() {}

    /** @var array<string, int> */
    public const RESOURCES = [
        'commerce.categories' => 1,
        'commerce.products' => 1,
        'commerce.cart' => 1,
    ];

    /**
     * @return array<string, ResourceDefinition>
     */
    public static function definitions(): array
    {
        $definitions = [
            new ResourceDefinition(
                id: 'commerce.categories',
                version: 1,
                apiSurface: 'commerce/v1',
                listEndpoint: 'commerce/v1/categories',
                detailEndpoint: 'commerce/v1/categories/{id}',
                shape: ResourceDefinition::SHAPE_LIST,
                fields: [
                    new ResourceFieldDefinition('id', ResourceFieldType::ID),
                    new ResourceFieldDefinition('name', ResourceFieldType::STRING, notes: 'لا حقل `name_en` اليوم — فجوة حقيقية مؤكَّدة، لا يُخترَع بديل عنها.'),
                    new ResourceFieldDefinition('description', ResourceFieldType::STRING, notes: 'قد تكون `null`.'),
                    new ResourceFieldDefinition('color', ResourceFieldType::STRING, notes: 'قد تكون `null`.'),
                    new ResourceFieldDefinition('parent_id', ResourceFieldType::ID, notes: 'قد تكون `null` للتصنيف الجذري.'),
                ],
                queryParams: [],
                paginated: false,
                auth: ResourceDefinition::AUTH_STORE_BEARER,
                notes: 'شجرة كاملة بعمق ثابت (حتى مستويين) بلا ترقيم صفحات ولا ترشيح/فرز — القائمة تُرجِع كل التصنيفات الجذرية المنشورة على قناة الجوال المحلولة.',
            ),
            new ResourceDefinition(
                id: 'commerce.products',
                version: 1,
                apiSurface: 'commerce/v1',
                listEndpoint: 'commerce/v1/products',
                detailEndpoint: 'commerce/v1/products/{id}',
                shape: ResourceDefinition::SHAPE_LIST,
                fields: [
                    new ResourceFieldDefinition('id', ResourceFieldType::ID),
                    new ResourceFieldDefinition('name', ResourceFieldType::STRING, localized: true),
                    new ResourceFieldDefinition('description', ResourceFieldType::STRING, notes: 'قد تكون `null`.'),
                    new ResourceFieldDefinition('sku', ResourceFieldType::STRING, notes: 'قد تكون `null`.'),
                    new ResourceFieldDefinition('category', ResourceFieldType::OBJECT, notes: '`{id, name}` أو `null` — بلا `name_en` (نفس فجوة `commerce.categories`).'),
                    new ResourceFieldDefinition('price', ResourceFieldType::MONEY, notes: '`{amount_minor, currency}` — محسوبة دوماً عبر `CommercePriceResolver`، أبداً عمود خام.'),
                    new ResourceFieldDefinition('in_stock', ResourceFieldType::NULLABLE_BOOLEAN, notes: '`null` يعني "غير معروف" (لا سياسة تجهيز مضبوطة على القناة) — أبداً `false` كاذبة.'),
                    new ResourceFieldDefinition('thumbnail_url', ResourceFieldType::STRING, notes: 'قد تكون `null`.'),
                    new ResourceFieldDefinition('media', ResourceFieldType::LIST, notes: 'التفاصيل فقط (`GET .../{id}`) — غائب في عنصر القائمة.'),
                    new ResourceFieldDefinition('is_variant_managed', ResourceFieldType::NULLABLE_BOOLEAN),
                    new ResourceFieldDefinition('options', ResourceFieldType::LIST, notes: 'التفاصيل فقط، ومنتج بمتغيّرات فقط — `null` لغيره.'),
                    new ResourceFieldDefinition('variants', ResourceFieldType::LIST, notes: 'التفاصيل فقط، ومنتج بمتغيّرات فقط — `null` لغيره.'),
                    new ResourceFieldDefinition('created_at', ResourceFieldType::TIMESTAMP),
                    new ResourceFieldDefinition('updated_at', ResourceFieldType::TIMESTAMP),
                ],
                queryParams: [
                    new ResourceQueryParamDefinition('search', ResourceQueryParamDefinition::KIND_FILTER, 'مطابقة `LIKE` على `name`/`name_en`/`sku` — نص حرّ للمستخدم النهائي، لا للتاجر وقت النشر.'),
                    new ResourceQueryParamDefinition('category_id', ResourceQueryParamDefinition::KIND_FILTER, 'UUID تصنيف — القيمة الوحيدة المسموحة عبر مرجع سياق مُعِدّ سلفاً (`$route.categoryId`)، لا نص حرّ (APP-BUILDER-14).'),
                    new ResourceQueryParamDefinition('name', ResourceQueryParamDefinition::KIND_SORT, 'يطابق `CommerceProductController::SORTS[\'name\']` حرفياً.'),
                    new ResourceQueryParamDefinition('sale_price', ResourceQueryParamDefinition::KIND_SORT, 'يطابق `CommerceProductController::SORTS[\'sale_price\']` حرفياً.'),
                    new ResourceQueryParamDefinition('created_at', ResourceQueryParamDefinition::KIND_SORT, 'يطابق `CommerceProductController::SORTS[\'created_at\']` حرفياً. الاتجاه العكسي عبر بادئة `-` (مثال: `-created_at`).'),
                ],
                paginated: true,
                auth: ResourceDefinition::AUTH_STORE_BEARER,
                notes: '`page`/`per_page` (الحدّ الأقصى 100) — يطابق `PublicApiController::perPage()` حرفياً.',
            ),
            new ResourceDefinition(
                id: 'commerce.cart',
                version: 1,
                apiSurface: 'commerce/v1',
                listEndpoint: 'commerce/v1/cart',
                detailEndpoint: null,
                shape: ResourceDefinition::SHAPE_SINGLE,
                fields: [
                    new ResourceFieldDefinition('status', ResourceFieldType::STRING),
                    new ResourceFieldDefinition('items', ResourceFieldType::LIST, notes: 'كل عنصر: `id, product_id, product_variant_id, variant_descriptor, product_name, unit_key, unit_name, quantity, unit_price{amount_minor,currency}, line_total{amount_minor,currency}, available`.'),
                    new ResourceFieldDefinition('subtotal', ResourceFieldType::MONEY),
                    new ResourceFieldDefinition('currency', ResourceFieldType::STRING),
                    new ResourceFieldDefinition('has_unavailable_items', ResourceFieldType::NULLABLE_BOOLEAN),
                ],
                queryParams: [],
                paginated: false,
                auth: ResourceDefinition::AUTH_STORE_BEARER_AND_CART_TOKEN,
                notes: 'سلّة "الحالي" وحدها — لا معرّف مسار، لا ترشيح/فرز. هوية السلّة الضيف تنتقل عبر ترويسة `X-Cart-Token` منفصلة عن حامل المتجر.',
            ),
        ];

        $byId = [];
        foreach ($definitions as $definition) {
            $byId[$definition->id] = $definition;
        }

        return $byId;
    }
}

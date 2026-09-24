<?php

namespace App\Services\AppBuilder;

/**
 * إشارات `visibility` المسموحة — مجموعة مُعرَّفة ومغلقة، لا امتداد حرّ. كل
 * إشارة تعكس حالة سياق حقيقية (سلّة، عميل، منتج) يحلّها وقت التشغيل — لا
 * تعبيراً حرّاً ولا مساراً للوصول إلى أي بيانات خارج هذه القائمة (`ADR-01`).
 *
 * توسيعها لاحقاً (مثال: قراءة حقل من عنصر مربوط) قرارٌ منفصل يقتضي دليلاً
 * جديداً على كيفية تمرير سياق العنصر الحالي إلى شجرة الشروط — لا يُخترَع هنا.
 */
final class VisibilitySignal
{
    private function __construct() {}

    /** عدد عناصر السلّة الحالية — عدد صحيح. */
    public const CART_ITEM_COUNT = 'cart.itemCount';

    /** هل يوجد عميل مصادَق عليه (`X-Customer-Token` صالح) — منطقية. */
    public const CUSTOMER_IS_AUTHENTICATED = 'customer.isAuthenticated';

    /** توفّر المنتج الحالي — منطقية قابلة لـ`null` (نفس دلالة `in_stock` في `commerce/v1`: `null` يعني غير معروف). */
    public const PRODUCT_IN_STOCK = 'product.inStock';

    /** @var array<int, string> */
    public const ALL = [
        self::CART_ITEM_COUNT,
        self::CUSTOMER_IS_AUTHENTICATED,
        self::PRODUCT_IN_STOCK,
    ];
}

<?php

namespace App\Services\Commerce;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\StorefrontOffer;

/**
 * CUST-H4-6 — نتيجة تقييم مرشّح عرضٍ واحد (قراءة فقط). `live = true` يعني أن
 * المرشّح يظهر علناً الآن: ضمن نافذته، منتجه نشطٌ ومنشورٌ على قناة المتجر، وله
 * خصمٌ حقيقي من سلطة التسعير. وإلا `reason` يشرح سبب الحجب للمساحة الإدارية
 * فقط — القراءة العامة لا ترى إلا المرشّحات الحيّة ولا تكشف أسباباً أبداً.
 *
 * الأسعار بالهللات (`int`)، والعملة هي `Tenant.currency` نفسها. `discountPercent`
 * مشتقٌّ طازج من الرقمين (`StorefrontOfferResolver::discountPercent()`)، لا يُخزَّن،
 * وهو `null` لغير الحيّ. لا مبلغ وفرٍ ولا سعر مشطوب.
 */
final readonly class StorefrontOfferView
{
    public function __construct(
        public StorefrontOffer $offer,
        public ?Product $product,
        public bool $live,
        public ?string $reason,
        public ?int $referencePrice,
        public ?int $offerPrice,
        public ?string $currency,
        public ?ProductMedia $thumbnail,
        public ?int $discountPercent = null,
    ) {}
}

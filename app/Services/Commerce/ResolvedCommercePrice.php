<?php

namespace App\Services\Commerce;

/**
 * لقطة قراءة واحدة لنتيجة حسم سعر Commerce — اقتراح تجاري، لا حقيقة مالية.
 * هذا **ليس** سطر فاتورة ولا قيداً محاسبياً؛ سطر الفاتورة يبقى مصدر الحقيقة
 * التاريخي بعد دخول المسار المالي القائم (`InvoiceService::applyItemsAndTotals()`).
 *
 * `amount` بالهللات (minor units) مطابقاً لدقة النقود في كل أَوْج — لا float.
 * `resolved = false` يعني «لا سعر قابل للحسم» (وحدة بديلة بلا سعرٍ صريح في
 * قائمة الأسعار)، وهي حالة مختلفة تماماً عن `amount = 0` (سعرٌ صفريٌّ حقيقي
 * مُقرَّر عمداً على المنتج أو في القائمة).
 */
final readonly class ResolvedCommercePrice
{
    public const SOURCE_PRICE_LIST = 'price_list';

    public const SOURCE_PRODUCT_DEFAULT = 'product_default';

    public const SOURCE_NONE = 'none';

    public function __construct(
        public bool $resolved,
        public ?int $amount,
        public string $currency,
        public string $source,
        public ?string $priceListId,
        public ?string $unitName,
        public ?int $minSalePrice,
    ) {}

    /**
     * H6 Batch F — the list that actually SUPPLIED the price. `priceListId` is the list that was consulted;
     * when it had no item for the product/unit the price falls back to the product default and no list
     * supplied it, so persisted provenance must not name one.
     */
    public function provenanceListId(): ?string
    {
        return $this->source === self::SOURCE_PRICE_LIST ? $this->priceListId : null;
    }
}

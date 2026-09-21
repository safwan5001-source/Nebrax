<?php

namespace App\Support;

use App\Models\Product;
use App\Models\ProductVariant;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  محلِّل هويّة المتغيّر لسطر المستند — نقطة القرار الوحيدة (VAR-DOC-1)
 * ═══════════════════════════════════════════════════════════════
 *  كل خدمة مستندٍ (فاتورة/مشترى/مرتجع/عرض سعر/إشعار دائن/فاتورة متكررة/
 *  مستند توريد/سند تسليم) تستدعي `resolve()` قبل إنشاء أي سطر، بدل تكرار
 *  نفس التحقّق ثماني مرّات. **مبدأٌ واحد لا يُستثنى:** منتجٌ بسيطٌ لا يقبل
 *  `product_variant_id`، ومنتجٌ متعدد الخيارات **يلزمه** متغيّرٌ فعلي — لا
 *  مسار بيع/شراء غامض على الأب مهما كان نوع المستند (Fail closed حرفياً).
 *
 *  `descriptor()` يبني لقطةً حتميةً من نفس ترتيب الخيارات المعتمد في
 *  `ProductMediaGalleryService::resolveGallery()` (VAR-MEDIA-1) — لا نسخة
 *  ثانية من منطق الترتيب: `(option.sort_order, value.sort_order)`.
 */
final class DocumentLineVariantResolver
{
    /**
     * يتحقّق من: تطابق تصنيف المنتج (بسيط ⇔ null، متعدد الخيارات ⇔ متغيّرٌ
     * إلزامي)، انتماء المتغيّر لهذا المنتج بعينه، تطابق المستأجر، وصلاحية
     * المتغيّر للاستخدام التجاري (نشِط). لا يثق بـ`tenant_id` من العميل أبداً
     * — المقارنة دوماً مع `$tenantId` الممرَّر من السياق الخادميّ النشط.
     */
    public static function resolve(Product $product, ?string $variantId, string $tenantId): ?ProductVariant
    {
        if ($product->tenant_id !== $tenantId) {
            throw new RuntimeException('تعارض عزل مستأجر: المنتج لا يخصّ هذا المستأجر.');
        }

        if ($variantId === null) {
            if ($product->isVariantManaged()) {
                throw new RuntimeException('هذا المنتج متعدد الخيارات — يجب تحديد المتغيّر الفعلي، لا الأب.');
            }

            return null;
        }

        if (! $product->isVariantManaged()) {
            throw new RuntimeException('هذا منتجٌ بسيط ولا يقبل تحديد متغيّر.');
        }

        $variant = ProductVariant::find($variantId);

        if ($variant === null || $variant->product_id !== $product->id) {
            throw new RuntimeException('المتغيّر المحدَّد لا يتبع هذا المنتج.');
        }

        if ($variant->tenant_id !== $tenantId) {
            throw new RuntimeException('تعارض عزل مستأجر بين المنتج والمتغيّر.');
        }

        if (! $variant->is_active) {
            throw new RuntimeException('هذا المتغيّر معطَّل ولا يصلح للاستخدام التجاري.');
        }

        return $variant;
    }

    /**
     * لقطةٌ نصّية حتمية «أسود / كبير» — لا تُخزَّن هويّة القيم، فلا حاجة
     * لإعادة اشتقاقها من متغيّرٍ حيّ عند عرض مستندٍ مرحَّل/مجمَّد لاحقاً.
     */
    public static function descriptor(ProductVariant $variant): ?string
    {
        return self::formatDescriptor($variant->optionValues()->with('option')->get());
    }

    /**
     * مسار كتالوج POS المحمّل مسبقاً فقط: لا يعامل علاقة غير محمّلة أو خياراً
     * غير محمّل كبيانات مكتملة، بل يعود حرفياً إلى المصدر الاستعلامي المعتاد.
     */
    public static function descriptorFromLoadedOptionValues(ProductVariant $variant): ?string
    {
        if (! $variant->relationLoaded('optionValues')) {
            return self::descriptor($variant);
        }

        $values = $variant->getRelation('optionValues');
        if (! $values->every(fn ($value) => $value->relationLoaded('option'))) {
            return self::descriptor($variant);
        }

        return self::formatDescriptor($values);
    }

    private static function formatDescriptor($values): ?string
    {
        $names = $values
            ->sortBy(fn ($value) => [(int) ($value->option->sort_order ?? 0), (int) $value->sort_order])
            ->pluck('value')
            ->filter(fn ($value) => $value !== null && $value !== '')
            ->values()
            ->all();

        return $names === [] ? null : implode(' / ', $names);
    }
}

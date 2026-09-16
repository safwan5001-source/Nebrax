<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductVariant;
use Illuminate\Support\Collection;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProductMediaGalleryService — حلّ المعرض الموحّد (VAR-MEDIA-1)
 * ═══════════════════════════════════════════════════════════════
 *  المصدر الوحيد لترتيب/حسم معرض الوسائط — لا يُعاد تنفيذ هذا المنطق في أي
 *  متحكّم (العقد: «لا تكرار قواعد الحلّ عبر المتحكّمات»).
 *
 *  ═══ الخوارزمية (حتمية، بلا اعتمادٍ على ترتيب الصفوف العرضي) ═══
 *  1. وسائط المنتج المشتركة (بلا قيمة خيارٍ ولا متغيّر) — بترتيب `sort_order`
 *     ثم `created_at` ثم `id` كحاسمٍ نهائي مستقر.
 *  2. إن مُرِّر متغيّرٌ: وسائط قيم خياراته المختارة، **بترتيب الخيار الأصلي
 *     على المنتج** (`ProductOption.sort_order`) لا ترتيب إدراج الجدول
 *     الوسيط — كل قيمةٍ بترتيبها الداخلي نفسه (1) بعدها.
 *  3. إن مُرِّر متغيّرٌ: وسائط المتغيّر الحصرية نفسه، بنفس الترتيب الداخلي.
 *
 *  **الغلاف** ليس عموداً منفصلاً — هو ببساطة **أوّل عنصرٍ في هذا المعرض
 *  المحلول**، بنفس العرف القائم فعلياً قبل هذا المعيار (كل استهلاكٍ سابق كان
 *  يأخذ «أوّل صفٍّ بترتيب sort_order») — مُوحَّدٌ الآن في مكانٍ واحد، لا سلطة
 *  غلافٍ ثانية.
 *
 *  **تفريغ التكرار**: دفاعٌ في العمق فقط — بنية النطاقات الحصرية (٣ نطاقاتٍ
 *  متمايزة تماماً، مفروضة في `ProductMedia::booted()`) تمنع ظهور نفس الصفّ
 *  عبر أكثر من مسارٍ بنيوياً، فلا تكرار حقيقي متوقَّع؛ إزالة التكرار هنا
 *  بمعرّف الصفّ (لا اسم الملف ولا الرابط) تحصينٌ إضافي لا أكثر.
 *
 *  منتجٌ بسيط (`$variant = null`): تكافئ تماماً السلوك القائم قبل هذا
 *  المعيار — وسائط المنتج فقط، بلا أي تغيير.
 */
class ProductMediaGalleryService
{
    /** @return Collection<int, ProductMedia> */
    public function resolveGallery(Product $product, ?ProductVariant $variant = null): Collection
    {
        $items = collect();

        $items = $items->concat(
            ProductMedia::where('product_id', $product->id)
                ->whereNull('product_option_value_id')
                ->whereNull('product_variant_id')
                ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
                ->get()
        );

        if ($variant !== null) {
            $orderedValues = self::sortedOptionValues($variant->optionValues()->with('option')->get());

            foreach ($orderedValues as $value) {
                $items = $items->concat(
                    ProductMedia::where('product_option_value_id', $value->id)
                        ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
                        ->get()
                );
            }

            $items = $items->concat(
                ProductMedia::where('product_variant_id', $variant->id)
                    ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
                    ->get()
            );
        }

        return $items->unique('id')->values();
    }

    public function resolveCover(Product $product, ?ProductVariant $variant = null): ?ProductMedia
    {
        return $this->resolveGallery($product, $variant)->first();
    }

    /**
     * إصدارٌ مُجمَّع (batched) من resolveCover() — لكتالوج POS تحديداً
     * (VAR-FU-5/GAP-06)، حيث استدعاء resolveCover() لكل متغيّرٍ على حدة يفتح
     * حتى ٣ استعلاماتٍ × عدد المتغيّرات. يطابق خوارزمية resolveGallery()
     * حرفياً (الطبقات الثلاث بنفس الترتيب) — لا سلطة موازية، فقط دفعتان
     * إضافيتان بدل استعلامٍ لكل متغيّر.
     *
     * الشرط: `$variants` يجب أن تحمل `optionValues.option` محمَّلةً سلفاً
     * (eager)، و`$sharedMediaByProduct` مُمرَّرة جاهزة (من علاقة
     * `Product::media()` المحمَّلة سلفاً في المستدعي، بنفس ترتيبها) بدل
     * إعادة استعلامها هنا — فيتطابق غلاف أي متغيّرٍ يسقط للوسائط المشتركة مع
     * `pos_image` الأب نفسه حرفياً، لا استعلاماً مستقلاً قد ينحرف ترتيبه.
     *
     * يطابق تصفية الصورة الفعلية في `ProductResource::pos_image` (أول عنصرٍ
     * mime-type يبدأ بـ`image/`) — لا `first()` خام قد يلتقط ملف مستندٍ.
     *
     * @param  Collection<int, ProductVariant>  $variants
     * @param  Collection<string, Collection<int, ProductMedia>>  $sharedMediaByProduct  مفتاحها product_id
     * @return array<string, ?ProductMedia> مفتاحها product_variant_id
     */
    public function resolveCoversForVariants(Collection $variants, Collection $sharedMediaByProduct): array
    {
        if ($variants->isEmpty()) {
            return [];
        }

        $isImage = fn (ProductMedia $item): bool => str_starts_with((string) $item->mime_type, 'image/');

        $optionValueIds = $variants->flatMap(fn (ProductVariant $v) => $v->optionValues->pluck('id'))->unique()->values();
        $optionMediaByValue = $optionValueIds->isEmpty() ? collect() : ProductMedia::whereIn('product_option_value_id', $optionValueIds)
            ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
            ->get()->groupBy('product_option_value_id');

        $variantMediaByVariant = ProductMedia::whereIn('product_variant_id', $variants->pluck('id'))
            ->orderBy('sort_order')->orderBy('created_at')->orderBy('id')
            ->get()->groupBy('product_variant_id');

        $covers = [];
        foreach ($variants as $variant) {
            $cover = $sharedMediaByProduct->get($variant->product_id, collect())->first($isImage);

            if ($cover === null) {
                foreach (self::sortedOptionValues($variant->optionValues) as $value) {
                    $cover = $optionMediaByValue->get($value->id, collect())->first($isImage);
                    if ($cover !== null) {
                        break;
                    }
                }
            }

            $covers[$variant->id] = $cover ?? $variantMediaByVariant->get($variant->id, collect())->first($isImage);
        }

        return $covers;
    }

    /** @param  Collection<int, \App\Models\ProductOptionValue>  $values */
    private static function sortedOptionValues(Collection $values): Collection
    {
        return $values
            ->sortBy(fn ($value) => [(int) ($value->option->sort_order ?? 0), (int) $value->sort_order])
            ->values();
    }
}

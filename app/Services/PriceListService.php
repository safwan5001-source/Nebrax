<?php

namespace App\Services;

use App\Models\PriceList;
use App\Models\PriceListItem;
use App\Models\Product;
use App\Services\Accounting\UnitConversion;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * إدارة وحلّ قوائم السعر اليدوية. لا تعيد حساب فاتورة ولا تعدّل سطرها: القائمة
 * تقترح سعراً قبل الحفظ، وسطر الفاتورة يبقى مصدر حقيقة المبلغ التاريخي.
 */
class PriceListService
{
    public function __construct(protected UnitConversion $units) {}

    /**
     * يعيد سعر القائمة بالهللات أو null حين لا يملك المنتج/الوحدة عنصراً فيها.
     * لا يوجد ضبط نسبة أو float: كل قائمة تسجل سعراً صريحاً لكل وحدة.
     *
     * `$lock` اختياريٌ (افتراضه `false`، بلا أثر على الاستدعاءات القائمة):
     * يفعّله فقط مسارٌ يكتب أثراً بناءً على هذا السعر داخل نفس المعاملة (مثل
     * إضافة/تعديل سطر سلة)، فيعيد قفل صفّ القائمة وصفّ العنصر المطابق
     * (إن وُجد) بـ `lockForUpdate()` قبل الحسم — فحذف العنصر أو تعطيل القائمة
     * أثناء الانتظار يُعاد فحصه بعد القفل بدل الاعتماد على قراءة سابقة له.
     */
    public function resolve(PriceList $priceList, Product $product, ?string $unitName, bool $lock = false): ?int
    {
        if ($lock) {
            $priceList = PriceList::query()->whereKey($priceList->id)->lockForUpdate()->firstOrFail();
        }

        if (! $priceList->is_active) {
            throw new RuntimeException('قائمة الأسعار المحددة غير نشطة.');
        }

        [$resolvedUnit] = $this->units->resolve($product, $unitName);
        $storedUnit = $resolvedUnit ?? $product->unit;

        $query = PriceListItem::where('price_list_id', $priceList->id)
            ->where('product_id', $product->id)
            ->where('unit_name', $storedUnit);

        if ($lock) {
            $query->lockForUpdate();
        }

        $item = $query->first();

        return $item ? (int) $item->price : null;
    }

    /** ينشئ أو يستبدل سعراً واحداً لمنتج ووحدة محددين داخل قائمة المؤسسة. */
    public function upsertItem(PriceList $priceList, Product $product, array $data): PriceListItem
    {
        if (! $priceList->is_active) {
            throw new RuntimeException('لا يمكن تعديل عناصر قائمة أسعار غير نشطة. فعّلها أولاً.');
        }
        if (! $product->is_active) {
            throw new RuntimeException('لا يمكن إضافة منتج غير نشط إلى قائمة الأسعار.');
        }

        [$resolvedUnit] = $this->units->resolve($product, $data['unit_name'] ?? null);
        $storedUnit = $resolvedUnit ?? $product->unit;

        return DB::transaction(function () use ($priceList, $product, $storedUnit, $data) {
            return PriceListItem::updateOrCreate([
                'price_list_id' => $priceList->id,
                'product_id' => $product->id,
                'unit_name' => $storedUnit,
            ], [
                'price' => (int) $data['price'],
            ]);
        });
    }

    /**
     * الحذف النهائي مسموح فقط لقائمة لم تصبح مرجعاً في فاتورة. المستخدمة تبقى
     * قابلة للتعطيل كي لا تنكسر المراجعة أو مرجع المسودة التاريخي.
     */
    public function delete(PriceList $priceList): void
    {
        if ($priceList->invoices()->exists()) {
            throw new RuntimeException('لا يمكن حذف قائمة أسعار استُخدمت في فاتورة. عطّلها بدلاً من ذلك.');
        }
        if ($priceList->defaultPartners()->exists()) {
            throw new RuntimeException('لا يمكن حذف قائمة أسعار معيّنة افتراضياً لعميل. أزلها من العميل أو عطّلها بدلاً من ذلك.');
        }
        if ($priceList->defaultSalesChannels()->exists()) {
            throw new RuntimeException('لا يمكن حذف قائمة أسعار معيّنة افتراضياً لقناة بيع. أزلها من القناة أو عطّلها بدلاً من ذلك.');
        }

        $priceList->delete();
    }
}

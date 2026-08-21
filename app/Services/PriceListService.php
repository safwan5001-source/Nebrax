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
     */
    public function resolve(PriceList $priceList, Product $product, ?string $unitName): ?int
    {
        if (! $priceList->is_active) {
            throw new RuntimeException('قائمة الأسعار المحددة غير نشطة.');
        }

        [$resolvedUnit] = $this->units->resolve($product, $unitName);
        $storedUnit = $resolvedUnit ?? $product->unit;

        $item = PriceListItem::where('price_list_id', $priceList->id)
            ->where('product_id', $product->id)
            ->where('unit_name', $storedUnit)
            ->first();

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

        $priceList->delete();
    }
}

<?php

namespace App\Services;

use App\Models\Product;
use App\Services\Accounting\InventoryService;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;

/**
 * خدمة إنشاء المنتجات — مسار الإنشاء القانوني الموحّد يستعمله المتحكّم الداخلي
 * والـ Public API معًا، فلا يوجد منطق إنشاء موازٍ.
 *
 * يولّد رمز الصنف (SKU) عند غيابه تحت القفل نفسه فلا تتصادم عمليات الإنشاء
 * المتزامنة، ثم يُنشئ المنتج، ويسجّل رصيدًا افتتاحيًا **إن طُلبت كمية ابتدائية**
 * (قيد 1140/3130) — كمية = 0 لا تولّد حركةً ولا قيدًا (`recordOpeningStock`
 * تُرجع null)، فإنشاءٌ بلا كمية ابتدائية لا أثر مخزني ولا محاسبي له. أخيرًا يسجّل
 * حدث دورة حياة الإنشاء (الفاعل اختياري — null لعميل الـ API غير البشري).
 */
class ProductService
{
    public function __construct(
        protected InventoryService $inventory,
        protected ProductLifecycleService $lifecycle,
    ) {}

    /**
     * @param  array<string, mixed>  $data
     */
    public function create(array $data, ?string $userId = null): Product
    {
        return DB::transaction(function () use ($data, $userId) {
            if (blank($data['sku'] ?? null)) {
                $prefix = (string) Settings::get('numbering', 'product_prefix');
                $data['sku'] = Product::nextDocumentNumber($prefix !== '' ? $prefix : 'SKU');
            }

            $product = Product::create($data); // initial_quantity ليست عمودًا — يحرسها fillable

            $this->inventory->recordOpeningStock($product, (int) ($data['initial_quantity'] ?? 0));
            $this->lifecycle->create($product, $userId);

            return $product;
        });
    }
}

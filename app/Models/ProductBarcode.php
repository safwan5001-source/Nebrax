<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * باركود بديل لمنتج، ويمكن ربطه بوحدة محددة من قالب المنتج.
 *
 * التفرد على مستوى المستأجر: جهاز المسح لا يملك سياق فرعاً لحل كود متكرر.
 */
class ProductBarcode extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'code', 'unit_name', 'default_quantity', 'label', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'default_quantity' => 'integer',
        ];
    }

    /**
     * جزء من فضاء الباركود الموحّد (PR-UOM-1). `created` لا `creating`:
     * يحتاج `id` (المولَّد بالفعل عند هذه اللحظة) بيقين. لا معالج حذفٍ هنا
     * عمداً — الحذف الفردي (`ProductController::destroyBarcode`) وحذف كل
     * باركودات منتجٍ دفعةً واحدة (`ProductLifecycleService::delete`) كلاهما
     * يحرّر التسجيل صراحةً في موضعه، لأن حذف العلاقة الجماعي
     * (`$product->alternateBarcodes()->delete()`) استعلام مجمّع لا يُطلق
     * حدث Eloquent لكل صفّ — الاعتماد عليه هنا كان سيترك تسجيلات يتيمة.
     */
    protected static function booted(): void
    {
        static::created(function (ProductBarcode $barcode) {
            BarcodeRegistryEntry::claim($barcode->code, $barcode->product_id, 'alternate');
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}

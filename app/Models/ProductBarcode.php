<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * باركود بديل لمنتج، ويمكن ربطه بوحدة محددة من قالب المنتج، وبمتغيّرٍ فعلي
 * بعينه (VAR-POS-1: `product_variant_id`) حين يكون المنتج متعدد الخيارات —
 * فارغٌ دائماً لمنتجٍ بسيط. الباركود **محلٌّ (resolver) لا سلطة سعر** (العقد
 * الموثّق: docs/plans/products-inventory/AWJ_MULTIPLE_BARCODE_UOM_SELLING_PRICE_UX_CONTRACT.md).
 *
 * التفرد على مستوى المستأجر: جهاز المسح لا يملك سياق فرعاً لحل كود متكرر.
 */
class ProductBarcode extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'product_id', 'product_variant_id', 'code', 'unit_name', 'default_quantity', 'label', 'created_by',
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
     *
     * `saving` (VAR-POS-1): نفس حارس `ProductMedia::booted()` حرفياً —
     * متغيّرٌ لا يتبع هذا المنتج، أو من مستأجرٍ آخر، يُرفض قبل أي كتابة.
     */
    protected static function booted(): void
    {
        static::saving(function (ProductBarcode $barcode): void {
            if ($barcode->product_variant_id === null) {
                return;
            }

            $tenantId = $barcode->tenant_id ?: app(TenantContext::class)->id();
            $variant = ProductVariant::find($barcode->product_variant_id);
            if ($variant === null || $variant->product_id !== $barcode->product_id) {
                throw new RuntimeException('المتغيّر المحدَّد لا يتبع هذا المنتج.');
            }
            if ($variant->tenant_id !== $tenantId) {
                throw new RuntimeException('تعارض عزل مستأجر بين المنتج والمتغيّر.');
            }
        });

        static::created(function (ProductBarcode $barcode) {
            BarcodeRegistryEntry::claim($barcode->code, $barcode->product_id, 'alternate');
        });
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /** VAR-POS-1: المتغيّر الفعلي الذي يحلّه هذا الباركود — فارغٌ لمنتجٍ بسيط. */
    public function variant(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductVariant::class, 'product_variant_id');
    }

    public function creator(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class, 'created_by');
    }
}

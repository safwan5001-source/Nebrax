<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use App\Support\GeneratesDocumentNumbers;
use Closure;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * منتج أو خدمة. الأسعار بالـ minor units (هللات) كـ bigint — لا float إطلاقاً.
 * tax_rate نسبة مئوية صحيحة (15 = 15%).
 */
/**
 * @see design-system/foundations/multi-branch-architecture.md
 * تشغيلي بعزل **مشروط**: مشترك ما دام مفتاح «مشاركة المنتجات» مفعّلاً (الافتراضي).
 * المراجع المخزَّنة في سطور المستندات تُحلّ خارج العزل عبر `referenceBelongsTo`.
 */
class Product extends BaseModel implements BranchShareable
{
    use BranchScoped;
    use GeneratesDocumentNumbers;
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'branch_id', 'sku', 'barcode', 'name', 'name_en', 'type', 'unit',
        'description', 'category', 'brand', 'category_id', 'brand_id', 'unit_template_id', 'reorder_level',
        'supplier_id', 'sales_account_id', 'cogs_account_id',
        'min_sale_price', 'discount', 'discount_type', 'profit_margin', 'tags', 'internal_notes',
        'sale_price', 'purchase_price', 'tax_rate', 'track_inventory',
        'quantity_on_hand', 'avg_cost', 'is_active',
    ];

    protected $casts = [
        'reorder_level'    => 'integer',
        'min_sale_price'   => 'integer',
        'discount'         => 'integer',
        'profit_margin'    => 'integer',
        'sale_price'       => 'integer',
        'purchase_price'   => 'integer',
        'tax_rate'         => 'integer',
        'track_inventory'  => 'boolean',
        'quantity_on_hand' => 'integer',
        'avg_cost'         => 'integer',
        'is_active'        => 'boolean',
    ];

    protected $attributes = [
        'type'            => 'good',
        'unit'            => 'piece',
        'sale_price'      => 0,
        'purchase_price'  => 0,
        'tax_rate'        => 15,
        'track_inventory'  => false,
        'quantity_on_hand' => 0,
        'avg_cost'         => 0,
        'is_active'        => true,
    ];

    /** كود الصنف الداخلي هو SKU، وسلسلته مستمرة ولا تُعاد سنوياً. */
    public static function documentNumberColumn(): string
    {
        return 'sku';
    }

    /** SKU مرجع كتالوج مؤسسي؛ لا يتفرع عداده مع عزل عرض المنتجات. */
    protected static function isBranchNumbered(): bool
    {
        return false;
    }

    public function isService(): bool
    {
        return $this->type === 'service';
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }

    /** الباركودات البديلة؛ الباركود الأساسي التاريخي يبقى في عمود المنتج. */
    public function alternateBarcodes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class);
    }

    /** صور المنتج الخاصة، مرتبةً عند طلبها في ملف المنتج لا في الكتالوج. */
    public function media(): HasMany
    {
        return $this->hasMany(ProductMedia::class);
    }

    /**
     * التصنيف والعلامة المُدارَان. الاسمان `productCategory`/`productBrand`
     * لا `category`/`brand`: العمودان النصّيان القديمان يحملان الاسمين، وعلاقةٌ
     * بالاسم نفسه كانت تُحجَب بقيمة العمود صامتةً — يقرأ المستدعي نصّاً حيث
     * يتوقّع نموذجاً.
     */
    public function productCategory(): BelongsTo
    {
        return $this->belongsTo(ProductCategory::class, 'category_id');
    }

    public function productBrand(): BelongsTo
    {
        return $this->belongsTo(Brand::class, 'brand_id');
    }

    /** قالب الوحدات: وحدة أساس (هي `unit`) ووحدات بديلة بمعاملات صحيحة. */
    public function unitTemplate(): BelongsTo
    {
        return $this->belongsTo(UnitTemplate::class, 'unit_template_id');
    }

    /**
     * العزل مشروط بمفتاح «مشاركة المنتجات» — مفعّل افتراضياً، فالسلوك القائم
     * لكل مستأجر لا يتغيّر حتى يُطفئه بيده من «إعدادات الفروع».
     */
    public function branchSharingExemption(BranchSharing $sharing): bool|Closure
    {
        return $sharing->shared('share_products');
    }
}

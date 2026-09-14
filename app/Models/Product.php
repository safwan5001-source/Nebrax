<?php

namespace App\Models;

use App\Support\BranchSettings;
use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use App\Tenancy\BranchShareable;
use App\Tenancy\BranchSharing;
use Closure;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use RuntimeException;

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
        // PR-UOM2-1: اقتراحٌ للواجهة لا سلوكٌ في المستندات. `null` = وحدة الأساس.
        'default_sales_unit', 'default_purchase_unit',
        'description', 'category', 'brand', 'category_id', 'brand_id', 'unit_template_id', 'reorder_level',
        'supplier_id', 'sales_account_id', 'cogs_account_id',
        'min_sale_price', 'discount', 'discount_type', 'profit_margin', 'tags', 'internal_notes',
        'sale_price', 'purchase_price', 'tax_rate', 'track_inventory',
        'quantity_on_hand', 'avg_cost', 'is_active',
    ];

    protected $casts = [
        'reorder_level' => 'integer',
        'min_sale_price' => 'integer',
        'discount' => 'integer',
        'profit_margin' => 'integer',
        'purchase_price' => 'integer',
        'tax_rate' => 'integer',
        'track_inventory' => 'boolean',
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'type' => 'good',
        'unit' => 'piece',
        'sale_price' => 0,
        'purchase_price' => 0,
        'tax_rate' => 15,
        'track_inventory' => false,
        'quantity_on_hand' => 0,
        'avg_cost' => 0,
        'is_active' => true,
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

    /**
     * الباركود الأساسي جزءٌ من فضاء الباركود الموحّد (PR-UOM-1). `saved` لا
     * `saving`: يحتاج `id` نهائياً (مضمونٌ بعد الإدراج) و`isDirty()`/
     * `getOriginal()` ما زالا يعكسان القيمة السابقة قبل `syncOriginal()` —
     * فيغطي الإنشاء والتعديل بمعالجٍ واحد يعمل حتى مع الاستيراد الذي يكتب
     * `Product::create()` مباشرة بلا مرور بخدمةٍ وسيطة.
     */
    protected static function booted(): void
    {
        // VAR-INV-1 (P2): فشلٌ مغلَق قبل أي كتابة فعلية — `saving` لا `saved`،
        // فيُلغى الحفظ **بالكامل** (لا سطر واحد يُكتب على `products` ولا على
        // `InventoryState`) حين يحمل الحفظ إسناداً مباشراً لـ`quantity_on_hand`/
        // `avg_cost` على منتجٍ `variant_managed`. الأب في هذه الحالة **لا هويّة
        // مخزونٍ موازية له** (VAR_ARCH_1 §3) — فلا توزيعٌ على المتغيّرات، ولا
        // صفّ أبٍ يُنشأ، ولا تجاهلٌ صامت كما كان سابقاً.
        static::saving(function (Product $product) {
            if (($product->pendingQuantityOnHand !== null || $product->pendingAvgCost !== null)
                && $product->isVariantManaged()) {
                throw new RuntimeException(
                    'لا يمكن إسناد كمية أو متوسط تكلفة مباشرة لمنتجٍ متعدد الخيارات — '
                    .'لا هويّة مخزونٍ للأب؛ حدِّد المتغيّر الفعلي وأسند مخزونه عبر InventoryService.'
                );
            }
        });

        static::saved(function (Product $product) {
            if ($product->isDirty('barcode')) {
                $old = $product->getOriginal('barcode');
                $new = $product->barcode;

                if ($old !== null && $old !== '') {
                    BarcodeRegistryEntry::release($old);
                }
                if ($new !== null && $new !== '') {
                    BarcodeRegistryEntry::claim($new, $product->id, 'primary');
                }
            }

            // فضاء SKU الموحّد (VAR-CORE-1): يغطي المنتج والمتغيّر معاً بقيدٍ
            // فريدٍ واحد — @see App\Models\SkuRegistryEntry.
            //
            // **مطالبةٌ مشروطة لا مطلقة:** على عكس الباركود، رمز منتجٍ بسيطٍ
            // موسومٍ بفرعٍ وغير مشترك (`share_products=false`) نطاقُه الفرعُ
            // وحده منذ عقدٍ سابق (migration 000085) — فرعان يستعملان الرمز
            // نفسه باستقلالٍ سلوكٌ قائم يجب ألّا يكسره هذا العقد. فالمطالبة
            // التنافسية على مستوى المستأجر تنطبق فقط حين لا معنى لعزل الفرع:
            // منتجٌ بلا فرع، أو مشتركٌ، أو **متعدد الخيارات** (المتغيّرات
            // بلا مفهوم فرعٍ أصلاً في VAR-CORE-1، فهويتها تنافسية على مستوى
            // المستأجر دائماً — فما إن يصبح المنتج كذلك يلتحق SKU الأب بها).
            if ($product->isDirty('sku')) {
                $old = $product->getOriginal('sku');
                $new = $product->sku;

                if (self::sharesSkuNamespace($product)) {
                    if ($old !== null && $old !== '') {
                        SkuRegistryEntry::releaseOwnedByProduct($old, $product->id);
                    }
                    if ($new !== null && $new !== '') {
                        SkuRegistryEntry::claim($new, 'product', productId: $product->id);
                    }
                } elseif ($new !== null && $new !== '') {
                    // منتجٌ فرعي معزول: لا ينضمّ إلى الجدول، لكن رمزه يجب ألّا
                    // يصطدم صامتةً بهويةٍ مرئية من كل الفروع بالفعل (منتجٌ
                    // مشترك/بلا فرع/متعدد الخيارات، أو أي متغيّر) — الاتجاه
                    // المعاكس بالضبط لما يتحقق منه `claim()` نفسه.
                    SkuRegistryEntry::assertFreeForIsolatedProduct($new, $product->id);
                }
            }

            // VAR-INV-1: توافقٌ خلفي للإسناد المباشر القديم (تجهيزات اختبارات
            // موجودة، وأدوات artisan/seed) — @see $pendingQuantityOnHand أدناه.
            $product->flushPendingInventorySeed();

            // VAR-PRICE-1: نفس التوافق الخلفي لـ`sale_price` — @see $pendingSalePrice أدناه.
            $product->flushPendingUnitPriceSeed();
        });
    }

    /**
     * هل يشترك رمز هذا المنتج في الفضاء الموحّد الآن، بحسب الحالة الراهنة
     * (فرعه وإعداد المشاركة الحالي)؟ يستعمله `ProductVariantService` عند
     * التراجع عن إدارة المتغيّرات ليقرر تحرير عضوية السجلّ أو إبقاءها.
     */
    public function claimsSkuNamespace(): bool
    {
        return self::sharesSkuNamespace($this);
    }

    /** @see booted() — نطاق مطالبة SKU الموحّدة. */
    private static function sharesSkuNamespace(Product $product): bool
    {
        if ($product->isVariantManaged()) {
            return true;
        }
        if ($product->branch_id === null) {
            return true;
        }

        return (bool) BranchSettings::sharing()['share_products'];
    }

    public function isService(): bool
    {
        return $this->type === 'service';
    }

    public function movements(): HasMany
    {
        return $this->hasMany(StockMovement::class);
    }

    /** هويّات المخزون (VAR-INV-1) — صفٌّ واحد بسيط، أو واحد لكل متغيّر فعلي. */
    public function inventoryStates(): HasMany
    {
        return $this->hasMany(InventoryState::class);
    }

    /**
     * VAR-INV-1: الكمية والمتوسط لم يعودا يُقرآن من عمودَي هذا الجدول —
     * `InventoryState` هي السلطة الوحيدة الآن (لا حقيقتان قابلتان للتعارض،
     * @see docs/plans/products-inventory/AWJ_PRODUCT_VARIANTS_VAR_ARCH_1.md §3.1).
     * العمودان الفيزيائيان (`products.quantity_on_hand`/`avg_cost`) يبقيان في
     * المخطَّط مجمَّدين بلا كتابة — إسقاطهما عبر ترحيل `Schema::table` كان
     * يخاطر بإعادة بناء SQLite المعروفة (تحذير VAR-INV-1 الصريح)، فتجميدهما
     * أرخص وأأمن من الإسقاط، وما زال يحقّق «لا كتابة مزدوجة دائمة» فعلياً.
     *
     * منتجٌ `variant_managed`: الكمية مجموعٌ مشتقٌّ لعرضٍ/تقريرٍ فقط عبر كل
     * المتغيّرات؛ المتوسط **لا يُخترع** (0 صراحةً) لأن الأب ليس هويّة تقييمٍ
     * موازية ولا يجوز خلط تكاليف متغيّرات مختلفة اقتصادياً في رقمٍ واحد.
     */
    /**
     * إسنادٌ مباشرٌ قديم (`Product::create(['quantity_on_hand'=>..., 'avg_cost'=>...])`
     * أو `$product->update([...])`) لا يكتب العمود الفيزيائي بعد الآن (مجمَّد
     * — أعلاه)، لكنه **لا يُهمَل صامتاً** أيضاً: كان توافقٌ صامت كهذا سيكسر
     * عشرات تجهيزات الاختبارات القائمة التي تفترض بذراً مباشراً لرصيدٍ
     * افتتاحي، وهو نمطٌ بلا أثرٍ محاسبي حقيقي (لا حركة، لا قيد) فلا يستحق
     * إعادة كتابة كل موضعٍ يستعمله إلى `InventoryService`. القيمة تُحفظ هنا
     * مؤقتاً وتُطبَّق على `InventoryState` بعد الحفظ (`flushPendingInventorySeed`)
     * — توجيهٌ شفّاف لا كتابةٌ مزدوجة: العمود الفيزيائي يبقى بلا كتابة أبداً.
     */
    private ?int $pendingQuantityOnHand = null;

    private ?int $pendingAvgCost = null;

    protected function quantityOnHand(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->isVariantManaged()
                ? (int) $this->inventoryStates()->sum('quantity_on_hand')
                : (int) ($this->inventoryStates()->whereNull('product_variant_id')->value('quantity_on_hand') ?? 0),
            set: function ($value) {
                $this->pendingQuantityOnHand = (int) $value;

                return [];
            },
        );
    }

    protected function avgCost(): Attribute
    {
        return Attribute::make(
            get: fn () => $this->isVariantManaged()
                ? 0
                : (int) ($this->inventoryStates()->whereNull('product_variant_id')->value('avg_cost') ?? 0),
            set: function ($value) {
                $this->pendingAvgCost = (int) $value;

                return [];
            },
        );
    }

    /**
     * يطبّق إسناداً مباشراً قديم لهذا الحفظ فقط (إن وُجد) على `InventoryState`
     * البسيطة لهذا المنتج. يعمل على منتجٍ بسيط فقط — `saving()` أعلاه يرفض
     * الحفظ مغلَقاً قبل الوصول هنا أصلاً لو كان المنتج `variant_managed`، فهذا
     * الفرع دفاعٌ في العمق لا مساراً حياً (لا هويّة أبٍ موازية تُكتب هنا أبداً،
     * VAR_ARCH_1 §3).
     */
    private function flushPendingInventorySeed(): void
    {
        if ($this->pendingQuantityOnHand === null && $this->pendingAvgCost === null) {
            return;
        }

        $quantity = $this->pendingQuantityOnHand;
        $avgCost = $this->pendingAvgCost;
        $this->pendingQuantityOnHand = null;
        $this->pendingAvgCost = null;

        if ($this->isVariantManaged()) {
            return;
        }

        $state = InventoryState::firstOrNew(['product_id' => $this->id, 'product_variant_id' => null]);
        $state->tenant_id = $this->tenant_id;
        if ($quantity !== null) {
            $state->quantity_on_hand = $quantity;
        }
        if ($avgCost !== null) {
            $state->avg_cost = $avgCost;
        }
        $state->save();
    }

    /** أسعار الوحدات (VAR-PRICE-1) — سعرٌ أساسي واحد للمنتج نفسه لكل وحدة (لا متغيّرات هنا). */
    public function unitPrices(): HasMany
    {
        return $this->hasMany(ProductUnitPrice::class)->whereNull('product_variant_id');
    }

    /**
     * VAR-PRICE-1: `sale_price` لم يعد يُقرأ من عمود هذا الجدول — `ProductUnitPrice`
     * (وحدة الأساس، `product_variant_id = NULL`) هي السلطة الوحيدة الآن. خلافاً
     * لـ`quantity_on_hand`: **لا استثناء لمنتجٍ `variant_managed`** — سعر الأب
     * يبقى مرجعاً تراجعياً صالحاً ومعتمَداً صراحةً لمتغيّرٍ بلا سعرٍ خاص لنفس
     * الوحدة (البند ٦ من عقد VAR-PRICE-1)، فلا معنى لمنعه هنا كما مُنع المخزون.
     */
    protected function salePrice(): Attribute
    {
        return Attribute::make(
            // إسنادٌ لم يُحفَظ بعد يبقى مرئياً فوراً للقراءة — كسلوك أي عمود
            // Eloquent عادي (`$model->x = 1; $model->x === 1` قبل `save()`
            // أيضاً). بلا هذا كان `$product->setAttribute('sale_price', ...)`
            // العابر لعرض سعرٍ مُحسَّب من قائمة أسعارٍ (`PosController::products()`)
            // يُقرأ فوراً بعده فيعود صامتاً إلى السعر الأساسي القديم — القيمة
            // العابرة لم تُكتب ولن تُكتب أصلاً (لا `save()` بعدها إطلاقاً).
            get: fn () => $this->pendingSalePrice
                ?? (int) ($this->unitPrices()->where('unit_name', $this->unit)->value('price') ?? 0),
            set: function ($value) {
                $this->pendingSalePrice = (int) $value;

                return [];
            },
        );
    }

    /** @see flushPendingUnitPriceSeed() */
    private ?int $pendingSalePrice = null;

    /**
     * يوازي `flushPendingInventorySeed()` حرفياً لكن بلا أي استثناء لمنتجٍ
     * `variant_managed` — سعر الأب سلطةٌ صالحة دائماً (خلافاً للمخزون).
     */
    private function flushPendingUnitPriceSeed(): void
    {
        if ($this->pendingSalePrice === null) {
            return;
        }

        $price = $this->pendingSalePrice;
        $this->pendingSalePrice = null;

        $row = ProductUnitPrice::firstOrNew([
            'product_id' => $this->id, 'product_variant_id' => null, 'unit_name' => $this->unit,
        ]);
        $row->tenant_id = $this->tenant_id;
        $row->price = $price;
        $row->save();
    }

    /** خيارات المتغيّرات (اللون/المقاس/...) — فارغة لمنتجٍ بسيط. */
    public function options(): HasMany
    {
        return $this->hasMany(ProductOption::class)->orderBy('sort_order');
    }

    /** المتغيّرات الفعلية (VAR-CORE-1) — فارغة إلا لمنتجٍ `variant_managed`. */
    public function variants(): HasMany
    {
        return $this->hasMany(ProductVariant::class);
    }

    public function isVariantManaged(): bool
    {
        return $this->variant_state === 'variant_managed';
    }

    /** الباركودات البديلة؛ الباركود الأساسي التاريخي يبقى في عمود المنتج. */
    public function alternateBarcodes(): HasMany
    {
        return $this->hasMany(ProductBarcode::class);
    }

    /**
     * صور المنتج المشتركة فقط (VAR-MEDIA-1: بلا قيمة خيارٍ ولا متغيّر) —
     * السلوك القائم حرفياً قبل هذا المعيار لكل مستهلكٍ حالي (`ProductController`،
     * `PosController`، `StorefrontProductController`، `pos_image`) دون أي
     * تعديلٍ في تلك المواضع؛ النطاقان الجديدان إضافةٌ لا يراها هذا الاستعلام.
     * لتنظيفٍ شاملٍ عابرٍ لكل النطاقات الثلاثة عند حذف المنتج نفسه، @see allMedia().
     */
    public function media(): HasMany
    {
        return $this->hasMany(ProductMedia::class)
            ->whereNull('product_option_value_id')
            ->whereNull('product_variant_id');
    }

    /** كل وسائط المنتج عبر النطاقات الثلاثة معاً — لتنظيف حذف المنتج الحقيقي فقط. */
    public function allMedia(): HasMany
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

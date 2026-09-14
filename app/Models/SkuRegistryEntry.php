<?php

namespace App\Models;

use App\Tenancy\BranchScope;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\QueryException;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  SkuRegistryEntry — فضاء SKU الموحّد على مستوى المستأجر (VAR-CORE-1)
 * ═══════════════════════════════════════════════════════════════
 *  يوسّع نمط `BarcodeRegistryEntry` نفسه حرفياً: صفٌّ واحد لكل SKU مستعمَل —
 *  لمنتج (`kind=product`) أو لمتغيّر (`kind=variant`) — بقيدٍ فريد
 *  `(tenant_id, sku)` هو مصدر الحقيقة الوحيد لتفرّد رمز الصنف عبر النوعين
 *  معاً. لا يجوز الاعتماد على قيدين منفصلين (`products.sku` و
 *  `product_variants.sku`) لأنهما لا يمنعان تصادماً بين منتجٍ ومتغيّرٍ آخر.
 *
 *  **الضمان الذرّي حقيقةً هو القيد الفريد في قاعدة البيانات، لا `isTaken()`
 *  وحدها** — نفس تحذير `BarcodeRegistryEntry` حرفياً.
 *
 *  ═══ العضوية مشروطة — وهذا مقصود، لا فجوة ═══
 *  `Product::sharesSkuNamespace()` لا يُدرج منتجاً فرعياً غير مشترك
 *  (`share_products=false`) هنا أصلاً — نطاق SKU لمثل هذا المنتج فرعُه وحده
 *  منذ عقدٍ سابق (migration 000085)، وإدراجه هنا قسراً كان سيكسر استقلال
 *  الفروع القائم فعلياً (راجع `ProductSkuValidationTest`). **لكن** كل هويةٍ
 *  تنضمّ فعلياً إلى هذا الجدول — منتجٌ مشترك/بلا فرع/متعدد الخيارات، أو أي
 *  متغيّر — مرئيةٌ من كل الفروع بحكم طبيعتها، فيجب ألّا تتصادم صامتةً مع رمز
 *  منتجٍ فرعي معزول. لذلك يتحقق `claim()` أيضاً من عدم وجود منتجٍ فرعي معزول
 *  يحمل الرمز نفسه قبل الحجز — تحت قفل صفّ المستأجر (نفس نمط
 *  `GeneratesDocumentNumbers::lockNumberingAnchor()` حرفياً) كي لا يفلت
 *  تصادمٌ عابرٌ بين الجدولين من فحصٍ عابرٍ للمعاملات.
 */
class SkuRegistryEntry extends BaseModel implements CompanyWide
{
    protected $table = 'sku_registry';

    protected $fillable = ['tenant_id', 'sku', 'kind', 'product_id', 'product_variant_id'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    public function variant(): BelongsTo
    {
        return $this->belongsTo(ProductVariant::class, 'product_variant_id');
    }

    /**
     * يحجز SKU لمنتج أو لمتغيّر. حفظٌ متكرّر لنفس (الرمز، المالك، النوع) بلا
     * تغيير آمنٌ تماماً — لا يُنشئ صفّاً ثانياً ولا يرفض.
     *
     * يقفل صفّ المستأجر أولاً: هذا الفحص يمتدّ عبر جدولين (`sku_registry` و
     * `products`) لا يجمعهما قيدٌ فريدٌ واحد، فالقفل هو الضامن الفعلي لعدم
     * إفلات تصادمٍ عابر — انظر توثيق الصنف أعلاه.
     */
    public static function claim(string $sku, string $kind, ?string $productId = null, ?string $variantId = null): void
    {
        self::lockTenantAnchor();

        $existing = static::where('sku', $sku)->first();

        if ($existing !== null) {
            $sameOwner = $kind === 'product'
                ? ($existing->kind === 'product' && $existing->product_id === $productId)
                : ($existing->kind === 'variant' && $existing->product_variant_id === $variantId);

            if ($sameOwner) {
                return;
            }

            throw new RuntimeException('رمز المنتج (SKU) مستخدم بالفعل في هذه المؤسسة، سواء لمنتج أو لأحد متغيّراته.');
        }

        if (self::isClaimedByAnIsolatedProduct($sku, $kind === 'product' ? $productId : null)) {
            throw new RuntimeException('رمز المنتج (SKU) مستخدم بالفعل في هذه المؤسسة، سواء لمنتج أو لأحد متغيّراته.');
        }

        try {
            static::create([
                'sku' => $sku,
                'kind' => $kind,
                'product_id' => $kind === 'product' ? $productId : null,
                'product_variant_id' => $kind === 'variant' ? $variantId : null,
            ]);
        } catch (QueryException $e) {
            if (self::isUniqueViolation($e)) {
                throw new RuntimeException('رمز المنتج (SKU) مستخدم بالفعل في هذه المؤسسة، سواء لمنتج أو لأحد متغيّراته.');
            }

            throw $e;
        }
    }

    /**
     * الاتجاه المعاكس لـ`claim()`: يتحقق منتجٌ فرعي معزول (`sharesSkuNamespace()`
     * = false) أن رمزه لا يصطدم بهويةٍ مرئية من كل الفروع بالفعل — بلا أن
     * ينضمّ هو نفسه إلى الجدول (يبقى نطاقه فرعه وحده كما كان). نفس قفل
     * المستأجر، فيتسلسل مع `claim()` على المستأجر نفسه بدل أن يتسابقا.
     */
    public static function assertFreeForIsolatedProduct(string $sku, ?string $exceptProductId = null): void
    {
        self::lockTenantAnchor();

        if (static::isTaken($sku, exceptProductId: $exceptProductId)) {
            throw new RuntimeException('رمز المنتج (SKU) مستخدم بالفعل في هذه المؤسسة، سواء لمنتج أو لأحد متغيّراته.');
        }
    }

    public static function release(string $sku): void
    {
        static::where('sku', $sku)->delete();
    }

    /**
     * تحريرٌ مضمون الملكية — لا يحذف صفّاً يخصّ مالكاً آخر بالخطأ. ضروريٌّ
     * لأن مطالبة المنتج مشروطة (`Product::sharesSkuNamespace()`)، فقد لا
     * يكون هذا المنتج هو من يملك الصفّ أصلاً؛ `release()` العام يحذف أي صفٍّ
     * بهذا النص بلا تحقّق ملكية، وهو غير آمن هنا تحديداً.
     */
    public static function releaseOwnedByProduct(string $sku, string $productId): void
    {
        static::where('sku', $sku)->where('kind', 'product')->where('product_id', $productId)->delete();
    }

    public static function releaseAllForProduct(string $productId): void
    {
        static::where('product_id', $productId)->delete();
    }

    public static function releaseAllForVariant(string $variantId): void
    {
        static::where('product_variant_id', $variantId)->delete();
    }

    public static function isTaken(string $sku, ?string $exceptProductId = null, ?string $exceptVariantId = null): bool
    {
        return static::where('sku', $sku)
            ->when($exceptProductId, fn ($q) => $q->where(function ($q2) use ($exceptProductId) {
                $q2->where('kind', '!=', 'product')->orWhere('product_id', '!=', $exceptProductId);
            }))
            ->when($exceptVariantId, fn ($q) => $q->where(function ($q2) use ($exceptVariantId) {
                $q2->where('kind', '!=', 'variant')->orWhere('product_variant_id', '!=', $exceptVariantId);
            }))
            ->exists();
    }

    private static function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /**
     * منتجٌ فرعي معزول لا صفّ له هنا أبداً (بالتصميم)، فتحقّق `claim()` من
     * تفرّد الرمز يفوته بلا هذا الفحص المباشر على `products`. `branch_id`
     * غير فارغ وحده يكفي معياراً: منتجٌ مشترك حالياً (`share_products=true`)
     * انضمّ فعلاً إلى هذا الجدول أصلاً عبر `claim()` الاعتيادي — فحصه هنا
     * مكرَّرٌ لا مؤذٍ؛ المهمّ ألّا يُغفَل المعزول الذي لم ينضمّ إطلاقاً.
     */
    private static function isClaimedByAnIsolatedProduct(string $sku, ?string $exceptProductId): bool
    {
        return Product::withoutGlobalScope(BranchScope::class)
            ->whereNotNull('branch_id')
            ->whereNull('deleted_at')
            ->where('sku', $sku)
            ->when($exceptProductId, fn ($q) => $q->where('id', '!=', $exceptProductId))
            ->exists();
    }

    /**
     * قفل **مِرساة** صفّ المستأجر — نفس نمط
     * `GeneratesDocumentNumbers::lockNumberingAnchor()` حرفياً: صفٌّ موجودٌ
     * حتماً يُسلسِل الطلبات المتزامنة التي تتنافس على الفحص العابر للجدولين
     * أعلاه. لا يستبدل القيد الفريد في التصادم داخل `sku_registry` نفسه —
     * ذاك يبقى الضامن الذرّي القائم — بل يغلق النافذة التي لا يغطيها قيدٌ
     * واحد لأنها تمتدّ إلى جدول `products` المنفصل.
     */
    private static function lockTenantAnchor(): void
    {
        $tenantId = app(TenantContext::class)->id();

        if ($tenantId !== null) {
            Tenant::whereKey($tenantId)->lockForUpdate()->first();
        }
    }
}

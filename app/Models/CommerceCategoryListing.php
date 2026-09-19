<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * حالة نشر تصنيف على قناة بيع واحدة — يفصل حقيقة التصنيف الأساسية
 * (`ProductCategory` — بيانات رئيسية مشتركة) عن نشره التجاري حسب القناة،
 * بموازاة `CommerceListing` للمنتجات. لا يخزّن اسماً ولا شجرة ولا أي نسخة
 * من بيانات التصنيف: حالة نشر فقط (`is_published`).
 *
 * الاستقلالية كاملة بين نشر التصنيف ونشر المنتج: لا كتابة هنا تلمس
 * `commerce_listings`، ولا كتابة هناك تلمس هذا الجدول.
 *
 * **`CompanyWide`**: تهيئة على مستوى المؤسسة، كـ`CommerceListing`/
 * `SalesChannel` نفسهما — لا فرعاً بعينه.
 *
 * الحتمية: التصنيف ظاهر على قناة ⟺ يوجد صفٌّ `is_published = true` لذلك
 * الزوج — لا fallback ولا مصدر حقيقة ثانٍ (التوافق الرجعي حُسم بالـ backfill
 * في الترحيل، لا بمنطق قراءة غامض).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: حالة نشر تابعة لقناة — العزل عبر القناة/المستأجر */
class CommerceCategoryListing extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'category_id', 'sales_channel_id', 'is_published',
    ];

    protected $casts = [
        'is_published' => 'boolean',
    ];

    protected $attributes = [
        'is_published' => false,
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (شجرة التصنيفات بنية مشتركة عبر القنوات). */
    public function category(): BelongsTo
    {
        return $this->referenceBelongsTo(ProductCategory::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    /**
     * بوابة النشر العامة: استعلام صفوف النشر الفعّالة لقناة واحدة محلولة من
     * سياق موثوق (StorefrontContext) — يُستخدم كاستعلام فرعي (`select('category_id')`)
     * أو مع `where('category_id', …)->exists()`. TenantScope مطبَّق (سياق
     * المستأجر مضبوط من وسيط الحسم في كل المسارات العامة).
     */
    public static function publishedOn(string $salesChannelId): Builder
    {
        return static::query()
            ->where('sales_channel_id', $salesChannelId)
            ->where('is_published', true);
    }
}

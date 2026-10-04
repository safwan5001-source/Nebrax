<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use App\Tenancy\TenantContext;
use App\Tenancy\TenantScope;
use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use RuntimeException;

/**
 * CUST-H4-6 — مرشّحُ عرضٍ على متجر (تنسيق وجدولة فقط). **ليس سلطة سعر**:
 * لا عمود سعر/خصم/نسبة هنا إطلاقاً، ووجود الصف لا يكفي لظهور المنتج علناً —
 * `StorefrontOfferResolver` يشترط خصماً حقيقياً من `CommercePriceResolver`.
 *
 * **`CompanyWide`**: تابعٌ لـ`Storefront` (نفسه `CompanyWide`) — لا فرع للعرض.
 * المنتج مرجعٌ مخزَّن لا يُصفّى بالفرع؛ `saving` يتحقق بنيوياً أن المنتج
 * والمتجر للمستأجر نفسه (لا يكفي قيد FK الذي يثبت الوجود لا الملكية).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: تابعٌ لمتجرٍ على مستوى المؤسسة */
class StorefrontOffer extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    protected $fillable = [
        'tenant_id', 'storefront_id', 'product_id', 'starts_at', 'ends_at', 'is_active', 'position',
    ];

    protected $casts = [
        'starts_at' => 'datetime',
        'ends_at' => 'datetime',
        'is_active' => 'boolean',
        'position' => 'integer',
    ];

    protected $attributes = [
        'is_active' => true,
        'position' => 0,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $offer) {
            $tenantId = $offer->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null) {
                return;
            }

            if ($offer->starts_at !== null && $offer->ends_at !== null && ! $offer->starts_at->lt($offer->ends_at)) {
                throw new RuntimeException('بداية العرض يجب أن تسبق نهايته.');
            }

            $product = Product::withoutGlobalScopes()->select(['id', 'tenant_id'])->find($offer->product_id);
            if ($product === null || $product->tenant_id !== $tenantId) {
                throw new RuntimeException('المنتج غير موجود لهذا المستأجر.');
            }

            $storefront = Storefront::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id'])
                ->find($offer->storefront_id);
            if ($storefront === null || $storefront->tenant_id !== $tenantId) {
                throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
            }
        });
    }

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    /**
     * نافذة الصلاحية — **مغلقة من الطرفين**: `starts_at` فارغ أو ≤ الآن، و
     * `ends_at` فارغ أو ≥ الآن. UTC (التخزين والمقارنة معاً). النسخة الاستعلامية
     * (`scopeWithinWindow`) والنسخة الذاكرية (`isWithinWindow`) يحرسهما اختبارٌ
     * واحد على الحدود الدقيقة كي لا ينحرف أحدهما عن الآخر.
     */
    public function scopeWithinWindow(Builder $query, CarbonInterface $now): Builder
    {
        return $query
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', $now))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>=', $now));
    }

    public function isWithinWindow(CarbonInterface $now): bool
    {
        return ($this->starts_at === null || $this->starts_at->lte($now))
            && ($this->ends_at === null || $this->ends_at->gte($now));
    }

    /** الترتيب الحتمي الوحيد: ترتيب التاجر ثم الأقدم ثم المعرّف. */
    public function scopeOrdered(Builder $query): Builder
    {
        return $query->orderBy('position')->orderBy('created_at')->orderBy('id');
    }
}

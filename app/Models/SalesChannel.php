<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * قناة بيع Commerce — من أي قناة تجارية جاء البيع، لا من أي فرع يُدار ولا من
 * أي مخزن سيُنفَّذ (ADR-03 §1: `SalesChannel != Branch != Warehouse`).
 *
 * **`CompanyWide`**: القناة تخصّ المؤسسة كلها، كـ`Role`/`PaymentMethod` —
 * لا فرعاً بعينه. عمداً بلا `branch_id` وبلا `warehouse_id`: ربط قناة
 * بمخزن التنفيذ مسؤولية Fulfillment Policy في PR-COM-2B، لا هذا النموذج
 * (ADR-03 §3/§7).
 *
 * `slug` هويةٌ مستقرة قابلة للقراءة آلياً — نفس نمط `Role::$slug`
 * (`unique(tenant_id, slug)`، لا تحويل تلقائي، المستدعي يُقرِّرها صراحةً).
 * نفس السلاج الحرفي مسموحٌ لمستأجرين مختلفين لأن التفرّد مقيَّدٌ بالمستأجر.
 */
class SalesChannel extends BaseModel implements CompanyWide
{
    use SoftDeletes;

    public const TYPE_WEB = 'web';

    public const TYPE_MOBILE = 'mobile';

    public const TYPE_POS = 'pos';

    public const TYPE_EXTERNAL = 'external';

    protected $fillable = [
        'tenant_id', 'slug', 'name', 'type', 'is_active', 'default_price_list_id',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'is_active' => true,
    ];

    protected static function booted(): void
    {
        static::saving(function (self $channel): void {
            if ($channel->default_price_list_id === null) {
                return;
            }

            $tenantId = $channel->tenant_id ?? app(TenantContext::class)->id();
            if ($tenantId === null || $tenantId !== app(TenantContext::class)->id()) {
                throw new DomainException('Sales channel must belong to the active tenant.');
            }

            // Keep TenantScope in place: a known foreign UUID must be indistinguishable
            // from an unavailable list and must never become channel pricing authority.
            if (! PriceList::query()
                ->whereKey($channel->default_price_list_id)
                ->where('is_active', true)
                ->exists()
            ) {
                throw new DomainException('Default price list must be active and belong to the active tenant.');
            }
        });
    }

    public function defaultPriceList(): BelongsTo
    {
        return $this->belongsTo(PriceList::class, 'default_price_list_id');
    }
}

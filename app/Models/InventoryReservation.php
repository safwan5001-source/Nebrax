<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * حجز مخزوني — وعدٌ تشغيلي يخصم من Available-to-Sell، لا حركة مخزون.
 * لا يُنشئ ولا يُعدِّل `stock_movements` ولا `product_warehouse_stock.quantity`
 * ولا `products.quantity_on_hand`/`avg_cost` ولا أي قيدٍ محاسبي (ADR-02 §11).
 *
 * `base_quantity` كمية أساس دائماً — لا تحويل وحدات هنا (ADR-02 §10).
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: حجزٌ تابع لمخزن — العزل عبر المخزن/الفرع، كـProductWarehouseStock تماماً */
class InventoryReservation extends BaseModel implements CompanyWide
{
    use ResolvesBranchReferences;

    public const STATUS_ACTIVE = 'active';

    public const STATUS_CONSUMED = 'consumed';

    public const STATUS_RELEASED = 'released';

    public const STATUS_EXPIRED = 'expired';

    protected $fillable = [
        'tenant_id', 'warehouse_id', 'product_id', 'base_quantity', 'status',
        'source_type', 'source_id', 'idempotency_key', 'request_checksum',
        'expires_at', 'released_at', 'consumed_at', 'expired_at',
    ];

    protected $casts = [
        'base_quantity' => 'integer',
        'expires_at' => 'datetime',
        'released_at' => 'datetime',
        'consumed_at' => 'datetime',
        'expired_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
    ];

    /** مرجع مخزَّن — لا يُصفّى بالفرع أبداً (وإلا اختفى الحجز عن مسارٍ لا يرى فرع المنتج). */
    public function product(): BelongsTo
    {
        return $this->referenceBelongsTo(Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }
}

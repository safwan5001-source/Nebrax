<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * حالة مخزون منتج (منخفض/نافد) — مصدر حقيقة داخلي لدورة تنبيه المخزون فقط.
 * ليست إشعاراً (انظر `App\Models\Notification`) وليست جزءاً من `FinancialControlAlert`.
 *
 * `BelongsToBranch`: وسمٌ من فرع المنتج وقت الاكتشاف بلا Scope عالمي — العتبة
 * كمّية إجمالية على المنتج، فلا معنى لعزلها بفرعٍ نشط (نفس منطق
 * `FinancialControlAlert`).
 */
class InventoryStockAlert extends BaseModel
{
    use BelongsToBranch;

    public const STATUS_ACTIVE = 'active';
    public const STATUS_RESOLVED = 'resolved';

    public const TYPE_LOW_STOCK = 'low_stock';
    public const TYPE_OUT_OF_STOCK = 'out_of_stock';

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'product_id',
        'status',
        'type',
        'cycle',
        'quantity_on_hand',
        'reorder_level',
        'first_detected_at',
        'last_detected_at',
        'resolved_at',
    ];

    protected $casts = [
        'cycle' => 'integer',
        'quantity_on_hand' => 'integer',
        'reorder_level' => 'integer',
        'first_detected_at' => 'datetime',
        'last_detected_at' => 'datetime',
        'resolved_at' => 'datetime',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }
}

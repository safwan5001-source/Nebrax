<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * مسودة سلة POS غير مالية. لا تمثل فاتورة ولا تخصم مخزوناً ولا تنشئ قيداً.
 * تبقى لقطة الأصناف والأسعار والخصومات في payload حتى يستأنفها الكاشير أو تُلغى.
 */
class PosHeldSale extends BaseModel
{
    use BranchScoped;

    public const STATUS_HELD = 'held';
    public const STATUS_RESUMED = 'resumed';
    public const STATUS_DISCARDED = 'discarded';

    protected $fillable = [
        'tenant_id',
        'branch_id',
        'pos_session_id',
        'resumed_pos_session_id',
        'warehouse_id',
        'customer_id',
        'held_by',
        'status',
        'payload',
        'resumed_at',
        'discarded_at',
    ];

    protected $attributes = [
        'status' => self::STATUS_HELD,
    ];

    protected $casts = [
        'payload' => 'array',
        'resumed_at' => 'datetime',
        'discarded_at' => 'datetime',
    ];

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function resumedSession(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'resumed_pos_session_id');
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(Partner::class, 'customer_id');
    }

    public function heldBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'held_by');
    }
}

<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجل تدقيق append-only لجلسة POS. يشرح الحدث ولا يعدّل أي رصيد أو قيد محاسبي.
 */
class PosSessionEvent extends BaseModel
{
    use BranchScoped;

    public const TYPE_CASH_IN_RECORDED = 'cash_in_recorded';
    public const TYPE_CASH_OUT_RECORDED = 'cash_out_recorded';
    public const TYPE_RETURN_RECORDED = 'return_recorded';
    public const TYPE_EXCHANGE_RECORDED = 'exchange_recorded';
    public const TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT = 'closing_difference_requires_acknowledgement';
    public const TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED = 'closing_difference_acknowledged';
    public const TYPE_CLOSING_DIFFERENCE_SETTLED = 'closing_difference_settled';
    public const TYPE_CASH_DRAWER_OPEN_ATTEMPT = 'cash_drawer_open_attempt';
    public const TYPE_CART_CREATED = 'cart_created';
    public const TYPE_ITEM_ADDED = 'item_added';
    public const TYPE_ITEM_REMOVED = 'item_removed';
    public const TYPE_ITEM_QUANTITY_CHANGED = 'item_quantity_changed';
    public const TYPE_PRICE_OVERRIDDEN = 'price_overridden';
    public const TYPE_DISCOUNT_APPLIED = 'discount_applied';
    public const TYPE_DISCOUNT_CHANGED = 'discount_changed';
    public const TYPE_DISCOUNT_REMOVED = 'discount_removed';
    public const TYPE_CUSTOMER_CHANGED = 'customer_changed';
    public const TYPE_PAYMENT_STARTED = 'payment_started';
    public const TYPE_PAYMENT_CANCELLED = 'payment_cancelled';
    public const TYPE_PAYMENT_FAILED = 'payment_failed';
    public const TYPE_CART_HELD = 'cart_held';
    public const TYPE_CART_RESUMED = 'cart_resumed';
    public const TYPE_CART_DISCARDED = 'cart_discarded';
    public const TYPE_CART_CANCELLED = 'cart_cancelled';
    public const TYPE_CHECKOUT_STARTED = 'checkout_started';
    public const TYPE_CHECKOUT_COMPLETED = 'checkout_completed';
    public const TYPE_CLOSING_COUNT_SUBMITTED = 'closing_count_submitted';
    public const TYPE_CLOSING_COUNT_REVEALED = 'closing_count_revealed';
    public const TYPE_CLOSING_COUNT_RECOUNTED = 'closing_count_recounted';
    public const TYPE_OVERRIDE_REQUESTED = 'override_requested';
    public const TYPE_OVERRIDE_APPROVED = 'override_approved';
    public const TYPE_OVERRIDE_CONSUMED = 'override_consumed';

    public const TYPES = [
        self::TYPE_CASH_IN_RECORDED,
        self::TYPE_CASH_OUT_RECORDED,
        self::TYPE_RETURN_RECORDED,
        self::TYPE_EXCHANGE_RECORDED,
        self::TYPE_CLOSING_DIFFERENCE_REQUIRES_ACKNOWLEDGEMENT,
        self::TYPE_CLOSING_DIFFERENCE_ACKNOWLEDGED,
        self::TYPE_CLOSING_DIFFERENCE_SETTLED,
        self::TYPE_CASH_DRAWER_OPEN_ATTEMPT,
            self::TYPE_CART_CREATED,
            self::TYPE_ITEM_ADDED,
            self::TYPE_ITEM_REMOVED,
            self::TYPE_ITEM_QUANTITY_CHANGED,
            self::TYPE_PRICE_OVERRIDDEN,
            self::TYPE_DISCOUNT_APPLIED,
            self::TYPE_DISCOUNT_CHANGED,
            self::TYPE_DISCOUNT_REMOVED,
            self::TYPE_CUSTOMER_CHANGED,
            self::TYPE_PAYMENT_STARTED,
            self::TYPE_PAYMENT_CANCELLED,
            self::TYPE_PAYMENT_FAILED,
            self::TYPE_CART_HELD,
            self::TYPE_CART_RESUMED,
            self::TYPE_CART_DISCARDED,
            self::TYPE_CART_CANCELLED,
            self::TYPE_CHECKOUT_STARTED,
            self::TYPE_CHECKOUT_COMPLETED,
            self::TYPE_CLOSING_COUNT_SUBMITTED,
            self::TYPE_CLOSING_COUNT_REVEALED,
            self::TYPE_CLOSING_COUNT_RECOUNTED,
            self::TYPE_OVERRIDE_REQUESTED,
            self::TYPE_OVERRIDE_APPROVED,
            self::TYPE_OVERRIDE_CONSUMED,
        ];

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'branch_id', 'pos_session_id', 'cart_id', 'correlation_id', 'type', 'category',
        'actor_id', 'amount', 'reason_code', 'reason_note', 'performed_by', 'approved_by', 'payload', 'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('سجل أحداث جلسة نقطة البيع لا يعدّل بعد إنشائه.'));
        static::deleting(static fn () => throw new LogicException('سجل أحداث جلسة نقطة البيع لا يحذف.'));
    }

    protected function casts(): array
    {
        return [
            'amount' => 'integer',
            'payload' => 'array',
            'created_at' => 'datetime',
        ];
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }

    public function performedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'performed_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}

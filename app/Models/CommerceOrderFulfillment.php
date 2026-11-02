<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تنفيذ طلب متجر (COPS-H2-1، ADR-29 §2.3): صف واحد لكل طلب في V1، كسول (لا يوجد قبل أول إجراء). `CompanyWide` كالطلب نفسه.
 *
 * **الكاتب الوحيد** {@see \App\Services\Commerce\CommerceOrderFulfillmentService}؛ لا `$fillable` عمداً (لا إسناد جماعي) والحالة/النسخة/الطوابع يكتبها
 * بـ`forceFill` تحت الأقفال، وتحرسها مُشغّلات القاعدة (PG + SQLite). لا يكتب مخزوناً ولا قيداً ولا فاتورة ولا حجزاً.
 *
 * @property string $id
 * @property string $commerce_order_id
 * @property string $warehouse_id
 * @property string $type
 * @property string $status
 * @property int $version
 */
class CommerceOrderFulfillment extends BaseModel implements CompanyWide
{
    protected $table = 'commerce_order_fulfillments';

    public const TYPE_LOCAL_DELIVERY = 'local_delivery';

    public const TYPE_CARRIER = 'carrier';

    public const TYPE_PICKUP = 'pickup';

    public const TYPES = [self::TYPE_LOCAL_DELIVERY, self::TYPE_CARRIER, self::TYPE_PICKUP];

    public const PREPARING = 'preparing';

    public const READY = 'ready';

    public const OUT_FOR_DELIVERY = 'out_for_delivery';

    public const DELIVERY_FAILED = 'delivery_failed';

    public const RETURNED_TO_STORE = 'returned_to_store';

    public const DELIVERED = 'delivered';

    public const PICKED_UP = 'picked_up';

    public const STATUSES = [self::PREPARING, self::READY, self::OUT_FOR_DELIVERY, self::DELIVERY_FAILED, self::RETURNED_TO_STORE, self::DELIVERED, self::PICKED_UP];

    /** حالات تمنع إلغاء الطلب: في النقل (`fulfillment_in_transit`). */
    public const IN_TRANSIT = [self::OUT_FOR_DELIVERY, self::DELIVERY_FAILED];

    /** حالات نهائية مكتملة (`fulfillment_completed`). */
    public const COMPLETED = [self::DELIVERED, self::PICKED_UP];

    /** أسباب فشل التوصيل — قائمة مغلقة (D-H2-05). */
    public const FAILURE_REASONS = ['customer_unreachable', 'address_issue', 'recipient_absent', 'customer_refused', 'other'];

    protected $fillable = [];

    protected function casts(): array
    {
        return [
            'version' => 'integer',
            'delivery_attempts' => 'integer',
            'preparing_at' => 'datetime',
            'ready_at' => 'datetime',
            'first_dispatched_at' => 'datetime',
            'last_dispatched_at' => 'datetime',
            'last_failed_at' => 'datetime',
            'last_returned_at' => 'datetime',
            'delivered_at' => 'datetime',
            'picked_up_at' => 'datetime',
        ];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(Warehouse::class);
    }

    public function isTerminal(): bool
    {
        return in_array($this->status, self::COMPLETED, true);
    }
}

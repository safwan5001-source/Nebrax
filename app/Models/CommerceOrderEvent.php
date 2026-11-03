<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * حدث ثابت في سجل طلب المتجر (COPS-H1-1، ADR-29 §2.4). يكتبه `CommerceOrderEventRecorder` وحده داخل معاملة الانتقال؛ `feed_seq` تسلسل
 * لكل مستأجر بلا فجوات بترتيب الالتزام. لا تحديث ولا حذف (يفرضه النموذج هنا ومُشغّلات القاعدة معاً). `CompanyWide`: يتبع الطلب المؤسسي.
 *
 * @property string $commerce_order_id
 * @property int $feed_seq
 * @property string $type
 * @property string $actor_type
 * @property ?string $actor_id
 * @property ?array<string, mixed> $data
 */
class CommerceOrderEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const ORDER_PLACED = 'order.placed';

    public const ORDER_CANCELLED = 'order.cancelled';

    public const PAYMENT_PAID = 'payment.paid';

    public const PAYMENT_COLLECTED = 'payment.collected';

    /** COPS-H1-4: قبول التاجر اليدوي لطلب (`data` فارغة؛ الفاعل موظف). رفض التاجر ليس نوعاً جديداً: `order.cancelled` بسبب `merchant_rejected`. */
    public const ORDER_ACCEPTED = 'order.accepted';

    /** COPS-H3-4 (R-10): إقرار تنبيه الطلب لكل طلب (`data` فارغة؛ الفاعل موظف). لا يغيّر حالة الطلب. */
    public const ORDER_ACKNOWLEDGED = 'order.acknowledged';

    /** القائمة المغلقة (تطابق CHECK/مُشغّل القاعدة حرفياً؛ يحرسها اختبار). الإضافة بهجرة صريحة في شريحتها. */
    /** COPS-H2-1: أحداث تنفيذ الطلب (`data` قائمة بيضاء بلا ناقل/تتبع/ساعٍ/ملاحظة). */
    public const FULFILLMENT_STARTED = 'fulfillment.started';

    public const FULFILLMENT_READY = 'fulfillment.ready';

    public const FULFILLMENT_DISPATCHED = 'fulfillment.dispatched';

    public const FULFILLMENT_DELIVERY_FAILED = 'fulfillment.delivery_failed';

    public const FULFILLMENT_RETURNED = 'fulfillment.returned';

    public const FULFILLMENT_DELIVERED = 'fulfillment.delivered';

    public const FULFILLMENT_PICKED_UP = 'fulfillment.picked_up';

    public const FULFILLMENT_DETAILS_UPDATED = 'fulfillment.details_updated';

    public const TYPES = [
        self::ORDER_PLACED, self::ORDER_CANCELLED, self::PAYMENT_PAID, self::PAYMENT_COLLECTED, self::ORDER_ACCEPTED,
        self::FULFILLMENT_STARTED, self::FULFILLMENT_READY, self::FULFILLMENT_DISPATCHED, self::FULFILLMENT_DELIVERY_FAILED,
        self::FULFILLMENT_RETURNED, self::FULFILLMENT_DELIVERED, self::FULFILLMENT_PICKED_UP, self::FULFILLMENT_DETAILS_UPDATED,
        self::ORDER_ACKNOWLEDGED,
    ];

    public const ACTOR_USER = 'user';

    public const ACTOR_CUSTOMER = 'customer';

    public const ACTOR_GUEST = 'guest';

    public const ACTOR_SYSTEM = 'system';

    public const ACTORS = [self::ACTOR_USER, self::ACTOR_CUSTOMER, self::ACTOR_GUEST, self::ACTOR_SYSTEM];

    /** مفاتيح `data` المسموحة لكل نوع — قائمة بيضاء تمنع تسرّب PII أو مبالغ (لا اسم ولا هاتف ولا ملاحظة). */
    public const DATA_KEYS = [
        self::ORDER_PLACED => ['delivery_method', 'payment_method'],
        self::ORDER_CANCELLED => ['reason'],
        self::PAYMENT_PAID => [],
        self::PAYMENT_COLLECTED => [],
        self::ORDER_ACCEPTED => [],
        self::ORDER_ACKNOWLEDGED => [],
        self::FULFILLMENT_STARTED => [],
        self::FULFILLMENT_READY => [],
        self::FULFILLMENT_DISPATCHED => ['type', 'attempt'],
        self::FULFILLMENT_DELIVERY_FAILED => ['reason', 'attempt'],
        self::FULFILLMENT_RETURNED => [],
        self::FULFILLMENT_DELIVERED => [],
        self::FULFILLMENT_PICKED_UP => [],
        // أسماء الحقول المتغيّرة فقط (مفصولة بفاصلة) — لا قيم (ناقل/تتبع/ساعٍ/ملاحظة تبقى داخل صف التنفيذ).
        self::FULFILLMENT_DETAILS_UPDATED => ['fields'],
    ];

    protected $fillable = ['commerce_order_id', 'feed_seq', 'type', 'actor_type', 'actor_id', 'data', 'occurred_at'];

    protected function casts(): array
    {
        return ['feed_seq' => 'integer', 'data' => 'array', 'occurred_at' => 'datetime'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('أحداث الطلب ثابتة لا تُعدَّل.'));
        static::deleting(fn () => throw new LogicException('أحداث الطلب لا تُحذف.'));
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}

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

    /** القائمة المغلقة (تطابق CHECK/مُشغّل القاعدة حرفياً؛ يحرسها اختبار). الإضافة بهجرة صريحة في شريحتها. */
    public const TYPES = [self::ORDER_PLACED, self::ORDER_CANCELLED, self::PAYMENT_PAID, self::PAYMENT_COLLECTED];

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

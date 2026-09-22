<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * ═══════════════════════════════════════════════════════════════
 *  Payment Intent — أول تطبيق لحدّ ADR-04 المعماري (COM-MOBILE-PAYMENTS-1، ADR-09)
 * ═══════════════════════════════════════════════════════════════
 *
 * حدّ التنسيق بين `CommerceOrder` ومزوّدي الدفع (ADR-04 §1): «نيّة AWJ في
 * تحصيل مبلغ لالتزام طلبٍ معتمد» — لا معاملة مزوّد، لا سند دفع فعلي بعد.
 * V1 مقيَّدٌ بطريقتين لا تحتاجان مزوّداً: `cod` (تحصيل عند التوصيل، يرافق
 * `standard`) و`pay_on_pickup` (تحصيل عند الاستلام، يرافق `pickup`) — تُشتقّ
 * من طريقة توصيل الطلب حصراً، وليست اختياراً مستقلاً في هذا الإصدار.
 *
 * **لا يُمثَّل مدفوعاً عند الإنشاء أبداً** (ADR-04 §5) — الحالة الابتدائية
 * `awaiting_collection` دوماً، والانتقال إلى `collected` فعلٌ صريحٌ منفصل
 * عبر `CommercePaymentIntentService::markCollected()` فقط.
 *
 * **`CompanyWide`**: يتبع تصنيف رأسه (`CommerceOrder`) — لا فرعاً بعينه،
 * قناة البيع لا الفرع هي حدود Commerce (ADR-03 §1).
 */
class CommercePaymentIntent extends BaseModel implements CompanyWide
{
    public const METHOD_COD = 'cod';

    public const METHOD_PAY_ON_PICKUP = 'pay_on_pickup';

    public const METHODS = [self::METHOD_COD, self::METHOD_PAY_ON_PICKUP];

    public const STATUS_PENDING = 'pending';

    public const STATUS_AWAITING_COLLECTION = 'awaiting_collection';

    public const STATUS_COLLECTED = 'collected';

    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'tenant_id', 'commerce_order_id', 'payment_method_id', 'payment_method_name',
        'method', 'status', 'amount_minor', 'currency',
        'collected_at', 'cancelled_at', 'collection_note',
    ];

    protected $casts = [
        'amount_minor' => 'integer',
        'collected_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_AWAITING_COLLECTION,
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }

    public function paymentMethod(): BelongsTo
    {
        return $this->belongsTo(PaymentMethod::class);
    }

    public function isCollected(): bool
    {
        return $this->status === self::STATUS_COLLECTED;
    }

    public function isCancelled(): bool
    {
        return $this->status === self::STATUS_CANCELLED;
    }
}

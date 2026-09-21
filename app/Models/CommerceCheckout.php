<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;

/**
 * جلسة إتمام شراء مؤقتة — أساسها COM-CHECKOUT-1A. ليست مستنداً مالياً ولا
 * طلباً بحدّ ذاتها (`CommerceCheckout != CommerceOrder`).
 *
 * **COM-CHECKOUT-1B (قرار الهوية — Unify/Migrate)**: `App\Models\CommerceOrder`
 * القائم (PR-COM-5A/6B/6C) هو ذاته وجهة إتمام هذا الـ Checkout — لا كيان
 * Order ثانٍ. `order()` أدناه يربط 0-أو-1 طلبٍ ناتج؛
 * `completion_idempotency_key_hash`/`completion_idempotency_fingerprint`
 * يُملآن حصراً داخل نفس معاملة `CommerceCheckoutService::complete()` التي
 * تنشئ ذلك الطلب وتنقل `status` إلى `completed` — راجع توثيق migration
 * إضافتهما لتفصيل عقد Idempotency-Key الكامل.
 *
 * **`CompanyWide`**: تتبع تصنيف Cart/CommerceListing/FulfillmentPolicy —
 * جلسةٌ تابعة لقناة بيع، لا فرعٍ بعينه (`SalesChannel != Branch`).
 *
 * لا يُنشئ قيداً ولا حجز مخزون ولا أثراً محاسبياً — أساسٌ فقط.
 */
class CommerceCheckout extends BaseModel implements CompanyWide
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_READY = 'ready';

    public const STATUS_COMPLETED = 'completed';

    public const STATUS_EXPIRED = 'expired';

    /** حالات غير نهائية — تقبل PATCH ويجوز أن تصبح Checkout الحالي لسلّتها. */
    public const OPEN_STATUSES = [self::STATUS_ACTIVE, self::STATUS_READY];

    protected $fillable = [
        'tenant_id', 'storefront_id', 'sales_channel_id', 'cart_id',
        'status', 'expires_at',
        'contact_name', 'contact_phone', 'contact_email',
        'delivery_country', 'delivery_region', 'delivery_city', 'delivery_district',
        'delivery_street', 'delivery_building_no', 'delivery_additional_number',
        'delivery_postal_code', 'delivery_notes',
        'delivery_method', 'delivery_amount_minor',
        'completion_idempotency_key_hash', 'completion_idempotency_fingerprint',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
        'delivery_amount_minor' => 'integer',
    ];

    protected $attributes = [
        'status' => self::STATUS_ACTIVE,
        'delivery_amount_minor' => 0,
    ];

    public function storefront(): BelongsTo
    {
        return $this->belongsTo(Storefront::class);
    }

    public function salesChannel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class);
    }

    public function cart(): BelongsTo
    {
        return $this->belongsTo(CommerceCart::class, 'cart_id');
    }

    public function isOpen(): bool
    {
        return in_array($this->status, self::OPEN_STATUSES, true);
    }

    /** COM-CHECKOUT-1B — الطلب الناتج عن إتمام هذا الـ Checkout، إن وُجد. */
    public function order(): HasOne
    {
        return $this->hasOne(CommerceOrder::class, 'commerce_checkout_id');
    }
}

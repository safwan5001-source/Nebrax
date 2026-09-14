<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * جلسة إتمام شراء مؤقتة — COM-CHECKOUT-1A. ليست مستنداً مالياً ولا طلباً
 * (`CommerceCheckout != CommerceOrder`؛ ملاحظة تسمية: يوجد بالفعل
 * `App\Models\CommerceOrder` من نطاق PR-COM-5A/6B/6C غير متعلّق بهذا —
 * سجلّ التزامٍ تجاريّ بحالتَي draft/confirmed منفصلتَين تماماً عن سلسلة
 * Cart→Checkout→Order التي تبنيها هذه الهجرة؛ الفصل بينهما قرار CHECKOUT-1B
 * لا 1A).
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
        'delivery_street', 'delivery_postal_code', 'delivery_notes',
        'delivery_method', 'delivery_amount_minor',
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
}

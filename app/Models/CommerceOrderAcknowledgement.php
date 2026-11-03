<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * إقرار تنبيه طلب متجر (COPS-H3-4، ADR-30 §4 — R-10): **لكل طلب** (يُسكت التنبيه على كل الأجهزة والمستخدمين) دون تغيير حالة الطلب أو إخراجه من قوائم العمل.
 * `CompanyWide` كالطلب. **الكاتب الوحيد** {@see \App\Services\Commerce\CommerceOrderAcknowledgementService} (لا `$fillable`، يحرسه اختبار ساكن).
 *
 * @property string $commerce_order_id
 * @property ?string $acknowledged_by_user_id
 * @property \Carbon\CarbonInterface $acknowledged_at
 */
class CommerceOrderAcknowledgement extends BaseModel implements CompanyWide
{
    protected $table = 'commerce_order_acknowledgements';

    protected $fillable = [];

    protected function casts(): array
    {
        return ['acknowledged_at' => 'datetime'];
    }

    public function order(): BelongsTo
    {
        return $this->belongsTo(CommerceOrder::class, 'commerce_order_id');
    }
}

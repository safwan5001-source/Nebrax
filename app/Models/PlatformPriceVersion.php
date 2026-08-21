<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * نسخة سعر داخلية مؤرخة لخطة منصة Nebrax.
 *
 * لا تتبع مستأجراً ولا تنشئ فاتورة أو تحصيلاً. يبقى السعر الذي اختاره العقد
 * مثبتاً عبر platform_price_version_id حتى عند إدخال نسخة سعر أحدث.
 */
class PlatformPriceVersion extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'plan',
        'currency',
        'monthly_amount',
        'effective_on',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'monthly_amount' => 'integer',
            'effective_on'   => 'date',
        ];
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'created_by');
    }

    public function subscriptions(): HasMany
    {
        return $this->hasMany(PlatformSubscription::class, 'platform_price_version_id');
    }

    /** أحدث سعر نافذ لخطة وعملة في تاريخ محدد. */
    public function scopeEffectiveOn(Builder $query, string $plan, string $currency, \DateTimeInterface $date): Builder
    {
        return $query
            ->where('plan', $plan)
            ->where('currency', $currency)
            ->whereDate('effective_on', '<=', $date)
            ->orderByDesc('effective_on');
    }
}

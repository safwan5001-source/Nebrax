<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * عقد اشتراك تشغيلي للمنصة.
 *
 * لا يرث BaseModel عمداً ولا يظهر في أي مسار مستأجر؛ فهو يُقرأ حصراً من لوحة
 * المنصة المجمعة. `monthly_amount` يمثل الإيراد الشهري المتعاقد عليه بالهللات
 * ولا يثبت تحصيل نقدي أو يولّد أثراً في دفتر أي مستأجر.
 */
class PlatformSubscription extends Model
{
    use HasUuids, SoftDeletes;

    public const STATUS_TRIAL = 'trial';
    public const STATUS_ACTIVE = 'active';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_EXPIRED = 'expired';

    public const STATUSES = [
        self::STATUS_TRIAL,
        self::STATUS_ACTIVE,
        self::STATUS_CANCELLED,
        self::STATUS_EXPIRED,
    ];

    public $incrementing = false;

    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id',
        'plan',
        'status',
        'monthly_amount',
        'currency',
        'starts_on',
        'ends_on',
        'cancelled_at',
        'external_reference',
    ];

    protected function casts(): array
    {
        return [
            'monthly_amount' => 'integer',
            'starts_on'      => 'date',
            'ends_on'        => 'date',
            'cancelled_at'   => 'datetime',
        ];
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** نطاق الاشتراكات المتعاقد عليها والنافذة في تاريخ محدد. */
    public function scopeActiveOn(Builder $query, \DateTimeInterface $date): Builder
    {
        return $query
            ->where('status', self::STATUS_ACTIVE)
            ->whereDate('starts_on', '<=', $date)
            ->where(function (Builder $query) use ($date): void {
                $query->whereNull('ends_on')->orWhereDate('ends_on', '>=', $date);
            });
    }
}

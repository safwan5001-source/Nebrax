<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * سجل تدقيق immutable لدورة عقد منصة Nebrax.
 *
 * الأحداث تفسّر التغير التجاري للعقد ولا تغيّر وصول المستأجر أو تمثل فاتورة أو
 * تحصيلاً. لا توجد حقول قابلة للتعديل أو timestamps تلقائية كي يبقى السجل append-only.
 */
class PlatformSubscriptionEvent extends Model
{
    use HasUuids;

    public const ACTION_CREATED = 'created';
    public const ACTION_UPGRADED = 'upgraded';
    public const ACTION_DOWNGRADED = 'downgraded';
    public const ACTION_CANCELLED = 'cancelled';
    public const ACTION_EXPIRED = 'expired';

    public const ACTIONS = [
        self::ACTION_CREATED,
        self::ACTION_UPGRADED,
        self::ACTION_DOWNGRADED,
        self::ACTION_CANCELLED,
        self::ACTION_EXPIRED,
    ];

    public $incrementing = false;

    public $timestamps = false;

    protected $keyType = 'string';

    protected $fillable = [
        'platform_subscription_id',
        'tenant_id',
        'platform_administrator_id',
        'action',
        'from_plan',
        'to_plan',
        'from_monthly_amount',
        'to_monthly_amount',
        'effective_on',
        'reason',
        'metadata',
        'created_at',
    ];

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('أحداث عقود المنصة لا تعدّل بعد إنشائها.'));
        static::deleting(static fn () => throw new LogicException('أحداث عقود المنصة لا تحذف بعد إنشائها.'));
    }

    protected function casts(): array
    {
        return [
            'from_monthly_amount' => 'integer',
            'to_monthly_amount'   => 'integer',
            'effective_on'         => 'date',
            'metadata'             => 'array',
            'created_at'           => 'datetime',
        ];
    }

    public function subscription(): BelongsTo
    {
        return $this->belongsTo(PlatformSubscription::class, 'platform_subscription_id');
    }

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function administrator(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id');
    }
}

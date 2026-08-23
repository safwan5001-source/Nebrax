<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

class TenantCommercialAssignmentEvent extends Model implements CompanyWide
{
    use HasUuids;

    public const UPDATED_AT = null;

    public const ACTION_ASSIGNED = 'assigned';
    public const ACTION_CANCELLED = 'cancelled';
    public const ACTION_REVOKED = 'revoked';
    public const ACTION_PAYMENT_FAILED = 'payment_failed';
    public const ACTION_GRACE_FULL_STARTED = 'grace_full_started';
    public const ACTION_GRACE_READ_ONLY_STARTED = 'grace_read_only_started';
    public const ACTION_EXPIRED = 'expired';
    public const ACTION_CANCELLATION_SCHEDULED = 'cancellation_scheduled';
    public const ACTION_TRIAL_STARTED = 'trial_started';

    protected $fillable = [
        'tenant_commercial_assignment_id', 'tenant_id', 'platform_administrator_id',
        'action', 'effective_at', 'reason', 'metadata',
    ];

    protected function casts(): array
    {
        return ['effective_at' => 'immutable_datetime', 'metadata' => 'array'];
    }

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Commercial assignment events are immutable.'));
        static::deleting(fn () => throw new LogicException('Commercial assignment events cannot be deleted.'));
    }

    public function assignment(): BelongsTo { return $this->belongsTo(TenantCommercialAssignment::class, 'tenant_commercial_assignment_id'); }
    public function tenant(): BelongsTo { return $this->belongsTo(Tenant::class); }
    public function administrator(): BelongsTo { return $this->belongsTo(PlatformAdministrator::class, 'platform_administrator_id'); }
}

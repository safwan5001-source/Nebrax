<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** H6 Batch E — append-only wholesale membership decision history. Never updated or deleted. */
class WholesaleMembershipEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id', 'wholesale_membership_id', 'from_status', 'to_status', 'actor_type', 'actor_user_id', 'note',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Wholesale membership events are immutable.'));
        static::deleting(fn () => throw new LogicException('Wholesale membership events cannot be deleted.'));
    }

    public function membership(): BelongsTo
    {
        return $this->belongsTo(WholesaleMembership::class, 'wholesale_membership_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}

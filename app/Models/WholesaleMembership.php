<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * H6 Batch E — a buyer identity's wholesale eligibility on ONE sales channel. Eligibility only: this row
 * never holds credentials or session state, and authentication state (`customer_identities.is_active`,
 * token validity) is evaluated independently of it.
 *
 * `CompanyWide`: scoped by (tenant, channel), not by ERP branch. Writes go through
 * {@see \App\Services\Commerce\WholesaleMembershipService}; `status` and the decision facts are not
 * mass-assignable.
 */
class WholesaleMembership extends BaseModel implements CompanyWide
{
    public const PENDING = 'pending';

    public const APPROVED = 'approved';

    public const REJECTED = 'rejected';

    public const SUSPENDED = 'suspended';

    public const STATUSES = [self::PENDING, self::APPROVED, self::REJECTED, self::SUSPENDED];

    protected $fillable = ['tenant_id', 'sales_channel_id', 'customer_identity_id', 'applied_at'];

    protected $attributes = ['status' => self::PENDING];

    protected $hidden = ['decision_note'];

    protected $casts = [
        'applied_at' => 'datetime',
        'decided_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::saving(function (self $membership): void {
            if (! in_array($membership->status, self::STATUSES, true)) {
                throw new DomainException('Invalid wholesale membership status.');
            }

            $context = app(TenantContext::class);
            $tenantId = $membership->tenant_id ?? $context->id();
            if ($tenantId === null || $tenantId !== $context->id()) {
                throw new DomainException('Wholesale membership must belong to the active tenant.');
            }

            if (! $membership->exists || $membership->isDirty(['sales_channel_id', 'customer_identity_id'])) {
                // TenantScope stays in place: a foreign id is indistinguishable from a missing one.
                $channel = SalesChannel::query()->whereKey($membership->sales_channel_id)->first();
                if ($channel === null
                    || $channel->type !== SalesChannel::TYPE_WEB
                    || ! $channel->wholesale_membership_enabled
                ) {
                    throw new DomainException('Membership channel must be a wholesale-enabled web channel of the active tenant.');
                }

                if (! CustomerIdentity::query()->whereKey($membership->customer_identity_id)->exists()) {
                    throw new DomainException('Membership identity must belong to the active tenant.');
                }
            }
        });

        static::deleting(fn () => throw new DomainException('Wholesale memberships are never deleted; suspend or reject instead.'));
    }

    public function identity(): BelongsTo
    {
        return $this->belongsTo(CustomerIdentity::class, 'customer_identity_id');
    }

    public function channel(): BelongsTo
    {
        return $this->belongsTo(SalesChannel::class, 'sales_channel_id');
    }

    public function decidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by_user_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(WholesaleMembershipEvent::class);
    }
}

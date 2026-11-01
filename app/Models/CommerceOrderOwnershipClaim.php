<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/** B2C-ACCOUNTS — append-only evidence of a guest order being linked to a verified customer identity. Never updated or deleted. */
class CommerceOrderOwnershipClaim extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const PROOF_VERIFIED_EMAIL = 'verified_email';

    public const PROOF_ORDER_REFERENCE = 'order_reference';

    protected $fillable = ['tenant_id', 'commerce_order_id', 'customer_identity_id', 'proof'];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Order ownership claims are immutable.'));
        static::deleting(fn () => throw new LogicException('Order ownership claims cannot be deleted.'));
    }
}

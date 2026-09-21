<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * A saved address in a Commerce customer's own address book (ADR-08),
 * owned by `CustomerIdentity` — not `Partner` (most Commerce customers have
 * no linked `Partner` at all; `Partner.address` is a single flat address,
 * never a book). Saudi National Address fields (`building_no`,
 * `additional_number`, `short_address`) are present but never
 * unconditionally required — see `CommerceCustomerAddressRequest` for the
 * country-aware validation.
 *
 * Mutable by design: editing or deleting a saved address here must never
 * reach back into a confirmed `CommerceOrderSnapshot` — that immutable
 * historical record is populated by copying fields at checkout time, not
 * by reference.
 */
class CommerceCustomerAddress extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'customer_identity_id',
        'label',
        'recipient_name',
        'phone',
        'country',
        'region',
        'city',
        'district',
        'street',
        'building_no',
        'additional_number',
        'postal_code',
        'short_address',
        'latitude',
        'longitude',
        'delivery_notes',
        'is_default_shipping',
        'is_default_billing',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'decimal:7',
            'longitude' => 'decimal:7',
            'is_default_shipping' => 'boolean',
            'is_default_billing' => 'boolean',
        ];
    }

    protected $attributes = [
        'is_default_shipping' => false,
        'is_default_billing' => false,
    ];

    public function customerIdentity(): BelongsTo
    {
        return $this->belongsTo(CustomerIdentity::class);
    }
}

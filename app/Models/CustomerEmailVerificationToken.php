<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * H6 Batch H — one e-mailed verification link of a buyer identity. Holds only the token's SHA-256; see the
 * migration for the guarantees. Tenant-scoped through {@see BaseModel}.
 */
class CustomerEmailVerificationToken extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = ['tenant_id', 'customer_identity_id', 'sales_channel_id', 'token_hash', 'expires_at', 'used_at'];

    protected $hidden = ['token_hash'];

    protected $casts = ['expires_at' => 'datetime', 'used_at' => 'datetime'];

    public function identity(): BelongsTo
    {
        return $this->belongsTo(CustomerIdentity::class, 'customer_identity_id');
    }
}

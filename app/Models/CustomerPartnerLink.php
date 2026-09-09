<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CustomerPartnerLink extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'customer_identity_id',
        'partner_id',
        'status',
        'link_method',
        'linked_by_user_id',
        'linked_at',
        'revoked_by_user_id',
        'revoked_at',
    ];

    protected $casts = [
        'linked_at' => 'datetime',
        'revoked_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => 'active',
    ];

    public function identity(): BelongsTo
    {
        return $this->belongsTo(CustomerIdentity::class, 'customer_identity_id');
    }

    public function partner(): BelongsTo
    {
        return $this->belongsTo(Partner::class);
    }

    public function linkedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'linked_by_user_id');
    }

    public function revokedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'revoked_by_user_id');
    }
}

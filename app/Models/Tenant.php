<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class Tenant extends Model
{
    use HasUuids, SoftDeletes;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'name', 'slug', 'vat_number', 'cr_number', 'currency', 'country',
        'timezone', 'plan', 'feature_flags', 'plan_limits',
        'trial_ends_at', 'subscription_ends_at', 'is_active',
    ];

    protected $casts = [
        'feature_flags'        => 'array',
        'plan_limits'          => 'array',
        'is_active'            => 'boolean',
        'trial_ends_at'        => 'datetime',
        'subscription_ends_at' => 'datetime',
    ];

    protected $attributes = [
        'is_active' => true,
        'plan'      => 'free',
        'currency'  => 'SAR',
    ];

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }
}

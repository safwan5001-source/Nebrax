<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

/** @see design-system/foundations/multi-branch-architecture.md — مشترك: دليل الحسابات — بنية واحدة للمنشأة (التخصيص للفروع عبر account_branch) */
class Account extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'parent_id', 'code', 'name', 'name_en',
        'type', 'normal_balance', 'is_group', 'is_system', 'currency', 'is_active',
    ];

    protected $casts = [
        'is_group'  => 'boolean',
        'is_system' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function parent(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'parent_id');
    }

    public function children(): HasMany
    {
        return $this->hasMany(Account::class, 'parent_id');
    }

    public function lines(): HasMany
    {
        return $this->hasMany(JournalLine::class);
    }

    public function balance(): HasOne
    {
        return $this->hasOne(AccountBalance::class, 'account_id');
    }
}

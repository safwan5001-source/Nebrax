<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use RuntimeException;

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

    protected static function booted(): void
    {
        static::deleting(function (Account $account): void {
            if ($account->is_system) {
                throw new RuntimeException('لا يمكن حذف حساب نظامي. عطّل الحساب أو أنشئ حساباً مخصصاً عند الحاجة.');
            }

            if ($account->children()->exists()) {
                throw new RuntimeException('لا يمكن حذف حساب يحتوي حسابات فرعية. عطّل الحسابات أو أعد تنظيمها أولاً.');
            }

            if ($account->lines()->exists()) {
                throw new RuntimeException('لا يمكن حذف حساب له حركات مالية. عطّله للحفاظ على الأثر المحاسبي.');
            }
        });
    }

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

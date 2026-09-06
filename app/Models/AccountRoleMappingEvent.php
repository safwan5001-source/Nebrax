<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/** سجل تدقيق ثابت لتعيين أدوار توجيه الحسابات. لا يُحدَّث ولا يُحذف بعد الإنشاء. */
class AccountRoleMappingEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'role_key',
        'action',
        'actor_user_id',
        'previous_account_id',
        'previous_account_code',
        'new_account_id',
        'new_account_code',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('Account role mapping events are immutable.'));
        static::deleting(fn () => throw new LogicException('Account role mapping events cannot be deleted.'));
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_user_id');
    }
}

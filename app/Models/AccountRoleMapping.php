<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * تعيين مستأجرٍ صريح لدور محاسبي دلالي (`App\Support\AccountingRoles`) إلى
 * حساب فعلي. دليل حسابات واحد للمنشأة كلها — لا `branch_id` في V1.
 */
class AccountRoleMapping extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'role_key', 'account_id',
    ];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}

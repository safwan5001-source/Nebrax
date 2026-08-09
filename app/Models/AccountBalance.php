<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: أرصدة مجمّعة على مستوى المنشأة؛ أرصدة الفرع تُحسب من سطور القيد */
class AccountBalance extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id', 'account_id', 'balance', 'total_debit', 'total_credit',
    ];

    protected $casts = [
        'balance'      => 'integer',
        'total_debit'  => 'integer',
        'total_credit' => 'integer',
    ];
}

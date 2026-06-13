<?php

namespace App\Models;

class AccountBalance extends BaseModel
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

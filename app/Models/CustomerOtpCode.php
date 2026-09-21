<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * A short-lived, hashed, attempt-limited OTP code issued to a phone number
 * for Commerce customer authentication (COM-MOBILE-AUTH-1). Never carries
 * the plaintext code — see `CustomerOtpService`. `CompanyWide`: this is
 * authentication plumbing tied to `tenant_id` alone, not an operational
 * record scoped to a branch.
 */
class CustomerOtpCode extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'phone_e164',
        'purpose',
        'code_hash',
        'attempts',
        'consumed_at',
        'expires_at',
    ];

    protected $casts = [
        'attempts' => 'integer',
        'consumed_at' => 'datetime',
        'expires_at' => 'datetime',
    ];

    protected $attributes = [
        'attempts' => 0,
    ];
}

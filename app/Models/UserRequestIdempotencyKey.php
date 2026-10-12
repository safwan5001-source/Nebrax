<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * سجلّ Idempotency لطلبات المستخدمين (S3): مملوك لمستأجر ومستخدم واحد، ومعزول بالمستأجر عبر
 * `BaseModel`. لا يحمل سراً: المفتاح مجزَّأ والحمولة مبصومة. `CompanyWide` (إقرار واعٍ): أثرٌ
 * تقني للطلب لا مستند محاسبي مرتبط بفرع، والمفتاح فريد لكل مستخدم.
 */
class UserRequestIdempotencyKey extends BaseModel implements CompanyWide
{
    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED = 'completed';

    protected $fillable = [
        'tenant_id', 'user_id', 'key_hash', 'method', 'route_identity', 'request_fingerprint',
        'status', 'response_status', 'response_body', 'response_headers',
        'locked_at', 'completed_at', 'expires_at',
    ];

    protected $casts = [
        'response_status' => 'integer',
        'response_headers' => 'array',
        'locked_at' => 'datetime',
        'completed_at' => 'datetime',
        'expires_at' => 'datetime',
    ];
}

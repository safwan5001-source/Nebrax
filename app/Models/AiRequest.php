<?php

namespace App\Models;

use App\Tenancy\CompanyWide;

/**
 * سجل طلب مزوّد المساعد الذكي (AI-02A): هوية الطلب، الحجز، التسوية، المحاولات.
 *
 * `CompanyWide` (إقرار واعٍ): سجل استهلاك على مستوى المؤسسة لا فرع. لا يحمل نصّ رسالة ولا
 * ردّاً ولا أسراراً — بصمة HMAC فقط. الحقول المالية تُغيَّر عبر `AiBudgetService` وحدها.
 */
class AiRequest extends BaseModel implements CompanyWide
{
    public const STATUS_RESERVED = 'reserved';

    public const STATUS_SETTLED = 'settled';

    public const STATUS_FAILED = 'failed';

    protected $fillable = [
        'tenant_id', 'actor_id', 'feature', 'provider', 'model', 'billable', 'idempotency_hash',
        'request_fingerprint', 'status', 'attempt', 'period', 'reserved_tokens', 'reserved_cost_micro_usd',
        'error_code', 'started_at',
    ];

    protected $hidden = ['idempotency_hash', 'request_fingerprint'];

    protected $casts = [
        'billable' => 'boolean',
        'attempt' => 'integer',
        'reserved_tokens' => 'integer',
        'reserved_cost_micro_usd' => 'integer',
        'input_tokens' => 'integer',
        'output_tokens' => 'integer',
        'unmetered_tokens' => 'integer',
        'cost_micro_usd' => 'integer',
        'started_at' => 'datetime',
        'completed_at' => 'datetime',
    ];
}

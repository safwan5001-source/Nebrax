<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * محاولة إرسال ZATCA دائمة. هوية المحاولة ولقطة الطلب لا تتغيران؛
 * طبقة الإرسال وحدها تنقل الحالة من pending إلى نتيجة نهائية.
 */
class ZatcaSubmissionAttempt extends BaseModel
{
    protected $fillable = [
        'branch_id',
        'invoice_id',
        'attempt_number',
        'submission_type',
        'source',
        'status',
        'idempotency_key_hash',
        'request_hash',
        'requested_by',
        'requested_at',
        'completed_at',
        'response_http_status',
        'response_code',
        'response_message',
        'response_payload',
    ];

    protected $hidden = [
        'idempotency_key_hash',
    ];

    protected $attributes = [
        'status' => 'pending',
        'source' => 'manual',
    ];

    protected function casts(): array
    {
        return [
            'attempt_number' => 'integer',
            'requested_at' => 'datetime',
            'completed_at' => 'datetime',
            'response_http_status' => 'integer',
            'response_payload' => 'array',
        ];
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}

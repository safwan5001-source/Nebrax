<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * محاولة إرسال ZATCA دائمة. هوية المحاولة ولقطة الطلب لا تتغيران؛
 * طبقة الإرسال وحدها تنقل الحالة من pending إلى نتيجة نهائية.
 */
class ZatcaSubmissionAttempt extends BaseModel
{
    use BelongsToBranch;

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

    protected static function booted(): void
    {
        static::creating(function (self $attempt): void {
            if (! in_array($attempt->submission_type, ['clearance', 'reporting'], true)
                || ! in_array($attempt->source, ['manual', 'automatic'], true)
                || $attempt->status !== 'pending') {
                throw new LogicException('Invalid ZATCA submission attempt identity.');
            }
        });

        static::updating(function (self $attempt): void {
            $allowed = [
                'status',
                'completed_at',
                'response_http_status',
                'response_code',
                'response_message',
                'response_payload',
                'updated_at',
            ];

            if (array_diff(array_keys($attempt->getDirty()), $allowed) !== []) {
                throw new LogicException('ZATCA submission attempt identity is immutable.');
            }
            if ($attempt->getOriginal('status') !== 'pending'
                || ! in_array($attempt->status, ['accepted', 'rejected', 'failed'], true)) {
                throw new LogicException('Invalid ZATCA submission attempt transition.');
            }
        });

        static::deleting(function (): void {
            throw new LogicException('ZATCA submission attempts are permanent audit records.');
        });
    }

    public function invoice(): BelongsTo
    {
        return $this->belongsTo(Invoice::class);
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }
}

<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * حدث تدقيق المساعد الذكي (AI-02A) — وصفي فقط، يُلحَق ولا يُعدَّل ولا يُحذف عبر النموذج.
 *
 * العزل: يرث `BaseModel` فيُصفَّى بالمستأجر تلقائياً. الحذف الوحيد المشروع هو سياسة الاحتفاظ
 * (`ai:prune-records`) عبر منشئ الاستعلام، وهي خارج أحداث النموذج عمداً. الحارس هنا يمنع التعديل
 * العرَضي من الكود لا من SQL خام — حدّ موثَّق.
 */
class AiAuditEvent extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $fillable = [
        'request_id', 'tenant_id', 'actor_id', 'feature', 'event', 'tool', 'provider', 'model', 'outcome',
        'reason', 'attempt', 'input_tokens', 'output_tokens', 'cost_micro_usd', 'meta', 'occurred_at',
    ];

    protected $casts = [
        'meta' => 'array',
        'attempt' => 'integer',
        'input_tokens' => 'integer',
        'output_tokens' => 'integer',
        'cost_micro_usd' => 'integer',
        'occurred_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::updating(fn () => throw new LogicException('AI audit events are append-only.'));
        static::deleting(fn () => throw new LogicException('AI audit events are append-only.'));
    }
}

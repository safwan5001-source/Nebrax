<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سجلّ تسليم إشعار لمستخدم واحد. **ليست** بديلاً عن `FinancialControlAlert`
 * (حالة/تنبيه دائم قابل للحل) — هذه سجلّ قراءة/عدم قراءة لكل مستلم فقط.
 * قراءة إشعار لا تُقفل أو تُقرّ مصدره أبداً (انظر المخطط الرئيسي §2/§ADR-04).
 *
 * `CompanyWide`: مرئية المستخدم لصندوقه لا تتبدّل بتبديل الفرع النشط —
 * العزل الحقيقي هنا مستأجر+مستلم، لا فرع.
 */
class Notification extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'recipient_id',
        'category',
        'type',
        'severity',
        'title',
        'message',
        'source_type',
        'source_id',
        'action',
        'data',
        'dedupe_key',
        'read_at',
    ];

    protected $casts = [
        'data' => 'array',
        'read_at' => 'datetime',
    ];

    public function recipient(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recipient_id');
    }

    public function isRead(): bool
    {
        return $this->read_at !== null;
    }
}

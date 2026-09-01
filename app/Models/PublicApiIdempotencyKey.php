<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سجلّ Idempotency للـ Public API (M2M) — يحمي عملية كتابة مستقبلية من التنفيذ
 * المزدوج. مملوك لمستأجر واحد وعميل API واحد، ومعزول تلقائيًا بالمستأجر عبر
 * `BaseModel`. لا يحمل هذا النموذج أيّ سرّ: المفتاح مجزَّأ، والحمولة مبصومة.
 *
 * `CompanyWide` (إقرار واعٍ): أثرُ تكاملٍ على مستوى المؤسسة، غير مرتبط بفرع —
 * كعميل الـ API نفسه (لا سياق فرع لطلب M2M). يفشل حارسُ عزل الفروع أيّ نموذج
 * يرث `BaseModel` بلا تصنيف صريح، فالتصنيف إلزامي هنا.
 */
class PublicApiIdempotencyKey extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'api_client_id',
        'key_hash',
        'method',
        'route_identity',
        'request_fingerprint',
        'status',
        'response_status',
        'response_body',
        'response_headers',
        'locked_at',
        'completed_at',
        'expires_at',
    ];

    protected $casts = [
        'response_status'  => 'integer',
        'response_headers' => 'array',
        'locked_at'        => 'datetime',
        'completed_at'     => 'datetime',
        'expires_at'       => 'datetime',
    ];

    public const STATUS_IN_PROGRESS = 'in_progress';
    public const STATUS_COMPLETED   = 'completed';

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function apiClient(): BelongsTo
    {
        return $this->belongsTo(ApiClient::class);
    }
}

<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * سجلّ تدقيق طلب Public API — تدقيق تشغيلي/أمني append-only (لا محاسبي، لا يخلط
 * بأثر دفتر الأستاذ). يُنشأ مرة عند نهاية الطلب ولا يُحدَّث. بيانات وصفية فقط:
 * لا جسم طلب/استجابة، ولا أسرار (Authorization/مفتاح API/مفتاح idempotency خام).
 *
 * **داخلي للمنصة:** لا يُكشف عبر أيّ مسار Public API (لا مورد قراءة له في PR-4).
 * يرث عزل المستأجر عبر `BaseModel` دفاعًا في العمق فقط.
 *
 * `CompanyWide` (إقرار واعٍ): تدقيق تكاملٍ على مستوى المؤسسة، غير مرتبط بفرع.
 */
class PublicApiRequestLog extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'api_client_id',
        'request_id',
        'method',
        'route_identity',
        'path',
        'query_params',
        'scope',
        'response_status',
        'duration_ms',
        'rate_limited',
        'idempotency_status',
        'ip',
        'user_agent',
    ];

    protected $casts = [
        'query_params'    => 'array',
        'response_status' => 'integer',
        'duration_ms'     => 'integer',
        'rate_limited'    => 'boolean',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    public function apiClient(): BelongsTo
    {
        return $this->belongsTo(ApiClient::class);
    }
}

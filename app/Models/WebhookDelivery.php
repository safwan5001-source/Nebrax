<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * محاولة تسليم Webhook لكل (حدث، اشتراك) — تحمل الحالة وعدّاد المحاولات وموعد
 * الاستحقاق و«الإيجار» (lease) للمطالبة الآمنة بين مُشغّلات متزامنة. تُعاد المحاولة
 * على الصفّ نفسه (يزداد `attempts`) فيثبت معرّف التسليم ومعرّف الحدث.
 *
 * `CompanyWide`: بنية تكامل على مستوى المؤسسة. يرث `BaseModel` (UUID + عزل مستأجر).
 */
class WebhookDelivery extends BaseModel implements CompanyWide
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_DELIVERED = 'delivered';
    public const STATUS_RETRY_SCHEDULED = 'retry_scheduled';
    public const STATUS_FAILED = 'failed';

    /** الحالات التي قد تصبح مستحقّةً للتسليم (غير النهائية). */
    public const CLAIMABLE_STATUSES = [
        self::STATUS_PENDING,
        self::STATUS_RETRY_SCHEDULED,
        self::STATUS_PROCESSING, // مهجورة إذا انقضى إيجارها (استعادة).
    ];

    protected $fillable = [
        'tenant_id',
        'webhook_event_id',
        'webhook_endpoint_id',
        'status',
        'attempts',
        'next_attempt_at',
        'reserved_until',
        'last_status_code',
        'last_error',
        'last_duration_ms',
        'last_response_snippet',
        'delivered_at',
        'failed_at',
    ];

    protected function casts(): array
    {
        return [
            'attempts'         => 'integer',
            'next_attempt_at'  => 'datetime',
            'reserved_until'   => 'datetime',
            'last_status_code' => 'integer',
            'last_duration_ms' => 'integer',
            'delivered_at'     => 'datetime',
            'failed_at'        => 'datetime',
        ];
    }

    public function event(): BelongsTo
    {
        return $this->belongsTo(WebhookEvent::class, 'webhook_event_id');
    }

    public function endpoint(): BelongsTo
    {
        return $this->belongsTo(WebhookEndpoint::class, 'webhook_endpoint_id');
    }
}

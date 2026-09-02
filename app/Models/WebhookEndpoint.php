<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * اشتراك Webhook مملوك **لمستأجر واحد** — وجهة تسليم موقَّعة لأنواع أحداث مختارة.
 *
 * `CompanyWide` (إقرار واعٍ): بنية تكامل على مستوى المؤسسة، غير مرتبطة بفرع —
 * كـ`ApiClient` والمستخدمين والإعدادات. يرث `BaseModel` (UUID + عزل مستأجر تلقائي).
 *
 * السرّ مشفَّر at-rest عبر cast `encrypted` (مفتاح التطبيق)، ومخفيّ في التسلسل،
 * ويُفكّ وقت التسليم فقط لحساب توقيع HMAC. لا يُعاد السرّ الخام بعد الإنشاء/التدوير.
 */
class WebhookEndpoint extends BaseModel implements CompanyWide
{
    public const STATUS_ENABLED = 'enabled';
    public const STATUS_DISABLED = 'disabled';

    protected $fillable = [
        'tenant_id',
        'api_client_id',
        'url',
        'description',
        'event_types',
        'secret',
        'secret_prefix',
        'status',
        'disabled_at',
        'last_success_at',
        'last_failure_at',
    ];

    protected $hidden = ['secret'];

    protected function casts(): array
    {
        return [
            'event_types'     => 'array',
            'secret'          => 'encrypted',
            'disabled_at'     => 'datetime',
            'last_success_at' => 'datetime',
            'last_failure_at' => 'datetime',
        ];
    }

    public function apiClient(): BelongsTo
    {
        return $this->belongsTo(ApiClient::class);
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }

    public function isEnabled(): bool
    {
        return $this->status === self::STATUS_ENABLED;
    }

    /** هل الاشتراك مُفعَّل ومشترِك بنوع الحدث المعطى؟ */
    public function listensTo(string $eventType): bool
    {
        return $this->isEnabled() && in_array($eventType, (array) $this->event_types, true);
    }
}

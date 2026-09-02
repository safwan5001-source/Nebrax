<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * حدث Webhook منطقي (الصندوق الصادر / outbox) — معرّفه الثابت هو معرّف المغلَّف
 * الذي يراه المستهلك، فتُعاد المحاولات عليه دون تغيّر المعرّف (يدعم إزالة التكرار).
 *
 * `CompanyWide`: بنية تكامل على مستوى المؤسسة. يرث `BaseModel` (UUID + عزل مستأجر).
 * الحمولة `payload` هي كتلة `data` المُنتقاة (مورد Public)، لا Eloquent خام.
 */
class WebhookEvent extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'type',
        'api_version',
        'source_type',
        'source_id',
        'payload',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'payload'     => 'array',
            'occurred_at' => 'datetime',
        ];
    }

    public function deliveries(): HasMany
    {
        return $this->hasMany(WebhookDelivery::class);
    }
}

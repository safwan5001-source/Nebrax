<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * محاولة إدخال تشغيلية. الجسم الخام مشفَّر وليس لقطة دليل ضريبي.
 * `CompanyWide` مثل `WebhookDelivery`: سجل تكامل على مستوى المؤسسة.
 */
class DeliveryConnectorAttempt extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'delivery_connector_account_id',
        'event_id',
        'raw_checksum',
        'authoritative_checksum',
        'outcome',
        'http_status',
        'error_code',
        'delivery_hub_order_id',
        'provider_order_id',
        'secret_version',
        'operational_raw_body',
    ];

    protected $hidden = [
        'operational_raw_body',
    ];

    protected function casts(): array
    {
        return [
            'operational_raw_body' => 'encrypted',
            'http_status' => 'integer',
            'secret_version' => 'integer',
        ];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(DeliveryConnectorAccount::class, 'delivery_connector_account_id');
    }

    public function hubOrder(): BelongsTo
    {
        return $this->belongsTo(DeliveryHubOrder::class, 'delivery_hub_order_id');
    }
}

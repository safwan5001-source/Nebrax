<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use LogicException;

/**
 * سجل تدقيق ثابت (append-only) لتغييرات اتصال بوابة الدفع: من فعل ماذا ومتى.
 *
 * لا يحوي أي سر ولا قيمة سرّ ولا طولها — أسماء الحقول المتغيّرة فقط. بلا مفتاح أجنبي على البوابة
 * عمداً: بوابة مسودة غير مرجعية قد تُحذف ويبقى أثرها. لا تعديل ولا حذف من التطبيق.
 */
class PaymentConnectionEvent extends BaseModel implements CompanyWide
{
    public $timestamps = false;

    protected $dateFormat = 'Y-m-d H:i:s.u';

    protected $fillable = [
        'tenant_id',
        'payment_gateway_id',
        'provider',
        'gateway_name',
        'event_type',
        'from_status',
        'to_status',
        'credential_version',
        'actor_user_id',
        'reason',
        'changed_fields',
        'occurred_at',
    ];

    protected function casts(): array
    {
        return [
            'changed_fields' => 'array',
            'credential_version' => 'integer',
            'occurred_at' => 'immutable_datetime',
        ];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for payment connection events.');
            }
            if ($event->tenant_id !== null && (string) $event->tenant_id !== (string) $context->id()) {
                throw new DomainException('Payment connection event tenant cannot be forged.');
            }
            $event->tenant_id = (string) $context->id();
            $event->occurred_at ??= now();
        });

        static::updating(fn () => throw new LogicException('Payment connection events are append-only.'));
        static::deleting(fn () => throw new LogicException('Payment connection events are append-only.'));
    }
}

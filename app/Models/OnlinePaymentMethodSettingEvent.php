<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;
use LogicException;

/** سجل تدقيق ثابت لتغيير إظهار وسيلة دفع إلكتروني: الفاعل والقيمتان والسبب. لا يُعدَّل ولا يُحذف. */
class OnlinePaymentMethodSettingEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [];

    protected function casts(): array
    {
        return ['enabled_from' => 'boolean', 'enabled_to' => 'boolean'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $event): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for online payment method events.');
            }
            $event->tenant_id = (string) $context->id();
        });
        static::updating(fn () => throw new LogicException('Online payment method events are append-only.'));
        static::deleting(fn () => throw new LogicException('Online payment method events are append-only.'));
    }
}

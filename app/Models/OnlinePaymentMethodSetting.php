<?php

namespace App\Models;

use App\Support\OnlinePaymentMethodCatalog;
use App\Tenancy\CompanyWide;
use App\Tenancy\TenantContext;
use DomainException;

/**
 * إعداد إظهار وسيلة دفع إلكتروني للعميل (PAY-SETTINGS-UX): لا يقيّد ما تقبله صفحة المزوّد المستضافة، ولا يُفعَّل لعميل ما لم تكن الوسيلة مدعومة وجاهزة (تحسبها الخدمة).
 * يُكتب عبر `OnlinePaymentMethodSettingsService` وحده (خارج `$fillable` عمداً).
 */
class OnlinePaymentMethodSetting extends BaseModel implements CompanyWide
{
    protected $fillable = [];

    protected function casts(): array
    {
        return ['enabled' => 'boolean'];
    }

    protected static function booted(): void
    {
        static::creating(function (self $setting): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for online payment method settings.');
            }
            $setting->tenant_id = (string) $context->id();
            if (! OnlinePaymentMethodCatalog::isKnown((string) $setting->method_key)) {
                throw new DomainException('Unknown online payment method.');
            }
        });
    }
}

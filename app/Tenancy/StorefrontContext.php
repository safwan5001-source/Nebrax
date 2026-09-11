<?php

namespace App\Tenancy;

use LogicException;

/**
 * سياق متجر Commerce العام (anonymous) — tenant + sales channel، يُنشأ بالكامل
 * من `ResolveStorefrontTenant` middleware عبر بيانات مخزَّنة (شريحة الرابط ثم
 * `SalesChannel` النشطة من نوع `web`)، لا من أي مدخل يتحكم به المتصفح.
 *
 * منفصل عمداً عن `TenantContext`/`CustomerContext`: لا مصادقة عميل هنا (تصفح
 * مجهول)، والقناة إضافةٌ خاصة بحدود الكتالوج العام لا يحتاجها أي سياق آخر.
 */
class StorefrontContext
{
    private ?string $tenantId = null;

    private ?string $salesChannelId = null;

    public function set(string $tenantId, string $salesChannelId): void
    {
        $this->tenantId = $tenantId;
        $this->salesChannelId = $salesChannelId;
    }

    public function tenantId(): string
    {
        return $this->required($this->tenantId);
    }

    public function salesChannelId(): string
    {
        return $this->required($this->salesChannelId);
    }

    public function isEstablished(): bool
    {
        return $this->tenantId !== null && $this->salesChannelId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->salesChannelId = null;
    }

    private function required(?string $value): string
    {
        if (! $this->isEstablished()) {
            throw new LogicException('StorefrontContext has not been established for this request.');
        }

        return $value;
    }
}

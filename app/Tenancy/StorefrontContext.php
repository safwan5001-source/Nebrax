<?php

namespace App\Tenancy;

use LogicException;

/**
 * سياق متجر Commerce العام (anonymous) — tenant + sales channel (+ storefront
 * اختياري)، يُنشأ بالكامل من وسيط الحسم (`ResolveStorefrontDomain` المعتمد
 * لـ COM-7-P2A عبر Host، أو `ResolveStorefrontTenant` المتوارَث القائم على
 * شريحة الرابط — تطويري محض بعد P2A) عبر بيانات مخزَّنة، لا من أي مدخل يتحكم
 * به المتصفح.
 *
 * منفصل عمداً عن `TenantContext`/`CustomerContext`: لا مصادقة عميل هنا (تصفح
 * مجهول)، والقناة/المتجر إضافتان خاصتان بحدود الكتالوج العام لا يحتاجهما أي
 * سياق آخر.
 *
 * `storefrontId` **اختياري**: المسار المتوارَث (P1) لا يحلّ صفّ `Storefront`
 * أصلاً (سابقٌ لوجود النموذج)، فيضبط السياق بدونه — استدعاء `storefrontId()`
 * في تلك الحالة يفشل بوضوح بدل إرجاع قيمة زائفة. المسار الموثوق (P2A) يضبطه
 * دائماً.
 */
class StorefrontContext
{
    private ?string $tenantId = null;

    private ?string $salesChannelId = null;

    private ?string $storefrontId = null;

    public function set(string $tenantId, string $salesChannelId, ?string $storefrontId = null): void
    {
        $this->tenantId = $tenantId;
        $this->salesChannelId = $salesChannelId;
        $this->storefrontId = $storefrontId;
    }

    public function tenantId(): string
    {
        return $this->required($this->tenantId);
    }

    public function salesChannelId(): string
    {
        return $this->required($this->salesChannelId);
    }

    /** @throws LogicException لا `Storefront` محلولاً في هذا المسار (السياق المتوارَث P1). */
    public function storefrontId(): string
    {
        $this->required($this->tenantId);

        if ($this->storefrontId === null) {
            throw new LogicException('لا Storefront محلولاً في مسار السياق الحالي.');
        }

        return $this->storefrontId;
    }

    public function hasStorefront(): bool
    {
        return $this->storefrontId !== null;
    }

    public function isEstablished(): bool
    {
        return $this->tenantId !== null && $this->salesChannelId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->salesChannelId = null;
        $this->storefrontId = null;
    }

    private function required(?string $value): string
    {
        if (! $this->isEstablished()) {
            throw new LogicException('StorefrontContext has not been established for this request.');
        }

        return $value;
    }
}

<?php

namespace App\Tenancy;

/**
 * المستأجر المحسوم من مضيف الطلب (نطاق فرعي `{slug}.{base}`) قبل المصادقة.
 *
 * منفصل عمداً عن `TenantContext`: ذاك ما يزال يُضبَط في `SetTenant` بعد
 * مصادقة المستخدم. هذا السياق يسمح لمسار الدخول أن يتحقق من الانتماء
 * دون إقامة `TenantScope` قبل نجاح المصادقة، ودون التبديل الصامت إلى
 * مستأجر المستخدم عند التعارض.
 */
class HostnameTenantContext
{
    protected ?string $tenantId = null;

    protected ?string $slug = null;

    public function set(string $tenantId, string $slug): void
    {
        $this->tenantId = $tenantId;
        $this->slug = $slug;
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function slug(): ?string
    {
        return $this->slug;
    }

    public function has(): bool
    {
        return $this->tenantId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->slug = null;
    }
}

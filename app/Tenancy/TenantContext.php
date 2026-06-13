<?php

namespace App\Tenancy;

/**
 * يحمل معرّف المستأجر الحالي خلال الطلب (singleton).
 * يُضبط في SetTenant middleware من توكن المستخدم.
 */
class TenantContext
{
    protected ?string $tenantId = null;

    public function set(string $tenantId): void
    {
        $this->tenantId = $tenantId;
    }

    public function id(): ?string
    {
        return $this->tenantId;
    }

    public function has(): bool
    {
        return $this->tenantId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
    }
}

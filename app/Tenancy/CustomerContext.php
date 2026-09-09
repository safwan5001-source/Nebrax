<?php

namespace App\Tenancy;

use LogicException;

/** Trusted customer ownership values established by middleware, never request input. */
class CustomerContext
{
    private ?string $tenantId = null;

    private ?string $customerIdentityId = null;

    private ?string $linkedPartnerId = null;

    public function set(string $tenantId, string $customerIdentityId, ?string $linkedPartnerId): void
    {
        $this->tenantId = $tenantId;
        $this->customerIdentityId = $customerIdentityId;
        $this->linkedPartnerId = $linkedPartnerId;
    }

    public function tenantId(): string
    {
        return $this->required($this->tenantId);
    }

    public function customerIdentityId(): string
    {
        return $this->required($this->customerIdentityId);
    }

    public function linkedPartnerId(): ?string
    {
        $this->assertEstablished();

        return $this->linkedPartnerId;
    }

    public function hasPartnerLink(): bool
    {
        return $this->linkedPartnerId() !== null;
    }

    public function isEstablished(): bool
    {
        return $this->tenantId !== null && $this->customerIdentityId !== null;
    }

    public function forget(): void
    {
        $this->tenantId = null;
        $this->customerIdentityId = null;
        $this->linkedPartnerId = null;
    }

    private function required(?string $value): string
    {
        $this->assertEstablished();

        return $value ?? throw new LogicException('CustomerContext value is unavailable.');
    }

    private function assertEstablished(): void
    {
        if (! $this->isEstablished()) {
            throw new LogicException('CustomerContext has not been established for this request.');
        }
    }
}

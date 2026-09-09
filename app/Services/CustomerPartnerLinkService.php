<?php

namespace App\Services;

use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\User;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use LogicException;

class CustomerPartnerLinkService
{
    public function __construct(private TenantContext $tenantContext) {}

    public function link(
        CustomerIdentity $identity,
        Partner $partner,
        User $actor,
    ): CustomerPartnerLink {
        $tenantId = $this->requireTenant();
        $this->assertSameTenantReferences($tenantId, $identity, $partner, $actor);

        return DB::transaction(function () use ($tenantId, $identity, $partner, $actor): CustomerPartnerLink {
            $lockedIdentity = CustomerIdentity::query()->whereKey($identity->id)->lockForUpdate()->firstOrFail();
            $lockedPartner = Partner::query()
                ->withoutGlobalScope(BranchScope::class)
                ->whereKey($partner->id)
                ->lockForUpdate()
                ->firstOrFail();
            $lockedActor = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($actor->id)
                ->lockForUpdate()
                ->firstOrFail();

            $this->assertEligible($lockedIdentity, $lockedPartner, $lockedActor);
            $existing = CustomerPartnerLink::query()
                ->where('customer_identity_id', $lockedIdentity->id)
                ->where('status', 'active')
                ->first();

            if ($existing !== null) {
                if ($existing->partner_id === $lockedPartner->id) {
                    return $existing;
                }

                throw ValidationException::withMessages([
                    'customer_identity_id' => ['للهوية رابط Partner نشط بالفعل.'],
                ]);
            }

            return CustomerPartnerLink::create([
                'tenant_id' => $lockedIdentity->tenant_id,
                'customer_identity_id' => $lockedIdentity->id,
                'partner_id' => $lockedPartner->id,
                'status' => 'active',
                'link_method' => 'staff_verified_claim',
                'linked_by_user_id' => $lockedActor->id,
                'linked_at' => now(),
            ]);
        });
    }

    public function revoke(CustomerPartnerLink $link, User $actor): CustomerPartnerLink
    {
        $tenantId = $this->requireTenant();

        if ($link->tenant_id !== $tenantId || $actor->tenant_id !== $tenantId) {
            throw ValidationException::withMessages(['link' => ['تعذّر العثور على رابط صالح.']]);
        }

        return DB::transaction(function () use ($tenantId, $link, $actor): CustomerPartnerLink {
            $locked = CustomerPartnerLink::query()->whereKey($link->id)->lockForUpdate()->firstOrFail();
            $lockedActor = User::query()
                ->where('tenant_id', $tenantId)
                ->whereKey($actor->id)
                ->lockForUpdate()
                ->firstOrFail();

            if (! $lockedActor->is_active || $lockedActor->trashed()) {
                throw ValidationException::withMessages(['actor' => ['المستخدم المنفذ غير مفعّل.']]);
            }

            if ($locked->status === 'revoked') {
                return $locked;
            }

            $locked->update([
                'status' => 'revoked',
                'revoked_by_user_id' => $lockedActor->id,
                'revoked_at' => now(),
            ]);

            return $locked->refresh();
        });
    }

    private function requireTenant(): string
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required for customer Partner links.');
        }

        return $this->tenantContext->id();
    }

    private function assertSameTenantReferences(
        string $tenantId,
        CustomerIdentity $identity,
        Partner $partner,
        User $actor,
    ): void {
        if (
            $identity->tenant_id !== $tenantId
            || $partner->tenant_id !== $tenantId
            || $actor->tenant_id !== $tenantId
        ) {
            throw ValidationException::withMessages(['link' => ['تعذّر العثور على سجلات ربط صالحة.']]);
        }
    }

    private function assertEligible(
        CustomerIdentity $identity,
        Partner $partner,
        User $actor,
    ): void {
        if (! $identity->is_active || $identity->trashed() || $identity->email_verified_at === null) {
            throw ValidationException::withMessages(['customer_identity_id' => ['هوية العميل غير مؤهلة للربط.']]);
        }

        if (! $partner->is_active || $partner->trashed() || ! $partner->isCustomer()) {
            throw ValidationException::withMessages(['partner_id' => ['Partner غير مؤهل للربط كعميل.']]);
        }

        if (! $actor->is_active || $actor->trashed()) {
            throw ValidationException::withMessages(['actor' => ['المستخدم المنفذ غير مفعّل.']]);
        }

        if (! $actor->hasPermission('customer_access.manage')) {
            throw ValidationException::withMessages(['actor' => ['المستخدم غير مخوّل بإدارة وصول العملاء.']]);
        }
    }
}

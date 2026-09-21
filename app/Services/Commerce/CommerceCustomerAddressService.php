<?php

namespace App\Services\Commerce;

use App\Models\CommerceCustomerAddress;
use App\Tenancy\CustomerContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * CRUD over the authenticated customer's own address book (COM-MOBILE-ADDRESSES-1
 * / ADR-08). Every query is scoped by `customer_identity_id` from the trusted
 * `CustomerContext` on top of the automatic tenant scope `BaseModel` already
 * applies — an address never resolves for anyone but its own owner.
 *
 * Default-shipping/default-billing exclusivity is enforced here (clear the
 * previous default under a row lock, then set the new one) and again at the
 * database level by the two partial unique indexes the migration creates —
 * this service is the ergonomic path, the index is the guarantee under races.
 */
final class CommerceCustomerAddressService
{
    /** @return Collection<int, CommerceCustomerAddress> */
    public function list(CustomerContext $context): Collection
    {
        return $this->scoped($context)->orderByDesc('created_at')->get();
    }

    public function find(CustomerContext $context, string $id): ?CommerceCustomerAddress
    {
        return $this->scoped($context)->find($id);
    }

    /** @param  array<string, mixed>  $data */
    public function create(CustomerContext $context, array $data): CommerceCustomerAddress
    {
        return DB::transaction(function () use ($context, $data): CommerceCustomerAddress {
            if (($data['is_default_shipping'] ?? false) === true) {
                $this->clearDefault($context, 'is_default_shipping');
            }
            if (($data['is_default_billing'] ?? false) === true) {
                $this->clearDefault($context, 'is_default_billing');
            }

            $data['tenant_id'] = $context->tenantId();
            $data['customer_identity_id'] = $context->customerIdentityId();

            return CommerceCustomerAddress::create($data);
        });
    }

    /** @param  array<string, mixed>  $data */
    public function update(CustomerContext $context, string $id, array $data): CommerceCustomerAddress
    {
        return DB::transaction(function () use ($context, $id, $data): CommerceCustomerAddress {
            $address = $this->scoped($context)->lockForUpdate()->find($id);
            if ($address === null) {
                throw new RuntimeException('العنوان غير موجود.');
            }

            if (($data['is_default_shipping'] ?? false) === true) {
                $this->clearDefault($context, 'is_default_shipping', $address->id);
            }
            if (($data['is_default_billing'] ?? false) === true) {
                $this->clearDefault($context, 'is_default_billing', $address->id);
            }

            $address->update($data);

            return $address;
        });
    }

    public function delete(CustomerContext $context, string $id): void
    {
        DB::transaction(function () use ($context, $id): void {
            $deleted = $this->scoped($context)->whereKey($id)->delete();
            if ($deleted === 0) {
                throw new RuntimeException('العنوان غير موجود.');
            }
        });
    }

    private function clearDefault(CustomerContext $context, string $column, ?string $exceptId = null): void
    {
        $this->scoped($context)
            ->where($column, true)
            ->when($exceptId !== null, fn ($query) => $query->whereKeyNot($exceptId))
            ->update([$column => false]);
    }

    /** @return \Illuminate\Database\Eloquent\Builder<CommerceCustomerAddress> */
    private function scoped(CustomerContext $context)
    {
        return CommerceCustomerAddress::query()->where('customer_identity_id', $context->customerIdentityId());
    }
}

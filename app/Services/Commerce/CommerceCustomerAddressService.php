<?php

namespace App\Services\Commerce;

use App\Models\CommerceCustomerAddress;
use App\Models\CustomerIdentity;
use App\Tenancy\CustomerContext;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
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
 *
 * (Codex, PR #929, round 2, P2) `create()`/`update()` each lock the owning
 * `CustomerIdentity` row first, before reading or writing any address of
 * that customer. This is a stable row that exists before the very first
 * address is ever created, so it serializes concurrent default-address
 * writes even when no address row yet exists to lock — without it, two
 * concurrent "set as default" requests could each see no existing default,
 * both insert one, and hit the partial unique index as a raw 500. The same
 * lock also fixes a second race: it makes `update()`'s merged-state Saudi
 * validation read the address's current committed state, not a snapshot
 * from before a concurrent PATCH landed.
 */
final class CommerceCustomerAddressService
{
    private const SAUDI_REQUIRED_FIELDS = ['district', 'building_no', 'postal_code', 'additional_number'];

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
            $this->lockCustomer($context);

            $this->assertSaudiFieldsPresent($data);

            if ($this->isTruthyBoolean($data['is_default_shipping'] ?? false)) {
                $this->clearDefault($context, 'is_default_shipping');
            }
            if ($this->isTruthyBoolean($data['is_default_billing'] ?? false)) {
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
            $this->lockCustomer($context);

            $address = $this->scoped($context)->lockForUpdate()->find($id);
            if ($address === null) {
                throw new RuntimeException('العنوان غير موجود.');
            }

            $this->assertSaudiFieldsPresent([
                'country' => $data['country'] ?? $address->country,
                'district' => array_key_exists('district', $data) ? $data['district'] : $address->district,
                'building_no' => array_key_exists('building_no', $data) ? $data['building_no'] : $address->building_no,
                'postal_code' => array_key_exists('postal_code', $data) ? $data['postal_code'] : $address->postal_code,
                'additional_number' => array_key_exists('additional_number', $data) ? $data['additional_number'] : $address->additional_number,
            ]);

            if ($this->isTruthyBoolean($data['is_default_shipping'] ?? false)) {
                $this->clearDefault($context, 'is_default_shipping', $address->id);
            }
            if ($this->isTruthyBoolean($data['is_default_billing'] ?? false)) {
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

    /** @param  array<string, mixed>  $data */
    public function assertSaudiFieldsPresent(array $data): void
    {
        if (($data['country'] ?? null) !== 'SA') {
            return;
        }

        $missing = [];
        foreach (self::SAUDI_REQUIRED_FIELDS as $field) {
            if (! isset($data[$field]) || trim((string) $data[$field]) === '') {
                $missing[] = $field;
            }
        }

        if ($missing !== []) {
            throw ValidationException::withMessages([
                'saudi_national_address' => 'العنوان الوطني السعودي يتطلب: '.implode(', ', $missing).'.',
            ]);
        }
    }

    /**
     * (Codex, PR #929, P2) Laravel's `boolean` validation rule accepts
     * `true`/`false`/`1`/`0`/`"1"`/`"0"` but never normalizes the validated
     * value — it stays exactly as submitted. A strict `=== true` check
     * against `1`/`"1"` silently skipped clearing the previous default,
     * while the model's own `boolean` cast still saved the new row as the
     * default — two rows the partial unique index then rejected with a raw
     * constraint-violation 500 instead of the intended clear-then-set flow.
     */
    private function isTruthyBoolean(mixed $value): bool
    {
        return (bool) $value;
    }

    /**
     * Locks the customer's own row for the rest of this transaction. A
     * `CustomerIdentity` row always exists before its first address does,
     * so this is the one stable anchor available to serialize concurrent
     * create()/update() calls for the same customer — the address rows
     * themselves can't be locked when there aren't any yet.
     */
    private function lockCustomer(CustomerContext $context): void
    {
        CustomerIdentity::query()->whereKey($context->customerIdentityId())->lockForUpdate()->first();
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

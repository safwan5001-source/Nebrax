<?php

namespace App\Services;

use App\Models\CustomerIdentity;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use LogicException;

class CustomerIdentityService
{
    public function __construct(private TenantContext $tenantContext) {}

    /**
     * Creates an unverified, unlinked identity. A duplicate returns null so the
     * public endpoint can retain the same non-enumerating response.
     */
    public function register(array $attributes): ?CustomerIdentity
    {
        if (! $this->tenantContext->has()) {
            throw new LogicException('TenantContext is required before customer registration.');
        }

        try {
            return DB::transaction(fn () => CustomerIdentity::create([
                'tenant_id' => $this->tenantContext->id(),
                'display_name' => $attributes['display_name'],
                'email' => $attributes['email'],
                'phone' => $attributes['phone'] ?? null,
                'password' => $attributes['password'],
                'email_verified_at' => null,
                'is_active' => true,
            ]));
        } catch (QueryException $exception) {
            if ($this->isIdentifierConflict($exception)) {
                return null;
            }

            throw $exception;
        }
    }

    private function isIdentifierConflict(QueryException $exception): bool
    {
        if (! in_array((string) $exception->getCode(), ['23000', '23505'], true)) {
            return false;
        }

        $message = $exception->getMessage();

        return str_contains($message, 'customer_identities_tenant_email_unique')
            || str_contains($message, 'customer_identities_tenant_phone_unique')
            || str_contains($message, 'customer_identities.email_normalized')
            || str_contains($message, 'customer_identities.phone_e164');
    }
}

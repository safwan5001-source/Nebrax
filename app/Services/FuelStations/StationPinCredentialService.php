<?php

namespace App\Services\FuelStations;

use App\Models\Employee;
use App\Models\User;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Support\Facades\Hash;

/**
 * Resolves an existing AWJ user by the tenant-wide employee number.
 * Credential verification only: issuing a station-restricted session is
 * deliberately a separate step, after the token authorization boundary is audited.
 */
final class StationPinCredentialService
{
    public function verify(string $employeeNumber, string $pin): ?User
    {
        $tenantId = app(HostnameTenantContext::class)->id();
        if ($tenantId === null) {
            return null; // No cross-tenant employee-number lookup on a shared host.
        }

        if (! preg_match('/\\A[0-9]{6}\\z/D', $pin)) {
            return null;
        }

        $employee = Employee::query()
            ->where('tenant_id', $tenantId)
            ->where('employee_no', $employeeNumber)
            ->where('is_active', true)
            ->first();

        if (! $employee) {
            return null;
        }

        $user = User::query()
            ->where('tenant_id', $tenantId)
            ->where('employee_id', $employee->id)
            ->where('is_active', true)
            ->first();

        if (! $user || ! is_string($user->station_pin_hash) || $user->station_pin_hash === '') {
            return null;
        }

        return Hash::check($pin, $user->station_pin_hash) ? $user : null;
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateCustomerSettingsRequest;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات العميل (تفضيلات غير محاسبية) — تُخزَّن في tenants.settings['customers'].
 * لا أثر محاسبي. تُستخدم كقيم افتراضية في شاشات العملاء.
 */
class CustomerSettingsController extends ApiController
{
    private const DEFAULTS = [
        'default_type'       => 'customer',
        'default_city'       => '',
        'payment_terms_days' => 30,
        'require_tax_number' => false,
        'loyalty_enabled'    => false,
    ];

    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->current($this->tenant())]);
    }

    public function update(UpdateCustomerSettingsRequest $request): JsonResponse
    {
        $tenant = $this->tenant();

        $customers = array_merge($this->current($tenant), array_filter(
            $request->validated(),
            fn ($v) => $v !== null
        ));

        $settings = $tenant->settings ?? [];
        $settings['customers'] = $customers;
        $tenant->update(['settings' => $settings]);

        return response()->json(['data' => $customers]);
    }

    private function tenant(): Tenant
    {
        return Tenant::findOrFail(app(TenantContext::class)->id());
    }

    private function current(Tenant $tenant): array
    {
        return array_merge(self::DEFAULTS, $tenant->settings['customers'] ?? []);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateSalesSettingsRequest;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;

/**
 * إعدادات المبيعات (تفضيلات غير محاسبية) — تُخزَّن في tenants.settings['sales'].
 * لا أثر محاسبي (لا قيود). تُستخدم كقيم افتراضية في شاشات الفواتير/العروض.
 */
class SalesSettingsController extends ApiController
{
    private const DEFAULTS = [
        'default_tax_rate'     => 15,
        'default_payment_type' => 'credit',
        'quote_validity_days'  => 14,
        'invoice_prefix'       => 'INV',
        'default_terms'        => '',
    ];

    public function show(): JsonResponse
    {
        return response()->json(['data' => $this->current($this->tenant())]);
    }

    public function update(UpdateSalesSettingsRequest $request): JsonResponse
    {
        $tenant = $this->tenant();

        // دمج المُدخل فوق القيم الحالية (المفاتيح غير المرسلة تبقى كما هي).
        $sales = array_merge($this->current($tenant), array_filter(
            $request->validated(),
            fn ($v) => $v !== null
        ));

        $settings = $tenant->settings ?? [];
        $settings['sales'] = $sales;
        $tenant->update(['settings' => $settings]);

        return response()->json(['data' => $sales]);
    }

    private function tenant(): Tenant
    {
        return Tenant::findOrFail(app(TenantContext::class)->id());
    }

    /** القيم الحالية مدموجة فوق الافتراضات. */
    private function current(Tenant $tenant): array
    {
        return array_merge(self::DEFAULTS, $tenant->settings['sales'] ?? []);
    }
}

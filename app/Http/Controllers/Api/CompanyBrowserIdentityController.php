<?php

namespace App\Http\Controllers\Api;

use App\Models\Tenant;
use App\Support\Settings;
use App\Tenancy\HostnameTenantContext;
use Illuminate\Http\JsonResponse;

/**
 * هوية متصفح عامة محدودة لمسارات tenant-hosted ERP فقط.
 * لا تعتمد على جلسة الموظف ولا تعيد أي بيانات غير الشعار.
 */
final class CompanyBrowserIdentityController extends ApiController
{
    public function show(HostnameTenantContext $hostnameTenant): JsonResponse
    {
        $tenantId = $hostnameTenant->id();
        if ($tenantId === null) {
            abort(404);
        }

        $tenant = Tenant::query()->find($tenantId, ['id']);
        if ($tenant === null) {
            abort(404);
        }

        $logo = Settings::group('company', $tenant)['logo'] ?? null;

        return response()->json([
            'logo' => is_string($logo) && trim($logo) !== '' ? trim($logo) : null,
        ]);
    }
}

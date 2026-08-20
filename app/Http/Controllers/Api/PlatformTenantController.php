<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PlatformTenantUpdateRequest;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Support\PlatformTenantService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * إدارة مستأجري المنصة من مساحة التشغيل الداخلية: قوائم/تفاصيل أساسية،
 * وتغيير خطة أو تمديد تجربة أو تفعيل/تعطيل.
 *
 * القراءة تتطلب توكن بقدرة `platform:read`، والتعديل يتطلب `platform:manage`
 * (تُفرَض عبر `EnsurePlatformAdministrator` في routes/api.php).
 */
class PlatformTenantController extends ApiController
{
    public function index(Request $request, PlatformTenantService $service): JsonResponse
    {
        $tenants = $service->list($request->query('search'), (int) $request->query('per_page', 20));

        return response()->json([
            'data'       => $tenants->items(),
            'pagination' => [
                'current_page' => $tenants->currentPage(),
                'last_page'    => $tenants->lastPage(),
                'per_page'     => $tenants->perPage(),
                'total'        => $tenants->total(),
            ],
        ]);
    }

    public function show(string $tenant, PlatformTenantService $service): JsonResponse
    {
        return response()->json(['data' => $service->find($tenant)]);
    }

    public function update(
        PlatformTenantUpdateRequest $request,
        string $tenant,
        PlatformTenantService $service,
    ): JsonResponse {
        $model = Tenant::findOrFail($tenant);
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        if ($request->has('plan')) {
            $service->updatePlan($model, $administrator, $request->string('plan')->toString());
        }

        if ($request->has('trial_ends_at')) {
            $trialEndsAt = $request->input('trial_ends_at');
            $service->extendTrial($model, $administrator, $trialEndsAt ? new \DateTimeImmutable($trialEndsAt) : null);
        }

        if ($request->has('is_active')) {
            $service->setActive($model, $administrator, $request->boolean('is_active'));
        }

        return response()->json(['data' => $service->find($model->id)]);
    }
}

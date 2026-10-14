<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\SaveCommerceFacetVisualRequest;
use App\Services\Commerce\CommerceFacetVisualException;
use App\Services\Commerce\CommerceFacetVisualService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * AWJ-VD-H1 / VD-1b (§3.8-a) — writes the visual identity of a facet or facet value.
 *
 * Guarded by `commerce.manage` (D-04: no RBAC change — a `products.manage`-only role keeps editing names and gets 403
 * here), self-service denial and a throttle. Ownership comes from `TenantScope`: a facet or value that is missing or
 * belongs to another tenant is the same non-revealing 404.
 */
final class CommerceFacetVisualController extends ApiController
{
    public function updateFacet(SaveCommerceFacetVisualRequest $request, CommerceFacetVisualService $visuals, string $id): JsonResponse
    {
        $this->denySelfService($request);

        return $this->respond(fn () => $visuals->saveForFacet($id, $request->visual(), $request->expectedVersion()));
    }

    public function updateValue(SaveCommerceFacetVisualRequest $request, CommerceFacetVisualService $visuals, string $id, string $valueId): JsonResponse
    {
        $this->denySelfService($request);

        return $this->respond(fn () => $visuals->saveForValue($id, $valueId, $request->visual(), $request->expectedVersion()));
    }

    private function respond(callable $save): JsonResponse
    {
        try {
            $saved = $save();
        } catch (CommerceFacetVisualException $e) {
            return response()->json(array_filter([
                'message' => $e->getMessage(),
                'code' => $e->errorCode,
                'errors' => $e->errors === [] ? null : $e->errors,
            ], static fn ($v) => $v !== null) + $e->context, $e->status);
        }

        if ($saved === null) {
            abort(404, 'البُعد أو القيمة غير موجودة.');
        }

        return response()->json(['data' => $saved]);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'إدارة تصنيف الكتالوج غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}

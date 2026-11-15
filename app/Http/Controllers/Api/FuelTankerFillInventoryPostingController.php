<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PostFuelTankerFillInventoryRequest;
use App\Http\Resources\FuelTankerFillResource;
use App\Models\FuelTankerFill;
use App\Services\FuelTankerFillInventoryPostingService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR6B-3 — ترحيل سند تعبئة الصهريج مخزنياً ومحاسبياً (سند واحد بطلب صريح؛ لا ترحيل جماعي ولا تلقائي) ومعاينته.
 *
 * مغلق خلف ثلاث بوابات (PR-1 وPR-4 والترحيل `FUEL_TANKER_INVENTORY_POSTING_ENABLED`) ⇒ 404 موحَّد قبل أي صلاحية؛ صلاحيات `fuel.tanker.fill.inventory.post` (+`post_historical` للتاريخي)
 * و`fuel.tanker.fill.inventory.view` للمعاينة، قدرة `fuel_stations.core`؛ نطاق المحطة (فرع/مخزن/إسناد) 404 موحَّد. **لا مسار يصل جلسة PIN** (خارج `StationSessionBoundary`، فشل مغلق).
 * الأعمدة المالية (التكلفة التاريخية، معرّف القيد) تظهر لمن يملك `products.view_cost` فقط.
 */
class FuelTankerFillInventoryPostingController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelTankerFillInventoryPostingService $posting) {}

    public function store(PostFuelTankerFillInventoryRequest $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $options = $request->validated();
        $result = $this->domain(fn () => $this->posting->post($fill, $request->user(), $options));

        return (new FuelTankerFillResource($result['fill']->load(['owner', 'tanker'])))
            ->additional(['meta' => ['replayed' => $result['replayed'], 'posting' => $this->present($result['posting'], $request)]])
            ->response()
            ->setStatusCode($result['replayed'] ? 200 : 201);
    }

    public function preview(Request $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);

        return response()->json(['data' => $this->domain(fn () => $this->posting->preview($fill, $request->user()))]);
    }

    /** @param array<string, mixed> $posting @return array<string, mixed> */
    private function present(array $posting, Request $request): array
    {
        if (! $request->user()->hasPermission('products.view_cost')) {
            unset($posting['posted_cost_minor'], $posting['journal_entry_id'], $posting['cost_movement_id']);
        }

        return $posting;
    }

    private function visibleFill(string $id, Request $request): FuelTankerFill
    {
        $fill = $this->scopeToActiveBranch(FuelTankerFill::query(), $request)->findOrFail($id);
        $this->accessibleStation($fill->fuel_station_id);

        return $fill;
    }
}

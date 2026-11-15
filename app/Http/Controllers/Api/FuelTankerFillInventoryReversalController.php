<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ReverseFuelTankerFillInventoryRequest;
use App\Http\Resources\FuelTankerFillResource;
use App\Models\FuelTankerFill;
use App\Services\FuelTankerFillInventoryReversalService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR6B-4 — عكس ترحيل سند تعبئة الصهريج بالتكلفة التاريخية (سند واحد بطلب صريح وسبب) ومعاينة أثره.
 *
 * البوابات الثلاث نفسها للترحيل (PR-1 وPR-4 و`FUEL_TANKER_INVENTORY_POSTING_ENABLED`، مغلقة افتراضياً) ⇒ 404 موحَّد قبل أي صلاحية؛ `fuel.tanker.fill.inventory.reverse` للعكس و`…inventory.view` للمعاينة،
 * قدرة `fuel_stations.core`؛ نطاق المحطة (فرع/مخزن/إسناد) 404 موحَّد. **لا مسار يصل جلسة PIN** (خارج `StationSessionBoundary`).
 * الأعمدة المالية (التكلفة، معرّفات القيود والحركات) لمن يملك `products.view_cost` فقط؛ لا حسابات في الاستجابة.
 */
class FuelTankerFillInventoryReversalController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelTankerFillInventoryReversalService $reversal) {}

    public function store(ReverseFuelTankerFillInventoryRequest $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $result = $this->domain(fn () => $this->reversal->reverse($fill, $request->user(), $request->validated()));

        return (new FuelTankerFillResource($result['fill']->load(['owner', 'tanker'])))
            ->additional(['meta' => ['replayed' => $result['replayed'], 'posting' => $this->present($result['posting'], $request)]])
            ->response()
            ->setStatusCode($result['replayed'] ? 200 : 201);
    }

    public function preview(Request $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);

        return response()->json(['data' => $this->domain(fn () => $this->reversal->preview($fill, $request->user()))]);
    }

    /** @param array<string, mixed> $posting @return array<string, mixed> */
    private function present(array $posting, Request $request): array
    {
        if (! $request->user()->hasPermission('products.view_cost')) {
            unset($posting['posted_cost_minor'], $posting['journal_entry_id'], $posting['cost_movement_id'], $posting['reversal_journal_entry_id'], $posting['reversal_cost_movement_id']);
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

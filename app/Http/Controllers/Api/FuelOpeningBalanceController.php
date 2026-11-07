<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreFuelOpeningBalanceRequest;
use App\Http\Requests\UpdateFuelOpeningBalanceRequest;
use App\Http\Resources\FuelOpeningBalanceResource;
use App\Models\FuelOpeningBalance;
use App\Services\FuelOpeningBalanceService;
use App\Support\FuelCostVisibility;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FUEL-TANKS-V2 / PR-1 — مستند الرصيد الافتتاحي للوقود (مسودة ← معاينة ← ترحيل). مغلق خلف بوابة نشر:
 * `fuel_stations.opening_balance_enabled=false` ⇒ كل المسارات 404. نطاق المحطة (فرع + مخزن + محطات مسنَدة) على الخادم قبل أي
 * قراءة أو كتابة بـ404 موحَّد. الترحيل يشترط (route) `fuel.governance.manage` + `products.view_cost`، وتعيده الخدمة بسلطة التكلفة المالية.
 */
class FuelOpeningBalanceController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelOpeningBalanceService $service) {}

    private function gate(): void
    {
        abort_unless(FuelOpeningBalanceService::enabled(), 404);
    }

    private function scoped(Request $request): Builder
    {
        return $this->restrictToAccessibleStations(
            $this->scopeToAccessibleWarehouses($this->scopeToActiveBranch(FuelOpeningBalance::query(), $request), ['warehouse_id'])
        );
    }

    public function index(Request $request)
    {
        $this->gate();
        $filters = $request->validate([
            'station_id' => ['nullable', 'uuid'], 'status' => ['nullable', 'in:draft,posted'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $query = $this->scoped($request)->with(["station"]);
        if (! empty($filters['station_id'])) {
            $query->where('fuel_station_id', $filters['station_id']);
        }
        if (! empty($filters['status'])) {
            $query->where('status', $filters['status']);
        }

        return FuelOpeningBalanceResource::collection($query->latest('opening_date')->latest('id')->paginate((int) ($filters['per_page'] ?? 50)));
    }

    public function show(Request $request, string $id)
    {
        $this->gate();
        $document = $this->scoped($request)->with(['station', 'lines.tank'])->findOrFail($id);

        return new FuelOpeningBalanceResource($document);
    }

    public function store(StoreFuelOpeningBalanceRequest $request): JsonResponse
    {
        $this->gate();
        $this->accessibleStation($request->validated()['fuel_station_id']);
        $result = $this->domain(fn () => $this->service->createDraft($request->validated(), $request->user()));

        return (new FuelOpeningBalanceResource($result['document']->load(['station', 'lines.tank'])))
            ->additional(['meta' => ['replayed' => $result['replayed']]])
            ->response()->setStatusCode($result['replayed'] ? 200 : 201);
    }

    public function update(UpdateFuelOpeningBalanceRequest $request, string $id)
    {
        $this->gate();
        $document = $this->scoped($request)->findOrFail($id);
        $this->accessibleStation($document->fuel_station_id);

        return new FuelOpeningBalanceResource(
            $this->domain(fn () => $this->service->updateDraft($document, $request->validated(), $request->user()))->load(['station', 'lines.tank'])
        );
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $this->gate();
        $document = $this->scoped($request)->findOrFail($id);
        $this->accessibleStation($document->fuel_station_id);
        $this->domain(fn () => $this->service->deleteDraft($document, $request->user()));

        return response()->json(null, 204);
    }

    /** معاينة بلا كتابة ولا قفل. من لا يرى التكلفة (`products.view_cost`) لا يرى أي مبلغ ولا القيد. */
    public function preview(Request $request, string $id): JsonResponse
    {
        $this->gate();
        $document = $this->scoped($request)->with('lines')->findOrFail($id);
        $this->accessibleStation($document->fuel_station_id);
        $data = $this->domain(fn () => $this->service->preview($document));
        if (! FuelCostVisibility::canSeeCost($request->user())) {
            $data = $this->withoutMoney($data);
        }

        return response()->json(['data' => $data]);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $this->gate();
        $document = $this->scoped($request)->findOrFail($id);
        $this->accessibleStation($document->fuel_station_id);
        $result = $this->domain(fn () => $this->service->post($document, $request->user()));

        return (new FuelOpeningBalanceResource($result['document']->load(['station', 'lines.tank'])))
            ->additional(['meta' => ['replayed' => $result['replayed']]])
            ->response()->setStatusCode(200);
    }

    /** @param array<mixed> $data @return array<mixed> */
    private function withoutMoney(array $data): array
    {
        unset($data['journal'], $data['total_value_minor']);
        foreach (['products', 'lines'] as $key) {
            foreach ($data[$key] ?? [] as $i => $row) {
                unset($data[$key][$i]['unit_cost_per_liter_minor'], $data[$key][$i]['value_minor']);
            }
        }

        return $data;
    }
}

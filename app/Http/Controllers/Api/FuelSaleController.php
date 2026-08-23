<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CollectFuelSalePaymentRequest;
use App\Http\Requests\StoreFuelSaleRequest;
use App\Http\Requests\StoreFuelStationProductPriceRequest;
use App\Http\Resources\FuelSaleResource;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Models\PaymentMethod;
use App\Services\FuelSaleService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class FuelSaleController extends ApiController
{
    public function __construct(
        private FuelSaleService $sales,
        private FuelStationProductPriceService $prices,
        private FuelStationSettingsService $settings,
    ) {}

    public function index(Request $request): JsonResponse
    {
        $query = FuelSale::query()->with(['invoice', 'paymentReceipts.payment'])->orderByDesc('created_at');
        if ($request->filled('station_id')) {
            $query->where('fuel_station_id', $request->query('station_id'));
        }
        if ($request->filled('shift_id')) {
            $query->where('fuel_shift_id', $request->query('shift_id'));
        }
        if ($request->filled('status')) {
            $query->where('status', $request->query('status'));
        }

        return FuelSaleResource::collection($this->scopeToActiveBranch($query, $request)->paginate(50))->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new FuelSaleResource($this->present($this->visibleSale($id, $request))))->response();
    }

    public function store(StoreFuelSaleRequest $request): JsonResponse
    {
        $sale = $this->domain(fn () => $this->sales->createDraft($request->validated(), $request->user()));

        return (new FuelSaleResource($this->present($sale)))->response()->setStatusCode(201);
    }

    public function finalize(Request $request, string $id): JsonResponse
    {
        $sale = $this->visibleSale($id, $request);
        $finalized = $this->domain(fn () => $this->sales->finalize($sale, $request->user()));

        return (new FuelSaleResource($this->present($finalized)))->response();
    }

    public function collectPayment(CollectFuelSalePaymentRequest $request, string $id): JsonResponse
    {
        $sale = $this->visibleSale($id, $request);
        $this->domain(fn () => $this->sales->collectPayment($sale, $request->validated(), $request->user()));

        return (new FuelSaleResource($this->present($sale->fresh())))->response()->setStatusCode(201);
    }

    /** طرق التحصيل الفعالة لهذه المحطة فقط؛ لا تعتمد الواجهة على قائمة عامة ثم تُرفض لاحقاً. */
    public function paymentMethods(Request $request, string $stationId): JsonResponse
    {
        $station = $this->scopeToActiveBranch(FuelStation::query(), $request)->findOrFail($stationId);
        $ids = $this->settings->forStation($station)['fuel_sales_allowed_payment_method_ids'] ?? [];
        $methods = PaymentMethod::query()
            ->whereIn('id', is_array($ids) ? $ids : [])
            ->where('is_active', true)
            ->whereIn('settlement_type', ['cash', 'bank'])
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $methods]);
    }

    public function priceIndex(Request $request): JsonResponse
    {
        $query = FuelStationProductPrice::query()->orderByDesc('effective_from');
        if ($request->filled('station_id')) {
            $query->where('fuel_station_id', $request->query('station_id'));
        }
        if ($request->filled('fuel_product_id')) {
            $query->where('fuel_product_id', $request->query('fuel_product_id'));
        }

        return response()->json(['data' => $query->paginate(50)]);
    }

    public function storePrice(StoreFuelStationProductPriceRequest $request): JsonResponse
    {
        $price = $this->domain(fn () => $this->prices->create($request->validated(), $request->user()));

        return response()->json(['data' => $price], 201);
    }

    private function visibleSale(string $id, Request $request): FuelSale
    {
        return $this->scopeToActiveBranch(FuelSale::query(), $request)->findOrFail($id);
    }

    private function present(FuelSale $sale): FuelSale
    {
        return $sale->load(['invoice.lines', 'stockMovement', 'cogsJournalEntry', 'paymentReceipts.payment']);
    }
}

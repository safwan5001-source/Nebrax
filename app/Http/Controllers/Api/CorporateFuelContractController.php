<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CorporateFuelContractActionRequest;
use App\Http\Requests\StoreCorporateFuelContractPriceRequest;
use App\Http\Requests\StoreCorporateFuelContractRequest;
use App\Http\Requests\UpdateCorporateFuelContractRequest;
use App\Http\Resources\CorporateFuelContractResource;
use App\Models\CorporateFuelContract;
use App\Services\CorporateFuelAuthorizationService;
use App\Services\CorporateFuelContractService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class CorporateFuelContractController extends ApiController
{
    public function __construct(
        private CorporateFuelContractService $contracts,
        private CorporateFuelAuthorizationService $credit,
    ) {}

    public function index(): JsonResponse
    {
        return CorporateFuelContractResource::collection(
            CorporateFuelContract::query()->with(['stations', 'fuelProducts', 'prices'])->orderByDesc('created_at')->paginate(50)
        )->response();
    }

    public function show(string $id): JsonResponse
    {
        return (new CorporateFuelContractResource($this->contract($id)->load(['stations', 'fuelProducts', 'prices'])))->response();
    }

    public function store(StoreCorporateFuelContractRequest $request): JsonResponse
    {
        $contract = $this->domain(fn () => $this->contracts->create($request->validated(), $request->user()));

        return (new CorporateFuelContractResource($contract))->response()->setStatusCode(201);
    }

    public function update(UpdateCorporateFuelContractRequest $request, string $id): JsonResponse
    {
        $contract = $this->domain(fn () => $this->contracts->updateDraft($this->contract($id), $request->validated(), $request->user()));

        return (new CorporateFuelContractResource($contract))->response();
    }

    public function activate(CorporateFuelContractActionRequest $request, string $id): JsonResponse
    {
        $contract = $this->domain(fn () => $this->contracts->activate($this->contract($id), $request->user(), $request->validated('reason')));

        return (new CorporateFuelContractResource($contract))->response();
    }

    public function suspend(CorporateFuelContractActionRequest $request, string $id): JsonResponse
    {
        $reason = (string) $request->validated('reason');
        $contract = $this->domain(fn () => $this->contracts->suspend($this->contract($id), $request->user(), $reason));

        return (new CorporateFuelContractResource($contract))->response();
    }

    public function storePrice(StoreCorporateFuelContractPriceRequest $request, string $id): JsonResponse
    {
        $price = $this->domain(fn () => $this->contracts->createPrice($this->contract($id), $request->validated(), $request->user()));

        return response()->json(['data' => $price], 201);
    }

    public function exposure(string $id): JsonResponse
    {
        $contract = $this->contract($id);

        return response()->json([
            'data' => [
                'corporate_fuel_contract_id' => $contract->id,
                'partner_id' => $contract->partner_id,
                'credit_limit_minor' => (int) $contract->credit_limit_minor,
                'official_exposure_minor' => $this->credit->officialExposure($contract->partner_id),
            ],
        ]);
    }

    private function contract(string $id): CorporateFuelContract
    {
        return CorporateFuelContract::query()->findOrFail($id);
    }
}

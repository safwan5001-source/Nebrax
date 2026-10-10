<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreDeliveryConnectorAccountRequest;
use App\Http\Resources\DeliveryConnectorAccountResource;
use App\Models\DeliveryConnectorAccount;
use App\Services\DeliveryHub\DeliveryConnectorAccountService;
use App\Services\DeliveryHub\DeliveryConnectorException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * DLV-CONNECTOR-CORE-1 — إدارة الربط. السر يُعاد عند الإنشاء والتدوير فقط.
 * لا يُفعّل مزوّداً ولا يلمس الفوترة.
 */
class DeliveryConnectorAccountController extends ApiController
{
    public function __construct(private readonly DeliveryConnectorAccountService $accounts) {}

    public function index(Request $request): JsonResponse
    {
        $query = DeliveryConnectorAccount::query()->orderBy('platform_key')->orderBy('external_store_id');
        $allowed = $request->user()->allowedBranchIds();
        if ($allowed !== null) {
            $query->whereIn('branch_id', $allowed);
        }

        return DeliveryConnectorAccountResource::collection($query->get())->response();
    }

    public function show(Request $request, string $id): JsonResponse
    {
        $account = $this->visibleAccount($request, $id);
        if ($account === null) {
            abort(404);
        }

        return (new DeliveryConnectorAccountResource($account))->response();
    }

    public function store(StoreDeliveryConnectorAccountRequest $request): JsonResponse
    {
        try {
            [$account, $secret] = $this->accounts->create($request->user(), $request->validated());
        } catch (DeliveryConnectorException $e) {
            return $this->failure($e);
        }

        return (new DeliveryConnectorAccountResource($account))
            ->additional(['secret' => $secret])
            ->response()
            ->setStatusCode(201);
    }

    public function rotateSecret(Request $request, string $id): JsonResponse
    {
        $account = $this->visibleAccount($request, $id);
        if ($account === null) {
            abort(404);
        }

        try {
            [$account, $secret] = $this->accounts->rotateSecret($account);
        } catch (DeliveryConnectorException $e) {
            return $this->failure($e);
        }

        return (new DeliveryConnectorAccountResource($account))
            ->additional(['secret' => $secret])
            ->response();
    }

    public function disable(Request $request, string $id): JsonResponse
    {
        $account = $this->visibleAccount($request, $id);
        if ($account === null) {
            abort(404);
        }

        try {
            $account = $this->accounts->disable($account);
        } catch (DeliveryConnectorException $e) {
            return $this->failure($e);
        }

        return (new DeliveryConnectorAccountResource($account))->response();
    }

    private function failure(DeliveryConnectorException $e): JsonResponse
    {
        return response()->json([
            'message' => $e->getMessage(),
            'error_code' => $e->errorCode,
        ], $e->status);
    }

    private function visibleAccount(Request $request, string $id): ?DeliveryConnectorAccount
    {
        $account = DeliveryConnectorAccount::query()->whereKey($id)->first();
        if ($account === null || ! $account->visibleTo($request->user())) {
            return null;
        }

        return $account;
    }
}

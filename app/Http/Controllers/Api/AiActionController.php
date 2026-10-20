<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CancelAiActionRequest;
use App\Http\Requests\StoreAiActionRequest;
use App\Http\Requests\StoreAiActionVersionRequest;
use App\Http\Resources\AiActionResource;
use App\Models\AiAction;
use App\Services\AiActionGateway;
use App\Support\AiActionException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class AiActionController extends ApiController
{
    public function store(StoreAiActionRequest $request, AiActionGateway $gateway): JsonResponse
    {
        try {
            $action = $gateway->create($request->user(), (string) $request->input('type'), (array) $request->input('proposal'));
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return (new AiActionResource($action))->response()->setStatusCode(201);
    }

    public function show(Request $request, AiAction $action, AiActionGateway $gateway): JsonResponse
    {
        try {
            $action = $gateway->show($request->user(), $action);
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return (new AiActionResource($action))->response();
    }

    public function storeVersion(StoreAiActionVersionRequest $request, AiAction $action, AiActionGateway $gateway): JsonResponse
    {
        try {
            $action = $gateway->addVersion(
                $request->user(),
                $action,
                (int) $request->input('expected_version'),
                (array) $request->input('proposal'),
            );
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return (new AiActionResource($action))->response()->setStatusCode(201);
    }

    public function cancel(CancelAiActionRequest $request, AiAction $action, AiActionGateway $gateway): JsonResponse
    {
        try {
            $action = $gateway->cancel($request->user(), $action, (int) $request->input('expected_version'));
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return (new AiActionResource($action))->response();
    }

    private function error(AiActionException $exception): JsonResponse
    {
        return response()->json([
            'error' => ['code' => $exception->reason, 'message' => $exception->getMessage()],
        ], $exception->status);
    }
}

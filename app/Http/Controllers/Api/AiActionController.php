<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CancelAiActionRequest;
use App\Http\Requests\StoreAiActionRequest;
use App\Http\Requests\StoreAiActionFileRequest;
use App\Http\Requests\StoreAiActionVersionRequest;
use App\Http\Resources\AiActionExtractionResource;
use App\Http\Resources\AiActionResource;
use App\Models\AiAction;
use App\Models\AiActionFile;
use App\Services\AiActionGateway;
use App\Services\AiActionProductFileIntakeService;
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

    public function storeFile(StoreAiActionFileRequest $request, AiAction $action, AiActionProductFileIntakeService $intake): JsonResponse
    {
        try {
            $result = $intake->intake($request->user(), $action, (int) $request->input('expected_version'), $request->file('file'));
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        $response = (new AiActionExtractionResource($result['extraction']))->response()->setStatusCode(201);
        if ($result['replayed']) $response->headers->set('AI-Action-File-Replayed', 'true');

        return $response;
    }

    public function showExtraction(Request $request, AiAction $action, AiActionFile $file, AiActionProductFileIntakeService $intake): JsonResponse
    {
        try {
            $extraction = $intake->extraction($request->user(), $action, $file);
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return (new AiActionExtractionResource($extraction))->response();
    }

    private function error(AiActionException $exception): JsonResponse
    {
        return response()->json([
            'error' => ['code' => $exception->reason, 'message' => $exception->getMessage()],
        ], $exception->status);
    }
}

<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CancelAiActionRequest;
use App\Http\Requests\StoreAiActionRequest;
use App\Http\Requests\StoreAiActionFileRequest;
use App\Http\Requests\StoreAiActionImageArchiveRequest;
use App\Http\Requests\StoreAiActionVersionRequest;
use App\Http\Requests\StoreAiActionReviewRequest;
use App\Http\Requests\RetryAiActionExecutionRequest;
use App\Http\Requests\StoreAiActionApprovalRequest;
use App\Http\Requests\StoreAiActionExecutionRequest;
use App\Http\Requests\StoreAiActionPreviewRequest;
use App\Http\Resources\AiActionExtractionResource;
use App\Http\Resources\AiActionResource;
use App\Models\AiAction;
use App\Models\AiActionFile;
use App\Services\AiActionGateway;
use App\Services\AiActionProductFileIntakeService;
use App\Services\AiActionProductImageStager;
use App\Services\AiActionProductApprovalService;
use App\Services\AiActionProductExecutionService;
use App\Services\AiActionProductReviewService;
use App\Support\AiActionCostVisibility;
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

    public function review(Request $request, AiAction $action, AiActionProductReviewService $review): JsonResponse
    {
        try {
            $data = $review->show($request->user(), $action);
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }
        return response()->json(['data' => [
            'action' => (new AiActionResource($data['action']))->resolve(),
            'proposal' => AiActionCostVisibility::allows($request->user()) ? $data['proposal'] : AiActionCostVisibility::redactProposal($data['proposal']),
            'manifest_hash' => $data['manifest_hash'],
        ]]);
    }

    public function storeReview(StoreAiActionReviewRequest $request, AiAction $action, AiActionProductReviewService $review): JsonResponse
    {
        try {
            $action = $review->edit($request->user(), $action, (int) $request->input('expected_version'), (array) $request->input('edits'));
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }
        return (new AiActionResource($action))->response()->setStatusCode(201);
    }

    public function storePreview(StoreAiActionPreviewRequest $request, AiAction $action, AiActionProductApprovalService $approvals): JsonResponse
    {
        try {
            $result = $approvals->createPreview($request->user(), $action, (int) $request->input('expected_version'));
            $data = $approvals->present($result['preview']->load('approval'), $request->user(), $request->query());
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }
        $response = response()->json(['data' => $data], $result['replayed'] ? 200 : 201);
        if ($result['replayed']) $response->headers->set('AI-Action-Preview-Replayed', 'true');

        return $response;
    }

    public function showPreview(Request $request, AiAction $action, string $preview, AiActionProductApprovalService $approvals): JsonResponse
    {
        try {
            $model = $approvals->preview($request->user(), $action, $preview === 'latest' ? null : $preview);
            $data = $approvals->present($model, $request->user(), $request->query());
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return response()->json(['data' => $data]);
    }

    public function approve(StoreAiActionApprovalRequest $request, AiAction $action, AiActionProductApprovalService $approvals): JsonResponse
    {
        try {
            $result = $approvals->approve(
                $request->user(), $action, (int) $request->input('expected_version'),
                (string) $request->input('preview_id'), (string) $request->input('preview_hash'),
            );
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }
        $response = response()->json(['data' => $approvals->presentApproval($result['approval']) + ['action' => ['id' => $action->id, 'status' => AiAction::STATUS_APPROVED, 'version' => (int) $result['approval']->action_version]]], $result['replayed'] ? 200 : 201);
        if ($result['replayed']) $response->headers->set('AI-Action-Approval-Replayed', 'true');

        return $response;
    }

    public function execute(StoreAiActionExecutionRequest $request, AiAction $action, AiActionProductExecutionService $executions): JsonResponse
    {
        try {
            $result = $executions->run($request->user(), $action, (int) $request->input('expected_version'));
            $data = $executions->present($result['execution'], $request->user(), $request->query());
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }
        $response = response()->json(['data' => $data], $result['replayed'] ? 200 : 201);
        if ($result['replayed']) $response->headers->set('AI-Action-Execution-Replayed', 'true');

        return $response;
    }

    public function retryExecution(RetryAiActionExecutionRequest $request, AiAction $action, string $execution, AiActionProductExecutionService $executions): JsonResponse
    {
        try {
            $model = $executions->retry($request->user(), $action, $execution);
            $data = $executions->present($model, $request->user(), $request->query());
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return response()->json(['data' => $data]);
    }

    public function showExecution(Request $request, AiAction $action, string $execution, AiActionProductExecutionService $executions): JsonResponse
    {
        try {
            $model = $executions->show($request->user(), $action, $execution === 'latest' ? null : $execution);
            $data = $executions->present($model, $request->user(), $request->query());
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return response()->json(['data' => $data]);
    }

    /** AI-ACTIONS-06: validated ZIP of product images → private staging. Nothing is attached to a product. */
    public function storeImageArchive(StoreAiActionImageArchiveRequest $request, AiAction $action, AiActionProductImageStager $stager): JsonResponse
    {
        try {
            $result = $stager->stageArchive($request->user(), $action, (int) $request->input('expected_version'), $request->file('archive'));
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        $response = response()->json(['data' => $this->imageList($stager, $action)], 201);
        if ($result['replayed']) $response->headers->set('AI-Action-Images-Replayed', 'true');

        return $response;
    }

    public function listImages(Request $request, AiAction $action, AiActionProductImageStager $stager): JsonResponse
    {
        try {
            app(AiActionGateway::class)->authorizeFileIntake($request->user(), $action);
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return response()->json(['data' => $this->imageList($stager, $action)]);
    }

    /** Authenticated, tenant- and action-scoped thumbnail. The stored object is a re-encoded, size-bounded copy. */
    public function showImageThumbnail(Request $request, AiAction $action, string $image, AiActionProductImageStager $stager)
    {
        try {
            $thumbnail = $stager->thumbnail($request->user(), $action, $image);
        } catch (AiActionException $exception) {
            return $this->error($exception);
        }

        return response()->stream(function () use ($thumbnail): void {
            fpassthru($thumbnail['stream']);
            fclose($thumbnail['stream']);
        }, 200, [
            'Content-Type' => $thumbnail['mime'],
            'X-Content-Type-Options' => 'nosniff',
            'Content-Security-Policy' => "default-src 'none'",
            'Cache-Control' => 'private, max-age=300',
        ]);
    }

    /** @return array<string,mixed> */
    private function imageList(AiActionProductImageStager $stager, AiAction $action): array
    {
        $catalog = $stager->catalog($action);

        return [
            'archive' => array_map(static fn (array $image): array => [
                'id' => $image['id'], 'label' => $image['label'], 'sha256' => $image['sha256'], 'mime_type' => $image['mime_type'],
                'size' => $image['size'], 'width' => $image['width'], 'height' => $image['height'],
            ], $catalog['archive']),
            'remote' => count(array_filter($catalog['by_key'], static fn (array $image): bool => $image['kind'] === 'url')),
        ];
    }

    private function error(AiActionException $exception): JsonResponse
    {
        return response()->json([
            'error' => ['code' => $exception->reason, 'message' => $exception->getMessage()],
        ], $exception->status);
    }
}

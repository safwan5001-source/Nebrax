<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CancelStorefrontPresentationVersionScheduleRequest;
use App\Http\Requests\CreateStorefrontPresentationVersionRequest;
use App\Http\Requests\PublishStorefrontPresentationVersionRequest;
use App\Http\Requests\RenameStorefrontPresentationVersionRequest;
use App\Http\Requests\SaveStorefrontPresentationVersionRequest;
use App\Http\Requests\ScheduleStorefrontPresentationVersionRequest;
use App\Services\Commerce\ActiveVersionImmutableException;
use App\Services\Commerce\ForwardSchemaVersionException;
use App\Services\Commerce\InvalidScheduleTimeException;
use App\Services\Commerce\PresentationDocumentTooLargeException;
use App\Services\Commerce\PresentationPublishValidationException;
use App\Services\Commerce\SourceVersionNotFoundException;
use App\Services\Commerce\StalePublicationHeadException;
use App\Services\Commerce\StaleScheduleTokenException;
use App\Services\Commerce\StaleVersionRevisionException;
use App\Services\Commerce\StorefrontPresentationVersionService;
use App\Services\Commerce\VersionLifecycleConflictException;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * CUST-H1-1 — أساس النسخ (list/create/read/save/rename/delete) داخل
 * مساحة عمل التجارة. لا نشر ولا جدولة هنا. `{id}`/`{version}` محدِّدا صفّ
 * فقط. الملكية من `TenantContext`. أجنبي/مفقود → 404 لا 403.
 */
class CommerceWorkspaceStorefrontPresentationVersionController extends ApiController
{
    public function index(
        Request $request,
        StorefrontPresentationVersionService $versions,
        string $id,
    ): JsonResponse {
        $this->denySelfService($request);

        $payload = $versions->listForCurrentTenant($id);
        if ($payload === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json(['data' => $payload]);
    }

    public function store(
        CreateStorefrontPresentationVersionRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
    ): JsonResponse {
        $this->denySelfService($request);

        try {
            $payload = $versions->createForCurrentTenant(
                $id,
                $request->validated('name'),
                $request->validated('source_version_id'),
            );
        } catch (SourceVersionNotFoundException $e) {
            abort(404, $e->getMessage());
        } catch (ForwardSchemaVersionException $e) {
            abort(409, $e->getMessage());
        } catch (PresentationDocumentTooLargeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json(['data' => $payload], 201);
    }

    public function show(
        Request $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);

        try {
            $payload = $versions->showForCurrentTenant($id, $version);
        } catch (ForwardSchemaVersionException $e) {
            abort(409, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function update(
        SaveStorefrontPresentationVersionRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);
        $this->rejectOversizedBody($request);

        try {
            $payload = $versions->saveForCurrentTenant(
                $id,
                $version,
                $request->validated('config'),
                (int) $request->validated('revision'),
            );
        } catch (StaleVersionRevisionException|ActiveVersionImmutableException|ForwardSchemaVersionException $e) {
            abort(409, $e->getMessage());
        } catch (PresentationDocumentTooLargeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function rename(
        RenameStorefrontPresentationVersionRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);

        try {
            $payload = $versions->renameForCurrentTenant(
                $id,
                $version,
                $request->validated('name'),
                (int) $request->validated('revision'),
            );
        } catch (StaleVersionRevisionException|ForwardSchemaVersionException $e) {
            abort(409, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function publish(
        PublishStorefrontPresentationVersionRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);

        $expectedPublishedRevision = $request->validated('expected_published_revision');

        try {
            $payload = $versions->publishForCurrentTenant(
                $id,
                $version,
                (int) $request->validated('revision'),
                $expectedPublishedRevision !== null ? (int) $expectedPublishedRevision : null,
                $request->validated('expected_active_version_id'),
            );
        } catch (StaleVersionRevisionException|StalePublicationHeadException|ForwardSchemaVersionException|VersionLifecycleConflictException $e) {
            abort(409, $e->getMessage());
        } catch (PresentationPublishValidationException $e) {
            return response()->json($e->toPayload(), 422);
        } catch (PresentationDocumentTooLargeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function schedule(
        ScheduleStorefrontPresentationVersionRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);

        try {
            $payload = $versions->scheduleForCurrentTenant(
                $id,
                $version,
                (int) $request->validated('revision'),
                $request->validated('scheduled_for'),
                $request->validated('expected_schedule_token'),
            );
        } catch (StaleVersionRevisionException|StaleScheduleTokenException|VersionLifecycleConflictException $e) {
            abort(409, $e->getMessage());
        } catch (PresentationPublishValidationException $e) {
            return response()->json($e->toPayload(), 422);
        } catch (InvalidScheduleTimeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function cancelSchedule(
        CancelStorefrontPresentationVersionScheduleRequest $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): JsonResponse {
        $this->denySelfService($request);

        try {
            $payload = $versions->cancelScheduleForCurrentTenant(
                $id,
                $version,
                $request->validated('expected_schedule_token'),
            );
        } catch (StaleScheduleTokenException|VersionLifecycleConflictException $e) {
            abort(409, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->json(['data' => $payload]);
    }

    public function destroy(
        Request $request,
        StorefrontPresentationVersionService $versions,
        string $id,
        string $version,
    ): Response {
        $this->denySelfService($request);

        try {
            $deleted = $versions->deleteForCurrentTenant($id, $version);
        } catch (VersionLifecycleConflictException $e) {
            abort(409, $e->getMessage());
        }

        if ($deleted === null) {
            abort(404, 'النسخة غير موجودة.');
        }

        return response()->noContent();
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }

    private function rejectOversizedBody(Request $request): void
    {
        if (strlen((string) $request->getContent()) > StorefrontPresentationNormalizer::MAX_DOCUMENT_BYTES) {
            abort(422, 'مستند المظهر أكبر من الحد المسموح.');
        }
    }
}

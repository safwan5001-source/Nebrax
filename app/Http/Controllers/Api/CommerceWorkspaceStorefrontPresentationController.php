<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\PublishStorefrontPresentationRequest;
use App\Http\Requests\SaveStorefrontPresentationRequest;
use App\Services\Commerce\NothingToPublishException;
use App\Services\Commerce\PresentationDocumentTooLargeException;
use App\Services\Commerce\StaleDraftRevisionException;
use App\Services\Commerce\StorefrontPresentationService;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * STORE-BACKEND-1 — مسودة/نشر مظهر المتجر داخل مساحة عمل التجارة.
 *
 * `{id}` محدِّد صفّ فقط. الملكية من `TenantContext`. أجنبي/مفقود → 404
 * `'المتجر غير موجود.'` لا 403. `self_service` ممنوع كبقية مساحة العمل.
 */
class CommerceWorkspaceStorefrontPresentationController extends ApiController
{
    public function show(
        Request $request,
        StorefrontPresentationService $presentations,
        string $id,
    ): JsonResponse {
        $this->denySelfService($request);

        $payload = $presentations->showForCurrentTenant($id);
        if ($payload === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json(['data' => $payload]);
    }

    public function update(
        SaveStorefrontPresentationRequest $request,
        StorefrontPresentationService $presentations,
        string $id,
    ): JsonResponse {
        $this->denySelfService($request);
        $this->rejectOversizedBody($request);

        try {
            $payload = $presentations->saveDraftForCurrentTenant(
                $id,
                $request->validated('config'),
                (int) $request->validated('draft_revision'),
            );
        } catch (StaleDraftRevisionException $e) {
            abort(409, $e->getMessage());
        } catch (PresentationDocumentTooLargeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json(['data' => $payload]);
    }

    public function publish(
        PublishStorefrontPresentationRequest $request,
        StorefrontPresentationService $presentations,
        string $id,
    ): JsonResponse {
        $this->denySelfService($request);
        $this->rejectOversizedBody($request);

        try {
            $payload = $presentations->publishForCurrentTenant(
                $id,
                $request->expectedRevision(),
            );
        } catch (StaleDraftRevisionException $e) {
            abort(409, $e->getMessage());
        } catch (NothingToPublishException|PresentationDocumentTooLargeException $e) {
            abort(422, $e->getMessage());
        }

        if ($payload === null) {
            abort(404, 'المتجر غير موجود.');
        }

        return response()->json(['data' => $payload]);
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

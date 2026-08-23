<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\CommercialAssignmentLifecycleRequest;
use App\Http\Requests\CommercialAssignmentLifecycleDateRequest;
use App\Http\Requests\CommercialAssignmentPreviewRequest;
use App\Http\Requests\CommercialAssignmentStoreRequest;
use App\Http\Requests\CommercialTrialStoreRequest;
use App\Models\CommercialPlanVersion;
use App\Models\CommercialProductVersion;
use App\Models\PlatformAdministrator;
use App\Models\Tenant;
use App\Models\TenantCommercialAssignment;
use App\Services\CommercialAssignmentService;
use App\Services\CommercialAssignmentLifecycleService;
use App\Services\CommercialTrialService;
use App\Services\CommercialAccessInspectorService;
use App\Support\ApplicationOperationClass;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PlatformCommercialAssignmentController extends ApiController
{
    public function __construct(
        private CommercialAssignmentService $assignments,
        private CommercialAssignmentLifecycleService $lifecycle,
        private CommercialTrialService $trials,
        private CommercialAccessInspectorService $inspector,
    ) {}

    public function index(Tenant $tenant): JsonResponse
    {
        return response()->json([
            'data' => TenantCommercialAssignment::query()
                ->where('tenant_id', $tenant->id)
                ->with(['planVersion', 'productVersion', 'events'])
                ->latest('created_at')
                ->get()
                ->map(fn (TenantCommercialAssignment $assignment) => $this->assignmentData($assignment))
                ->all(),
        ]);
    }

    public function preview(CommercialAssignmentPreviewRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();
        $startsAt = CarbonImmutable::parse($data['starts_at'], 'UTC');
        $endsAt = isset($data['ends_at']) ? CarbonImmutable::parse($data['ends_at'], 'UTC') : null;
        $preview = $data['source_type'] === TenantCommercialAssignment::SOURCE_PLAN
            ? $this->assignments->previewPlan($tenant, CommercialPlanVersion::query()->findOrFail($data['version_id']), $startsAt, $endsAt)
            : $this->assignments->previewAddon($tenant, CommercialProductVersion::query()->findOrFail($data['version_id']), $startsAt, $endsAt);

        return response()->json(['data' => $preview]);
    }

    public function assignPlan(CommercialAssignmentStoreRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();
        $assignment = $this->assignments->assignPlan(
            $tenant,
            $this->administrator($request),
            CommercialPlanVersion::query()->findOrFail($data['version_id']),
            CarbonImmutable::parse($data['starts_at'], 'UTC'),
            isset($data['ends_at']) ? CarbonImmutable::parse($data['ends_at'], 'UTC') : null,
            $data['reason'] ?? null,
        );

        return response()->json(['data' => $this->assignmentData($assignment)], $assignment->wasRecentlyCreated ? 201 : 200);
    }

    public function assignAddon(CommercialAssignmentStoreRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();
        $assignment = $this->assignments->assignAddon(
            $tenant,
            $this->administrator($request),
            CommercialProductVersion::query()->findOrFail($data['version_id']),
            CarbonImmutable::parse($data['starts_at'], 'UTC'),
            isset($data['ends_at']) ? CarbonImmutable::parse($data['ends_at'], 'UTC') : null,
            $data['reason'] ?? null,
        );

        return response()->json(['data' => $this->assignmentData($assignment)], $assignment->wasRecentlyCreated ? 201 : 200);
    }

    public function inspectAccess(Request $request, Tenant $tenant, string $capabilityKey): JsonResponse
    {
        $operation = ApplicationOperationClass::tryFrom((string) $request->query('operation', 'read'));
        if ($operation === null) abort(422, 'Unknown operation class.');
        $at = $request->query('at') === null ? null : CarbonImmutable::parse((string) $request->query('at'), 'UTC');

        return response()->json(['data' => $this->inspector->inspect($tenant, $capabilityKey, $operation, $at)]);
    }

    public function startPlanTrial(CommercialTrialStoreRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();
        $version = CommercialPlanVersion::query()->findOrFail($data['version_id']);
        $assignment = $this->trials->startPlanTrial(
            $tenant, $this->administrator($request), $version,
            CarbonImmutable::parse($data['starts_at'] ?? now('UTC'), 'UTC'), (int) $data['duration_days'], $data['reason'] ?? null,
        );

        return response()->json(['data' => $this->assignmentData($assignment)], 201);
    }

    public function startAddonTrial(CommercialTrialStoreRequest $request, Tenant $tenant): JsonResponse
    {
        $data = $request->validated();
        $version = CommercialProductVersion::query()->findOrFail($data['version_id']);
        $assignment = $this->trials->startAddonTrial(
            $tenant, $this->administrator($request), $version,
            CarbonImmutable::parse($data['starts_at'] ?? now('UTC'), 'UTC'), (int) $data['duration_days'], $data['reason'] ?? null,
        );

        return response()->json(['data' => $this->assignmentData($assignment)], 201);
    }

    public function paymentFailure(CommercialAssignmentLifecycleDateRequest $request, TenantCommercialAssignment $assignment): JsonResponse
    {
        $data = $request->validated();
        return response()->json([
            'data' => $this->assignmentData($this->lifecycle->recordPaymentFailure(
                $assignment, $this->administrator($request), CarbonImmutable::parse($data['effective_at'], 'UTC'), $data['reason'] ?? null,
            )),
        ]);
    }

    public function scheduleCancellation(CommercialAssignmentLifecycleDateRequest $request, TenantCommercialAssignment $assignment): JsonResponse
    {
        $data = $request->validated();
        return response()->json([
            'data' => $this->assignmentData($this->lifecycle->scheduleCancellation(
                $assignment, $this->administrator($request), CarbonImmutable::parse($data['effective_at'], 'UTC'), $data['reason'] ?? null,
            )),
        ]);
    }

    public function reconcile(CommercialAssignmentLifecycleDateRequest $request, TenantCommercialAssignment $assignment): JsonResponse
    {
        $data = $request->validated();
        return response()->json([
            'data' => $this->assignmentData($this->lifecycle->reconcile(
                $assignment, $this->administrator($request), CarbonImmutable::parse($data['effective_at'], 'UTC'), $data['reason'] ?? null,
            )),
        ]);
    }

    public function cancel(CommercialAssignmentLifecycleRequest $request, TenantCommercialAssignment $assignment): JsonResponse
    {
        return response()->json([
            'data' => $this->assignmentData($this->assignments->cancel($assignment, $this->administrator($request), $request->validated('reason'))),
        ]);
    }

    public function revoke(CommercialAssignmentLifecycleRequest $request, TenantCommercialAssignment $assignment): JsonResponse
    {
        return response()->json([
            'data' => $this->assignmentData($this->assignments->revoke($assignment, $this->administrator($request), $request->validated('reason'))),
        ]);
    }

    private function administrator(Request $request): PlatformAdministrator
    {
        /** @var PlatformAdministrator $administrator */
        $administrator = $request->user();

        return $administrator;
    }

    /** @return array<string, mixed> */
    private function assignmentData(TenantCommercialAssignment $assignment): array
    {
        return [
            'id' => $assignment->id,
            'tenant_id' => $assignment->tenant_id,
            'source_type' => $assignment->source_type,
            'status' => $assignment->status,
            'plan_version_id' => $assignment->commercial_plan_version_id,
            'product_version_id' => $assignment->commercial_product_version_id,
            'starts_at' => $assignment->starts_at?->toIso8601String(),
            'ends_at' => $assignment->ends_at?->toIso8601String(),
            'lifecycle_state' => $assignment->lifecycle_state,
            'payment_failed_at' => $assignment->payment_failed_at?->toIso8601String(),
            'scheduled_cancellation_at' => $assignment->scheduled_cancellation_at?->toIso8601String(),
            'ended_at' => $assignment->ended_at?->toIso8601String(),
            'cancelled_at' => $assignment->cancelled_at?->toIso8601String(),
            'revoked_at' => $assignment->revoked_at?->toIso8601String(),
            'reason' => $assignment->reason,
            'events' => $assignment->events->map(fn ($event) => [
                'action' => $event->action,
                'effective_at' => $event->effective_at?->toIso8601String(),
                'reason' => $event->reason,
            ])->values()->all(),
        ];
    }
}

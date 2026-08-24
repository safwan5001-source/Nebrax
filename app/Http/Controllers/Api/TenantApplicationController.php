<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ToggleApplicationRequest;
use App\Services\TenantApplicationService;
use Illuminate\Http\JsonResponse;

/** إدارة التطبيقات الرئيسية وقدراتها الفرعية مع بقاء الاستحقاق وRBAC منفصلين. */
class TenantApplicationController extends ApiController
{
    public function __construct(private TenantApplicationService $applications) {}

    public function index(): JsonResponse
    {
        return response()->json([
            'data' => $this->applications->stateFor(),
            'groups' => $this->applications->groupStateFor(),
        ]);
    }

    /**
     * أي قدرات مرئية اليوم لهذا المستأجر — للشريط الجانبي وحده. متاح لأي
     * مستخدم مصادَق بلا `apps.view` عمداً: كل الأدوار تحتاج التنقّل الصحيح.
     */
    public function navState(): JsonResponse
    {
        return response()->json(['data' => $this->applications->navVisibility()]);
    }

    public function enable(ToggleApplicationRequest $request): JsonResponse
    {
        return $this->toggle($request, true);
    }

    public function disable(ToggleApplicationRequest $request): JsonResponse
    {
        return $this->toggle($request, false);
    }

    private function toggle(ToggleApplicationRequest $request, bool $enabled): JsonResponse
    {
        $scope = $request->validated('scope') ?? 'capability';
        $reason = $request->validated('reason');
        $actor = $request->user();

        if ($scope === 'all_groups') {
            $data = $this->domain(fn () => $this->applications->setAllGroups($enabled, $actor, $reason));

            return response()->json([
                'data' => $data,
                'applications' => $this->applications->stateFor(),
                'groups' => $this->applications->groupStateFor(),
            ]);
        }

        if ($scope === 'group') {
            $group = $request->validated('group_key');
            $this->domain(fn () => $enabled
                ? $this->applications->enableGroup($group, $actor, $reason)
                : $this->applications->disableGroup($group, $actor, $reason));

            return response()->json([
                'data' => $this->applications->groupStateFor()[$group],
                'applications' => $this->applications->stateFor(),
                'groups' => $this->applications->groupStateFor(),
            ]);
        }

        if ($scope === 'group_capabilities') {
            $group = $request->validated('group_key');
            $data = $this->domain(fn () => $this->applications->setGroupCapabilities(
                $group,
                $enabled,
                $actor,
                $reason,
            ));

            return response()->json([
                'data' => $data,
                'applications' => $this->applications->stateFor(),
                'groups' => $this->applications->groupStateFor(),
            ]);
        }

        $key = $request->validated('application_key');
        $this->domain(fn () => $enabled
            ? $this->applications->enable($key, $actor, $reason)
            : $this->applications->disable($key, $actor, $reason));

        return response()->json([
            'data' => $this->applications->stateFor()[$key],
            'groups' => $this->applications->groupStateFor(),
        ]);
    }
}

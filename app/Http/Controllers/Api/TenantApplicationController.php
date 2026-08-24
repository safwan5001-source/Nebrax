<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\ToggleApplicationGroupRequest;
use App\Http\Requests\ToggleApplicationRequest;
use App\Services\TenantApplicationService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
        $key = $request->validated('application_key');
        $this->domain(fn () => $this->applications->enable($key, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->stateFor()[$key]]);
    }

    public function disable(ToggleApplicationRequest $request): JsonResponse
    {
        $key = $request->validated('application_key');
        $this->domain(fn () => $this->applications->disable($key, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->stateFor()[$key]]);
    }

    public function enableGroup(ToggleApplicationGroupRequest $request): JsonResponse
    {
        $group = $request->validated('group_key');
        $this->domain(fn () => $this->applications->enableGroup($group, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->groupStateFor()[$group]]);
    }

    public function disableGroup(ToggleApplicationGroupRequest $request): JsonResponse
    {
        $group = $request->validated('group_key');
        $this->domain(fn () => $this->applications->disableGroup($group, $request->user(), $request->validated('reason')));

        return response()->json(['data' => $this->applications->groupStateFor()[$group]]);
    }

    public function enableAllGroups(Request $request): JsonResponse
    {
        $validated = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $data = $this->domain(fn () => $this->applications->setAllGroups(true, $request->user(), $validated['reason'] ?? null));

        return response()->json(['data' => $data]);
    }

    public function disableAllGroups(Request $request): JsonResponse
    {
        $validated = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $data = $this->domain(fn () => $this->applications->setAllGroups(false, $request->user(), $validated['reason'] ?? null));

        return response()->json(['data' => $data]);
    }

    public function enableGroupCapabilities(ToggleApplicationGroupRequest $request): JsonResponse
    {
        $group = $request->validated('group_key');
        $data = $this->domain(fn () => $this->applications->setGroupCapabilities(
            $group,
            true,
            $request->user(),
            $request->validated('reason'),
        ));

        return response()->json([
            'data' => $data,
            'applications' => $this->applications->stateFor(),
        ]);
    }

    public function disableGroupCapabilities(ToggleApplicationGroupRequest $request): JsonResponse
    {
        $group = $request->validated('group_key');
        $data = $this->domain(fn () => $this->applications->setGroupCapabilities(
            $group,
            false,
            $request->user(),
            $request->validated('reason'),
        ));

        return response()->json([
            'data' => $data,
            'applications' => $this->applications->stateFor(),
        ]);
    }
}

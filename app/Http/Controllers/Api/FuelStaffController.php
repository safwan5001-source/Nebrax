<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateFuelStaffRequest;
use App\Services\AccessChangeAuditReader;
use App\Services\AccessChangeAuditor;
use App\Services\FuelStaffAccessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * FUEL-B3: إدارة موظفي المحطات (قوالب الصلاحيات + الصلاحيات الفردية + نطاق المحطات). الصلاحية `fuel.staff.manage`؛
 * الحدود (سقف المنح، النطاق، لا نفسه/المالك) في الخدمة، والمحاولات المرفوضة تُدقَّق.
 */
class FuelStaffController extends ApiController
{
    public function __construct(private FuelStaffAccessService $staff, private AccessChangeAuditor $auditor, private AccessChangeAuditReader $audit) {}

    public function templates(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->staff->templates($request->user())]);
    }

    public function index(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->staff->list($request->user())]);
    }

    /** FUEL-B4: موظفون يمكن البدء بإدارتهم (قراءة فقط، بنفس حراس التعديل). */
    public function candidates(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->staff->candidates($request->user())]);
    }

    /** FUEL-B4: سجل تغييرات الصلاحيات — قراءة فقط ومقيَّد بنطاق الفاعل، بترقيم صفحات على الخادم. */
    public function audit(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'outcome' => ['nullable', 'string', 'in:applied,denied'],
            'target_user_id' => ['nullable', 'uuid'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'page' => ['nullable', 'integer', 'min:1'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        return response()->json($this->audit->page($request->user(), $filters));
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return response()->json(['data' => $this->staff->show($request->user(), $id)]);
    }

    public function update(UpdateFuelStaffRequest $request, string $id): JsonResponse
    {
        $input = $request->validated();
        $this->staff->ensureTargetExists($request->user(), $id);
        $attempted = array_filter([
            'template' => array_key_exists('template', $input) ? ($input['template'] ?? 'none') : null,
            'grant_all_fuel' => $input['grant_all_fuel'] ?? null,
            'add_permissions' => $input['add_permissions'] ?? null,
            'remove_permissions' => $input['remove_permissions'] ?? null,
            'station_ids' => $input['station_ids'] ?? null,
        ], fn ($v) => $v !== null);

        $result = $this->auditor->guard(
            'fuel_staff.updated', AccessChangeAuditor::SUBJECT_FUEL_STAFF, $id, $id, $request->user(), $attempted,
            fn () => $this->domain(fn () => $this->staff->update($request->user(), $id, $input)),
        );

        return response()->json(['data' => $result]);
    }
}

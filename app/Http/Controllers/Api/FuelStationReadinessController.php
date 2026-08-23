<?php

namespace App\Http\Controllers\Api;

use App\Models\FinancialControlAlert;
use App\Models\FuelStationMaintenanceSchedule;
use App\Models\FuelStationSafetyCorrectiveAction;
use App\Models\FuelStationSafetyFinding;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationSafetyPermit;
use App\Models\FuelStationWorkOrder;
use App\Services\FuelStationAlertService;
use App\Services\FuelStationMaintenanceService;
use App\Services\FuelStationSafetyService;
use App\Services\Reporting\FuelStationReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Cycle 9 surface; writes delegate to audited domain services only. */
class FuelStationReadinessController extends ApiController
{
    public function __construct(
        private readonly FuelStationMaintenanceService $maintenance,
        private readonly FuelStationSafetyService $safety,
        private readonly FuelStationAlertService $alerts,
        private readonly FuelStationReportService $reports,
    ) {
    }

    public function maintenance(Request $request): JsonResponse
    {
        $request->validate(['fuel_station_id' => ['nullable', 'uuid'], 'status' => ['nullable', 'string', 'max:32']]);
        $schedules = FuelStationMaintenanceSchedule::query()->with('station')->when($request->fuel_station_id, fn ($q, $id) => $q->where('fuel_station_id', $id))->orderBy('next_due_at')->paginate(50);
        $orders = FuelStationWorkOrder::query()->with(['station', 'schedule', 'assignee'])->when($request->fuel_station_id, fn ($q, $id) => $q->where('fuel_station_id', $id))->when($request->status, fn ($q, $status) => $q->where('status', $status))->orderByDesc('opened_at')->paginate(50);

        return response()->json(['data' => ['schedules' => $schedules, 'work_orders' => $orders]]);
    }

    public function storeSchedule(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fuel_station_id' => ['required', 'uuid'], 'asset_type' => ['required', 'string', 'max:160'], 'asset_id' => ['required', 'uuid'],
            'name' => ['required', 'string', 'max:160'], 'schedule_type' => ['required', 'in:calendar,runtime,meter'],
            'interval_days' => ['nullable', 'integer', 'min:0'], 'interval_milliliters' => ['nullable', 'integer', 'min:0'],
            'manufacturer_interval' => ['nullable', 'string', 'max:160'], 'instructions' => ['nullable', 'string', 'max:4000'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $schedule = $this->domain(fn () => $this->maintenance->createSchedule($data, $request->user()));

        return response()->json(['data' => $schedule], 201);
    }

    public function storeWorkOrder(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fuel_station_id' => ['required', 'uuid'], 'fuel_station_maintenance_schedule_id' => ['nullable', 'uuid'],
            'asset_type' => ['required', 'string', 'max:160'], 'asset_id' => ['required', 'uuid'], 'work_type' => ['required', 'in:preventive,corrective'],
            'priority' => ['nullable', 'in:low,medium,high,critical'], 'severity' => ['nullable', 'in:low,medium,high,critical'],
            'title' => ['required', 'string', 'max:200'], 'description' => ['nullable', 'string', 'max:5000'], 'vendor_name' => ['nullable', 'string', 'max:160'],
            'assigned_to' => ['nullable', 'uuid'], 'cost_minor' => ['nullable', 'integer', 'min:0'], 'downtime_minutes' => ['nullable', 'integer', 'min:0'],
            'evidence_reference' => ['nullable', 'string', 'max:500'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $order = $this->domain(fn () => $this->maintenance->createWorkOrder($data, $request->user()));

        return response()->json(['data' => $order->load(['station', 'schedule', 'assignee'])], 201);
    }

    public function transitionWorkOrder(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:triaged,scheduled,in_progress,completed,verified,closed'], 'scheduled_at' => ['nullable', 'date'],
            'root_cause' => ['nullable', 'string', 'max:5000'], 'resolution' => ['nullable', 'string', 'max:5000'],
            'cost_minor' => ['nullable', 'integer', 'min:0'], 'downtime_minutes' => ['nullable', 'integer', 'min:0'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $order = FuelStationWorkOrder::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->maintenance->transition($order, $data['status'], $data, $request->user()));

        return response()->json(['data' => $updated]);
    }

    public function safety(Request $request): JsonResponse
    {
        $request->validate(['fuel_station_id' => ['nullable', 'uuid']]);
        $station = $request->query('fuel_station_id');
        return response()->json(['data' => [
            'inspections' => FuelStationSafetyInspection::query()->with(['station', 'findings.correctiveActions'])->when($station, fn ($q) => $q->where('fuel_station_id', $station))->orderByDesc('scheduled_at')->paginate(50),
            'permits' => FuelStationSafetyPermit::query()->with('station')->when($station, fn ($q) => $q->where('fuel_station_id', $station))->orderBy('expires_on')->paginate(50),
        ]]);
    }

    public function storeInspection(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fuel_station_id' => ['required', 'uuid'], 'inspection_type' => ['required', 'string', 'max:80'], 'scheduled_at' => ['nullable', 'date'],
            'notes' => ['nullable', 'string', 'max:5000'], 'evidence_reference' => ['nullable', 'string', 'max:500'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $inspection = $this->domain(fn () => $this->safety->createInspection($data, $request->user()));

        return response()->json(['data' => $inspection], 201);
    }

    public function performInspection(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'reason' => ['nullable', 'string', 'max:500'], 'findings' => ['required', 'array', 'min:1'],
            'findings.*.checklist_key' => ['required', 'string', 'max:120'], 'findings.*.result' => ['required', 'in:pass,fail,not_applicable'],
            'findings.*.severity' => ['nullable', 'in:low,medium,high,critical'], 'findings.*.title' => ['required', 'string', 'max:200'],
            'findings.*.details' => ['nullable', 'string', 'max:5000'], 'findings.*.asset_type' => ['nullable', 'string', 'max:160'], 'findings.*.asset_id' => ['nullable', 'uuid'],
        ]);
        $inspection = FuelStationSafetyInspection::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->safety->performInspection($inspection, $data['findings'], $request->user(), $data['reason'] ?? null));

        return response()->json(['data' => $updated]);
    }

    public function storeCorrectiveAction(Request $request, string $findingId): JsonResponse
    {
        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'], 'description' => ['nullable', 'string', 'max:5000'], 'assigned_to' => ['nullable', 'uuid'],
            'due_date' => ['nullable', 'date'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $finding = FuelStationSafetyFinding::query()->findOrFail($findingId);
        $action = $this->domain(fn () => $this->safety->createCorrectiveAction($finding, $data, $request->user()));

        return response()->json(['data' => $action], 201);
    }

    public function transitionCorrectiveAction(Request $request, string $id): JsonResponse
    {
        $data = $request->validate([
            'status' => ['required', 'in:in_progress,completed,verified,closed'], 'resolution' => ['nullable', 'string', 'max:5000'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $action = FuelStationSafetyCorrectiveAction::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->safety->transitionCorrectiveAction($action, $data['status'], $data, $request->user()));

        return response()->json(['data' => $updated]);
    }

    public function verifyInspection(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $inspection = FuelStationSafetyInspection::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->safety->verifyInspection($inspection, $request->user(), $data['reason'] ?? null));

        return response()->json(['data' => $updated]);
    }

    public function closeInspection(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        $inspection = FuelStationSafetyInspection::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->safety->closeInspection($inspection, $request->user(), $data['reason'] ?? null));

        return response()->json(['data' => $updated]);
    }

    public function storePermit(Request $request): JsonResponse
    {
        $data = $request->validate([
            'fuel_station_id' => ['required', 'uuid'], 'permit_type' => ['required', 'string', 'max:100'], 'reference' => ['required', 'string', 'max:160'],
            'issued_on' => ['nullable', 'date'], 'expires_on' => ['nullable', 'date'], 'asset_type' => ['nullable', 'string', 'max:160'], 'asset_id' => ['nullable', 'uuid'],
            'evidence_reference' => ['nullable', 'string', 'max:500'], 'reason' => ['nullable', 'string', 'max:500'],
        ]);
        $permit = $this->domain(fn () => $this->safety->createPermit($data, $request->user()));

        return response()->json(['data' => $permit], 201);
    }

    public function alerts(Request $request): JsonResponse
    {
        $request->validate(['status' => ['nullable', 'in:active,acknowledged,resolved'], 'severity' => ['nullable', 'in:critical,high,medium,low']]);
        $alerts = FinancialControlAlert::query()->where('rule', 'like', 'fuel.%')
            ->when($request->status, fn ($q, $status) => $q->where('status', $status))
            ->when($request->severity, fn ($q, $severity) => $q->where('severity', $severity))
            ->orderByRaw("CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END")
            ->orderByDesc('last_detected_at')->paginate(50);
        return response()->json(['data' => $alerts]);
    }

    public function scanAlerts(): JsonResponse
    {
        return response()->json(['data' => $this->domain(fn () => $this->alerts->scan())]);
    }

    public function acknowledgeAlert(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:1000']]);
        $alert = FinancialControlAlert::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->alerts->acknowledge($alert, $data['note'] ?? null, $request->user()));
        return response()->json(['data' => $updated]);
    }

    public function assignAlert(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['assigned_to' => ['nullable', 'uuid'], 'reason' => ['nullable', 'string', 'max:500']]);
        $alert = FinancialControlAlert::query()->findOrFail($id);
        $updated = $this->domain(fn () => $this->alerts->assign($alert, $data['assigned_to'] ?? null, $data['reason'] ?? null, $request->user()));
        return response()->json(['data' => $updated]);
    }

    public function dashboard(Request $request): JsonResponse
    {
        return response()->json(['data' => $this->reports->dashboard($this->reportFilters($request))]);
    }

    public function report(Request $request, string $family): JsonResponse
    {
        $filters = $this->reportFilters($request);
        $data = match ($family) {
            'sales' => $this->reports->sales((string) $request->query('dimension', 'station'), $filters),
            'inventory' => $this->reports->inventory($filters),
            'profitability' => $this->reports->profitability((string) $request->query('dimension', 'station'), $filters),
            'fleet' => $this->reports->fleet($filters), 'avi' => $this->reports->avi($filters),
            'devices' => $this->reports->devices($filters), 'maintenance' => $this->reports->maintenance($filters),
            'safety' => $this->reports->safety($filters), default => abort(404),
        };
        return response()->json(['data' => $data]);
    }

    /** @return array<string,mixed> */
    private function reportFilters(Request $request): array
    {
        return $request->validate(['from' => ['nullable', 'date'], 'to' => ['nullable', 'date', 'after_or_equal:from'], 'station_id' => ['nullable', 'uuid']]);
    }
}

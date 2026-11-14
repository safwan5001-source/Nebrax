<?php

namespace App\Http\Controllers\Api;

use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Services\FuelTankerFillAccountingReportService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * TANKER-PR6B-6 — تقارير الرقابة والمطابقة المحاسبية لسندات التعبئة (قراءة فقط، GET وحده): `fills` · `inventory-reconciliation` · `clearing-account` · `accounting-control`.
 *
 * البوابات الثلاث نفسها للترحيل (PR-1 وPR-4 والترحيل) ⇒ 404 موحَّد مغلقاً؛ `fuel.tanker.fill.inventory.view` + قدرة `fuel_stations.core`؛ نطاق المحطة/الفرع كسندات PR-4 و404 موحَّد.
 * المرشّحات: المحطة، الفرع، صاحب الصهريج، نوع الوقود، حالة السند (`status` و`inventory_status`)، والفترة (`from`/`to`). المبالغ والمعرّفات المالية لـ`products.view_cost` فقط ومعرّفات الحسابات لـ`accounts.view` فقط؛
 * **تقرير الحساب الوسيط ماليٌّ بالكامل فيتطلب الصلاحيتين معاً وألا يكون المستخدم مقيَّداً بمحطات/مخازن (403 برمز `reason` وإلا): أرصدة الأستاذ لا تُعزل بالمحطة.** لا مسار يصل جلسة PIN.
 */
class FuelTankerFillReportController extends ApiController
{
    use AuthorizesFuelStationScope;

    private const PER_PAGE = 25;
    private const MAX_PER_PAGE = 100;

    public function __construct(private FuelTankerFillAccountingReportService $reports) {}

    public function show(Request $request, string $key): JsonResponse
    {
        abort_unless(in_array($key, FuelTankerFillAccountingReportService::KEYS, true), 404);
        $filters = $request->validate([
            'station_id' => ['nullable', 'uuid'], 'branch_id' => ['nullable', 'uuid'], 'owner_id' => ['nullable', 'uuid'], 'fuel_product_id' => ['nullable', 'uuid'],
            'status' => ['nullable', 'in:' . implode(',', FuelTankerFill::STATUSES)], 'inventory_status' => ['nullable', 'in:' . implode(',', FuelTankerFill::INVENTORY_STATUSES)],
            'from' => ['nullable', 'date_format:Y-m-d'], 'to' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'page' => ['nullable', 'integer', 'min:1'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:' . self::MAX_PER_PAGE],
        ]);
        $user = $request->user();
        if (! empty($filters['station_id'])) {
            $this->accessibleStation($filters['station_id']);
        }
        $allowedBranches = $user->allowedBranchIds();
        if (! empty($filters['branch_id']) && $allowedBranches !== null && ! in_array($filters['branch_id'], $allowedBranches, true)) {
            abort(404);
        }

        $query = FuelTankerFill::query();
        foreach (['station_id' => 'fuel_station_id', 'branch_id' => 'branch_id', 'owner_id' => 'fuel_tanker_owner_id', 'fuel_product_id' => 'fuel_product_id', 'status' => 'status', 'inventory_status' => 'inventory_status'] as $param => $column) {
            if (! empty($filters[$param])) {
                $query->where($column, $filters[$param]);
            }
        }
        if (! empty($filters['from'])) {
            $query->where('recorded_at', '>=', $filters['from'] . ' 00:00:00');
        }
        if (! empty($filters['to'])) {
            $query->where('recorded_at', '<=', $filters['to'] . ' 23:59:59');
        }
        $this->restrictToAccessibleStations($query);
        $query = $this->scopeToActiveBranch($query, $request);

        $period = ['from' => $filters['from'] ?? null, 'to' => $filters['to'] ?? null];
        // فرع الأرصدة: مرشّح الفرع (ضمن المسموح) وإلا فروع المستخدم المسموحة (null = المؤسسة).
        $effectiveBranches = ! empty($filters['branch_id']) ? [$filters['branch_id']] : $allowedBranches;
        $stationIds = $this->accessibleStationIds();
        $visibleWarehouses = $stationIds === null ? null : FuelStation::query()->whereIn('id', $stationIds)->whereNotNull('warehouse_id')->pluck('warehouse_id')->unique()->values()->all();
        $fullScope = $user->allowedWarehouseIds() === null && $user->allowedFuelStationIds() === null;

        $data = match ($key) {
            'fills' => $this->reports->fills($query, $user, (int) ($filters['page'] ?? 1), (int) ($filters['per_page'] ?? self::PER_PAGE)),
            'inventory-reconciliation' => $this->reports->inventoryReconciliation($query, $user, $visibleWarehouses, $allowedBranches, $fullScope),
            'accounting-control' => $this->reports->accountingControl($query, $user, $effectiveBranches, $period),
            'clearing-account' => $this->reports->clearingAccount($user, $effectiveBranches, $period),
        };
        // مرشّحات لا تؤثر في أرصدة الأستاذ (لا مرجع لها على سطر القيد) تُعلَن صراحةً بدل أن تبدو مطبَّقة.
        $notApplicableToBalances = array_values(array_intersect(['station_id', 'owner_id', 'fuel_product_id', 'status', 'inventory_status'], array_keys(array_filter($filters, fn ($v) => $v !== null && $v !== ''))));

        return response()->json(['data' => $data, 'meta' => [
            'report' => $key, 'read_only' => true, 'generated_at' => now()->toIso8601String(),
            'filters' => array_filter($filters, fn ($v) => $v !== null && $v !== ''),
            'scan_limit' => FuelTankerFillAccountingReportService::SCAN_LIMIT,
            // نطاق ما طُبِّق فعلاً: الصفوف تُقيَّد بمحطات المستخدم وفروعه والمرشّحات؛ أرصدة الأستاذ بالفرع والفترة فقط.
            'row_scope' => ['station_restricted' => $stationIds !== null, 'branch_restricted' => $allowedBranches !== null],
            'balance_filters_not_applicable' => in_array($key, ['clearing-account', 'accounting-control'], true) ? $notApplicableToBalances : [],
        ]]);
    }
}

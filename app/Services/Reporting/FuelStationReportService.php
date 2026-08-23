<?php

namespace App\Services\Reporting;

use App\Models\FinancialControlAlert;
use App\Models\FuelAviAuthorization;
use App\Models\FuelOperationalLedger;
use App\Models\FuelSale;
use App\Models\FuelStationDevice;
use App\Models\FuelStationSafetyCorrectiveAction;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationSafetyPermit;
use App\Models\FuelStationWorkOrder;
use App\Models\FuelShift;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Carbon;
use RuntimeException;

/**
 * تقارير تشغيل محطات الوقود قراءة فقط. لا تستعمل مسودات البيع ولا أرقام الواجهة:
 * البيع والربحية من FuelSale النهائي وCOGS الرسمي، والمخزون من ledger التشغيلي
 * مع إبقاء StockMovement/InventoryService مصدر الدفتر الرسمي.
 */
class FuelStationReportService
{
    /** @var array<string,string> */
    private const SALES_DIMENSIONS = [
        'station' => 'fuel_station_id', 'fuel' => 'fuel_product_id', 'pump' => 'fuel_pump_id',
        'nozzle' => 'fuel_nozzle_id', 'shift' => 'fuel_shift_id', 'customer' => 'partner_id',
        'vehicle' => 'fuel_fleet_vehicle_id', 'driver' => 'fuel_fleet_driver_id',
        'contract' => 'corporate_fuel_contract_id',
    ];

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function dashboard(array $filters = []): array
    {
        $this->requireTenant();
        $today = Carbon::today();
        $sales = $this->salesBase(['from' => $today->toDateString(), 'to' => $today->toDateString(), ...$filters]);
        $totals = (clone $sales)->selectRaw('COALESCE(SUM(quantity_milliliters), 0) as liters_ml, COALESCE(SUM(gross_minor), 0) as revenue_minor, COALESCE(SUM(cogs_minor), 0) as cogs_minor')->first();

        return [
            'period' => ['from' => $today->toDateString(), 'to' => $today->toDateString()],
            'sales_today_minor' => (int) $totals->revenue_minor,
            'liters_today_milliliters' => (int) $totals->liters_ml,
            'gross_margin_minor' => (int) $totals->revenue_minor - (int) $totals->cogs_minor,
            'open_shifts' => FuelShift::query()->where('status', FuelShift::STATUS_OPEN)->count(),
            'open_work_orders' => FuelStationWorkOrder::query()->whereNotIn('status', [FuelStationWorkOrder::STATUS_CLOSED])->count(),
            'active_alerts' => FinancialControlAlert::query()->where('rule', 'like', 'fuel.%')->whereIn('status', ['active', 'acknowledged'])->count(),
            'degraded_devices' => FuelStationDevice::query()->where(fn (Builder $query) => $query->where('health', FuelStationDevice::HEALTH_DEGRADED)->orWhere('sync_status', FuelStationDevice::SYNC_FAILED))->count(),
            // لا نقدّر "أيام المخزون" من دون سياسة استهلاك/وحدة حرارية موثوقة؛ يعاد null بوضوح.
            'tank_days_remaining' => null,
            'data_boundary' => 'finalized_sales_and_operational_evidence_only',
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function sales(string $dimension, array $filters = []): array
    {
        $this->requireTenant();
        $column = self::SALES_DIMENSIONS[$dimension] ?? null;
        if ($column === null) throw new RuntimeException('بُعد تقرير مبيعات الوقود غير معتمد.');
        $rows = $this->salesBase($filters)
            ->selectRaw("{$column} as dimension_id, COUNT(*) as sales_count, COALESCE(SUM(quantity_milliliters), 0) as quantity_milliliters, COALESCE(SUM(gross_minor), 0) as revenue_minor, COALESCE(SUM(cogs_minor), 0) as cogs_minor")
            ->groupBy($column)->orderByDesc('revenue_minor')->get()
            ->map(fn ($row) => $this->salesRow($row))->all();

        return ['family' => 'sales', 'dimension' => $dimension, 'rows' => $rows, 'filters' => $this->normalizedFilters($filters)];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function profitability(string $dimension, array $filters = []): array
    {
        if (! in_array($dimension, ['station', 'fuel', 'customer', 'vehicle'], true)) throw new RuntimeException('بُعد ربحية الوقود غير معتمد.');
        $report = $this->sales($dimension, $filters);
        $report['family'] = 'profitability';
        return $report;
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function inventory(array $filters = []): array
    {
        $this->requireTenant();
        $query = FuelOperationalLedger::query();
        $this->applyOperationalFilters($query, $filters, 'occurred_at');
        $rows = $query->selectRaw('movement_type, COALESCE(SUM(quantity_milliliters), 0) as quantity_milliliters, COALESCE(SUM(value_minor), 0) as value_minor')
            ->groupBy('movement_type')->orderBy('movement_type')->get()->map(fn ($row) => [
                'movement_type' => $row->movement_type, 'quantity_milliliters' => (int) $row->quantity_milliliters, 'value_minor' => (int) $row->value_minor,
            ])->all();
        return [
            'family' => 'inventory', 'rows' => $rows, 'filters' => $this->normalizedFilters($filters),
            'accounting_boundary' => 'FuelOperationalLedger is operational detail; StockMovement/InventoryService remain official book-stock truth.',
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function fleet(array $filters = []): array
    {
        return [
            'family' => 'fleet',
            'vehicle_consumption' => $this->sales('vehicle', $filters)['rows'],
            'driver_consumption' => $this->sales('driver', $filters)['rows'],
            'customer_consumption' => $this->sales('customer', $filters)['rows'],
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function avi(array $filters = []): array
    {
        $this->requireTenant();
        $query = FuelAviAuthorization::query();
        $this->applyOperationalFilters($query, $filters, 'authorized_at');
        $decisions = (clone $query)->selectRaw('decision, reason_code, COUNT(*) as count')->groupBy('decision', 'reason_code')->orderByDesc('count')->get()
            ->map(fn ($row) => ['decision' => $row->decision, 'reason_code' => $row->reason_code, 'count' => (int) $row->count])->all();
        $suspicious = (clone $query)->whereNotNull('suspicion_signals')->get(['id', 'suspicion_signals'])->filter(fn (FuelAviAuthorization $row) => $row->suspicion_signals !== [])->count();
        return ['family' => 'avi', 'decisions' => $decisions, 'suspicious_authorizations' => $suspicious, 'filters' => $this->normalizedFilters($filters)];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function devices(array $filters = []): array
    {
        $this->requireTenant();
        $query = FuelStationDevice::query();
        if (! empty($filters['station_id'])) $query->where('fuel_station_id', $filters['station_id']);
        return [
            'family' => 'devices',
            'rows' => $query->orderBy('name')->get()->map(fn (FuelStationDevice $device) => [
                'id' => $device->id, 'station_id' => $device->fuel_station_id, 'name' => $device->name,
                'type' => $device->device_type, 'health' => $device->health, 'sync_status' => $device->sync_status,
                'last_seen_at' => $device->last_seen_at?->toISOString(), 'last_failure_reason' => $device->last_failure_reason,
            ])->all(),
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function maintenance(array $filters = []): array
    {
        $this->requireTenant();
        $query = FuelStationWorkOrder::query();
        if (! empty($filters['station_id'])) $query->where('fuel_station_id', $filters['station_id']);
        $rows = $query->selectRaw('status, COUNT(*) as count, COALESCE(SUM(cost_minor), 0) as cost_minor, COALESCE(SUM(downtime_minutes), 0) as downtime_minutes')
            ->groupBy('status')->orderBy('status')->get()->map(fn ($row) => [
                'status' => $row->status, 'count' => (int) $row->count, 'cost_minor' => (int) $row->cost_minor, 'downtime_minutes' => (int) $row->downtime_minutes,
            ])->all();
        return ['family' => 'maintenance', 'rows' => $rows];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    public function safety(array $filters = []): array
    {
        $this->requireTenant();
        $inspectionQuery = FuelStationSafetyInspection::query();
        $permitQuery = FuelStationSafetyPermit::query();
        $actionQuery = FuelStationSafetyCorrectiveAction::query();
        if (! empty($filters['station_id'])) {
            $inspectionQuery->where('fuel_station_id', $filters['station_id']);
            $permitQuery->where('fuel_station_id', $filters['station_id']);
            $actionQuery->whereHas('finding.inspection', fn (Builder $query) => $query->where('fuel_station_id', $filters['station_id']));
        }
        return [
            'family' => 'safety',
            'inspection_statuses' => $inspectionQuery->selectRaw('status, COUNT(*) as count')->groupBy('status')->get()->map(fn ($row) => ['status' => $row->status, 'count' => (int) $row->count])->all(),
            'open_corrective_actions' => $actionQuery->whereNotIn('status', [FuelStationSafetyCorrectiveAction::STATUS_CLOSED])->count(),
            'expiring_permits' => $permitQuery->where('status', FuelStationSafetyPermit::STATUS_ACTIVE)->whereNotNull('expires_on')->whereDate('expires_on', '<=', Carbon::today()->addDays(30))->count(),
        ];
    }

    /** @param array<string,mixed> $filters */
    private function salesBase(array $filters): Builder
    {
        $query = FuelSale::query()->where('status', FuelSale::STATUS_FINALIZED);
        $this->applyOperationalFilters($query, $filters, 'finalized_at');
        return $query;
    }

    /** @param Builder<\Illuminate\Database\Eloquent\Model> $query @param array<string,mixed> $filters */
    private function applyOperationalFilters(Builder $query, array $filters, string $dateColumn): void
    {
        if (! empty($filters['from'])) $query->whereDate($dateColumn, '>=', $filters['from']);
        if (! empty($filters['to'])) $query->whereDate($dateColumn, '<=', $filters['to']);
        if (! empty($filters['station_id'])) $query->where('fuel_station_id', $filters['station_id']);
    }

    /** @return array<string,mixed> */
    private function salesRow(object $row): array
    {
        $revenue = (int) $row->revenue_minor;
        $cogs = (int) $row->cogs_minor;
        return [
            'dimension_id' => $row->dimension_id, 'sales_count' => (int) $row->sales_count,
            'quantity_milliliters' => (int) $row->quantity_milliliters, 'revenue_minor' => $revenue,
            'cogs_minor' => $cogs, 'margin_minor' => $revenue - $cogs,
        ];
    }

    /** @param array<string,mixed> $filters @return array<string,mixed> */
    private function normalizedFilters(array $filters): array
    {
        return array_filter(['from' => $filters['from'] ?? null, 'to' => $filters['to'] ?? null, 'station_id' => $filters['station_id'] ?? null], fn ($value) => $value !== null && $value !== '');
    }

    private function requireTenant(): void
    {
        if (! app(TenantContext::class)->has()) throw new RuntimeException('تقارير محطات الوقود تتطلب سياق مستأجر موثوقاً.');
    }
}

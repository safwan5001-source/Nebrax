<?php

namespace Tests\Feature;

use App\Models\FinancialControlAlert;
use App\Models\FuelStation;
use App\Models\FuelStationReadinessEvent;
use App\Models\FuelStationSafetyCorrectiveAction;
use App\Models\FuelStationSafetyFinding;
use App\Models\FuelStationSafetyInspection;
use App\Models\FuelStationSafetyPermit;
use App\Models\FuelStationWorkOrder;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\User;
use App\Services\FuelStationAlertService;
use App\Services\FuelStationMaintenanceService;
use App\Services\FuelStationSafetyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

class FuelStationReadinessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function work_order_reuses_station_asset_truth_transitions_once_and_never_creates_a_financial_effect(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $service = app(FuelStationMaintenanceService::class);
        $order = $service->createWorkOrder([
            'fuel_station_id' => $station->id, 'asset_type' => FuelStation::class, 'asset_id' => $station->id,
            'work_type' => FuelStationWorkOrder::TYPE_CORRECTIVE, 'title' => 'فحص مضخة المحطة', 'priority' => 'high', 'severity' => 'high',
        ], $owner);

        $this->assertSame($station->id, $order->asset_id);
        foreach ([
            FuelStationWorkOrder::STATUS_TRIAGED, FuelStationWorkOrder::STATUS_SCHEDULED,
            FuelStationWorkOrder::STATUS_IN_PROGRESS, FuelStationWorkOrder::STATUS_COMPLETED,
            FuelStationWorkOrder::STATUS_VERIFIED, FuelStationWorkOrder::STATUS_CLOSED,
        ] as $status) {
            $data = $status === FuelStationWorkOrder::STATUS_SCHEDULED ? ['scheduled_at' => now()->addHour()->toISOString()] : [];
            if ($status === FuelStationWorkOrder::STATUS_COMPLETED) $data = ['resolution' => 'تمت المعالجة', 'cost_minor' => 1250, 'downtime_minutes' => 20];
            $order = $service->transition($order, $status, $data, $owner);
        }

        $this->assertSame(FuelStationWorkOrder::STATUS_CLOSED, $order->status);
        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertGreaterThanOrEqual(7, FuelStationReadinessEvent::query()->count());
        $this->expectException(LogicException::class);
        $order->update(['title' => 'تعديل ممنوع']);
    }

    /** @test */
    public function failed_safety_finding_requires_a_closed_corrective_action_before_inspection_verification(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $service = app(FuelStationSafetyService::class);
        $inspection = $service->createInspection(['fuel_station_id' => $station->id, 'inspection_type' => 'فحص طفايات الحريق'], $owner);
        $inspection = $service->performInspection($inspection, [[
            'checklist_key' => 'extinguisher-expiry', 'result' => FuelStationSafetyFinding::RESULT_FAIL,
            'severity' => 'high', 'title' => 'طفاية منتهية', 'asset_type' => FuelStation::class, 'asset_id' => $station->id,
        ]], $owner);
        $finding = $inspection->findings()->sole();
        $action = $service->createCorrectiveAction($finding, ['title' => 'استبدال الطفاية', 'due_date' => now()->subDay()->toDateString()], $owner);

        $this->expectExceptionMessage('قبل إغلاق جميع إجراءاته التصحيحية');
        $service->verifyInspection($inspection, $owner);
    }

    /** @test */
    public function safety_permit_alerts_are_branch_scoped_and_preserve_the_generic_alert_engine(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $safety = app(FuelStationSafetyService::class);
        $safety->createPermit([
            'fuel_station_id' => $station->id, 'permit_type' => 'رخصة سلامة', 'reference' => 'SAFE-001', 'expires_on' => now()->subDay()->toDateString(),
        ], $owner);
        $result = app(FuelStationAlertService::class)->scan();

        $this->assertSame(1, $result['detected']);
        $alert = FinancialControlAlert::query()->sole();
        $this->assertSame('fuel.safety.permit_expiring', $alert->rule);
        $this->assertSame($station->branch_id, $alert->branch_id);
        $this->assertSame(FuelStationSafetyPermit::class, $alert->source_type);
    }

    /** @test */
    public function a_station_asset_from_another_tenant_is_rejected(): void
    {
        [$station, $owner] = $this->stationAndOwner();
        $other = $this->registerTenant('readiness-other', 'readiness-other@example.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $otherStation = FuelStation::create(['code' => 'READ-OTHER', 'name' => 'محطة أخرى']);
        app(TenantContext::class)->set($station->tenant_id);

        $this->expectException(\Illuminate\Database\Eloquent\ModelNotFoundException::class);
        app(FuelStationMaintenanceService::class)->createWorkOrder([
            'fuel_station_id' => $station->id, 'asset_type' => FuelStation::class, 'asset_id' => $otherStation->id,
            'work_type' => FuelStationWorkOrder::TYPE_PREVENTIVE, 'title' => 'ربط غير مسموح',
        ], $owner);
    }

    /** @return array{FuelStation, User} */
    private function stationAndOwner(): array
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $owner = User::where('tenant_id', $auth['tenant_id'])->firstOrFail();
        $station = FuelStation::create(['code' => 'READY-'.substr($auth['tenant_id'], 0, 6), 'name' => 'محطة الجاهزية']);

        return [$station, $owner];
    }
}

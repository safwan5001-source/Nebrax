<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelTank;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\User;
use App\Services\FuelShiftService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * يثبت هذا الملف أن Cycle 4 يلتقط حقائق تشغيلية للشفت فقط. لا ينشئ بيعاً أو
 * دفعاً أو فاتورة أو تسوية مخزون أو قيداً محاسبياً موازياً.
 */
class FuelShiftServiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @test */
    public function it_closes_and_locks_a_full_operational_shift_without_official_commercial_or_accounting_documents(): void
    {
        $fixture = $this->fixture();
        $service = app(FuelShiftService::class);
        $shift = $service->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 10000,
            'active_terminal_keys' => ['forecourt-a'],
            'idempotency_key' => 'open-lifecycle-1',
        ], $fixture['actor']);
        $service->assignStaff($shift, $fixture['actor']->id, 'attendant', $fixture['actor']);
        $this->recordAllReadings($service, $shift, $fixture, 1000000, 1005000, 500000, 495000);
        $service->recordCashMovement($shift, [
            'type' => 'cash_in', 'amount_minor' => 500, 'reason' => 'فكة تشغيلية موثقة', 'idempotency_key' => 'cash-in-1',
        ], $fixture['actor']);
        $service->recordCashMovement($shift, [
            'type' => 'cash_out', 'amount_minor' => 200, 'reason' => 'إيداع خزنة موثق', 'idempotency_key' => 'cash-out-1',
        ], $fixture['actor']);
        $service->recordCashMovement($shift, [
            'type' => 'expense', 'amount_minor' => 300, 'reason' => 'مستلزم تشغيلي نقدي موثق', 'idempotency_key' => 'expense-1',
        ], $fixture['actor']);

        $closed = $service->close($shift, 10000, 'إغلاق الشفت بعد العد', $fixture['actor']);
        $this->assertSame(FuelShift::STATUS_CLOSED, $closed->status);
        $this->assertSame(10000, $closed->expected_operational_cash_minor);
        $this->assertSame(0, $closed->cash_variance_minor);
        $this->assertSame(5000, $closed->operational_meter_milliliters);
        $this->assertSame(0, $closed->operational_tank_variance_milliliters);
        $this->assertDatabaseHas('fuel_shift_cash_variances', [
            'fuel_shift_id' => $closed->id,
            'status' => FuelShiftCashVariance::STATUS_NOT_REQUIRED,
            'expected_operational_cash_minor' => 10000,
            'counted_cash_minor' => 10000,
            'variance_minor' => 0,
        ]);
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, Payment::count());
        try {
            $service->close($closed, 10000, 'إغلاق مكرر', $fixture['actor']);
            $this->fail('يجب أن يمنع lifecycle إغلاق الشفت مرتين.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('ليس مفتوحاً', $e->getMessage());
        }

        $approved = $service->approve($closed, 'إقرار المشرف التشغيلي', $fixture['supervisor']);
        $this->assertSame(FuelShift::STATUS_APPROVED, $approved->status);
        $this->assertNotNull($approved->locked_at);

        $this->expectException(LogicException::class);
        $approved->update(['closing_note' => 'لا يجوز التعديل بعد القفل']);
    }

    /** @test */
    public function it_preserves_a_nonzero_cash_variance_as_pending_review_without_a_journal_or_automatic_settlement(): void
    {
        $fixture = $this->fixture();
        $service = app(FuelShiftService::class);
        $shift = $service->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 10000,
            'idempotency_key' => 'open-pending-variance',
        ], $fixture['actor']);
        $service->assignStaff($shift, $fixture['actor']->id, 'attendant', $fixture['actor']);
        $this->recordAllReadings($service, $shift, $fixture, 800000, 810000, 700000, 690000);

        $closed = $service->close($shift, 9700, 'عجز تشغيلي يحتاج مراجعة', $fixture['actor']);
        $variance = $closed->cashVariance()->sole();
        $this->assertSame(-300, $variance->variance_minor);
        $this->assertSame(FuelShiftCashVariance::DIRECTION_SHORTAGE, $variance->variance_direction);
        $this->assertSame(FuelShiftCashVariance::STATUS_PENDING_REVIEW, $variance->status);
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, Payment::count());

        $service->approve($closed, 'اعتماد مع حفظ فرق النقد للمراجعة', $fixture['supervisor']);
        $this->assertSame(0, JournalEntry::count());
    }

    /** @test */
    public function it_rejects_duplicate_open_station_shifts_negative_meter_deltas_and_unavailable_cash_out(): void
    {
        $fixture = $this->fixture();
        $service = app(FuelShiftService::class);
        $shift = $service->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 1000,
            'idempotency_key' => 'open-guards-1',
        ], $fixture['actor']);
        $same = $service->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 999999,
            'idempotency_key' => 'open-guards-1',
        ], $fixture['actor']);
        $this->assertSame($shift->id, $same->id);
        try {
            $service->open([
                'fuel_station_id' => $fixture['station']->id,
                'opening_float_minor' => 1000,
                'idempotency_key' => 'open-guards-2',
            ], $fixture['actor']);
            $this->fail('يجب منع ورديتين مفتوحتين للمحطة نفسها.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('وردية وقود مفتوحة', $e->getMessage());
        }
        try {
            $service->recordCashMovement($shift, [
                'type' => 'cash_out', 'amount_minor' => 1001, 'reason' => 'تجاوز الرصيد', 'idempotency_key' => 'cash-guard-1',
            ], $fixture['actor']);
            $this->fail('يجب منع السحب النقدي فوق الرصيد التشغيلي المتوقع.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('يتجاوز الرصيد', $e->getMessage());
        }

        $service->assignStaff($shift, $fixture['actor']->id, 'attendant', $fixture['actor']);
        $this->recordAllReadings($service, $shift, $fixture, 1000000, 999999, 500000, 500001);
        try {
            $service->close($shift, 1000, null, $fixture['actor']);
            $this->fail('يجب رفض عداد إغلاق أقل من قراءة الفتح.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('لا تكون أقل', $e->getMessage());
        }
        $this->assertSame(FuelShift::STATUS_OPEN, $shift->fresh()->status);
    }

    /** @test */
    public function it_enforces_station_ownership_and_explicit_shift_permissions(): void
    {
        $fixture = $this->fixture();
        $service = app(FuelShiftService::class);
        $shift = $service->open([
            'fuel_station_id' => $fixture['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'open-ownership',
        ], $fixture['actor']);
        $other = $this->additionalStation($fixture['tenant_id'], $fixture['branch']);
        app(TenantContext::class)->set($fixture['tenant_id']);
        app(BranchContext::class)->set($fixture['branch']->id);
        try {
            $service->recordMeter($shift, [
                'fuel_nozzle_id' => $other['nozzle']->id,
                'reading_stage' => 'opening',
                'meter_milliliters' => 1,
                'evidence_key' => 'cross-station-nozzle',
            ], $fixture['actor']);
            $this->fail('لا ينبغي قبول فوهة من محطة أخرى.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('لا تنتمي', $e->getMessage());
        }

        $staff = User::create([
            'tenant_id' => $fixture['tenant_id'],
            'name' => 'عامل محدود',
            'email' => 'limited-shift@example.test',
            'password' => 'password123',
            'role' => 'staff',
        ]);
        $this->expectException(RuntimeException::class);
        $service->open([
            'fuel_station_id' => $other['station']->id,
            'opening_float_minor' => 0,
            'idempotency_key' => 'staff-no-permission',
        ], $staff);
    }

    /** @test */
    public function it_honors_variance_policies_and_keeps_evidence_idempotent_then_uses_correction_requests_after_lock(): void
    {
        $fixture = $this->fixture();
        $settings = app(FuelStationSettingsService::class);
        $service = app(FuelShiftService::class);
        $shift = $service->open([
            'fuel_station_id' => $fixture['station']->id, 'opening_float_minor' => 1000, 'idempotency_key' => 'open-policies',
        ], $fixture['actor']);
        $opening = [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 100000,
            'evidence_key' => 'idempotent-meter-opening',
        ];
        $first = $service->recordMeter($shift, $opening, $fixture['actor']);
        $again = $service->recordMeter($shift, $opening, $fixture['actor']);
        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, \App\Models\FuelShiftMeterReading::where('fuel_shift_id', $shift->id)->count());
        $service->recordMeter($shift, [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'closing', 'meter_milliliters' => 101000,
            'evidence_key' => 'idempotent-meter-closing',
        ], $fixture['actor']);
        $service->recordTank($shift, [
            'fuel_tank_id' => $fixture['tank']->id, 'reading_stage' => 'opening', 'reading_type' => 'physical',
            'quantity_milliliters' => 500000, 'evidence_key' => 'policy-tank-opening',
        ], $fixture['actor']);
        $service->recordTank($shift, [
            'fuel_tank_id' => $fixture['tank']->id, 'reading_stage' => 'closing', 'reading_type' => 'physical',
            'quantity_milliliters' => 498000, 'evidence_key' => 'policy-tank-closing',
        ], $fixture['actor']);
        $service->assignStaff($shift, $fixture['actor']->id, 'attendant', $fixture['actor']);
        $settings->putStationValues($fixture['station'], [
            'shift_allow_close_with_pending_cash_variance' => false,
            'shift_allow_close_with_unresolved_operational_variance' => false,
        ], $fixture['actor'], 'اختبار سياسات الإغلاق');
        try {
            $service->close($shift, 900, null, $fixture['actor']);
            $this->fail('يجب منع فرق النقد وفرق الخزان غير المحسومين عندما تمنع السياسة الإغلاق.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('فرق النقد', $e->getMessage());
        }
        $settings->putStationValues($fixture['station'], [
            'shift_allow_close_with_pending_cash_variance' => true,
            'shift_allow_close_with_unresolved_operational_variance' => true,
        ], $fixture['actor'], 'السماح بالحفظ للمراجعة');
        $closed = $service->close($shift, 900, null, $fixture['actor']);
        $approved = $service->approve($closed, null, $fixture['supervisor']);
        $correction = $service->requestCorrection($approved, [
            'target_type' => 'meter_reading', 'target_id' => $first->id, 'reason' => 'صورة القراءة تحتاج توضيحاً',
            'proposed' => ['evidence_note' => 'تم طلب صورة أوضح دون تعديل القراءة الأصلية'],
        ], $fixture['supervisor']);
        $this->assertSame('requested', $correction->status);
        $this->expectException(LogicException::class);
        $correction->update(['reason' => 'لا تعديل مباشر']);
    }

    /** @return array{tenant_id:string,actor:User,supervisor:User,branch:Branch,station:\App\Models\FuelStation,tank:FuelTank,nozzle:FuelNozzle} */
    private function fixture(string $suffix = 'main'): array
    {
        $n = ++$this->sequence;
        $auth = $this->registerTenant('fuel-' . $suffix . '-' . $n, "owner-fuel-{$suffix}-{$n}@example.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branch = Branch::where('tenant_id', $auth['tenant_id'])->sole();
        app(BranchContext::class)->set($branch->id);
        $actor = User::where('tenant_id', $auth['tenant_id'])->where('role', 'owner')->sole();
        $supervisor = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'مشرف شفت', 'email' => "supervisor-fuel-{$suffix}-{$n}@example.test",
            'password' => 'password123', 'role' => 'admin',
        ]);
        $product = Product::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'sku' => "FUEL-P-{$n}", 'name' => 'منتج وقود اختبار',
            'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuelProduct = FuelProduct::create([
            'tenant_id' => $auth['tenant_id'], 'product_id' => $product->id, 'code' => "FUEL-{$n}", 'name' => 'بنزين اختبار',
        ]);
        $station = \App\Models\FuelStation::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'code' => "ST-{$n}", 'name' => 'محطة اختبار',
        ]);
        $tank = FuelTank::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => "TN-{$n}", 'name' => 'خزان اختبار', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => "P-{$n}",
        ]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $auth['tenant_id'], 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => "N-{$n}",
        ]);
        app(FuelStationSettingsService::class)->putStationValues($station, [
            'shift_opening_meter_reading_required' => true,
            'shift_closing_meter_reading_required' => true,
            'shift_opening_tank_reading_required' => true,
            'shift_closing_tank_reading_required' => true,
            'shift_opening_cash_float_required' => true,
            'shift_mandatory_staff_assignment' => true,
            'shift_mandatory_cash_count' => true,
            'shift_supervisor_approval_required' => true,
            'shift_allow_close_with_pending_cash_variance' => true,
        ], $actor, 'تهيئة fixture Cycle 4');

        return compact('actor', 'supervisor', 'branch', 'station', 'tank', 'nozzle') + ['tenant_id' => $auth['tenant_id']];
    }

    /** @return array{station:\App\Models\FuelStation,tank:FuelTank,nozzle:FuelNozzle} */
    private function additionalStation(string $tenantId, Branch $branch): array
    {
        $n = ++$this->sequence;
        $product = Product::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'sku' => "FUEL-OTHER-P-{$n}", 'name' => 'منتج وقود محطة أخرى',
            'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuelProduct = FuelProduct::create([
            'tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => "FUEL-OTHER-{$n}", 'name' => 'بنزين محطة أخرى',
        ]);
        $station = \App\Models\FuelStation::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'code' => "ST-OTHER-{$n}", 'name' => 'محطة أخرى',
        ]);
        $tank = FuelTank::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuelProduct->id,
            'code' => "TN-OTHER-{$n}", 'name' => 'خزان محطة أخرى', 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
        ]);
        $pump = FuelPump::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => "P-OTHER-{$n}",
        ]);
        $nozzle = FuelNozzle::create([
            'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
            'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuelProduct->id, 'nozzle_number' => "N-OTHER-{$n}",
        ]);

        return compact('station', 'tank', 'nozzle');
    }

    /** @param array{tank:FuelTank,nozzle:FuelNozzle,actor:User} $fixture */
    private function recordAllReadings(FuelShiftService $service, FuelShift $shift, array $fixture, int $meterOpening, int $meterClosing, int $tankOpening, int $tankClosing): void
    {
        $service->recordMeter($shift, [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => $meterOpening,
            'evidence_key' => 'meter-opening-' . $shift->id,
        ], $fixture['actor']);
        $service->recordMeter($shift, [
            'fuel_nozzle_id' => $fixture['nozzle']->id, 'reading_stage' => 'closing', 'meter_milliliters' => $meterClosing,
            'evidence_key' => 'meter-closing-' . $shift->id,
        ], $fixture['actor']);
        $service->recordTank($shift, [
            'fuel_tank_id' => $fixture['tank']->id, 'reading_stage' => 'opening', 'reading_type' => 'physical',
            'quantity_milliliters' => $tankOpening, 'evidence_key' => 'tank-opening-' . $shift->id,
        ], $fixture['actor']);
        $service->recordTank($shift, [
            'fuel_tank_id' => $fixture['tank']->id, 'reading_stage' => 'closing', 'reading_type' => 'physical',
            'quantity_milliliters' => $tankClosing, 'evidence_key' => 'tank-closing-' . $shift->id,
        ], $fixture['actor']);
    }
}

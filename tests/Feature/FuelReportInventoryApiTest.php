<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Services\FuelReconciliationService;
use App\Services\FuelShiftService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** HORIZON-REPORTS / S6 — عائلة الخزانات والمخزون (E). بيانات اصطناعية: خزان سعته 10000 لتر، سعر 230 هللة/لتر. */
class FuelReportInventoryApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    private function tankId(): string
    {
        return $this->f['nozzle']->fuel_tank_id;
    }

    private function reading(float $liters, string $key, ?string $at = null): void
    {
        app(FuelReconciliationService::class)->recordReading([
            'fuel_station_id' => $this->f['station']->id, 'fuel_tank_id' => $this->tankId(), 'reading_type' => 'physical', 'quantity_liters' => (string) $liters,
            'evidence_key' => $key, 'recorded_by' => $this->f['actor']->id, ...($at ? ['measured_at' => $at] : []),
        ]);
    }

    private function sale(string $key, int $open, int $close): FuelShift
    {
        $shift = $this->open($key);
        $svc = app(FuelShiftService::class);
        foreach (['opening' => $open, 'closing' => $close] as $stage => $ml) {
            $svc->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}"], $this->f['actor']);
        }

        return $svc->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    private function report(string $key, string $query = '', string $who = 'actor'): array
    {
        return $this->withToken($this->token($who))->getJson(self::BASE.'/'.$key.$query)->assertOk()->json('data');
    }

    /** @test */
    public function every_inventory_report_runs_on_empty_data_with_a_stable_shape(): void
    {
        foreach (['tank_balances', 'opening_closing', 'receipts', 'movements', 'consumption', 'stocktake', 'variances', 'adjustments', 'supply_tracking', 'theoretical_vs_actual'] as $name) {
            $p = $this->report('inventory.'.$name);
            $this->assertSame('inventory.'.$name, $p['report']['key']);
            $this->assertIsArray($p['tables']);
        }
    }

    /** @test */
    public function tank_balances_show_the_latest_reading_fill_and_flag_tanks_without_readings(): void
    {
        $before = $this->report('inventory.tank_balances');
        $this->assertContains('tank_reading_missing', $before['data_quality']['gaps']);
        $this->assertNull($before['period']);
        $this->assertNull(collect($before['summary'])->firstWhere('key', 'quantity')['value']); // قراءة مجهولة ≠ صفر

        $this->reading(2500, 'inv-a');
        $p = $this->report('inventory.tank_balances');
        $row = $p['tables'][0]['rows'][0];
        $this->assertSame(2_500_000, $row['quantity']);
        $this->assertSame(2500, $row['fill_bp']); // 25% من 10000 لتر
        $this->assertSame('physical', $row['reading_type']);
        $this->assertTrue($p['data_quality']['complete']);
        $this->assertSame(2_500_000, collect($p['summary'])->firstWhere('key', 'quantity')['value']);
    }

    /** @test */
    public function theoretical_balance_is_opening_plus_receipts_minus_meter_sales(): void
    {
        $this->travelTo(\Carbon\CarbonImmutable::parse('2027-03-01 09:00:00'));
        $this->reading(5000, 'open-r');                 // افتتاح قبل الفترة
        $this->travelTo(\Carbon\CarbonImmutable::parse('2027-03-10 09:00:00'));
        $this->sale('t1', 5_000_000, 5_100_000);        // 100 لتر داخل الفترة
        $this->reading(4900, 'close-r');
        $this->travelBack();

        $q = '?from=2027-03-05&to=2027-03-12';
        $row = $this->report('inventory.theoretical_vs_actual', $q)['tables'][0]['rows'][0];
        $this->assertSame(5_000_000, $row['opening']);
        $this->assertSame(0, $row['received']);
        $this->assertSame(100_000, $row['sold']);
        $this->assertSame(4_900_000, $row['theoretical']);
        $this->assertSame(4_900_000, $row['closing']);
        $this->assertSame(0, $row['difference']);

        $oc = $this->report('inventory.opening_closing', $q)['tables'][0]['rows'][0];
        $this->assertSame(-100_000, $oc['change']);
    }

    /** @test */
    public function an_unmeasured_sale_leaves_the_theoretical_balance_unknown_instead_of_a_false_shortage(): void
    {
        $this->travelTo(\Carbon\CarbonImmutable::parse('2027-03-01 09:00:00'));
        $this->reading(5000, 'u-open');
        $this->travelTo(\Carbon\CarbonImmutable::parse('2027-03-10 09:00:00'));
        $shift = $this->open('unm');
        app(FuelShiftService::class)->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => 'opening', 'meter_milliliters' => 5_000_000, 'evidence_key' => 'unm-open'], $this->f['actor']);
        $this->reading(4900, 'u-close');   // لا قراءة إغلاق عدّاد ⇒ استهلاك الفوهة مجهول
        $this->travelBack();

        $p = $this->report('inventory.theoretical_vs_actual', '?from=2027-03-05&to=2027-03-12');
        $row = $p['tables'][0]['rows'][0];
        $this->assertNull($row['sold']);
        $this->assertNull($row['theoretical']);
        $this->assertNull($row['difference']);
        $this->assertFalse($p['data_quality']['complete']);
    }

    /** @test */
    public function a_missing_opening_reading_leaves_the_comparison_empty_and_flags_it(): void
    {
        $this->sale('t2', 5_000_000, 5_100_000);
        $this->reading(4900, 'only-close');
        $p = $this->report('inventory.theoretical_vs_actual');
        $row = $p['tables'][0]['rows'][0];
        $this->assertNull($row['opening']);
        $this->assertNull($row['theoretical']);
        $this->assertNull($row['difference']);
        $this->assertContains('tank_reading_missing', $p['data_quality']['gaps']);
    }

    /** @test */
    public function consumption_is_the_meter_sales_by_product_and_hides_money_from_non_sales_users(): void
    {
        $this->sale('c', 5_000_000, 5_100_000);
        $this->assertSame($this->report('sales.by_product')['tables'], $this->report('inventory.consumption')['tables']);
        $cols = array_column($this->report('inventory.consumption', '', 'seller')['tables'][0]['columns'], 'key');
        $this->assertNotContains('amount', $cols);
        $this->assertContains('liters', $cols);
    }

    /** @test */
    public function stocktake_summary_stays_null_when_a_draft_has_no_physical_reading(): void
    {
        $tank = $this->f['nozzle']->tank ?? \App\Models\FuelTank::query()->findOrFail($this->tankId());
        \App\Models\FuelReconciliation::query()->create([
            'tenant_id' => $this->f['station']->tenant_id, 'branch_id' => $this->f['station']->branch_id,
            'fuel_station_id' => $this->f['station']->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $tank->fuel_product_id,
            'warehouse_id' => $this->f['station']->warehouse_id, 'status' => 'draft',
            'opening_book_milliliters' => 1000, 'deliveries_milliliters' => 0, 'sales_milliliters' => 0, 'transfers_milliliters' => 0,
            'prior_adjustments_milliliters' => 0, 'expected_closing_milliliters' => 1000, 'created_by' => $this->f['actor']->id,
        ]);
        $p = $this->report('inventory.stocktake');
        $summary = collect($p['summary'])->keyBy('key');
        $this->assertSame(1, $summary['count']['value']);
        $this->assertNull($summary['variance']['value']);   // فرق غير مقيس ≠ صفر
        $this->assertNull($summary['financial']['value']);
        $this->assertNull($p['tables'][0]['totals']['variance']);
    }

    /** @test */
    public function movement_unit_cost_is_derived_per_liter_from_the_official_value(): void
    {
        $m = new \ReflectionMethod(\App\Services\Reporting\FuelInventoryReportBuilder::class, 'costPerLiter');
        $m->setAccessible(true);
        $this->assertSame(200, $m->invoke(null, 1_000, 5_000));     // 200 هللة/لتر (القيمة 1000 لكمية 5 لتر)
        $this->assertSame(200, $m->invoke(null, -1_000, -5_000));   // إشارة الحركة لا تؤثر
        $this->assertNull($m->invoke(null, null, 5_000));
        $this->assertNull($m->invoke(null, 1_000, 0));
    }

    /** @test */
    public function inventory_reports_respect_permissions_and_tenant_isolation(): void
    {
        // البائع (fuel.shift.view) يرى أرصدة الخزانات؟ لا: تتطلب fuel_stations.view أو fuel.reading.view؛ ولا يرى الجرد/الحركة (reconciliation.view).
        $this->withToken($this->token('seller'))->getJson(self::BASE.'/inventory.stocktake')->assertNotFound();
        $this->withToken($this->token('seller'))->getJson(self::BASE.'/inventory.movements')->assertNotFound();
        $this->withToken($this->token('seller'))->getJson(self::BASE.'/inventory.receipts')->assertNotFound();

        $this->reading(1000, 'iso-a');
        $ours = $this->f;
        \Illuminate\Support\Facades\Cache::flush();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture('b');
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $token = $this->f['actor']->createToken('t')->plainTextToken;
        $this->f = $ours;
        $foreign = $this->withToken($token)->getJson(self::BASE.'/inventory.tank_balances')->assertOk()->json('data');
        $this->assertNull($foreign['tables'][0]['rows'][0]['quantity']); // لا قراءة من مستأجرنا
        $this->withToken($token)->getJson(self::BASE.'/inventory.tank_balances?station_id='.$ours['station']->id)->assertNotFound();
    }

    /** @test */
    public function tank_balances_report_truncation_instead_of_silently_dropping_tanks_past_the_cap(): void
    {
        $base = $this->f['nozzle']->fuel_tank_id;
        $tank = \App\Models\FuelTank::findOrFail($base);
        for ($i = 0; $i < 100; $i++) {
            \App\Models\FuelTank::create([
                'tenant_id' => $this->f['tenant_id'], 'branch_id' => $tank->branch_id, 'fuel_station_id' => $tank->fuel_station_id, 'fuel_product_id' => $tank->fuel_product_id,
                'code' => 'CAP-'.$i, 'name' => 'خزان '.$i, 'capacity_milliliters' => 1_000_000, 'safe_capacity_milliliters' => 900_000,
            ]);
        }
        $p = $this->report('inventory.tank_balances');
        $this->assertCount(100, $p['tables'][0]['rows']);
        $this->assertTrue($p['truncated']);
        $this->assertFalse($p['data_quality']['complete']);
    }
}

<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelShift;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationMasterDataService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** HORIZON-REPORTS / S5 — عائلة المضخات والفوهات (D). بيانات اصطناعية: فوهة واحدة، سعر 230 هللة/لتر. */
class FuelReportPumpsApiTest extends TestCase
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

    private function meter(FuelShift $shift, string $stage, int $ml): void
    {
        app(FuelShiftService::class)->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}"], $this->f['actor']);
    }

    private function closed(string $key, int $open, int $close): FuelShift
    {
        $shift = $this->open($key);
        $this->meter($shift, 'opening', $open);
        $this->meter($shift, 'closing', $close);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    private function report(string $key, string $who = 'actor'): array
    {
        return $this->withToken($this->token($who))->getJson(self::BASE.'/'.$key)->assertOk()->json('data');
    }

    private function rows(array $p): array
    {
        return $p['tables'][0]['rows'];
    }

    /** @test */
    public function aliases_return_the_same_numbers_as_the_sales_and_shift_reports(): void
    {
        $this->closed('a', 5_000_000, 5_100_000);
        $this->assertSame($this->report('sales.by_nozzle')['tables'], $this->report('pumps.nozzle_consumption')['tables']);
        $this->assertSame($this->report('sales.by_pump')['tables'], $this->report('pumps.pump_sales')['tables']);
        $this->assertSame($this->report('shifts.readings')['tables'], $this->report('pumps.readings')['tables']);
    }

    /** @test */
    public function meter_vs_formal_sales_reports_the_unrecorded_liters(): void
    {
        $shift = $this->open('m');
        $this->meter($shift, 'opening', 1_000_000);
        // بيع رسمي واحد 1000 مل (الفوهة نفسها) بينما العداد سيتحرك 5 لترات.
        app(FuelSaleService::class)->finalize(app(FuelSaleService::class)->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $this->f['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => 'm-sale',
        ], $this->f['actor']), $this->f['actor']);
        $this->meter($shift, 'closing', 1_005_000);
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);

        $p = $this->report('pumps.meter_vs_sales');
        $row = $this->rows($p)[0];
        $this->assertSame(5000, $row['meter']);
        $this->assertSame(1000, $row['formal']);
        $this->assertSame(4000, $row['difference']);
        $this->assertSame('meter_higher', $row['state']);
        $this->assertSame('finalized_sales', $p['source']['kind']);
        $this->withToken($this->token('seller'))->getJson(self::BASE.'/pumps.meter_vs_sales')->assertNotFound();
    }

    /** @test */
    public function continuity_breaks_are_found_between_consecutive_shifts_of_the_same_nozzle(): void
    {
        $this->closed('c1', 5_000_000, 5_100_000);
        $this->closed('c2', 5_100_000, 5_150_000); // مستمرة
        $this->closed('c3', 5_160_000, 5_200_000); // افتتاح 5_160_000 ≠ إغلاق سابق 5_150_000
        $rows = $this->rows($this->report('pumps.differences'));
        $this->assertCount(1, $rows);
        $this->assertSame(10_000, $rows[0]['difference']);
        $this->assertSame(5_150_000, $rows[0]['previous_closing']);
    }

    /** @test */
    public function anomalies_flag_missing_readings_inverted_pairs_and_idle_nozzles(): void
    {
        $this->closed('idle', 5_000_000, 5_000_000);              // بلا حركة
        $open = $this->open('inv');
        $this->meter($open, 'opening', 5_000_000);
        $this->meter($open, 'closing', 4_000_000);                 // مقلوبة (مفتوحة)
        $types = array_column($this->rows($this->report('pumps.anomalies')), 'type');
        $this->assertContains('no_movement', $types);
        $this->assertContains('closing_below_opening', $types);
    }

    /** @test */
    public function resets_log_lists_meter_baseline_and_relinking_changes_from_the_audit_trail(): void
    {
        $nozzle = FuelNozzle::findOrFail($this->f['nozzle']->id);
        app(FuelStationMasterDataService::class)->updateNozzle($nozzle, ['meter_opening_milliliters' => 7_000_000], $this->f['actor']);
        $rows = $this->rows($this->report('pumps.resets'));
        $this->assertCount(1, $rows);
        $this->assertSame('nozzle.updated', $rows[0]['action']);
        $this->assertStringContainsString('meter_opening_milliliters: 0 → 7000000', $rows[0]['changes']);
        $this->withToken($this->token('seller'))->getJson(self::BASE.'/pumps.resets')->assertNotFound(); // يتطلب fuel_stations.manage
    }
}

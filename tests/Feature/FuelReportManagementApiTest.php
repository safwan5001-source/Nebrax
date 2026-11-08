<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** HORIZON-REPORTS / S8 — العائلة الإدارية (G): تركيب لمصادر قائمة. بيانات اصطناعية: 100 لتر × 2.30 = 230.00. */
class FuelReportManagementApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_collection_declaration_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    private function meter(FuelShift $shift, string $stage, int $ml): void
    {
        app(FuelShiftService::class)->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}"], $this->f['actor']);
    }

    private function closedShift(string $key, int $open, int $close, int $cash, int $bank): FuelShift
    {
        $shift = $this->open($key);
        $this->meter($shift, 'opening', $open);
        $this->meter($shift, 'closing', $close);
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => "d-{$key}", 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bank]],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + $cash, null, $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    private function report(string $key, string $who = 'actor', string $query = ''): array
    {
        return $this->withToken($this->token($who))->getJson(self::BASE.'/management.'.$key.$query)->assertOk()->json('data');
    }

    private function item(array $p, string $key): mixed
    {
        return collect($p['summary'])->firstWhere('key', $key)['value'] ?? null;
    }

    /** @test */
    public function the_dashboard_defaults_to_today_and_adds_follow_up_indicators(): void
    {
        $this->closedShift('a', 5_000_000, 5_100_000, 20000, 3000);
        $this->open('b'); // وردية مفتوحة الآن
        $p = $this->report('dashboard');
        $this->assertSame($p['period']['from'], $p['period']['to']);
        $this->assertSame(1, $this->item($p, 'open_shifts'));
        $this->assertSame(100_000, $this->item($p, 'liters'));
        $this->assertNotNull($this->item($p, 'pending_items'));
        $this->assertSame(0, $this->item($p, 'tanks_review')); // خزان بلا قراءة ليس «يحتاج مراجعة» (لا علامة حدّية)
    }

    /** @test */
    public function weekly_monthly_and_comparisons_reuse_the_sales_numbers_exactly(): void
    {
        $this->closedShift('w', 5_000_000, 5_100_000, 20000, 3000);
        $this->assertSame($this->report('weekly')['tables'][0]['rows'], $this->withToken($this->token())->getJson(self::BASE.'/sales.period?group=day')->json('data.tables.0.rows'));
        $monthly = $this->report('monthly');
        $this->assertSame(substr($monthly['period']['to'], 0, 7).'-01', $monthly['period']['from']);
        $this->assertSame(100_000, $monthly['tables'][0]['totals']['liters']);

        $this->assertSame($this->report('station_comparison')['tables'], $this->withToken($this->token())->getJson(self::BASE.'/sales.by_station')->json('data.tables'));
        $this->assertSame($this->report('product_comparison')['tables'], $this->withToken($this->token())->getJson(self::BASE.'/sales.by_product')->json('data.tables'));
        $this->assertSame($this->report('employee_performance')['tables'], $this->withToken($this->token())->getJson(self::BASE.'/sales.by_employee')->json('data.tables'));
    }

    /** @test */
    public function user_filters_win_over_the_report_default_period(): void
    {
        $p = $this->report('monthly', 'actor', '?from=2020-01-01&to=2020-01-31');
        $this->assertSame(['from' => '2020-01-01', 'to' => '2020-01-31'], $p['period']);
    }

    /** @test */
    public function trends_use_frozen_snapshots_and_never_estimate_a_shift_without_one(): void
    {
        $this->closedShift('t1', 5_000_000, 5_100_000, 20000, 3000);
        $row = $this->report('trends')['tables'][0]['rows'][0];
        $this->assertSame(1, $row['shifts']);
        $this->assertSame(100_000, $row['liters']);
        $this->assertSame(23_000, $row['sales']);
        $this->assertSame(23_000, $row['collected']);
        $this->assertSame(0, $row['difference']);

        config(['fuel_stations.shift_collection_declaration_enabled' => false]);
        $nodecl = $this->open('t2');
        $this->meter($nodecl, 'opening', 5_100_000);
        $this->meter($nodecl, 'closing', 5_110_000);
        app(FuelShiftService::class)->close($nodecl->fresh(), self::FLOAT, null, $this->f['actor']);
        $p = $this->report('trends');
        $this->assertNull($p['tables'][0]['rows'][0]['sales']);
        $this->assertNull($p['tables'][0]['totals']['sales']);
        $this->assertContains('collection_not_declared', $p['data_quality']['gaps']);
    }

    /** @test */
    public function exceptions_summary_counts_overdue_shifts_and_hides_sales_derived_rows_from_staff(): void
    {
        $this->open('late');
        $this->travel(13)->hours();
        $owner = $this->report('exceptions');
        $this->travelBack();
        $types = array_column($owner['tables'][0]['rows'], 'type');
        $this->assertContains('cash_variance_pending', $types);
        $overdue = collect($owner['tables'][0]['rows'])->firstWhere('type', 'overdue_shift');
        $this->assertSame(1, $overdue['count']);
        $this->assertNull($owner['period']);

        $seller = array_column($this->report('exceptions', 'seller')['tables'][0]['rows'], 'type');
        $this->assertNotContains('cash_variance_pending', $seller);
        $this->assertNotContains('collection_review_pending', $seller);
    }

    /** @test */
    public function day_close_with_a_closed_shift_lacking_a_declaration_is_not_complete(): void
    {
        $shift = $this->open('dcg');
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 5_100_000);
        config(['fuel_stations.shift_collection_declaration_enabled' => false]); // بلا بوابة الإقرار يُغلق بلا إقرار
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);

        $p = $this->report('day_close');
        $this->assertNull($p['tables'][0]['rows'][0]['sales']);
        $this->assertContains('collection_not_declared', $p['data_quality']['gaps']);
        $this->assertFalse($p['data_quality']['complete']);
    }

    /** @test */
    public function the_unified_day_close_summarizes_the_station_day(): void
    {
        $shift = $this->open('dc');
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 5_100_000);
        $this->handover($shift, 4000, 'dc-ho');
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'd-dc', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 23000], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);

        $row = $this->report('day_close')['tables'][0]['rows'][0];
        $this->assertSame(1, $row['shifts']);
        $this->assertSame(0, $row['open']);
        $this->assertSame(100_000, $row['liters']);
        $this->assertSame(23_000, $row['sales']);
        $this->assertSame(23_000, $row['collected']);
        $this->assertSame(4_000, $row['handover']);
        $this->assertSame(0, $row['received']);
    }

    /** @test */
    public function management_reports_need_permission_and_are_tenant_isolated(): void
    {
        $nobody = $this->roleUser($this->f['tenant_id'], 'nobody', 'nobody@mg.test', ['fuel.reading.view']);
        $this->f['nobody'] = $nobody;
        $this->withToken($this->token('nobody'))->getJson(self::BASE.'/management.dashboard')->assertNotFound();

        $this->closedShift('iso', 5_000_000, 5_100_000, 20000, 3000);
        $ours = $this->f;
        \Illuminate\Support\Facades\Cache::flush();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture('b');
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $token = $this->f['actor']->createToken('t')->plainTextToken;
        $this->f = $ours;
        $foreign = $this->withToken($token)->getJson(self::BASE.'/management.day_close')->assertOk()->json('data');
        $this->assertSame([], $foreign['tables'][0]['rows']);
    }

    /** @test */
    public function a_station_that_only_received_fuel_still_appears_in_the_day_close(): void
    {
        $now = now();
        $supplier = \App\Models\Partner::create(['tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'name' => 'مورد', 'type' => 'supplier']);
        \Illuminate\Support\Facades\DB::table('fuel_deliveries')->insert([
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'fuel_tank_id' => $this->f['nozzle']->fuel_tank_id, 'fuel_product_id' => $this->f['fuelProduct']->id, 'warehouse_id' => $this->f['warehouse']->id, 'supplier_id' => $supplier->id,
            'dispatched_milliliters' => 5_000_000, 'received_milliliters' => 4_990_000, 'transit_variance_milliliters' => -10_000, 'received_unit_cost_minor' => 0, 'received_total_cost_minor' => 0,
            'status' => 'approved', 'idempotency_key' => 'dc-delivery-only', 'received_at' => $now, 'created_at' => $now, 'updated_at' => $now,
        ]);
        $rows = $this->report('day_close')['tables'][0]['rows'];
        $this->assertCount(1, $rows);
        $this->assertSame(0, $rows[0]['shifts']);
        $this->assertSame(4_990_000, $rows[0]['received']);
    }
}

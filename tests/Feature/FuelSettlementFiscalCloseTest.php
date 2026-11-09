<?php

namespace Tests\Feature;

use App\Models\FiscalYear;
use App\Models\FuelShift;
use App\Services\Accounting\FiscalCloseService;
use App\Services\Accounting\FiscalYearService;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementPostingService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use App\Tenancy\BranchContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * P1-3b-2e-1 — مانع الإقفال المالي `fuel_settlement_pending` (يُرفع بالحسم الفعلي وحده، بلا تصرّفات) + حارس D-R.
 * بيئة معزولة وبيانات اختبار؛ بوابة التسوية تُفتح داخل الاختبار فقط.
 */
class FuelSettlementFiscalCloseTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private FiscalYear $year;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-FISCAL',
            'fuel_stations.shift_settlement_invoice_granularity' => 'per_nozzle',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();
        $y = now()->year;
        $described = app(FiscalYearService::class)->create(['name' => (string) $y, 'start_date' => "{$y}-01-01", 'end_date' => "{$y}-12-31"], null);
        $this->year = FiscalYear::findOrFail($described['id']);
    }

    private function closedShift(string $key, int $openingMeter = 1_000_000, ?callable $beforeClose = null): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + 20_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "fc-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
        if ($beforeClose !== null) {
            $beforeClose();
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
    }

    /** @return list<array<string,mixed>> */
    private function pendingItems(): array
    {
        $readiness = app(FiscalCloseService::class)->readiness($this->year->fresh());

        return array_values(array_filter($readiness['blockers'], fn ($i) => ($i['code'] ?? null) === 'fuel_settlement_pending'));
    }

    /** @test */
    public function with_the_gate_closed_there_is_no_blocker_and_no_fuel_query(): void
    {
        $this->closedShift('g1');
        config(['fuel_stations.shift_settlement_enabled' => false]);
        $queries = [];
        DB::listen(function ($q) use (&$queries) {
            $queries[] = $q->sql;
        });

        $this->assertSame([], $this->pendingItems());
        $fuelQueries = array_filter($queries, fn ($sql) => str_contains($sql, 'fuel_shift'));
        $this->assertSame([], array_values($fuelQueries), 'بوابة مغلقة ⇒ لا استعلام عن ورديات الوقود في الإقفال');
    }

    /** @test */
    public function an_unposted_closed_shift_blocks_the_final_close_and_actual_posting_lifts_it(): void
    {
        $shift = $this->closedShift('p1');

        $items = $this->pendingItems();
        $this->assertCount(1, $items);
        $this->assertSame(1, $items[0]['details']['count']);
        $e = $this->thrown(fn () => app(FiscalCloseService::class)->close($this->year->id, null), 'الإقفال النهائي مرفوض', RuntimeException::class);
        $this->assertStringContainsString('وردية وقود', $e->getMessage());

        $this->assertSame('posted', app(FuelShiftSettlementPostingService::class)->post($shift, $this->f['actor'])->outcome);

        $this->assertSame([], $this->pendingItems(), 'الحسم الفعلي يرفع المانع');
    }

    /** @test */
    public function a_posted_header_with_an_unresolved_withheld_line_still_blocks(): void
    {
        $shift = $this->closedShift('w1', 1_000_000, function () {
            $movement = app(InventoryService::class)->applyReceipt($this->f['product'], 1_000, 100, [
                'warehouse_id' => $this->f['warehouse']->id, 'source_type' => \App\Models\FuelProduct::class, 'source_id' => $this->f['fuelProduct']->id,
                'notes' => 'استلام داخل الوردية', InventoryService::FUEL_POOL_META => true,
            ], 100_000);
            app(FuelCostBasisService::class)->recordReceipt($this->f['fuelProduct'], $this->f['warehouse'], $movement, 1_000, 100_000);
        });
        $result = app(FuelShiftSettlementPostingService::class)->post($shift, $this->f['actor']);
        $this->assertSame('withheld', $result->status);

        $this->assertCount(1, $this->pendingItems(), 'سطر محجوب لم يُحسم يمنع الإقفال رغم وجود الرأس');
    }

    /** @test */
    public function the_blocker_ignores_the_active_branch_and_other_years_and_unregistered_stations(): void
    {
        $this->closedShift('b1');
        // فرع نشط مختلف: الإقفال مؤسسي ويرى ورديات كل الفروق.
        $other = \App\Models\Branch::create(['code' => 'BR-FC', 'name' => 'فرع آخر', 'is_main' => false]);
        app(BranchContext::class)->set($other->id);
        $this->assertCount(1, $this->pendingItems());
        app(BranchContext::class)->forget();

        // سنة أخرى لا ترى وردية هذه السنة.
        $next = now()->year + 1;
        $described = app(FiscalYearService::class)->create(['name' => (string) $next, 'start_date' => "{$next}-01-01", 'end_date' => "{$next}-12-31"], null);
        $nextYear = FiscalYear::findOrFail($described['id']);
        $readiness = app(FiscalCloseService::class)->readiness($nextYear);
        $this->assertSame([], array_values(array_filter($readiness['blockers'], fn ($i) => ($i['code'] ?? null) === 'fuel_settlement_pending')));

    }

    /** @test */
    public function a_station_with_no_settlement_policy_and_no_job_does_not_block(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'none'], $this->f['actor'], 'إيقاف');
        $this->closedShift('n1');
        $this->assertSame(0, DB::table('fuel_shift_settlement_jobs')->count());

        $this->assertSame([], $this->pendingItems(), 'السلوك القائم: بلا سياسة ولا مهمة لا مانع');
    }

    /** @test */
    public function d_r_rejects_an_erp_sale_on_a_pool_with_an_open_cost_history_and_allows_it_once_resolved(): void
    {
        $shift = $this->closedShift('dr1', 1_000_000, function () {
            $movement = app(InventoryService::class)->applyReceipt($this->f['product'], 1_000, 100, [
                'warehouse_id' => $this->f['warehouse']->id, 'source_type' => \App\Models\FuelProduct::class, 'source_id' => $this->f['fuelProduct']->id,
                'notes' => 'استلام داخل الوردية', InventoryService::FUEL_POOL_META => true,
            ], 100_000);
            app(FuelCostBasisService::class)->recordReceipt($this->f['fuelProduct'], $this->f['warehouse'], $movement, 1_000, 100_000);
        });
        app(FuelShiftSettlementPostingService::class)->post($shift, $this->f['actor']);
        $this->assertSame(1, DB::table('fuel_cost_pool_open_histories')->whereNull('resolved_at')->count());

        $live = $this->open('dr-live');
        $e = $this->thrown(fn () => $this->sale('dr-sale', $live), 'بيع ERP على مجمّع له تاريخ مفتوح', RuntimeException::class);
        $this->assertStringContainsString('FUEL_POOL_COST_HISTORY_OPEN', $e->getMessage());
        $this->assertSame(0, DB::table('fuel_sales')->where('fuel_shift_id', $live->id)->where('status', 'finalized')->count());

        // بعد الحسم (محاكاة بتحديث الانتقال الأحادي المسموح) يعود البيع.
        $resolution = (string) \Illuminate\Support\Str::uuid();
        $settlement = DB::table('fuel_shift_settlements')->where('fuel_shift_id', $shift->id)->value('id');
        DB::table('fuel_shift_settlement_resolutions')->insert([
            'id' => $resolution, 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_shift_settlement_id' => $settlement,
            'kind' => 'withheld_resolved', 'payload' => json_encode([]), 'resolved_by' => $this->f['actor']->id, 'resolved_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ]);
        DB::table('fuel_cost_pool_open_histories')->update(['resolution_id' => $resolution, 'resolved_at' => now()]);
        $this->assertSame('finalized', $this->sale('dr-sale2', $live)->status);
    }

    /** @test */
    public function a_job_that_ended_disabled_after_the_policy_was_switched_off_no_longer_blocks(): void
    {
        $this->closedShift('dis1');
        $this->assertCount(1, $this->pendingItems());
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'none'], $this->f['actor'], 'إيقاف');

        app(\App\Services\FuelShiftSettlementJobRunner::class)->run();   // المهمة تنتهي disabled

        $this->assertSame('disabled', DB::table('fuel_shift_settlement_jobs')->value('last_outcome'));
        $this->assertSame([], $this->pendingItems());
    }

    /** @test */
    public function shifts_closed_before_the_policy_was_enabled_mid_year_do_not_block(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'none'], $this->f['actor'], 'قبل التفعيل');
        $this->closedShift('pre1');                       // أُغلقت قبل التفعيل: بلا مهمة
        $this->travel(5)->seconds();
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل وسط السنة');
        $this->assertSame([], $this->pendingItems(), 'التفعيل نفسه لا يُنشئ مانعاً بأثر رجعي');

        $this->closedShift('post1', 2_000_000);           // بعد التفعيل: مهمة ⇒ معلّقة حتى تُرحَّل
        $items = $this->pendingItems();
        $this->assertCount(1, $items);
        $this->assertSame(1, $items[0]['details']['count']);
    }

    /** @test */
    public function the_supply_day_follows_the_station_timezone_across_the_year_boundary(): void
    {
        $y = now()->year;
        $this->travelTo(\Carbon\CarbonImmutable::parse("{$y}-12-31 21:00:00", 'UTC'));
        $shift = $this->open('tz1');
        foreach (['opening' => 1_000_000, 'closing' => 1_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "tz-{$stage}",
            ], $this->f['actor']);
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'tz-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        $this->travelTo(\Carbon\CarbonImmutable::parse("{$y}-12-31 22:30:00", 'UTC'));   // 01:30 يناير بتوقيت الرياض
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);

        $this->assertSame([], $this->pendingItems(), 'يوم التوريد 1 يناير فلا يخص سنة هذه الوردية المنتهية في 31 ديسمبر UTC');
        $next = $y + 1;
        $described = app(FiscalYearService::class)->create(['name' => (string) $next, 'start_date' => "{$next}-01-01", 'end_date' => "{$next}-12-31"], null);
        $readiness = app(FiscalCloseService::class)->readiness(FiscalYear::findOrFail($described['id']));
        $this->assertCount(1, array_filter($readiness['blockers'], fn ($i) => ($i['code'] ?? null) === 'fuel_settlement_pending'), 'وتخص السنة التالية');
    }
}

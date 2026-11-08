<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Services\FuelShiftService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * HORIZON-REPORTS / S1 — محرك تقارير الوقود: عائلتا المبيعات والورديات.
 *
 * بيانات اصطناعية معزولة (مستأجران اختباريان بمحطة وفوهة وسعر 230 هللة/لتر). كل رقم متوقع مشتق يدوياً من القراءات:
 * وردية 1: 100 لتر × 2.30 = 230.00؛ وردية 2: 50 لتر × 2.30 = 115.00؛ المجموع 150 لتراً و345.00.
 */
class FuelReportCenterApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';
    private const FLOAT_CASH = 20000;

    protected function setUp(): void
    {
        parent::setUp();
        // الـfixture المشترك يخزّن أساس receiving_shift_receipts فيحتاج البوابة مفتوحة لحظة التهيئة فقط (كاختبارات الإقرار)، ثم تُغلق كما في الإنتاج.
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    // ───────── مساعدات ─────────

    private function shiftWithSales(string $key, int $opening, int $closing, ?string $at = null): FuelShift
    {
        if ($at !== null) {
            $this->travelTo(CarbonImmutable::parse($at));
        }
        $shift = $this->open($key);
        $this->meter($shift, 'opening', $opening);
        $this->meter($shift, 'closing', $closing);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT_CASH, null, $this->f['actor']);
        $this->travelBack();

        return $closed;
    }

    private function meter(FuelShift $shift, string $stage, int $ml): void
    {
        app(FuelShiftService::class)->recordMeter($shift->fresh(), [
            'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}",
        ], $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    /** @return array<string,mixed> */
    private function report(string $key, array $query = [], string $who = 'actor'): array
    {
        $res = $this->withToken($this->token($who))->getJson(self::BASE.'/'.$key.($query ? '?'.http_build_query($query) : ''));
        $res->assertOk();

        return $res->json('data');
    }

    private function table(array $payload, string $key): array
    {
        return collect($payload['tables'])->firstWhere('key', $key);
    }

    private function twoShifts(): void
    {
        $this->shiftWithSales('a', 5_000_000, 5_100_000);
        $this->shiftWithSales('b', 5_100_000, 5_150_000);
    }

    // ───────── الكتالوج والصلاحيات ─────────

    /** @test */
    public function the_catalog_lists_only_reports_the_user_may_open(): void
    {
        $owner = $this->withToken($this->token())->getJson(self::BASE.'/catalog')->assertOk()->json('data');
        $keys = array_column($owner['reports'], 'key');
        $this->assertContains('sales.daily', $keys);
        $this->assertContains('shifts.detail', $keys);
        $this->assertCount(33, $keys);
        $this->assertArrayHasKey('sales', $owner['families']);

        // مستخدم بصلاحية البيع فقط يرى عائلة المبيعات ولا يرى تقارير الورديات (تتطلب fuel.shift.view).
        $salesOnly = $this->roleUser($this->f['tenant_id'], 'sales-only', 'sales-only@rpt.test', ['fuel.sale.view']);
        $this->f['sales_only'] = $salesOnly;
        $seen = array_column($this->withToken($this->token('sales_only'))->getJson(self::BASE.'/catalog')->assertOk()->json('data.reports'), 'key');
        $this->assertContains('sales.daily', $seen);
        $this->assertNotContains('shifts.log', $seen);
        $this->withToken($this->token('sales_only'))->getJson(self::BASE.'/shifts.log')->assertNotFound();
    }

    /** @test */
    public function a_user_without_any_fuel_report_permission_is_rejected_at_the_route(): void
    {
        $nobody = $this->roleUser($this->f['tenant_id'], 'nobody', 'nobody@rpt.test', ['products.view']);
        $this->f['nobody'] = $nobody;
        $this->withToken($this->token('nobody'))->getJson(self::BASE.'/catalog')->assertForbidden();
        $this->withToken($this->token('nobody'))->getJson(self::BASE.'/sales.daily')->assertForbidden();
    }

    /** @test */
    public function unauthenticated_requests_are_rejected(): void
    {
        $this->getJson(self::BASE.'/sales.daily')->assertUnauthorized();
        $this->getJson(self::BASE.'/catalog')->assertUnauthorized();
    }

    /** @test */
    public function an_unknown_report_key_is_not_found(): void
    {
        $this->withToken($this->token())->getJson(self::BASE.'/sales.nope')->assertNotFound();
    }

    // ───────── صحة الأرقام ─────────

    /** @test */
    public function daily_sales_equal_meter_delta_times_the_effective_price(): void
    {
        $this->twoShifts();
        $p = $this->report('sales.daily');

        $row = $this->table($p, 'daily')['rows'][0];
        $this->assertSame(2, $row['shifts']);
        $this->assertSame(150_000, $row['liters']);   // 150 لتراً بالمللتر
        $this->assertSame(34_500, $row['amount']);    // 345.00 ريال بالهللات
        $totals = $this->table($p, 'daily')['totals'];
        $this->assertSame(150_000, $totals['liters']);
        $this->assertSame(34_500, $totals['amount']);
        $this->assertTrue($p['data_quality']['complete']);
        $this->assertSame('meter_derived', $p['source']['kind']);
        $this->assertSame('محطة نقد اختبار', $p['stations'][0]['name']);
    }

    /** @test */
    public function product_pump_nozzle_and_station_views_agree_with_each_other_to_the_halala(): void
    {
        $this->twoShifts();
        foreach (['sales.by_product' => 'products', 'sales.by_pump' => 'pumps', 'sales.by_nozzle' => 'nozzles', 'sales.by_station' => 'stations', 'sales.by_shift' => 'shifts'] as $key => $table) {
            $t = $this->table($this->report($key), $table);
            $this->assertSame(150_000, $t['totals']['liters'], $key);
            $this->assertSame(34_500, $t['totals']['amount'], $key);
        }
        $product = $this->table($this->report('sales.by_product'), 'products')['rows'][0];
        $this->assertSame(230, $product['avg_price']);   // 2.30 ريال/لتر
        $this->assertSame(10_000, $product['share_bp']); // 100%
    }

    /** @test */
    public function consolidated_matrix_has_liters_and_amount_tables(): void
    {
        $this->twoShifts();
        $p = $this->report('sales.consolidated');
        $liters = $this->table($p, 'liters');
        $this->assertSame(150_000, $liters['rows'][0]['total']);
        $this->assertSame(34_500, $this->table($p, 'amount')['rows'][0]['total']);
    }

    /** @test */
    public function comparison_defaults_to_the_preceding_period_and_reports_deltas(): void
    {
        $this->shiftWithSales('prev', 5_000_000, 5_040_000, '2027-03-03 09:00:00');  // 40 لتراً في الفترة السابقة
        $this->shiftWithSales('cur', 5_040_000, 5_140_000, '2027-03-10 09:00:00');   // 100 لتر في الحالية
        $p = $this->report('sales.comparison', ['from' => '2027-03-08', 'to' => '2027-03-14']);

        $row = $this->table($p, 'comparison')['rows'][0];
        $this->assertSame(100_000, $row['a_liters']);
        $this->assertSame(40_000, $row['b_liters']);
        $this->assertSame(60_000, $row['delta_liters']);
        $this->assertSame(15_000, $row['delta_liters_bp']); // +150%
        $this->assertSame(23_000, $row['a_amount']);
        $this->assertSame(9_200, $row['b_amount']);
    }

    /** @test */
    public function an_invalid_meter_pair_makes_the_amount_unavailable_instead_of_inventing_one(): void
    {
        // الخدمة ترفض إغلاق وردية بقراءة إغلاق < افتتاح، لكنها تقبل تسجيلها فتبقى الوردية المفتوحة بقراءة غير طبيعية: لا مبلغ يُختلق لها.
        $shift = $this->open('bad');
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 4_000_000);
        $p = $this->report('sales.by_shift');
        $row = $this->table($p, 'shifts')['rows'][0];
        $this->assertNull($row['amount']);
        $this->assertSame(0, $row['complete']);
        $this->assertNull($this->table($p, 'shifts')['totals']['amount']);
        $this->assertFalse($p['data_quality']['complete']);
        $this->assertContains('closing_below_opening', $p['data_quality']['gaps']);
    }

    /** @test */
    public function empty_periods_return_empty_tables_without_errors(): void
    {
        $p = $this->report('sales.daily', ['from' => '2020-01-01', 'to' => '2020-01-02']);
        $this->assertSame([], $this->table($p, 'daily')['rows']);
        $this->assertNull($this->table($p, 'daily')['totals']);
    }

    // ───────── الحدود الزمنية بتوقيت المحطة ─────────

    /** @test */
    public function the_day_boundary_follows_the_station_timezone_not_the_server(): void
    {
        // 22:30 UTC = 01:30 بتوقيت الرياض لليوم التالي: تُنسب الوردية للحادي عشر لا العاشر.
        $this->shiftWithSales('tz', 5_000_000, 5_010_000, '2027-03-10 22:30:00');
        $this->assertSame([], $this->table($this->report('sales.daily', ['from' => '2027-03-10', 'to' => '2027-03-10']), 'daily')['rows']);
        $rows = $this->table($this->report('sales.daily', ['from' => '2027-03-11', 'to' => '2027-03-11']), 'daily')['rows'];
        $this->assertCount(1, $rows);
        $this->assertSame('2027-03-11', $rows[0]['period']);
    }

    /** @test */
    public function period_validation_rejects_reversed_and_oversized_ranges(): void
    {
        $this->withToken($this->token())->getJson(self::BASE.'/sales.daily?from=2027-03-10&to=2027-03-01')->assertStatus(422);
        $this->withToken($this->token())->getJson(self::BASE.'/sales.daily?from=2020-01-01&to=2027-01-01')->assertStatus(422);
        $this->withToken($this->token())->getJson(self::BASE.'/sales.daily?from=not-a-date')->assertStatus(422);
    }

    // ───────── الحقول الحسّاسة ─────────

    /** @test */
    public function money_columns_are_removed_from_the_payload_for_users_without_sales_permission(): void
    {
        $this->twoShifts();
        $p = $this->report('sales.daily', [], 'seller'); // البائع: fuel.shift.view فقط بلا fuel.sale.view

        $table = $this->table($p, 'daily');
        $this->assertNotContains('amount', array_column($table['columns'], 'key'));
        $this->assertArrayNotHasKey('amount', $table['rows'][0]);
        $this->assertArrayNotHasKey('amount', $table['totals']);
        $this->assertNotContains('amount', array_column($p['summary'], 'key'));
        $this->assertSame(150_000, $table['rows'][0]['liters']); // الكميات تبقى
        $this->assertStringNotContainsString('34500', json_encode($p));

        // الجدول الحسّاس بكامله يُحذف (مصفوفة القيمة).
        $matrix = $this->report('sales.consolidated', [], 'seller');
        $this->assertSame(['liters'], array_column($matrix['tables'], 'key'));
    }

    // ───────── العزل ─────────

    /** @test */
    public function a_foreign_tenant_sees_none_of_this_tenants_data_and_cannot_target_its_station(): void
    {
        $this->twoShifts();
        $ourStation = $this->f['station']->id;
        $ours = $this->f;

        // مستأجر آخر ببيانات خاصة به.
        \Illuminate\Support\Facades\Cache::flush(); // حد معدل التسجيل (مستأجر ثالث ورابع في الاختبار نفسه)
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture('b');
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $this->shiftWithSales('foreign', 7_000_000, 7_020_000);
        $foreign = $this->f;
        $this->f = $ours;
        app(TenantContext::class)->set($ours['tenant_id']);
        app(BranchContext::class)->set($ours['branch']->id);

        $token = $foreign['actor']->createToken('t')->plainTextToken;
        $own = $this->withToken($token)->getJson(self::BASE.'/sales.daily')->assertOk()->json('data');
        $this->assertSame(20_000, $this->table($own, 'daily')['totals']['liters']); // 20 لتراً له فقط
        $this->assertCount(1, $own['stations']);
        $this->assertNotSame($ourStation, $own['stations'][0]['id']);

        // معرّف محطتنا من مستأجر آخر = 404 موحّد (لا تسريب ولا فارغ مضلّل).
        $this->withToken($token)->getJson(self::BASE.'/sales.daily?station_id='.$ourStation)->assertNotFound();
        // وردية مستأجر آخر في تقرير التفاصيل = 404.
        $shiftId = FuelShift::query()->withoutGlobalScopes()->where('tenant_id', $ours['tenant_id'])->value('id');
        $this->withToken($token)->getJson(self::BASE.'/shifts.detail?shift_id='.$shiftId)->assertNotFound();
    }

    /** @test */
    public function a_user_scoped_to_another_station_sees_no_rows_and_gets_404_for_ours(): void
    {
        $this->twoShifts();
        $other = FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id, 'code' => 'OTHER-1', 'name' => 'محطة أخرى',
        ]);
        $scoped = $this->roleUser($this->f['tenant_id'], 'scoped', 'scoped@rpt.test', ['fuel.shift.view', 'fuel.sale.view']);
        $scoped->forceFill(['fuel_station_scope' => 'assigned'])->save();
        $scoped->fuelStations()->sync([$other->id]);
        $this->f['scoped'] = $scoped;

        $p = $this->report('sales.daily', [], 'scoped');
        $this->assertSame([], $this->table($p, 'daily')['rows']);
        $this->assertSame([$other->id], array_column($p['stations'], 'id'));
        $this->withToken($this->token('scoped'))->getJson(self::BASE.'/sales.daily?station_id='.$this->f['station']->id)->assertNotFound();
    }

    // ───────── الورديات ─────────

    /** @test */
    public function shift_log_lists_shifts_with_status_duration_and_liters(): void
    {
        $this->twoShifts();
        $open = $this->open('still-open');
        $p = $this->report('shifts.log');
        $rows = $this->table($p, 'shifts')['rows'];
        $this->assertCount(3, $rows);
        $this->assertSame(['closed', 'closed', 'open'], array_column($rows, 'status'));
        $this->assertSame(100_000, $rows[0]['liters']);
        $this->assertNull($rows[2]['liters']); // المفتوحة بلا لترات قبل الإغلاق
        $this->assertSame(1, collect($p['summary'])->firstWhere('key', 'open')['value']);
        $this->assertSame($open->number, $rows[2]['shift']);
    }

    /** @test */
    public function shift_detail_returns_nozzles_cash_and_a_404_for_unknown_shifts(): void
    {
        $shift = $this->shiftWithSales('d', 5_000_000, 5_100_000);
        $p = $this->report('shifts.detail', ['shift_id' => $shift->id]);
        $this->assertNull($p['period']);
        $nozzles = $this->table($p, 'nozzles');
        $this->assertSame(100_000, $nozzles['rows'][0]['liters']);
        $this->assertSame(5_000_000, $nozzles['rows'][0]['opening']);
        $this->assertSame(23_000, $nozzles['rows'][0]['amount']);
        $this->assertSame($shift->number, collect($p['summary'])->firstWhere('key', 'shift')['value']);
        $this->assertSame(self::FLOAT_CASH, collect($p['summary'])->firstWhere('key', 'opening_float')['value']);

        $this->withToken($this->token())->getJson(self::BASE.'/shifts.detail')->assertStatus(422);
        $this->withToken($this->token())->getJson(self::BASE.'/shifts.detail?shift_id='.(string) \Illuminate\Support\Str::uuid())->assertNotFound();

        // البائع لا يرى المبالغ المشتقة من البيع في التفاصيل.
        $seller = $this->report('shifts.detail', ['shift_id' => $shift->id], 'seller');
        $keys = array_column($this->table($seller, 'nozzles')['columns'], 'key');
        $this->assertNotContains('amount', $keys);
        $this->assertNotContains('amount', array_column($seller['summary'], 'key'));
        $this->assertNotContains('expected_cash', array_column($seller['summary'], 'key'));
    }

    /** @test */
    public function readings_report_flags_nozzles_without_readings(): void
    {
        $shift = $this->open('r1');
        $this->meter($shift, 'opening', 1_000_000);
        $p = $this->report('shifts.readings');
        $row = $this->table($p, 'readings')['rows'][0];
        $this->assertSame(1_000_000, $row['opening']);
        $this->assertNull($row['closing']);
        $this->assertSame('in_progress', $row['status']);
    }

    /** @test */
    public function open_overdue_flags_by_threshold(): void
    {
        $this->open('o1');
        $fresh = $this->report('shifts.open_overdue');
        $this->assertSame(0, collect($fresh['summary'])->firstWhere('key', 'overdue')['value']);
        $this->travel(13)->hours();
        $late = $this->report('shifts.open_overdue');
        $this->travelBack();
        $this->assertSame(1, collect($late['summary'])->firstWhere('key', 'overdue')['value']);
        $this->assertNull($late['period']);
    }

    /** @test */
    public function closing_variance_handover_and_corrections_reports_run_on_real_closed_shifts(): void
    {
        $shift = $this->shiftWithSales('c', 5_000_000, 5_100_000);
        $closing = $this->table($this->report('shifts.closing'), 'closing')['rows'][0];
        $this->assertSame($shift->number, $closing['shift']);
        $this->assertSame(self::FLOAT_CASH, $closing['counted']);

        $this->assertSame([], $this->table($this->report('shifts.handover'), 'handover')['rows']);
        $this->assertSame([], $this->table($this->report('shifts.corrections'), 'corrections')['rows']);
        $this->assertIsArray($this->table($this->report('shifts.variances'), 'variances')['rows']);
    }

    /** @test */
    public function employee_report_separates_sole_from_shared_shifts_and_never_splits_totals(): void
    {
        $shift = $this->open('e1');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        app(FuelShiftService::class)->assignStaff($shift->fresh(), $this->f['seller']->id, 'attendant', $this->f['actor']);
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT_CASH, null, $this->f['actor']);

        $rows = $this->table($this->report('sales.by_employee'), 'employees')['rows'];
        $seller = collect($rows)->firstWhere('employee', $this->f['seller']->name);
        $this->assertSame(1, $seller['sole_shifts']);
        $this->assertSame(100_000, $seller['sole_liters']);
        $this->assertSame(0, $seller['shared_shifts']);
    }

    // ───────── ملاحظات المراجعة (Codex #2078) ─────────

    /** @test */
    public function equipment_filters_do_not_turn_other_stations_into_unknown_amounts(): void
    {
        $this->twoShifts();
        $other = FuelStation::create(['tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id, 'code' => 'OTH-2', 'name' => 'محطة بلا مضخات']);
        app(FuelShiftService::class)->open(['fuel_station_id' => $other->id, 'opening_float_minor' => 0, 'idempotency_key' => 'shift-other'], $this->f['actor']);

        $unfiltered = $this->report('sales.by_pump');
        $this->assertNull($unfiltered['summary'][2]['value']); // وردية المحطة الأخرى بلا فوهات ⇒ غير مكتملة فعلاً
        $p = $this->report('sales.by_pump', ['pump_id' => $this->f['nozzle']->fuel_pump_id]);
        $this->assertSame(34_500, $this->table($p, 'pumps')['totals']['amount']); // المرشح يستبعد ما خارج المعدّة بدل إبطال الإجمالي
        $this->assertSame(34_500, $p['summary'][2]['value']);
        $this->assertTrue($p['data_quality']['complete']);
    }

    /** @test */
    public function comparison_keeps_the_data_quality_flags_of_the_current_period(): void
    {
        $this->shiftWithSales('prev', 5_000_000, 5_040_000, '2027-03-03 09:00:00');
        $bad = $this->open('cur-bad'); // الفترة الحالية: وردية مفتوحة بقراءة إغلاق < افتتاح
        $this->meter($bad, 'opening', 5_000_000);
        $this->meter($bad, 'closing', 4_000_000);

        $p = $this->report('sales.comparison', ['from' => '2026-01-01', 'to' => '2026-12-31', 'compare_from' => '2027-03-01', 'compare_to' => '2027-03-05']);
        $this->assertContains('closing_below_opening', $p['data_quality']['gaps']);
        $this->assertFalse($p['data_quality']['complete']);
    }

    /** @test */
    public function correction_snapshots_hide_sales_derived_cash_keys_from_users_without_sales_permission(): void
    {
        $shift = $this->shiftWithSales('corr', 5_000_000, 5_100_000);
        \App\Models\FuelShiftCorrection::create([
            'branch_id' => $shift->branch_id, 'fuel_shift_id' => $shift->id, 'target_type' => 'cash_count', 'target_id' => null,
            'before' => ['counted_cash_minor' => 20000, 'cash_variance_minor' => -4500, 'expected_operational_cash_minor' => 24500],
            'proposed' => ['counted_cash_minor' => 24500], 'status' => 'requested', 'reason' => 'خطأ عدّ',
            'requested_by' => $this->f['actor']->id, 'requested_at' => now(),
        ]);
        $seller = $this->report('shifts.corrections', ['from' => '2026-01-01', 'to' => '2026-12-31'], 'seller');
        $text = json_encode($seller['tables'][0]['rows'][0]);
        $this->assertStringContainsString('counted_cash_minor', $text);
        $this->assertStringNotContainsString('cash_variance_minor', $text);
        $this->assertStringNotContainsString('expected_operational_cash_minor', $text);

        $owner = json_encode($this->report('shifts.corrections', ['from' => '2026-01-01', 'to' => '2026-12-31'])['tables'][0]['rows'][0]);
        $this->assertStringContainsString('cash_variance_minor', $owner);
    }
}

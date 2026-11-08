<?php

namespace Tests\Feature;

use App\Services\FuelShiftService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * HORIZON-REPORTS / S9 — حارس أداء: تكلفة التقرير لكل وردية محدودة ولا تنمو بعدد الورديات (لا N+1 متصاعد)، ومدّة الاستجابة معقولة.
 * 40 وردية مغلقة بقراءات؛ الحد المقاس ثابت لكل وردية وليس زمناً مطلقاً هشّاً.
 */
class FuelReportPerformanceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/report-center';
    private const SHIFTS = 40;
    /** استعلامات لكل وردية (حاسبة العدادات + الأسعار) — سقف مُقاس مع هامش. */
    private const MAX_QUERIES_PER_SHIFT = 30;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    private function seedShifts(int $count): void
    {
        $svc = app(FuelShiftService::class);
        $reading = 1_000_000;
        for ($i = 0; $i < $count; $i++) {
            $shift = $this->open("perf-{$i}");
            foreach (['opening' => $reading, 'closing' => $reading + 10_000] as $stage => $ml) {
                $svc->recordMeter($shift->fresh(), ['fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "p-{$shift->id}-{$stage}"], $this->f['actor']);
            }
            $svc->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);
            $reading += 10_000;
        }
    }

    /** @test */
    public function query_cost_per_shift_is_bounded_and_totals_are_exact_at_scale(): void
    {
        $this->seedShifts(self::SHIFTS);
        $token = $this->f['actor']->createToken('t')->plainTextToken;

        DB::enableQueryLog();
        $started = microtime(true);
        $res = $this->withToken($token)->getJson(self::BASE.'/sales.by_shift')->assertOk()->json('data');
        $elapsed = microtime(true) - $started;
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();

        $this->assertSame(self::SHIFTS, count($res['tables'][0]['rows']));
        $this->assertSame(self::SHIFTS * 10_000, $res['tables'][0]['totals']['liters']);
        $this->assertSame(self::SHIFTS * 2300, $res['tables'][0]['totals']['amount']); // 10 لتر × 2.30 لكل وردية
        $this->assertFalse($res['truncated']);
        $perShift = $queries / self::SHIFTS;
        fwrite(STDERR, sprintf("\n[perf] %d shifts: %d queries (%.1f/shift) in %.2fs\n", self::SHIFTS, $queries, $perShift, $elapsed));
        $this->assertLessThanOrEqual(self::MAX_QUERIES_PER_SHIFT, $perShift);
        $this->assertLessThan(30.0, $elapsed);
    }

    /** @test */
    public function light_reports_do_not_run_the_per_shift_sales_calculation(): void
    {
        $this->seedShifts(15);
        $token = $this->f['actor']->createToken('t')->plainTextToken;
        DB::enableQueryLog();
        $this->withToken($token)->getJson(self::BASE.'/shifts.log')->assertOk();
        $queries = count(DB::getQueryLog());
        DB::disableQueryLog();
        $this->assertLessThan(60, $queries); // سجل الورديات: استعلامات ثابتة لا تتناسب مع عدد الورديات
    }
}

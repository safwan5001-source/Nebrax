<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * HORIZON-REPORTS / S4 — عائلة التحصيل (C). بيانات اصطناعية: وردية 1 = 100 لتر × 2.30 = 230.00 محصَّلة كاملةً (200.00 نقد + 30.00 شبكة)،
 * ووردية 2 = 50 لتراً = 115.00 محصَّل منها 110.00 (100.00 نقد + 10.00 شبكة) ⇒ عجز 5.00.
 */
class FuelReportCollectionApiTest extends TestCase
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

    private function declaredShift(string $key, int $opening, int $closing, int $cash, int $bank, ?string $note = null): FuelShift
    {
        $shift = $this->open($key);
        $this->meter($shift, 'opening', $opening);
        $this->meter($shift, 'closing', $closing);
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => "decl-{$key}", 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bank]],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + $cash, $note, $this->f['actor']);
    }

    private function token(string $who = 'actor'): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    /** @return array<string,mixed> */
    private function report(string $key, string $who = 'actor', string $query = ''): array
    {
        return $this->withToken($this->token($who))->getJson(self::BASE.'/'.$key.$query)->assertOk()->json('data');
    }

    private function table(array $p, string $key): array
    {
        return collect($p['tables'])->firstWhere('key', $key);
    }

    private function world(): void
    {
        $this->declaredShift('c1', 5_000_000, 5_100_000, 20000, 3000);
        $this->declaredShift('c2', 5_100_000, 5_150_000, 10000, 1000, 'عجز موثّق: خطأ عدّ');
    }

    /** @test */
    public function channel_reports_separate_cash_from_network_and_exclude_nothing_silently(): void
    {
        $this->world();
        $cash = $this->table($this->report('collection.cash'), 'cash');
        $this->assertSame(30000, $cash['totals']['amount']);
        $this->assertSame(['frozen', 'frozen'], array_column($cash['rows'], 'state'));
        $this->assertSame(4000, $this->table($this->report('collection.network'), 'bank')['totals']['amount']);
    }

    /** @test */
    public function by_method_and_by_employee_agree_with_the_channel_totals(): void
    {
        $this->world();
        $methods = $this->table($this->report('collection.by_method'), 'methods');
        $this->assertSame(34000, $methods['totals']['amount']);
        $cash = collect($methods['rows'])->firstWhere('type', 'cash');
        $this->assertSame(30000, $cash['amount']);
        $this->assertSame(8824, $cash['share_bp']); // 88.24%

        $employees = $this->table($this->report('collection.by_employee'), 'employees');
        $this->assertSame(34000, $employees['totals']['collected']);
        $this->assertSame(2, $employees['rows'][0]['shifts']);
    }

    /** @test */
    public function reconciliation_matches_meter_sales_to_collection_and_flags_the_shortage(): void
    {
        $this->world();
        $p = $this->report('collection.reconciliation');
        $rows = $this->table($p, 'reconciliation')['rows'];
        $this->assertSame([23000, 11500], array_column($rows, 'sales'));
        $this->assertSame([23000, 11000], array_column($rows, 'declared'));
        $this->assertSame([0, -500], array_column($rows, 'difference'));
        $this->assertSame(1, collect($p['summary'])->firstWhere('key', 'matched')['value']);
        $this->assertSame(1, collect($p['summary'])->firstWhere('key', 'differences')['value']);
    }

    /** @test */
    public function variances_report_totals_shortages_and_overages_by_direction(): void
    {
        $this->world();
        $p = $this->report('collection.variances');
        $rows = $this->table($p, 'variances')['rows'];
        // أساس النقد الافتراضي (movements_only) لا يحتسب نقد المبيعات في المتوقع ⇒ للورديتين فرق درج؛ فرق التحصيل مقابل العدادات 0 و−500.
        $this->assertCount(2, $rows);
        $this->assertSame([0, -500], array_column($rows, 'collection_difference'));
    }

    /** @test */
    public function a_closed_shift_without_declaration_is_reported_as_not_declared_never_invented(): void
    {
        config(['fuel_stations.shift_collection_declaration_enabled' => false]);
        $shift = $this->open('nodecl');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);

        $p = $this->report('collection.reconciliation');
        $row = $this->table($p, 'reconciliation')['rows'][0];
        $this->assertNull($row['declared']);
        $this->assertNull($row['sales']);
        $this->assertSame('none', $row['state']);
        $this->assertContains('collection_not_declared', $p['data_quality']['gaps']);
        $this->assertFalse($p['data_quality']['complete']);
        $this->assertSame([], $this->table($this->report('collection.cash'), 'cash')['rows']);
    }

    /** @test */
    public function sales_derived_columns_are_removed_for_users_without_sales_permission_but_declared_amounts_stay(): void
    {
        $this->world();
        $p = $this->report('collection.reconciliation', 'seller');
        $keys = array_column($this->table($p, 'reconciliation')['columns'], 'key');
        $this->assertContains('declared', $keys);
        $this->assertNotContains('sales', $keys);
        $this->assertNotContains('difference', $keys);
        $this->assertNotContains('review_required', $keys);

        // جدول الفروق بكامله حسّاس فيُحذف.
        $this->assertSame([], $this->report('collection.variances', 'seller')['tables']);
        // التحصيل المُقَرّ به يبقى ظاهراً لمن يرى الوردية.
        $this->assertSame(30000, $this->table($this->report('collection.cash', 'seller'), 'cash')['totals']['amount']);
    }

    /** @test */
    public function deferred_sales_are_receivables_from_final_sales_and_need_sales_permission(): void
    {
        $shift = $this->open('def');
        $sale = $this->corporateSale('def-sale', $shift);
        $this->assertSame(FuelSale::STATUS_FINALIZED, $sale->status);

        $p = $this->report('collection.deferred');
        $row = $this->table($p, 'deferred')['rows'][0];
        $this->assertSame('formal', 'formal'); // المصدر الرسمي
        $this->assertSame('finalized_sales', $p['source']['kind']);
        $this->assertSame(1, $row['sales']);
        $this->assertSame(1000, $row['liters']);
        $total = (int) \App\Models\Invoice::findOrFail($sale->invoice_id)->total;
        $this->assertSame($total, $row['gross']);   // إجمالي الفاتورة الرسمية لا gross_minor
        $this->assertSame($total - (int) $sale->paid_minor, $row['outstanding']);

        // نمط «غير شامل»: gross_minor صافٍ؛ المتبقي يتبع الفاتورة (100 + 15 − 110 = 5، لا −10)
        \Illuminate\Support\Facades\DB::table('invoices')->where('id', $sale->invoice_id)->update(['total' => 11500]);
        \Illuminate\Support\Facades\DB::table('fuel_sales')->where('id', $sale->id)->update(['gross_minor' => 10000, 'paid_minor' => 11000]);
        $row = $this->table($this->report('collection.deferred'), 'deferred')['rows'][0];
        $this->assertSame(11500, $row['gross']);
        $this->assertSame(500, $row['outstanding']);

        $this->withToken($this->token('seller'))->getJson(self::BASE.'/collection.deferred')->assertNotFound(); // بلا fuel.sale.view
    }

    /** @test */
    public function handover_alias_returns_the_same_rows_as_the_shift_report(): void
    {
        $shift = $this->open('ho');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        $this->handover($shift, 5000, 'ho-1');
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'decl-ho', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 23000], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);
        $a = $this->table($this->report('shifts.handover'), 'handover');
        $b = $this->table($this->report('collection.handover'), 'handover');
        $this->assertSame($a['rows'], $b['rows']);
        $this->assertSame(5000, $b['totals']['amount']);
    }

    /** @test */
    public function collection_reports_are_isolated_per_tenant(): void
    {
        $this->world();
        $ours = $this->f;
        \Illuminate\Support\Facades\Cache::flush();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture('b');
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $this->declaredShift('fx', 7_000_000, 7_010_000, 2000, 300);
        $foreign = $this->f['actor']->createToken('t')->plainTextToken;
        $this->f = $ours;

        $own = $this->withToken($foreign)->getJson(self::BASE.'/collection.by_method')->assertOk()->json('data');
        $this->assertSame(2300, $this->table($own, 'methods')['totals']['amount']); // 23.00 له فقط، لا 340.00 من المستأجر الآخر
    }

    /** @test */
    public function an_incomplete_frozen_sales_snapshot_is_a_quality_gap_even_though_a_declaration_exists(): void
    {
        $shift = $this->declaredShift('inc', 5_000_000, 5_100_000, 20000, 3000);
        \Illuminate\Support\Facades\DB::statement("UPDATE fuel_shift_collection_declarations SET sales_complete = false, sales_minor = NULL, difference_minor = NULL WHERE fuel_shift_id = '{$shift->id}'");

        $p = $this->report('collection.reconciliation');
        $this->assertContains('declaration_sales_incomplete', $p['data_quality']['gaps']);
        $this->assertFalse($p['data_quality']['complete']);
        $this->assertNull($this->table($p, 'reconciliation')['rows'][0]['sales']);
    }
}

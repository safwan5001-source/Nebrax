<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Services\FuelSaleService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementJobRunner;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use App\Services\Reporting\FuelReportEngine;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * الدورة الكاملة بأرقام دقيقة (هللات ومللترات) على بيانات اختبار معزولة وبوابة مفتوحة داخل الاختبار فقط:
 * وردية ← قراءات عدّادات ← مبيعات ERP (كاش وشبكة) ← إقرار تحصيل ← إغلاق ← مهمة تسوية ← مخزون ← قيود ← تقارير.
 *
 * الأرقام (سعر 2.30/لتر شامل ضريبة 15%): العدّاد 20,000 مل = 4600؛ ERP: 1 لتر نقداً (230) + 2 لتر شبكة (460) = 690 (للعميل المسمّى)؛ بقية العدّاد 17,000 مل = 3910 فاتورة تسوية للعميل النقدي.
 * الإقرار: نقد 1730 + شبكة 2870 = 4600 ⇒ تحصيل التسوية = (نقد 1730 − 230) + (شبكة 2870 − 460) = 1500 + 2410 = 3910 بلا فرق.
 */
class FuelSettlementFullCycleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-CYCLE',
            'fuel_stations.shift_settlement_invoice_granularity' => 'per_nozzle',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();
        $this->app->forgetInstance(FuelShiftSettlementJobRunner::class);
    }

    /** @param array<string,mixed> $report @return array<string,mixed> */
    private function summary(array $report): array
    {
        return collect($report['summary'])->mapWithKeys(fn ($i) => [$i['key'] => $i['value'] ?? null])->all();
    }

    /** @return array<string,mixed> */
    private function report(string $key, ?\Closure $branchScope = null): array
    {
        return app(FuelReportEngine::class)->run($this->f['actor'], $key, ['station_id' => $this->f['station']->id], null, $branchScope ?? fn ($q) => $q);
    }

    private function accountSum(string $code, string $side, array $entryIds): int
    {
        return (int) JournalLine::query()->whereHas('account', fn ($q) => $q->where('code', $code))->whereIn('journal_entry_id', $entryIds)->sum($side);
    }

    /** @test */
    public function the_full_cycle_matches_to_the_halala_and_the_milliliter_across_ledger_stock_and_reports(): void
    {
        $f = $this->f;
        $stockBefore = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $f['warehouse']->id)->value('quantity');

        // 1) وردية + قراءات عدّادات (افتتاح/إغلاق = 20,000 مل).
        $shift = $this->open('cyc');
        foreach (['opening' => 1_000_000, 'closing' => 1_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "cyc-{$stage}",
            ], $f['actor']);
        }

        // 2) مبيعات ERP للعميل المسمّى: 1 لتر نقداً و2 لتر شبكة (إيصالات محطة).
        $service = app(FuelSaleService::class);
        $sale1 = $service->finalize($service->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $f['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => 'cyc-s1',
        ], $f['actor']), $f['actor']);
        $sale2 = $service->finalize($service->createDraft([
            'fuel_station_id' => $f['station']->id, 'fuel_nozzle_id' => $f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $f['customer']->id, 'quantity_milliliters' => 2000, 'idempotency_key' => 'cyc-s2',
        ], $f['actor']), $f['actor']);
        $this->collect($sale1, 'cash', null, 'cyc-c1');      // 230 نقداً
        $this->collect($sale2, 'bank', null, 'cyc-c2');      // 460 شبكة

        // 3) إقرار التحصيل: نقد 1730 + شبكة 2870 = 4600، ثم الإغلاق.
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'cyc-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $f['cash']->id, 'amount_minor' => 1730], ['payment_method_id' => $f['bank']->id, 'amount_minor' => 2870]],
        ], $f['actor']);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 1730, null, $f['actor']);

        // 4) مهمة التسوية عبر المشغّل.
        $summary = app(FuelShiftSettlementJobRunner::class)->run();
        $this->assertSame(1, $summary['posted'], json_encode($summary));
        $header = DB::table('fuel_shift_settlements')->where('fuel_shift_id', $closed->id)->sole();
        $this->assertSame('posted', $header->status);

        // 5) اللترات: عدّاد = ERP + تسوية، بلا ازدواج.
        $this->assertSame([20_000, 3_000, 17_000], [(int) $header->metered_milliliters, (int) $header->erp_milliliters, (int) $header->residual_milliliters]);
        $sales = DB::table('fuel_sales')->where('fuel_shift_id', $closed->id)->where('status', 'finalized')->get();
        $this->assertSame(3_000, (int) $sales->where('source', 'station')->sum('quantity_milliliters'));
        $this->assertSame(17_000, (int) $sales->where('source', 'settlement')->sum('quantity_milliliters'));
        $this->assertSame(20_000, (int) $sales->sum('quantity_milliliters'), 'مجموع المبيعات النهائية = لترات العدّاد بالضبط');

        // 6) الفواتير (هللات): ERP 230 + 460، تسوية 3910، المجموع 4600، الضريبة 600.
        $invoices = Invoice::query()->whereIn('id', $sales->pluck('invoice_id'))->get();
        $this->assertSame([230, 460, 3910], $invoices->pluck('total')->map(fn ($v) => (int) $v)->sort()->values()->all());
        $this->assertSame(4600, (int) $invoices->sum('total'));
        $this->assertSame(600, (int) $invoices->sum('tax_amount'));
        $this->assertSame(4600, (int) $invoices->sum('paid_amount'), 'كل الفواتير مسدَّدة (الإقرار يغطي المبيعات)');
        $invoiceEntries = $invoices->pluck('journal_entry_id')->all();
        $this->assertSame(4000, $this->accountSum('4110', 'credit', $invoiceEntries), 'الإيراد الصافي');
        $this->assertSame(600, $this->accountSum('2120', 'credit', $invoiceEntries), 'ضريبة المخرجات');
        $this->assertSame(4600, $this->accountSum('1130', 'debit', $invoiceEntries));

        // 7) التحصيل: ERP (إيصالات) 230 نقد + 460 شبكة، والتسوية 2410 شبكة + 1500 نقد؛ بلا فروق.
        $collections = DB::table('fuel_shift_settlement_collections as c')->join('payment_methods as m', 'm.id', '=', 'c.payment_method_id')
            ->where('c.fuel_shift_settlement_id', $header->id)->get(['c.amount_minor', 'm.settlement_type', 'c.payment_id']);
        $byType = $collections->groupBy('settlement_type')->map(fn ($g) => (int) $g->sum('amount_minor'))->sortKeys()->all();
        $this->assertSame(['bank' => 2410, 'cash' => 1500], $byType);
        $this->assertSame(0, DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $header->id)->count());
        $receiptPaymentIds = DB::table('fuel_sale_payment_receipts')->whereIn('fuel_sale_id', $sales->pluck('id'))->pluck('payment_id');
        $this->assertSame(2, $receiptPaymentIds->count());
        $this->assertSame(0, $receiptPaymentIds->intersect($collections->pluck('payment_id'))->count(), 'لا سند يُعدّ مرتين (إيصال محطة وتخصيص تسوية)');
        $allPaymentEntries = DB::table('payments')->whereIn('id', $receiptPaymentIds->merge($collections->pluck('payment_id')))->pluck('journal_entry_id')->all();
        $this->assertSame(1730, $this->accountSum('1110', 'debit', $allPaymentEntries), 'الخزينة النقدية: 230 + 1500');
        $this->assertSame(2870, $this->accountSum('1120', 'debit', $allPaymentEntries), 'البنك: 460 + 2410');
        $this->assertSame(4600, $this->accountSum('1130', 'credit', $allPaymentEntries), 'ذمم العملاء تُسدَّد بكامل 4600');
        $customerEntries = array_merge($invoiceEntries, $allPaymentEntries);
        $this->assertSame(0, $this->accountSum('1130', 'debit', $customerEntries) - $this->accountSum('1130', 'credit', $customerEntries), 'رصيد 1130 للدورة = صفر');

        // 8) المخزون والتكلفة: خروج 20,000 مل (3,000 ERP + 17,000 تسوية) وقيد COGS يطابق مجموع تكلفة المبيعات.
        $this->assertSame($stockBefore - 20_000, (int) DB::table('product_warehouse_stock')->where('warehouse_id', $f['warehouse']->id)->value('quantity'));
        $this->assertSame(20_000, (int) DB::table('stock_movements')->where('type', 'out')->whereIn('source_id', $sales->pluck('id'))->sum('quantity'));
        $cogs = (int) $sales->sum('cogs_minor');
        $cogsEntries = $sales->pluck('cogs_journal_entry_id')->filter()->all();
        $this->assertSame(2_000_000, $cogs, 'متوسط تكلفة المجمّع 100 هللة/مل (100,000,000 ÷ 1,000,000) × 20,000 مل');
        $this->assertSame($cogs, $this->accountSum('5110', 'debit', $cogsEntries));
        $this->assertSame($cogs, $this->accountSum('1140', 'credit', $cogsEntries));

        // 9) كل القيود متوازنة هللةً بهللة.
        $entryIds = array_merge($invoiceEntries, $allPaymentEntries, $cogsEntries);
        $this->assertSame($this->accountSumAll('debit', $entryIds), $this->accountSumAll('credit', $entryIds));

        // 10) التقارير بلا ازدواج: العدّاد مقابل المبيعات الرسمية، والتحصيل حسب الطريقة، وإيراد المحطة.
        $meter = $this->report('pumps.meter_vs_sales');
        $this->assertSame(['meter' => 20_000, 'formal' => 20_000, 'unmatched' => 0], array_intersect_key($this->summary($meter), array_flip(['meter', 'formal', 'unmatched'])));
        $row = $meter['tables'][0]['rows'][0];
        $this->assertSame(17_000, (int) $row['settlement'], 'حصة التسوية ظاهرة ولا تُضاعَف');
        $this->assertSame(20_000, (int) $row['formal']);

        $methods = $this->report('financial.payment_methods');
        $byMethod = collect($methods['tables'][0]['rows'])->mapWithKeys(fn ($r) => [$r['method'] => [(int) $r['receipts'], (int) $r['amount']]])->all();
        $this->assertSame(4600, (int) $this->summary($methods)['amount'], 'إجمالي المقبوض = إجمالي المبيعات (إيصالات ERP + تحصيل التسوية، كل سند مرة)');
        $this->assertSame(4, array_sum(array_column($byMethod, 0)), 'أربع قبوضات: إيصالان + تخصيصان');
        $this->assertSame([1730, 2870], collect($byMethod)->map(fn ($v) => $v[1])->sort()->values()->all());

        // نطاق الفرع النشط يشمل تحصيلات التسوية كإيصالات ERP: فرع آخر ⇒ لا مقبوض من هذه المحطة، وفرعها ⇒ المجموع نفسه.
        $otherBranch = fn ($q) => $q->where($q->getModel()->getTable().'.branch_id', (string) \Illuminate\Support\Str::uuid());
        $this->assertSame(0, (int) ($this->summary($this->report('financial.payment_methods', $otherBranch))['amount'] ?? 0));
        $ownBranch = fn ($q) => $q->where($q->getModel()->getTable().'.branch_id', $f['branch']->id);
        $this->assertSame(4600, (int) $this->summary($this->report('financial.payment_methods', $ownBranch))['amount']);

        $revenue = $this->report('financial.revenue');
        $this->assertSame(4600, (int) collect($revenue['tables'][0]['rows'])->sum(fn ($r) => (int) ($r['gross'] ?? $r['total'] ?? $r['amount'] ?? 0)), 'إيراد المحطة = مجموع الفواتير مرة واحدة');
    }

    private function accountSumAll(string $side, array $entryIds): int
    {
        return (int) JournalLine::query()->whereIn('journal_entry_id', $entryIds)->sum($side);
    }
}

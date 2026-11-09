<?php

namespace Tests\Feature;

use App\Models\AccountingPeriodLock;
use App\Models\FuelShift;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Services\Accounting\InventoryService;
use App\Services\FuelCostBasisService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelShiftSettlementDates;
use App\Services\FuelShiftSettlementEvaluator;
use App\Services\FuelShiftSettlementPostingService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelStationWalkInPartnerService;
use App\Support\SettlementPostingResult;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * P1-3b-2b — محرك ترحيل تسوية الورديات (J1 فاتورة لكل فوهة + J2 تكلفة البضاعة + مخزون) على بيانات اختبار معزولة. **غير موصول بأي مسار إنتاجي.**
 *
 * يثبت: شروط النشر الثلاثة، القيد الناتج بالأرقام، استبعاد بيع التسوية من «بيع ERP»، الإعادة بلا أثر، الحجب على مستوى السطر، الفترة المقفلة، صفر أثر عند الفشل، التواريخ الأربعة،
 * وأن مسار البيع المباشر لم يتغيّر وأن لا مسار إنتاجياً يستدعي المحرك. الذمة 1130 تبقى مفتوحة بقدر الفواتير (التخصيص والسندات = 2c).
 */
class FuelShiftSettlementPostingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        $this->openGates();
        $this->f = $this->fixture();
        $this->setBasis('declared_collection');
        app(FuelStationWalkInPartnerService::class)->assign($this->f['station'], $this->f['actor']);
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'post_on_close'], $this->f['actor'], 'تفعيل اختبار');
        $this->travel(3)->seconds();
    }

    private function openGates(): void
    {
        config([
            'fuel_stations.shift_settlement_enabled' => true,
            'fuel_stations.shift_settlement_tax_opinion_ref' => 'TAX-OPINION-TEST-ENGINE',
            'fuel_stations.shift_settlement_invoice_granularity' => 'per_nozzle',
            'fuel_stations.shift_collection_declaration_enabled' => true,
            'fuel_stations.shift_cash_receipts_enabled' => true,
        ]);
    }

    /** وردية مغلقة بالمسار الحقيقي: عدّاد 20 لتراً (إغلاق − افتتاح) + إقرار نقد 46.00. */
    private function closedShift(string $key, int $openingMeter = 1_000_000, ?callable $beforeClose = null, int $deltaMl = 20_000, int $cashMinor = 4600, int $bankMinor = 0, ?string $note = null): FuelShift
    {
        $shift = $this->open($key);
        foreach (['opening' => $openingMeter, 'closing' => $openingMeter + $deltaMl] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "eng-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
        if ($beforeClose !== null) {
            $beforeClose($shift->fresh());
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $shift->id.'decl', 'base_revision' => 0,
            'lines' => [
                ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cashMinor],
                ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bankMinor],
            ],
        ], $this->f['actor']);

        return app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + $cashMinor, $note, $this->f['actor']);
    }

    private function engine(): FuelShiftSettlementPostingService
    {
        return app(FuelShiftSettlementPostingService::class);
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        $tables = ['invoices', 'invoice_lines', 'journal_entries', 'journal_lines', 'payments', 'stock_movements', 'fuel_sales', 'fuel_operational_ledgers',
            'fuel_inventory_cost_movements', 'fuel_shift_settlements', 'fuel_shift_settlement_lines', 'fuel_cost_pool_open_histories', 'zatca_chain_entries'];

        return collect($tables)->mapWithKeys(fn ($t) => [$t => DB::table($t)->count()])->all();
    }

    // ───────── شروط النشر (كلها تحجب بلا أي كتابة) ─────────

    /** @test */
    public function every_publication_condition_blocks_without_any_write(): void
    {
        $shift = $this->closedShift('g1');
        $before = $this->counts();

        config(['fuel_stations.shift_settlement_invoice_granularity' => '']);
        $r = $this->engine()->post($shift, $this->f['actor']);
        $this->assertSame(SettlementPostingResult::BLOCKED, $r->outcome);
        $this->assertSame(['FUEL_SETTLEMENT_GRANULARITY_NOT_DECLARED'], $r->reasons);

        foreach (['per_product', 'per_shift', 'nonsense'] as $unbuilt) {
            config(['fuel_stations.shift_settlement_invoice_granularity' => $unbuilt]);
            $this->assertSame(['FUEL_SETTLEMENT_GRANULARITY_NOT_DECLARED'], $this->engine()->post($shift, $this->f['actor'])->reasons, $unbuilt);
        }

        $this->openGates();
        config(['fuel_stations.shift_settlement_tax_opinion_ref' => '']);
        $this->assertSame(['FUEL_SETTLEMENT_GATE_CLOSED'], $this->engine()->post($shift, $this->f['actor'])->reasons);

        $this->openGates();
        config(['fuel_stations.shift_settlement_enabled' => false]);
        $this->assertSame(['FUEL_SETTLEMENT_GATE_CLOSED'], $this->engine()->post($shift, $this->f['actor'])->reasons);

        $this->openGates();
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'none'], $this->f['actor'], 'إيقاف');
        $this->assertSame(['FUEL_SETTLEMENT_POLICY_NOT_POST_ON_CLOSE'], $this->engine()->post($shift, $this->f['actor'])->reasons);

        $this->assertSame($before, $this->counts(), 'لا أثر لأي حجب');
    }

    // ───────── المسار السعيد: J1 + J2 ─────────

    /** @test */
    public function a_closed_shift_posts_one_invoice_per_nozzle_with_balanced_entries_stock_and_dates(): void
    {
        $shift = $this->closedShift('h1');
        $stockBefore = (int) DB::table('product_warehouse_stock')->where('warehouse_id', $this->f['warehouse']->id)->value('quantity');
        $before = $this->counts();

        $result = $this->engine()->post($shift, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome);
        $this->assertSame('posted', $result->status);
        $this->assertSame(1, $result->postedLines);
        $this->assertSame(0, $result->withheldLines);

        $header = DB::table('fuel_shift_settlements')->where('id', $result->settlementId)->first();
        $this->assertSame('posted', $header->status);
        $this->assertSame(20_000, (int) $header->metered_milliliters);
        $this->assertSame(0, (int) $header->erp_milliliters);
        $this->assertSame(20_000, (int) $header->residual_milliliters);
        $this->assertSame(4600, (int) $header->settled_invoice_total_minor);       // 20 لتراً × 2.30 شامل الضريبة
        $this->assertSame(0, (int) $header->pending_value_minor);
        $this->assertSame($shift->id, $header->fuel_shift_id);

        // بيع تسوية واحد، مصدره settlement، نهائي، للعميل النقدي للمحطة.
        $sale = DB::table('fuel_sales')->where('fuel_shift_id', $shift->id)->first();
        $this->assertSame('settlement', $sale->source);
        $this->assertSame('finalized', $sale->status);
        $this->assertSame(20_000, (int) $sale->quantity_milliliters);
        $walkIn = app(\App\Services\FuelShiftSettlementReadiness::class)->walkInPartner($this->f['station']);
        $this->assertSame($walkIn->id, $sale->partner_id);

        // J1: مدين 1130 = 4600 / دائن 4110 = 4000 + 2120 = 600 (شامل ضريبة 15%) — آجلة بلا سداد.
        $invoice = Invoice::findOrFail($sale->invoice_id);
        $this->assertSame('posted', $invoice->status);
        $this->assertSame('credit', $invoice->payment_type);
        $this->assertSame(4600, (int) $invoice->total);
        $this->assertSame(600, (int) $invoice->tax_amount);
        $this->assertSame(4600, (int) $invoice->paid_amount, 'سند قبض نقدي J3 بكامل قيمة الفاتورة');
        $lines = JournalLine::where('journal_entry_id', $invoice->journal_entry_id)->with('account')->get();
        $this->assertSame(4600, (int) $lines->sum('debit'));
        $this->assertSame(4600, (int) $lines->sum('credit'));
        $this->assertSame(4600, (int) $lines->filter(fn ($l) => $l->account->code === '1130')->sum('debit'));
        $this->assertSame(4000, (int) $lines->filter(fn ($l) => $l->account->code === '4110')->sum('credit'));
        $this->assertSame(600, (int) $lines->filter(fn ($l) => $l->account->code === '2120')->sum('credit'));

        // J2: مدين 5110 / دائن 1140 بقيمة التكلفة المثبَّتة على البيع، وحركة مخزون خارجة 20 لتراً، وسجل تشغيلي.
        $cogsLines = JournalLine::where('journal_entry_id', $sale->cogs_journal_entry_id)->with('account')->get();
        $this->assertSame((int) $sale->cogs_minor, (int) $cogsLines->filter(fn ($l) => $l->account->code === '5110')->sum('debit'));
        $this->assertSame((int) $sale->cogs_minor, (int) $cogsLines->filter(fn ($l) => $l->account->code === '1140')->sum('credit'));
        $this->assertSame($stockBefore - 20_000, (int) DB::table('product_warehouse_stock')->where('warehouse_id', $this->f['warehouse']->id)->value('quantity'));
        $this->assertSame(1, DB::table('fuel_operational_ledgers')->where('source_id', $sale->id)->count());

        // السطر مربوط بالبيع (انتقال أحادي) والعدّادات: صف واحد لكل جدول متوقع، ولا سند قبض (2c).
        $line = DB::table('fuel_shift_settlement_lines')->where('fuel_shift_settlement_id', $result->settlementId)->first();
        $this->assertSame($sale->id, $line->fuel_sale_id);
        $this->assertSame('posted', $line->state);
        $after = $this->counts();
        $this->assertSame($before['fuel_shift_settlements'] + 1, $after['fuel_shift_settlements']);
        $this->assertSame($before['fuel_sales'] + 1, $after['fuel_sales']);
        $this->assertSame($before['invoices'] + 1, $after['invoices']);
                $this->assertSame($before['payments'] + 1, $after['payments'], 'سند قبض واحد (J3)');
        $this->assertSame($before['journal_entries'] + 2, $after['journal_entries'] - 1, 'قيد السند فوق قيدَي الفاتورة والتكلفة');
        $collection = DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->sole();
        $this->assertSame(4600, (int) $collection->amount_minor);
        $this->assertSame('settlement', $collection->target_kind);
        $this->assertSame($invoice->id, $collection->invoice_id);
        // J3: مدين الخزينة النقدية (1110) / دائن العملاء (1130) بتاريخ التحصيل.
        $receipt = DB::table('payments')->where('id', $collection->payment_id)->first();
        $this->assertSame('posted', $receipt->status);
        $receiptLines = JournalLine::where('journal_entry_id', $receipt->journal_entry_id)->with('account')->get();
        $this->assertSame(4600, (int) $receiptLines->filter(fn ($l) => $l->account->code === '1110')->sum('debit'));
        $this->assertSame(4600, (int) $receiptLines->filter(fn ($l) => $l->account->code === '1130')->sum('credit'));
        $this->assertSame(0, DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $result->settlementId)->count(), 'لا فرق عند التطابق');

        // التواريخ الأربعة: التوريد = تاريخ الفاتورة = تاريخ القيد (يوم الإغلاق بتقويم المحطة)، ولحظة الإصدار من الفاتورة.
        $dates = app(FuelShiftSettlementDates::class)->forSettlement($result->settlementId);
        $this->assertSame($dates['supply']['business_date'], $dates['accounting_date']);
        $this->assertSame($dates['supply']['business_date'], $dates['lines'][0]['invoice_date']);
        $this->assertSame($dates['supply']['business_date'], $dates['lines'][0]['entry_date']);
        $this->assertNotNull($dates['lines'][0]['issued_at']);
    }

    /** @test */
    public function an_erp_sale_in_the_shift_is_deducted_and_a_settlement_sale_is_never_counted_as_erp(): void
    {
        $shift = $this->open('h2');
        foreach (['opening' => 2_000_000, 'closing' => 2_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "h2-{$stage}",
            ], $this->f['actor']);
        }
        $this->sale('h2-erp', $shift->fresh());                         // بيع ERP نهائي 1 لتر للعميل المسمّى
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'h2-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);

        $result = $this->engine()->post($closed, $this->f['actor']);

        $header = DB::table('fuel_shift_settlements')->where('id', $result->settlementId)->first();
        $this->assertSame(1_000, (int) $header->erp_milliliters);
        $this->assertSame(19_000, (int) $header->residual_milliliters);
        $this->assertSame(4370, (int) $header->settled_invoice_total_minor);       // 19 لتراً × 2.30

        // بعد الترحيل: بيع التسوية لا يدخل ERP، فالتقييم نفسه يعطي البقية نفسها (لا ازدواج احتساب).
        $evaluation = app(FuelShiftSettlementEvaluator::class)->evaluate($closed->fresh(), now());
        $this->assertSame(1_000, $evaluation['lines'][0]['erp_milliliters']);
        $this->assertSame(19_000, $evaluation['lines'][0]['residual_milliliters']);
    }

    // ───────── الإعادة والحجب والفشل ─────────

    /** @test */
    public function posting_twice_replays_the_first_result_without_any_new_effect(): void
    {
        $shift = $this->closedShift('r1');
        $first = $this->engine()->post($shift, $this->f['actor']);
        $afterFirst = $this->counts();

        $second = $this->engine()->post($shift->fresh(), $this->f['actor']);

        $this->assertSame(SettlementPostingResult::REPLAYED, $second->outcome);
        $this->assertSame($first->settlementId, $second->settlementId);
        $this->assertSame($afterFirst, $this->counts());
    }

    /** @test */
    public function replay_wins_over_a_later_policy_change_and_an_unavailable_station_or_foreign_actor_is_blocked_first(): void
    {
        $shift = $this->closedShift('r2');
        $first = $this->engine()->post($shift, $this->f['actor']);
        $this->assertSame(SettlementPostingResult::POSTED, $first->outcome);

        // تغيّر السياسة لاحقاً لا يحوّل الإعادة إلى «محجوب».
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_settlement_mode' => 'none'], $this->f['actor'], 'إيقاف لاحق');
        $replay = $this->engine()->post($shift->fresh(), $this->f['actor']);
        $this->assertSame(SettlementPostingResult::REPLAYED, $replay->outcome);

        // محطة غير نشطة ⇒ حجب مقروء (حتى للإعادة: التفويض والتوفّر أولاً) بلا أي كتابة.
        $before = $this->counts();
        DB::table('fuel_stations')->where('id', $this->f['station']->id)->update(['status' => 'inactive']);
        $this->assertSame(['FUEL_SETTLEMENT_STATION_UNAVAILABLE'], $this->engine()->post($shift->fresh(), $this->f['actor'])->reasons);
        $this->assertSame($before, $this->counts());
    }

    /** @test */
    public function a_residual_that_rounds_to_zero_value_is_blocked_not_silently_skipped(): void
    {
        $shift = $this->closedShift('z1', 1_000_000, null, 1, 0);   // 1 مل × 2.30/لتر = أقل من هللة
        $before = $this->counts();

        $result = $this->engine()->post($shift, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::BLOCKED, $result->outcome);
        $this->assertSame(['FUEL_SETTLEMENT_ZERO_VALUE_RESIDUAL'], $result->reasons);
        $this->assertSame($before, $this->counts());
    }

    // ───────── 2c: التحصيل (نقد / شبكة / مختلط) والفروق وتاريخ التحصيل ─────────

    /** @return array<string,mixed> */
    private function collectionsOf(string $settlementId): array
    {
        return DB::table('fuel_shift_settlement_collections as c')->join('payment_methods as m', 'm.id', '=', 'c.payment_method_id')
            ->where('c.fuel_shift_settlement_id', $settlementId)->orderBy('m.settlement_type')->get(['c.*', 'm.settlement_type'])->all();
    }

    /** @test */
    public function a_network_payment_posts_a_bank_receipt_not_cash(): void
    {
        $shift = $this->closedShift('n1', 1_000_000, null, 20_000, 0, 4600);
        $result = $this->engine()->post($shift, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome);
        $rows = $this->collectionsOf($result->settlementId);
        $this->assertCount(1, $rows);
        $this->assertSame('bank', $rows[0]->settlement_type);
        $lines = JournalLine::where('journal_entry_id', DB::table('payments')->where('id', $rows[0]->payment_id)->value('journal_entry_id'))->with('account')->get();
        $this->assertSame(0, (int) $lines->filter(fn ($l) => $l->account->code === '1110')->sum('debit'), 'الشبكة لا تمسّ الخزينة النقدية');
        $this->assertSame(4600, (int) $lines->filter(fn ($l) => $l->account->code === '1130')->sum('credit'));
        $this->assertSame(4600, (int) $lines->sum('debit'));
        $this->assertSame(4600, (int) $lines->sum('credit'));
    }

    /** @test */
    public function a_mixed_collection_fills_with_the_network_first_then_cash_and_conserves_money(): void
    {
        $shift = $this->closedShift('m1', 1_000_000, null, 20_000, 2000, 2600);   // شبكة 2600 + نقد 2000 = 4600
        $result = $this->engine()->post($shift, $this->f['actor']);

        $rows = $this->collectionsOf($result->settlementId);
        $byType = collect($rows)->groupBy('settlement_type')->map(fn ($g) => (int) $g->sum('amount_minor'));
        $this->assertSame(['bank' => 2600, 'cash' => 2000], $byType->all());
        $invoice = Invoice::findOrFail(DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->value('invoice_id'));
        $this->assertSame(4600, (int) $invoice->paid_amount);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertSame(0, DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $result->settlementId)->count());
        // 1130 للعميل النقدي: +4600 فاتورة − 2600 − 2000 = 0 (حفظ المال).
        $net = JournalLine::query()->whereHas('account', fn ($q) => $q->where('code', '1130'))
            ->whereIn('journal_entry_id', array_merge(
                [$invoice->journal_entry_id],
                DB::table('payments')->whereIn('id', collect($rows)->pluck('payment_id'))->pluck('journal_entry_id')->all(),
            ))->get();
        $this->assertSame(0, (int) $net->sum('debit') - (int) $net->sum('credit'));
    }

    /** @test */
    public function a_shortage_stays_as_an_open_receivable_and_a_surplus_is_a_record_only(): void
    {
        $short = $this->engine()->post($this->closedShift('s1', 1_000_000, null, 20_000, 4000, 0, 'عجز اختبار'), $this->f['actor']);
        $v = DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $short->settlementId)->get();
        $this->assertCount(1, $v);
        $this->assertSame('shortage', $v[0]->kind);
        $this->assertSame(600, (int) $v[0]->amount_minor);
        $this->assertNull($v[0]->payment_method_id);
        $invoice = Invoice::findOrFail(DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $short->settlementId)->value('invoice_id'));
        $this->assertSame(4000, (int) $invoice->paid_amount);
        $this->assertSame('partial', $invoice->payment_status);

        $surplus = $this->engine()->post($this->closedShift('s2', 2_000_000, null, 20_000, 5000, 0, 'زيادة اختبار'), $this->f['actor']);
        $this->assertSame(SettlementPostingResult::POSTED, $surplus->outcome, json_encode($surplus->reasons));
        $v2 = DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $surplus->settlementId)->get();
        $this->assertCount(1, $v2);
        $this->assertSame('surplus', $v2[0]->kind);
        $this->assertSame(400, (int) $v2[0]->amount_minor);
        $this->assertSame(4600, (int) DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $surplus->settlementId)->sum('amount_minor'), 'الزيادة لا تُقبض');
    }

    /** @test */
    public function the_receipt_date_is_the_actual_collection_date_distinct_from_the_supply_and_posting_dates(): void
    {
        // وردية تُقرّ تحصيلها قبل منتصف الليل (اليوم 1) وتُغلق بعده (اليوم 2) ثم تُرحَّل في اليوم 3.
        $tz = app(FuelStationSettingsService::class)->operatingTimezone($this->f['station']);
        $day1 = \Carbon\CarbonImmutable::now($tz)->addDays(10)->setTime(23, 40);
        $this->travelTo($day1->subHours(1));
        $shift = $this->open('d1');
        foreach (['opening' => 1_000_000, 'closing' => 1_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "d1-{$stage}",
            ], $this->f['actor']);
        }
        $this->travelTo($day1);
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'd1-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        $this->travelTo($day1->addMinutes(30));                       // بعد منتصف الليل ⇒ يوم الإغلاق = اليوم 2
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
        $this->travelTo($day1->addDays(1)->setTime(10, 0));           // الترحيل في اليوم 3 (بعد يوم الإغلاق)... اليوم 2 + 10 ساعات

        $result = $this->engine()->post($closed, $this->f['actor']);
        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome, json_encode($result->reasons));

        $supplyDate = $day1->addMinutes(30)->toDateString();
        $collectionDate = $day1->toDateString();
        $this->assertNotSame($supplyDate, $collectionDate);
        $dates = app(FuelShiftSettlementDates::class)->forSettlement($result->settlementId);
        $this->assertSame($supplyDate, $dates['supply']['business_date']);
        $this->assertSame($supplyDate, $dates['lines'][0]['invoice_date']);
        $this->assertSame($supplyDate, $dates['lines'][0]['entry_date'], 'قيد الفاتورة بتاريخ التوريد');

        $collection = DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->sole();
        $this->assertSame($collectionDate, substr((string) $collection->collection_date, 0, 10), 'تاريخ التحصيل = يوم الإقرار');
        $payment = DB::table('payments')->where('id', $collection->payment_id)->first();
        $this->assertSame($collectionDate, substr((string) $payment->payment_date, 0, 10));
        $receiptEntry = DB::table('journal_entries')->where('id', $payment->journal_entry_id)->first();
        $this->assertSame($collectionDate, substr((string) $receiptEntry->entry_date, 0, 10), 'قيد السند بتاريخ التحصيل لا التوريد');
        $this->assertNotSame($supplyDate, substr((string) $receiptEntry->entry_date, 0, 10));
        // لحظة الكتابة الفعلية (الترحيل) ثالثة مستقلة.
        $this->assertSame($day1->addDays(1)->toDateString(), \Carbon\CarbonImmutable::parse($receiptEntry->created_at)->setTimezone($tz)->toDateString());
    }

    /** @test */
    public function a_locked_collection_period_blocks_everything_even_when_the_supply_period_is_open(): void
    {
        $tz = app(FuelStationSettingsService::class)->operatingTimezone($this->f['station']);
        $day1 = \Carbon\CarbonImmutable::now($tz)->addDays(10)->setTime(23, 40);
        $this->travelTo($day1->subHours(1));
        $shift = $this->open('lc1');
        foreach (['opening' => 1_000_000, 'closing' => 1_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "lc1-{$stage}",
            ], $this->f['actor']);
        }
        $this->travelTo($day1);
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'lc1-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        $this->travelTo($day1->addMinutes(30));
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);
        $this->travelTo($day1->addDays(1)->setTime(10, 0));

        // فترة تاريخ التحصيل (اليوم 1) مقفلة، وفترة التوريد (اليوم 2) مفتوحة.
        AccountingPeriodLock::create([
            'tenant_id' => $this->f['tenant_id'], 'start_date' => $day1->toDateString(), 'end_date' => $day1->toDateString(),
            'status' => 'active', 'reason' => 'اختبار قفل التحصيل',
        ]);
        $before = $this->counts();

        $result = $this->engine()->post($closed, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::BLOCKED, $result->outcome);
        $this->assertContains('FUEL_SETTLEMENT_COLLECTION_PERIOD_LOCKED', $result->reasons);
        $this->assertSame($before, $this->counts(), 'لا فاتورة ولا قيد ولا سند');
    }

    /** @test */
    public function the_settlement_never_duplicates_receipts_invoices_or_entries_on_replay(): void
    {
        $result = $this->engine()->post($this->closedShift('dup1', 1_000_000, null, 20_000, 2000, 2600), $this->f['actor']);
        $after = $this->counts();
        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome);

        $again = $this->engine()->post(FuelShift::findOrFail(DB::table('fuel_shift_settlements')->where('id', $result->settlementId)->value('fuel_shift_id')), $this->f['actor']);

        $this->assertSame(SettlementPostingResult::REPLAYED, $again->outcome);
        $this->assertSame($after, $this->counts());
        $this->assertSame(2, DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->count());
        $this->assertSame(2, DB::table('payments')->whereIn('id', DB::table('fuel_shift_settlement_collections')->pluck('payment_id'))->count());
    }

    /** @test */
    public function an_unpaid_erp_walk_in_invoice_is_collected_first_and_never_paid_twice(): void
    {
        $walkIn = app(\App\Services\FuelShiftSettlementReadiness::class)->walkInPartner($this->f['station']);
        $shift = $this->open('erpw');
        foreach (['opening' => 3_000_000, 'closing' => 3_020_000] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "erpw-{$stage}",
            ], $this->f['actor']);
        }
        $service = app(\App\Services\FuelSaleService::class);
        $erpSale = $service->finalize($service->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $walkIn->id, 'quantity_milliliters' => 1000, 'idempotency_key' => 'erpw-sale',
        ], $this->f['actor']), $this->f['actor']);                    // 1 لتر = 230 للعميل النقدي، غير مسدَّدة
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'erpw-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 4600], ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 0]],
        ], $this->f['actor']);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 4600, null, $this->f['actor']);

        $result = $this->engine()->post($closed, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome, json_encode($result->reasons));
        $rows = DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->orderBy('target_kind')->get();
        $this->assertSame(['erp_walk_in', 'settlement'], $rows->pluck('target_kind')->all());
        $this->assertSame([230, 4370], $rows->pluck('amount_minor')->map(fn ($v) => (int) $v)->all(), '230 للفاتورة القائمة ثم الباقي 19 لتراً');
        $this->assertSame(230, (int) Invoice::findOrFail($erpSale->invoice_id)->paid_amount);
        $this->assertSame('paid', Invoice::findOrFail($erpSale->invoice_id)->payment_status);
        $this->assertSame(0, DB::table('fuel_shift_settlement_variances')->where('fuel_shift_settlement_id', $result->settlementId)->count());
    }

    /** @test */
    public function two_nozzles_with_the_same_number_on_different_pumps_are_collected_into_their_own_invoices(): void
    {
        $f = $this->f;
        $pump2 = \App\Models\FuelPump::create(['tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch']->id, 'fuel_station_id' => $f['station']->id, 'pump_number' => 'FCP-2-dup']);
        $nozzle2 = \App\Models\FuelNozzle::create([
            'tenant_id' => $f['tenant_id'], 'branch_id' => $f['branch']->id, 'fuel_station_id' => $f['station']->id, 'fuel_pump_id' => $pump2->id,
            'fuel_tank_id' => $f['nozzle']->fuel_tank_id, 'fuel_product_id' => $f['fuelProduct']->id, 'nozzle_number' => $f['nozzle']->nozzle_number,   // الرقم نفسه على مضخة أخرى
        ]);
        $shift = $this->open('dupn');
        foreach ([[$f['nozzle'], 1_000_000], [$nozzle2, 2_000_000]] as [$nozzle, $base]) {
            foreach (['opening' => $base, 'closing' => $base + 20_000] as $stage => $ml) {
                app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                    'fuel_nozzle_id' => $nozzle->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "dupn-{$nozzle->id}-{$stage}",
                ], $f['actor']);
            }
        }
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => 'dupn-decl', 'base_revision' => 0,
            'lines' => [['payment_method_id' => $f['cash']->id, 'amount_minor' => 9200], ['payment_method_id' => $f['bank']->id, 'amount_minor' => 0]],
        ], $f['actor']);
        $closed = app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT + 9200, null, $f['actor']);

        $result = $this->engine()->post($closed, $f['actor']);

        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome, json_encode($result->reasons));
        $this->assertSame(2, $result->postedLines);
        $rows = DB::table('fuel_shift_settlement_collections')->where('fuel_shift_settlement_id', $result->settlementId)->get();
        $this->assertCount(2, $rows);
        $this->assertCount(2, $rows->pluck('invoice_id')->unique(), 'كل فوهة بفاتورتها');
        foreach ($rows as $row) {
            $this->assertSame(4600, (int) $row->amount_minor);
            $this->assertSame(4600, (int) Invoice::findOrFail($row->invoice_id)->paid_amount);
        }
    }

    /** @test */
    public function an_unusable_treasury_is_blocked_at_evaluation_and_a_payment_service_rejection_maps_to_a_stable_code_with_no_write(): void
    {
        $shift = $this->closedShift('rej1');
        $before = $this->counts();

        // (1) خزينة غير نشطة تُكشف عند التقييم قبل أي كتابة.
        DB::table('cash_bank_accounts')->where('tenant_id', $this->f['tenant_id'])->update(['is_active' => false]);
        $this->assertSame(['FUEL_SETTLEMENT_NOT_READY_PAYMENT_METHOD_TREASURY'], $this->engine()->post($shift, $this->f['actor'])->reasons);
        $this->assertSame($before, $this->counts());
        DB::table('cash_bank_accounts')->where('tenant_id', $this->f['tenant_id'])->update(['is_active' => true]);

        // (2) رفض من خدمة السندات وقت الترحيل (تخويل إيداع مثلاً) ⇒ حجب برمز ثابت وتراجع كامل بعد بناء الفواتير.
        $real = app(\App\Services\Accounting\PaymentService::class);
        $mock = \Mockery::mock(\App\Services\Accounting\PaymentService::class);
        $mock->shouldReceive('create')->andReturnUsing(fn (...$args) => $real->create(...$args));
        $mock->shouldReceive('post')->andThrow(new \RuntimeException('ليس لديك صلاحية الإيداع'));
        $this->app->instance(\App\Services\Accounting\PaymentService::class, $mock);
        $this->app->forgetInstance(FuelShiftSettlementPostingService::class);

        $result = $this->engine()->post($shift->fresh(), $this->f['actor']);

        $this->assertSame(SettlementPostingResult::BLOCKED, $result->outcome);
        $this->assertSame(['FUEL_SETTLEMENT_RECEIPT_REJECTED'], $result->reasons);
        $this->assertSame($before, $this->counts(), 'تراجع كامل: لا فاتورة ولا قيد ولا سند');
    }

    /** @test */
    public function a_locked_period_on_the_supply_date_blocks_with_no_write_and_clears_when_opened(): void
    {
        $shift = $this->closedShift('p1');
        $lock = AccountingPeriodLock::create([
            'tenant_id' => $this->f['tenant_id'], 'start_date' => now()->subDays(30)->toDateString(), 'end_date' => now()->addDays(30)->toDateString(),
            'status' => 'active', 'reason' => 'إقفال',
        ]);
        $before = $this->counts();

        $blocked = $this->engine()->post($shift, $this->f['actor']);
        $this->assertSame(SettlementPostingResult::BLOCKED, $blocked->outcome);
        $this->assertContains('FUEL_SETTLEMENT_PERIOD_LOCKED', $blocked->reasons);
        $this->assertSame($before, $this->counts(), 'لا قيد بأثر رجعي ولا تاريخ بديل');

        $lock->update(['status' => 'released']);
        $this->assertSame(SettlementPostingResult::POSTED, $this->engine()->post($shift->fresh(), $this->f['actor'])->outcome);
    }

    /** @test */
    public function a_cost_event_after_the_shift_opened_withholds_the_line_only_and_opens_a_pool_history(): void
    {
        $shift = $this->closedShift('w1', 1_000_000, function () {
            // حدث تكلفة (استلام) داخل نافذة التعرّض: يحجب ترحيل المجمّع دون فشل الإغلاق.
            $movement = app(InventoryService::class)->applyReceipt($this->f['product'], 1_000, 100, [
                'warehouse_id' => $this->f['warehouse']->id, 'source_type' => \App\Models\FuelProduct::class, 'source_id' => $this->f['fuelProduct']->id,
                'notes' => 'استلام داخل الوردية', InventoryService::FUEL_POOL_META => true,
            ], 100_000);
            app(FuelCostBasisService::class)->recordReceipt($this->f['fuelProduct'], $this->f['warehouse'], $movement, 1_000, 100_000);
        });
        $before = $this->counts();

        $result = $this->engine()->post($shift, $this->f['actor']);

        $this->assertSame(SettlementPostingResult::POSTED, $result->outcome, 'سبب الحجب: '.implode(',', $result->reasons));
        $this->assertSame('withheld', $result->status);
        $this->assertSame(0, $result->postedLines);
        $this->assertSame(1, $result->withheldLines);
        $line = DB::table('fuel_shift_settlement_lines')->where('fuel_shift_settlement_id', $result->settlementId)->first();
        $this->assertSame('withheld_cost_pool_changed', $line->state);
        $this->assertNull($line->fuel_sale_id);
        $this->assertSame(4600, (int) $line->pending_value_minor);                 // تقدير معلّق لا التزام
        $this->assertSame(1, DB::table('fuel_cost_pool_open_histories')->whereNull('resolved_at')->count());
        $after = $this->counts();
        foreach (['invoices', 'journal_entries', 'stock_movements', 'fuel_sales', 'payments'] as $t) {
            $this->assertSame($before[$t], $after[$t], "المحجوب لا يكتب {$t}");
        }
    }

    /** @test */
    public function a_failure_inside_posting_rolls_everything_back(): void
    {
        $shift = $this->closedShift('f1');
        // حساب تكلفة البضاعة من نوع إيراد (غير صالح لـJ2) ⇒ تفشل خطوة J2 بعد إدراج الرأس والسطر والفاتورة والبيع.
        DB::table('fuel_stations')->where('id', $this->f['station']->id)->update(['default_cogs_account_id' => DB::table('accounts')->where('tenant_id', $this->f['tenant_id'])->where('code', '4110')->value('id')]);
        $before = $this->counts();

        $this->thrown(fn () => $this->engine()->post($shift->fresh(), $this->f['actor']), 'فشل J2 يُرجع كل شيء', \Throwable::class);

        $this->assertSame($before, $this->counts(), 'لا رأس ولا سطر ولا بيع ولا فاتورة ولا قيد ولا حركة ولا ICV');
        $this->assertSame(0, DB::table('fuel_shift_settlements')->where('fuel_shift_id', $shift->id)->count());
    }

    // ───────── حدود معمارية ─────────

    /** @test */
    public function no_production_path_calls_the_engine_and_the_direct_sale_path_is_untouched(): void
    {
        $callers = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $file) {
            if ($file->isFile() && $file->getExtension() === 'php' && str_contains((string) file_get_contents($file->getPathname()), 'FuelShiftSettlementPostingService')) {
                $callers[] = basename($file->getPathname());
            }
        }
        sort($callers);
        // P1-3b-2d: مستهلك واحد فقط هو معالج المهمة؛ لا الإغلاق ولا نقطة نهاية ولا المشغّل مباشرة.
        $this->assertSame(['FuelShiftSettlementEngineHandler.php', 'FuelShiftSettlementPostingService.php'], $callers, 'معالج المهمة هو المستهلك الوحيد للمحرك');
        $runner = (string) file_get_contents(app_path('Services/FuelShiftSettlementJobRunner.php'));
        $this->assertStringNotContainsString('FuelShiftSettlementPostingService', $runner);
        $close = (string) file_get_contents(app_path('Services/FuelShiftService.php'));
        $this->assertStringNotContainsString('FuelShiftSettlementPostingService', $close);
        $this->assertStringNotContainsString('FuelShiftSettlementEngineHandler', $close);

        $sales = (string) file_get_contents(app_path('Services/FuelSaleService.php'));
        $this->assertStringContainsString('public function finalize(FuelSale $sale, User $actor): FuelSale', $sales);
        $this->assertStringContainsString('public function prepareSettlementSale(', $sales);
        $this->assertStringContainsString('public function postSettlementSale(', $sales);
    }
}

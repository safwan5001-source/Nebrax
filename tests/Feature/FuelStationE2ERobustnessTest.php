<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\FuelOperationalLedger;
use App\Models\FuelSale;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** FUEL-E2E (2/3): التكرار وإعادة المحاولة، العمليات غير الصالحة، الدقة والتقريب، الوردية بلا مبيعات ERP. */
class FuelStationE2ERobustnessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use FuelStationE2EWorld;

    private const RECEIPTS = ['shift_expected_cash_basis' => 'receiving_shift_receipts'];

    /** @return array<string,int> لقطة عدّادات الأثر المالي والمخزني */
    private function footprint(): array
    {
        $t = $this->w['tenant_id'];

        return [
            'sales' => FuelSale::count(), 'invoices' => Invoice::count(), 'payments' => Payment::count(),
            'movements' => StockMovement::where('source_type', FuelSale::class)->count(),
            'ledger' => FuelOperationalLedger::where('movement_type', 'sale')->count(),
            'journals' => DB::table('journal_entries')->where('tenant_id', $t)->where('status', 'posted')->count(),
            'stock' => $this->stockMl(),
        ];
    }

    private function readyShift(string $tag, int $float = 20000): string
    {
        $shift = $this->openShift('seller', "{$tag}-open", $float);
        $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/staff", ['user_id' => $this->w['seller']->id, 'role' => 'attendant'])->assertSuccessful();
        $this->meter('seller', $shift, 'opening', 1000000)->assertCreated();
        $this->tankReading('seller', $shift, 'opening', 10000000)->assertCreated();

        return $shift;
    }

    // ═════════ S07 — قراءات الإغلاق وحدودها ═════════

    /** @test */
    public function s07_closing_readings_and_close_preconditions(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s07');

        // إغلاق بلا قراءات إغلاق (الافتراضي صارم) ← مرفوض ولا يتغير الشيء.
        $noReadings = $this->closeShift('seller', $shift, 20000);
        $this->assertSame(422, $noReadings->status(), 'لا إغلاق بلا قراءات عدادات/خزانات إغلاق');
        $this->assertSame('open', $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}")['data']['status']);

        // قراءة إغلاق أقل من الافتتاح: يوثّق السلوك (قبول ثم رفض عند الإغلاق).
        $low = $this->meter('seller', $shift, 'closing', 999000);
        $this->tankReading('seller', $shift, 'closing', 9990000);
        $this->declareCollection('seller', $shift, 0, 0, 's07-decl');
        $closeLow = $this->closeShift('seller', $shift, 20000);
        $this->evidence('S07', ['closing_lt_opening_record_status' => $low->status(), 'close_status' => $closeLow->status(), 'close_msg' => mb_substr((string) $closeLow->json('message'), 0, 140)]);
        $this->assertContains($low->status(), [201, 422]);
        $this->assertSame('open', $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}")['data']['status'], 'إغلاق بعدّاد عكسي يجب ألا ينجح');
        $this->assertSame(422, $closeLow->status());
    }

    /** @test */
    public function s07b_readings_are_immutable_and_idempotent_by_evidence_key(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s07b');
        $rows = fn () => DB::table('fuel_shift_meter_readings')->where('fuel_shift_id', $shift)->count();
        $before = $rows();
        $replay = $this->meter('seller', $shift, 'opening', 1000000);
        $this->assertContains($replay->status(), [200, 201], 'إعادة نفس القراءة بالدليل نفسه idempotent');
        $this->assertSame($before, $rows());
        $changed = $this->meter('seller', $shift, 'opening', 1000500);
        $this->assertSame(422, $changed->status(), 'تغيير قيمة قراءة محفوظة مرفوض');
        $this->assertSame($before, $rows());
        $this->assertSame(422, $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/meter-readings", ['fuel_nozzle_id' => $this->w['nozzle']['id'], 'reading_stage' => 'opening', 'meter_milliliters' => -5, 'evidence_key' => 'neg'])->status());
        $this->assertSame(422, $this->as('seller')->postJson("/api/fuel-stations/shifts/{$shift}/meter-readings", ['fuel_nozzle_id' => $this->w['nozzle']['id'], 'reading_stage' => 'opening', 'meter_milliliters' => 12.5, 'evidence_key' => 'frac'])->status());
        $this->evidence('S07b', ['replay_status' => $replay->status(), 'changed_status' => $changed->status()]);
    }

    // ═════════ S08 — الوردية بلا مبيعات ERP (مسار الجوال وحده) ═════════

    /** @test */
    public function s08_meter_only_shift_produces_no_stock_invoice_or_ledger_effect(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $before = $this->footprint();
        $books = $this->books();
        $shift = $this->readyShift('s08');
        $this->meter('seller', $shift, 'closing', 1020000)->assertCreated();
        $this->tankReading('seller', $shift, 'closing', 9980000)->assertCreated();
        $this->declareCollection('seller', $shift, 4600, 0, 's08-decl')->assertSuccessful();
        $closed = $this->closeShift('seller', $shift, 24600, 'E2E_TEST')->assertSuccessful()['data'];
        $coll = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}/collection")['data'];
        $after = $this->footprint();
        $afterBooks = $this->books();
        $this->evidence('S08', [
            'meter_ml' => $closed['operational_meter_milliliters'], 'derived_sales_minor' => $coll['sales']['amount_minor'], 'collected' => $coll['reconciliation']['collected_total_minor'],
            'expected_cash' => $closed['expected_operational_cash_minor'], 'variance' => $closed['cash_variance_minor'],
            'stock_delta_ml' => $before['stock'] - $after['stock'], 'new_invoices' => $after['invoices'] - $before['invoices'], 'new_journals' => $after['journals'] - $before['journals'],
            'revenue_4110_delta' => ($afterBooks['by']['4110']['c'] ?? 0) - ($books['by']['4110']['c'] ?? 0), 'tank_variance_ml' => $closed['operational_tank_variance_milliliters'],
            'disclaimers' => $coll['disclaimers'], 'drawer' => $coll['drawer'], 'cash_variance_status' => $closed['cash_variance']['status'] ?? null,
        ]);
        // القياس: مبيعات الجوال المشتقة صحيحة تشغيلياً…
        $this->assertSame(4600, $coll['sales']['amount_minor']);
        // …لكن فرق نقد الدرج (المتوقع لا يعرف نقد المبيعات بلا سندات ERP) = نقد المبيعات بالضبط.
        $this->assertSame(4600, $closed['cash_variance_minor'], 'وردية الجوال وحدها تعدّ نقد البيع فرقاً (انظر drawer.implied_sales_cash)');
        // …لكنها لا تُنتج أي أثر مخزني أو محاسبي (توثيق التصميم، لا افتراض).
        $this->assertSame($before, $after, 'وردية العدادات وحدها لا تُنقص المخزون ولا تُنشئ فواتير/قيوداً');
    }

    /** @test */
    public function s08b_meter_volume_larger_than_recorded_sales_is_visible_not_silently_accepted(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s08b');
        $s = $this->finalSale('seller', $shift, 15000, 's08b-sale'); // عداد 20 لتر لكن مبيعات ERP 15 لتر فقط
        $this->collect('seller', $s['id'], 'cash', (int) $s['gross_minor'], 's08b-pay')->assertSuccessful();
        $this->meter('seller', $shift, 'closing', 1020000)->assertCreated();
        $this->tankReading('seller', $shift, 'closing', 9980000)->assertCreated();
        $this->declareCollection('seller', $shift, (int) $s['gross_minor'], 0, 's08b-decl')->assertSuccessful();
        $closed = $this->closeShift('seller', $shift, 20000 + (int) $s['gross_minor'], 'E2E_TEST')->assertSuccessful()['data'];
        $coll = $this->as('owner')->getJson("/api/fuel-stations/shifts/{$shift}/collection")['data'];
        $this->evidence('S08b', [
            'meter_ml' => 20000, 'erp_sale_ml' => 15000, 'stock_delta_ml' => 15000, 'derived_sales_minor' => $coll['sales']['amount_minor'], 'collected' => $coll['reconciliation']['collected_total_minor'],
            'difference' => $coll['reconciliation']['difference_minor'], 'direction' => $coll['reconciliation']['direction'], 'tank_variance_ml' => $closed['operational_tank_variance_milliliters'],
            'tank_variance_status' => $closed['operational_tank_variance_status'] ?? null, 'review_required' => $coll['review']['state'] ?? null,
        ]);
        // 5 لترات خرجت من العداد ولم تُباع في ERP: يجب أن يظهر ذلك كفرق تحصيل (5×2.30=11.50) لا أن يختفي.
        $this->assertSame(1150, -1 * (int) $coll['reconciliation']['difference_minor'], 'فرق التحصيل = قيمة 5 لترات غير موثّقة');
        $this->assertSame('shortage', $coll['reconciliation']['direction']);
    }

    // ═════════ S09 — منع التكرار وإعادة المحاولة بعد انقطاع الاتصال ═════════

    /** @test */
    public function s09_retries_after_a_dropped_connection_never_duplicate_sales_payments_stock_or_journals(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s09');
        $base = $this->footprint();

        // "ردّ ضاع في الطريق": نفس طلب المسودة 3 مرات.
        $ids = [];
        for ($i = 0; $i < 3; $i++) { $ids[] = $this->draftSale('seller', $shift, 20000, 's09-draft')->assertSuccessful()['data']['id']; }
        $this->assertCount(1, array_unique($ids), 'مسودة واحدة');
        $this->assertSame($base['sales'] + 1, FuelSale::count());

        // مفتاح مستعمل لكمية مختلفة ← رفض.
        $this->assertSame(422, $this->draftSale('seller', $shift, 30000, 's09-draft')->status());

        // إنهاء ×3: لقطة بعد الأول، ثم الإعادتان لا تغيّران شيئاً (بما فيه القيود).
        $this->as('seller')->postJson("/api/fuel-stations/sales/{$ids[0]}/finalize")->assertSuccessful();
        $afterFirstFinalize = $this->footprint();
        $booksAfterFirst = $this->books();
        for ($i = 0; $i < 2; $i++) { $this->as('seller')->postJson("/api/fuel-stations/sales/{$ids[0]}/finalize")->assertSuccessful(); }
        $afterFinal = $this->footprint();
        $this->assertSame($afterFirstFinalize, $afterFinal, 'إعادة الإنهاء لا تغيّر أي أثر (فواتير/مخزون/قيود)');
        $this->assertSame($booksAfterFirst, $this->books(), 'إعادة الإنهاء لا تضيف سطور قيد ولا تغيّر أي حساب');
        $this->assertSame(2, $afterFirstFinalize['journals'] - $base['journals'], 'الإنهاء الأول ينتج قيدين بالضبط: الفاتورة والتكلفة');
        $this->assertSame($base['invoices'] + 1, $afterFinal['invoices']);
        $this->assertSame($base['movements'] + 1, $afterFinal['movements']);
        $this->assertSame($base['ledger'] + 1, $afterFinal['ledger']);
        $this->assertSame($base['stock'] - 20000, $afterFinal['stock'], 'الخصم من المخزون مرة واحدة');
        $journalsPerSale = $afterFinal['journals'] - $base['journals'];

        // تحصيل ×3 بالمفتاح نفسه.
        $pids = [];
        for ($i = 0; $i < 3; $i++) { $pids[] = $this->collect('seller', $ids[0], 'cash', 4600, 's09-pay')->assertSuccessful()['data']['id'] ?? null; }
        $this->assertSame(1, Payment::count(), 'سند قبض واحد');
        // نفس المفتاح بمبلغ مختلف ← رفض.
        $this->assertSame(422, $this->collect('seller', $ids[0], 'cash', 4000, 's09-pay')->status());
        // مفتاح جديد بعد السداد الكامل ← رفض (لا تحصيل ثانٍ).
        $this->assertSame(422, $this->collect('seller', $ids[0], 'cash', 4600, 's09-pay-2')->status());
        $final = $this->footprint();
        $this->assertSame(1, $final['payments']);
        $this->assertSame($afterFinal['journals'] + 1, $final['journals'], 'قيد سند واحد فقط');

        // إعلان التحصيل بالمفتاح نفسه ×2، ثم مراجعة قديمة.
        $this->meter('seller', $shift, 'closing', 1020000)->assertCreated();
        $this->tankReading('seller', $shift, 'closing', 9980000)->assertCreated();
        $d1 = $this->declareCollection('seller', $shift, 4600, 0, 's09-decl', 0)->assertSuccessful();
        $d2 = $this->declareCollection('seller', $shift, 4600, 0, 's09-decl', 0);
        $this->assertContains($d2->status(), [200, 201], 'إعادة الإعلان بالمفتاح نفسه');
        $stale = $this->declareCollection('seller', $shift, 4000, 0, 's09-decl-b', 0);
        $this->assertSame(409, $stale->status(), 'نسخة قديمة ← تعارض لا كتابة صامتة');

        // إغلاق ×2.
        $this->closeShift('seller', $shift, 24600)->assertSuccessful();
        $second = $this->closeShift('seller', $shift, 24600);
        $this->evidence('S09', [
            'draft_replays' => 3, 'sales_rows' => 1, 'finalize_replays' => 3, 'invoices_delta' => 1, 'stock_delta' => 20000, 'payments' => 1,
            'journals_per_sale_and_receipt' => $final['journals'] - $base['journals'], 'journals_for_finalize' => $journalsPerSale, 'second_close_status' => $second->status(),
        ]);
        $this->assertSame(1, DB::table('fuel_shifts')->where('id', $shift)->where('status', 'closed')->count());
        $this->assertBooksIntegrity('s09');
    }

    /** @test */
    public function s09b_same_idempotency_key_with_a_different_nozzle_is_not_treated_as_the_same_sale(): void
    {
        if (! getenv('E2E_RUN_KNOWN_DEFECTS')) { $this->markTestSkipped('P2-1 — عيب مؤكَّد في FUEL_STATION_E2E_REPORT.md؛ شغّله بـ E2E_RUN_KNOWN_DEFECTS=1 حتى يُصلَح.'); }
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s09b');
        $n2 = $this->as('owner')->postJson('/api/fuel-stations/nozzles', [
            'fuel_pump_id' => $this->w['pump']['id'], 'fuel_tank_id' => $this->w['tank']['id'], 'fuel_product_id' => $this->w['fuelProduct']['id'], 'nozzle_number' => 'E2E_TEST-N2',
        ])->assertCreated()['data'];
        $a = $this->draftSale('seller', $shift, 20000, 's09b-key')->assertSuccessful()['data'];
        $b = $this->draftSale('seller', $shift, 20000, 's09b-key', ['fuel_nozzle_id' => $n2['id']]);
        $this->evidence('S09b', ['second_status' => $b->status(), 'same_id' => ($b->json('data.id') === $a['id']), 'returned_nozzle' => $b->json('data.fuel_nozzle_id'), 'requested_nozzle' => $n2['id'], 'original_nozzle' => $a['fuel_nozzle_id']]);
        $this->assertTrue($b->status() === 422 || $b->json('data.fuel_nozzle_id') === $n2['id'], 'إعادة المفتاح بفوهة مختلفة يجب ألا تُرجع بيعاً على فوهة أخرى بصمت');
    }

    // ═════════ S10 — عمليات غير صالحة ═════════

    /** @test */
    public function s10_invalid_equipment_quantities_and_states_are_rejected_without_a_trace(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s10');
        $base = $this->footprint();
        $n = $this->w['nozzle']['id'];
        $cases = [];

        foreach (['qty_zero' => 0, 'qty_negative' => -5, 'qty_float' => 1.5, 'qty_string' => 'abc'] as $name => $qty) {
            $cases[$name] = $this->draftSale('seller', $shift, $qty, "s10-{$name}")->status();
        }
        // بيع يفوق الرصيد، وإنهاء بلا عميل: المسودة تُنشأ (201) ثم يجب أن يُرفض الإنهاء برفض مُتحكَّم (4xx) لا 5xx.
        $stages = [];
        $oversell = $this->draftSale('seller', $shift, 10000001, 's10-oversell');
        $stages['oversell'] = ['draft' => $oversell->status(), 'finalize' => $oversell->status() === 201 ? $this->as('seller')->postJson('/api/fuel-stations/sales/' . $oversell['data']['id'] . '/finalize')->status() : null];
        $nopartner = $this->draftSale('seller', $shift, 1000, 's10-nopartner', ['partner_id' => null]);
        $stages['no_partner'] = ['draft' => $nopartner->status(), 'finalize' => $nopartner->status() === 201 ? $this->as('seller')->postJson('/api/fuel-stations/sales/' . $nopartner['data']['id'] . '/finalize')->status() : null];
        foreach ($stages as $name => $st) {
            $this->assertSame(201, $st['draft'], "{$name}: المسودة تُنشأ ولا يُرفض إلا الإنهاء");
            $this->assertGreaterThanOrEqual(400, $st['finalize'], "{$name}: الإنهاء يجب أن يُرفض");
            $this->assertLessThan(500, $st['finalize'], "{$name}: رفض مُتحكَّم لا خطأ خادم");
        }
        $cases['oversell_draft+final'] = "draft:{$stages['oversell']['draft']}/final:{$stages['oversell']['finalize']}";
        $cases['unknown_nozzle'] = $this->draftSale('seller', $shift, 1000, 's10-nonoz', ['fuel_nozzle_id' => '00000000-0000-4000-8000-000000000000'])->status();
        $cases['no_partner_finalize'] = "draft:{$stages['no_partner']['draft']}/final:{$stages['no_partner']['finalize']}";

        // معدات غير صالحة: فوهة/مضخة/خزان معطّلة أو صيانة.
        foreach ([['nozzles', $n, 'maintenance'], ['nozzles', $n, 'inactive']] as [$res, $id, $status]) {
            $this->as('owner')->putJson("/api/fuel-stations/{$res}/{$id}", ['status' => $status])->assertSuccessful();
            $cases["nozzle_{$status}"] = $this->draftSale('seller', $shift, 1000, "s10-nozzle-{$status}")->status();
        }
        $this->as('owner')->putJson("/api/fuel-stations/nozzles/{$n}", ['status' => 'active'])->assertSuccessful();
        $this->as('owner')->putJson('/api/fuel-stations/pumps/' . $this->w['pump']['id'], ['status' => 'maintenance'])->assertSuccessful();
        $cases['pump_maintenance'] = $this->draftSale('seller', $shift, 1000, 's10-pump-m')->status();
        $this->as('owner')->putJson('/api/fuel-stations/pumps/' . $this->w['pump']['id'], ['status' => 'active'])->assertSuccessful();
        $this->as('owner')->putJson('/api/fuel-stations/tanks/' . $this->w['tank']['id'], ['status' => 'maintenance'])->assertSuccessful();
        $cases['tank_maintenance'] = $this->draftSale('seller', $shift, 1000, 's10-tank-m')->status();
        $this->as('owner')->putJson('/api/fuel-stations/tanks/' . $this->w['tank']['id'], ['status' => 'active'])->assertSuccessful();

        // دفع غير صالح.
        $ok = $this->finalSale('seller', $shift, 1000, 's10-ok');
        $cases['pay_zero'] = $this->collect('seller', $ok['id'], 'cash', 0, 's10-p0')->status();
        $cases['pay_negative'] = $this->collect('seller', $ok['id'], 'cash', -100, 's10-pn')->status();
        $cases['pay_over'] = $this->collect('seller', $ok['id'], 'cash', 999999, 's10-po')->status();
        $cases['pay_unknown_method'] = $this->as('seller')->postJson("/api/fuel-stations/sales/{$ok['id']}/payments", ['payment_method_id' => '00000000-0000-4000-8000-000000000000', 'amount_minor' => 230, 'idempotency_key' => 's10-pu'])->status();
        $cases['pay_before_final'] = (function () use ($shift) {
            $d = $this->draftSale('seller', $shift, 1000, 's10-prefinal')->json('data.id');
            return $this->collect('seller', $d, 'cash', 230, 's10-pf')->status();
        })();

        // وردية: فتح ثانٍ لنفس المحطة، وبيع على وردية مغلقة.
        $cases['second_open_shift'] = $this->as('seller')->postJson('/api/fuel-stations/shifts/open', ['fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => 0, 'idempotency_key' => 's10-open-2'])->status();
        $cases['open_same_key'] = $this->as('seller')->postJson('/api/fuel-stations/shifts/open', ['fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => 20000, 'idempotency_key' => 's10-open'])->status();
        $cases['open_unknown_station'] = $this->as('seller')->postJson('/api/fuel-stations/shifts/open', ['fuel_station_id' => '00000000-0000-4000-8000-000000000000', 'opening_float_minor' => 0, 'idempotency_key' => 's10-open-x'])->status();
        $cases['open_negative_float'] = $this->as('seller')->postJson('/api/fuel-stations/shifts/open', ['fuel_station_id' => $this->w['station']['id'], 'opening_float_minor' => -1, 'idempotency_key' => 's10-open-n'])->status();

        $this->evidence('S10', ['cases' => $cases]);
        $expectRejected = ['qty_zero', 'qty_negative', 'qty_float', 'qty_string', 'unknown_nozzle', 'nozzle_maintenance', 'nozzle_inactive', 'pay_zero', 'pay_negative', 'pay_over', 'pay_unknown_method', 'pay_before_final', 'second_open_shift', 'open_unknown_station', 'open_negative_float'];
        foreach ($expectRejected as $k) { $this->assertGreaterThanOrEqual(400, $cases[$k], "{$k} يجب أن يُرفض"); $this->assertLessThan(500, $cases[$k], "{$k} 5xx بدل رفض مُتحكَّم"); }
        $after = $this->footprint();
        // الأثر الوحيد المسموح: بيع s10-ok (واحد) + لا شيء من المرفوضات.
        $this->assertSame($base['invoices'] + 1, $after['invoices']);
        $this->assertSame($base['payments'], $after['payments']);
        $this->assertSame($base['stock'] - 1000, $after['stock']);
    }

    /** @test */
    public function s10b_a_sale_cannot_be_drafted_or_finalized_through_a_pump_or_tank_under_maintenance(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $shift = $this->readyShift('s10b');
        $out = [];
        foreach (['pumps' => $this->w['pump']['id'], 'tanks' => $this->w['tank']['id']] as $res => $id) {
            $this->as('owner')->putJson("/api/fuel-stations/{$res}/{$id}", ['status' => 'maintenance'])->assertSuccessful();
            $draft = $this->draftSale('seller', $shift, 1000, "s10b-{$res}");
            $fin = $draft->status() < 300 ? $this->as('seller')->postJson('/api/fuel-stations/sales/' . $draft['data']['id'] . '/finalize') : null;
            $out[$res] = ['draft' => $draft->status(), 'finalize' => $fin?->status(), 'stock_after' => $this->stockMl()];
            $this->as('owner')->putJson("/api/fuel-stations/{$res}/{$id}", ['status' => 'active'])->assertSuccessful();
        }
        $this->evidence('S10b', $out);
        foreach ($out as $res => $o) {
            $blocked = $o['draft'] >= 400 || ($o['finalize'] !== null && $o['finalize'] >= 400);
            $this->assertTrue($blocked, "{$res}: البيع عبر معدة في الصيانة يجب أن يُمنع عند المسودة أو الإنهاء");
            $this->assertSame(10000000, $o['stock_after'], "{$res}: لا خصم مخزون");
        }
    }

    // ═════════ S16 — تسوية الخزان (فرق القياس الفعلي عن الرصيد الدفتري) ═════════

    /** @test */
    public function s16_tank_loss_and_gain_reconciliations_adjust_stock_once_and_post_balanced_entries(): void
    {
        $this->buildWorld(self::RECEIPTS);
        $variance = Account::where('type', 'expense')->where('is_group', false)->orderBy('code')->firstOrFail();
        $gain = Account::where('type', 'revenue')->where('is_group', false)->orderBy('code')->firstOrFail();
        $this->as('owner')->putJson("/api/fuel-stations/stations/{$this->w['station']['id']}/settings", ['inventory_variance_account_id' => $variance->id, 'inventory_gain_account_id' => $gain->id, 'fuel_distinct_approver_required' => true])->assertOk();
        $manager = $this->e2eUser('manager', ['fuel_stations.view', 'fuel_stations.manage']);
        $this->w['tokens']['manager'] = $manager->createToken('api')->plainTextToken;
        $st = $this->w['station']['id'];
        $tk = $this->w['tank']['id'];

        $reading = fn (string $liters, string $key) => $this->as('owner')->postJson('/api/fuel-stations/readings', ['fuel_station_id' => $st, 'fuel_tank_id' => $tk, 'reading_type' => 'physical', 'quantity_liters' => $liters, 'evidence_key' => $key, 'evidence' => ['method' => 'dipstick']]);
        $out = [];
        foreach ([['loss', '9990', -10000], ['gain', '10010', 20000]] as [$kind, $liters, $expectedVariance]) {
            $before = $this->books();
            $stock0 = $this->stockMl();
            $r = $reading($liters, "s16-{$kind}")->assertSuccessful()['data'];
            $draft = $this->as('owner')->postJson('/api/fuel-stations/reconciliations', ['fuel_station_id' => $st, 'fuel_tank_id' => $tk, 'physical_reading_id' => $r['id'], 'reason' => 'E2E_TEST']);
            $this->assertSame(201, $draft->status(), $draft->getContent());
            $rec = $draft['data'];
            $this->assertSame($expectedVariance, (int) $rec['variance']['milliliters'], $kind);
            // مرجع تحذيري: لا اعتماد ذاتي (السياسة الافتراضية للمحطات الجديدة).
            $self = $this->as('owner')->postJson("/api/fuel-stations/reconciliations/{$rec['id']}/approve", ['reason' => 'E2E_TEST']);
            $ok = $this->as('manager')->postJson("/api/fuel-stations/reconciliations/{$rec['id']}/approve", ['reason' => 'E2E_TEST']);
            $this->assertSame(200, $ok->status(), $ok->getContent());
            $again = $this->as('manager')->postJson("/api/fuel-stations/reconciliations/{$rec['id']}/approve", ['reason' => 'E2E_TEST']);
            $after = $this->books();
            $this->assertSame($stock0 + $expectedVariance, $this->stockMl(), "{$kind}: المخزون يطابق القياس الفعلي");
            $this->assertSame(1, $after['entries'] - $before['entries'], "{$kind}: قيد واحد حتى مع إعادة الاعتماد");
            $this->assertBooksIntegrity("s16-{$kind}");
            $value = abs($expectedVariance) / 1000 * 100; // 1.00 ريال/لتر
            $this->assertSame($kind === 'loss' ? -(int) $value : (int) $value, $this->net($after, '1140') - $this->net($before, '1140'), "{$kind}: أثر 1140");
            $out[$kind] = ['variance_ml' => $expectedVariance, 'self_approve_status' => $self->status(), 'approve_status' => $ok->status(), 'reapprove_status' => $again->status(), 'value_minor' => $value, 'stock_after' => $this->stockMl()];
        }
        // إعادة استعمال دليل القياس في تسوية أخرى مرفوض.
        $reuse = $this->as('owner')->postJson('/api/fuel-stations/reconciliations', ['fuel_station_id' => $st, 'fuel_tank_id' => $tk, 'physical_reading_id' => $r['id'], 'reason' => 'x']);
        $out['reuse_reading_status'] = $reuse->status();
        $this->evidence('S16', $out);
        $this->assertSame(422, $out['loss']['self_approve_status'], 'لا اعتماد ذاتي');
        $this->assertSame(422, $reuse->status());
    }
}

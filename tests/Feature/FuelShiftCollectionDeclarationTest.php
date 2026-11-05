<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCollectionDeclaration;
use App\Models\FuelShiftCollectionRevision;
use App\Models\FuelShiftEvent;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Services\FuelShiftCashExpectationService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelStationPaymentMethods;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * إقرار تحصيل الوردية: مبيعات العدادات × السعر الفعّال ↔ توزيع التحصيل حسب طرق الدفع.
 *
 * بيانات اصطناعية معزولة (مستأجرون اختباريون). الميزة تشغيلية فقط: كل اختبار يثبت أنها لا تُنشئ سنداً ولا فاتورة ولا قيداً
 * ولا إيصال بيع، وأن بوابة FUEL_SHIFT_CASH_RECEIPTS_ENABLED تبقى مغلقة ولا تتأثر. سعر الاختبار 230 هللة/لتر (توضيحي).
 */
class FuelShiftCollectionDeclarationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/shifts';
    private const PRICE = 230; // هللة/لتر

    protected function setUp(): void
    {
        parent::setUp();
        // الـfixture المشترك يخزّن أساس receiving_shift_receipts (يتطلب فتح بوابة D1 لحظة التهيئة فقط)؛ ثم تُغلق البوابة كما في الإنتاج:
        // الأساس الفعّال يبقى movements_only مهما خُزِّن، وهذه الميزة مستقلة عنه.
        config(['fuel_stations.shift_collection_declaration_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
    }

    // ───────── البوابة ─────────

    /** @test */
    public function the_gate_closed_hides_both_routes_and_leaves_close_untouched(): void
    {
        config(['fuel_stations.shift_collection_declaration_enabled' => false]);
        $shift = $this->open('g1');
        $token = $this->token('actor');

        $this->withToken($token)->getJson(self::BASE . "/{$shift->id}/collection")->assertNotFound();
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(0, 0), 'g1-k'))->assertNotFound();

        $closed = app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $this->assertSame('closed', $closed->status);
        $this->assertSame(0, FuelShiftCollectionDeclaration::count());
        $this->assertSame(0, FuelShiftEvent::whereIn('type', [FuelShiftEvent::TYPE_COLLECTION_DECLARED, FuelShiftEvent::TYPE_COLLECTION_FROZEN])->count());
    }

    /** @test */
    public function the_cash_receipts_deployment_gate_is_independent_and_stays_closed(): void
    {
        $this->assertFalse((bool) config('fuel_stations.shift_cash_receipts_enabled'));
        $shift = $this->open('g2');
        $this->saveCollection($shift, 0, $this->fullLines(0, 0), 'g2-k');
        $this->assertSame('movements_only', app(FuelShiftCashExpectationService::class)->effectiveBasis($this->f['station']));
    }

    // ───────── المبيعات من العدادات ─────────

    /** @test */
    public function sales_are_meter_delta_times_the_effective_price_with_product_breakdown(): void
    {
        $shift = $this->open('s1');
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 5_100_000); // 100 لتر

        $view = $this->collectionView($shift);

        $this->assertTrue($view['sales']['complete']);
        $this->assertSame(100_000, $view['sales']['milliliters']);
        $this->assertSame(100 * self::PRICE, $view['sales']['amount_minor']);
        $this->assertCount(1, $view['sales']['products']);
        $this->assertSame(self::PRICE, $view['sales']['products'][0]['price_per_liter_minor']);
        $this->assertSame(100 * self::PRICE, $view['sales']['products'][0]['amount_minor']);
        $this->assertSame([], $view['sales']['gaps']);
    }

    /** @test */
    public function a_missing_closing_reading_never_yields_a_trusted_amount(): void
    {
        $shift = $this->open('s2');
        $this->meter($shift, 'opening', 5_000_000);

        $sales = $this->collectionView($shift)['sales'];

        $this->assertFalse($sales['complete']);
        $this->assertNull($sales['amount_minor'], 'لا إجمالي جزئي مقدَّم كإجمالي.');
        $this->assertFalse($sales['milliliters_complete']);
        $this->assertContains('missing_reading', $sales['gaps']);
        $this->assertSame('missing_closing', $sales['nozzles'][0]['status']);
    }

    /** @test */
    public function an_abnormal_closing_below_opening_reading_is_excluded_and_flagged(): void
    {
        $shift = $this->open('s3');
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 4_000_000);

        $sales = $this->collectionView($shift)['sales'];

        $this->assertFalse($sales['complete']);
        $this->assertNull($sales['amount_minor']);
        $this->assertSame(0, $sales['milliliters'], 'القراءة الشاذة لا تدخل المجموع.');
        $this->assertContains('closing_below_opening', $sales['gaps']);
        $this->assertSame('closing_below_opening', $sales['nozzles'][0]['status']);
    }

    /** @test */
    public function a_price_that_started_during_the_shift_blocks_the_amount_instead_of_guessing(): void
    {
        $shift = $this->open('s4');
        // فترة السعر الفعّالة بدأت بعد فتح الوردية (سعر عُدِّل أثناءها): لا نوزّع اللترات بين سعرين بالتخمين.
        $shift->forceFill(['opened_at' => now()->subHour()])->saveQuietly();
        $this->meter($shift, 'opening', 5_000_000);
        $this->meter($shift, 'closing', 5_010_000);

        $sales = $this->collectionView($shift)['sales'];

        $this->assertFalse($sales['complete']);
        $this->assertNull($sales['amount_minor']);
        $this->assertContains('price_changed_during_shift', $sales['gaps']);
        $this->assertSame(10_000, $sales['milliliters'], 'اللترات تبقى معروضة؛ المبلغ وحده محجوب.');
    }

    // ───────── طرق الدفع ─────────

    /** @test */
    public function the_input_list_is_the_stations_current_allowed_methods_by_id_and_follows_settings_changes(): void
    {
        $shift = $this->open('m1');
        $ids = collect($this->collectionView($shift)['methods'])->pluck('id')->sort()->values()->all();
        $this->assertSame(collect([$this->f['cash']->id, $this->f['bank']->id])->sort()->values()->all(), $ids);

        // تعطيل طريقة من إعدادات المحطة تظهر في القراءة التالية بلا إنشاء أي طريقة جديدة.
        $before = PaymentMethod::count();
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['fuel_sales_allowed_payment_method_ids' => [$this->f['cash']->id]], $this->f['actor'], 'تعطيل الشبكة');
        $this->assertSame([$this->f['cash']->id], collect($this->collectionView($shift)['methods'])->pluck('id')->all());
        $this->assertSame($before, PaymentMethod::count());
    }

    /** @test */
    public function the_list_is_the_same_source_as_the_sale_collection_methods(): void
    {
        $this->assertSame(
            app(FuelStationPaymentMethods::class)->allowedFor($this->f['station'])->pluck('id')->all(),
            collect($this->collectionView($this->open('m2'))['methods'])->pluck('id')->all(),
        );
    }

    /** @test */
    public function a_disabled_or_unknown_method_is_rejected_and_a_missing_enabled_method_is_rejected(): void
    {
        $shift = $this->open('m3');

        $e = $this->rejects(fn () => $this->saveCollection($shift, 0, [
            ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 100],
            ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => 100],
            ['payment_method_id' => '00000000-0000-0000-0000-000000000000', 'amount_minor' => 1],
        ], 'm3-a'));
        $this->assertStringContainsString('FUEL_COLLECTION_METHOD_NOT_ALLOWED', $e->getMessage());

        $e = $this->rejects(fn () => $this->saveCollection($shift, 0, [['payment_method_id' => $this->f['cash']->id, 'amount_minor' => 100]], 'm3-b'));
        $this->assertStringContainsString('FUEL_COLLECTION_METHODS_CHANGED', $e->getMessage());

        // طريقة عُطِّلت من إعدادات المحطة بعد رسم الشاشة ⇒ مرفوض عند الحفظ.
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['fuel_sales_allowed_payment_method_ids' => [$this->f['cash']->id]], $this->f['actor'], 'تعطيل');
        $e = $this->rejects(fn () => $this->saveCollection($shift, 0, $this->fullLines(100, 100), 'm3-c'));
        $this->assertStringContainsString('FUEL_COLLECTION_METHOD_NOT_ALLOWED', $e->getMessage());
        $this->assertSame(0, FuelShiftCollectionDeclaration::count());
    }

    /** @test */
    public function invalid_amounts_and_duplicate_lines_are_rejected(): void
    {
        $shift = $this->open('m4');
        $cash = $this->f['cash']->id;
        $bank = $this->f['bank']->id;
        foreach ([
            [['payment_method_id' => $cash, 'amount_minor' => -1], ['payment_method_id' => $bank, 'amount_minor' => 0]],
            [['payment_method_id' => $cash, 'amount_minor' => 10.5], ['payment_method_id' => $bank, 'amount_minor' => 0]],
            [['payment_method_id' => $cash, 'amount_minor' => '10'], ['payment_method_id' => $bank, 'amount_minor' => 0]],
            [['payment_method_id' => $cash, 'amount_minor' => 1], ['payment_method_id' => $cash, 'amount_minor' => 2]],
        ] as $i => $lines) {
            $e = $this->rejects(fn () => $this->saveCollection($shift, 0, $lines, "m4-{$i}"));
            $this->assertStringContainsString('FUEL_COLLECTION_INVALID', $e->getMessage());
        }
        $this->assertSame(0, FuelShiftCollectionDeclaration::count());
    }

    // ───────── المطابقة ─────────

    /** @test */
    public function reconciliation_reports_none_overage_and_shortage_against_meter_sales(): void
    {
        $shift = $this->open('r1');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        $sales = 100 * self::PRICE; // 23000

        $v = $this->saveCollection($shift, 0, $this->fullLines($sales - 3000, 3000), 'r1-a')['view'];
        $this->assertSame(['visible' => true, 'final' => true, 'reason' => null, 'collected_total_minor' => $sales, 'sales_minor' => $sales, 'difference_minor' => 0, 'direction' => 'none'], $v['reconciliation']);

        $v = $this->saveCollection($shift, 1, $this->fullLines($sales - 3000 - 1000, 3000), 'r1-b')['view'];
        $this->assertSame(-1000, $v['reconciliation']['difference_minor']);
        $this->assertSame('shortage', $v['reconciliation']['direction']);

        $v = $this->saveCollection($shift, 2, $this->fullLines($sales + 500, 3000), 'r1-c')['view'];
        $this->assertSame(3500, $v['reconciliation']['difference_minor']);
        $this->assertSame('overage', $v['reconciliation']['direction']);
        $this->assertSame(3, $v['revision']);
    }

    /** @test */
    public function reconciliation_is_not_final_when_sales_are_incomplete(): void
    {
        $shift = $this->open('r2');
        $this->meter($shift, 'opening', 1_000_000);

        $v = $this->saveCollection($shift, 0, $this->fullLines(5000, 0), 'r2-a')['view'];

        $this->assertFalse($v['reconciliation']['final']);
        $this->assertNull($v['reconciliation']['difference_minor']);
        $this->assertNull($v['reconciliation']['direction']);
        $this->assertSame('sales_incomplete', $v['reconciliation']['reason']);
    }

    /** @test */
    public function credit_sales_and_unrecorded_settlements_are_excluded_and_disclosed(): void
    {
        $shift = $this->open('r3');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_001_000);
        $view = $this->saveCollection($shift, 0, $this->fullLines(0, 0), 'r3-a')['view'];
        $this->assertContains('credit_sales_excluded', $view['disclaimers']);
        $this->assertContains('unrecorded_settlements_excluded', $view['disclaimers']);
        $this->assertContains('operational_not_financial_proof', $view['disclaimers']);
    }

    // ───────── منع التكرار والتزامن ─────────

    /** @test */
    public function replaying_the_same_key_and_payload_does_not_create_a_second_revision(): void
    {
        $shift = $this->open('i1');
        $first = $this->saveCollection($shift, 0, $this->fullLines(100, 50), 'i1-k');
        $again = $this->saveCollection($shift, 0, $this->fullLines(100, 50), 'i1-k');

        $this->assertFalse($first['replayed']);
        $this->assertTrue($again['replayed']);
        $this->assertSame(1, FuelShiftCollectionRevision::count());
        $this->assertSame(1, FuelShiftCollectionDeclaration::sole()->revision);
        $this->assertSame(1, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_COLLECTION_DECLARED)->count());
    }

    /** @test */
    public function the_same_key_with_a_different_payload_is_a_409_conflict_with_no_effect(): void
    {
        $shift = $this->open('i2');
        $token = $this->token('actor');
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(100, 0), 'i2-k'))->assertCreated();

        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(1, $this->fullLines(999, 0), 'i2-k'))
            ->assertStatus(409)->assertJsonPath('reason', 'idempotency_conflict');
        $this->assertSame(100, FuelShiftCollectionDeclaration::sole()->collected_total_minor);
    }

    /** @test */
    public function a_stale_base_revision_is_a_409_and_an_identical_resave_makes_no_new_revision(): void
    {
        $shift = $this->open('i3');
        $token = $this->token('actor');
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(100, 0), 'i3-a'))->assertCreated();

        // جهاز آخر ما زال على النسخة 0.
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(200, 0), 'i3-b'))
            ->assertStatus(409)->assertJsonPath('reason', 'stale_revision')->assertJsonPath('current_revision', 1);

        // حمولة مطابقة للحالية بمفتاح جديد: لا نسخة جديدة.
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(1, $this->fullLines(100, 0), 'i3-c'))
            ->assertOk()->assertJsonPath('meta.unchanged', true);
        $this->assertSame(1, FuelShiftCollectionRevision::count());
    }

    /** @test */
    public function an_old_key_retried_after_a_newer_revision_does_not_revert_the_declaration(): void
    {
        $shift = $this->open('i4');
        $this->saveCollection($shift, 0, $this->fullLines(100, 0), 'i4-a');
        $this->saveCollection($shift, 1, $this->fullLines(300, 0), 'i4-b');

        $retry = $this->saveCollection($shift, 0, $this->fullLines(100, 0), 'i4-a'); // lost-response retry

        $this->assertTrue($retry['replayed']);
        $this->assertSame(300, FuelShiftCollectionDeclaration::sole()->collected_total_minor);
        $this->assertSame(2, FuelShiftCollectionRevision::count());
    }

    // ───────── التجميد والإغلاق ─────────

    /** @test */
    public function closing_freezes_the_declaration_with_the_drawer_snapshot_and_no_accounting_side_effects(): void
    {
        $shift = $this->open('c1', 20000);
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        $sales = 100 * self::PRICE;
        $this->saveCollection($shift, 0, $this->fullLines($sales - 3000, 3000), 'c1-a');
        app(FuelShiftService::class)->recordCashMovement($shift->fresh(), ['type' => 'cash_in', 'amount_minor' => 500, 'reason' => 'وارد غير مبيعات', 'idempotency_key' => 'c1-in'], $this->f['actor']);
        $this->handover($shift, 10000, 'c1-h');
        $before = ['je' => JournalEntry::count(), 'pay' => Payment::count(), 'rcpt' => FuelSalePaymentReceipt::count(), 'sales' => FuelSale::count()];

        // الدرج: عهدة 20000 + نقد مبيعات 20000 + وارد 500 − تسليم 10000 = 30500
        $closed = app(FuelShiftService::class)->close($shift->fresh(), 30500, null, $this->f['actor']);

        $d = FuelShiftCollectionDeclaration::sole();
        $this->assertSame('frozen', $d->status);
        $this->assertNotNull($d->frozen_at);
        $this->assertSame(20000, $d->opening_float_minor);
        $this->assertSame(30500, $d->counted_cash_minor);
        $this->assertSame(10000, $d->treasury_handover_minor);
        $this->assertSame(500, $d->cash_in_minor);
        // نقد المبيعات المستنتج من الدرج = 30500 − 20000 − 500 + 10000 + 0 = 20000 = نقد مُقَرّ به ⇒ فرق التقاطع صفر.
        $this->assertSame(20000, $d->drawer_implied_sales_cash_minor);
        $this->assertSame(0, $d->cash_cross_difference_minor);
        $this->assertSame(0, $d->difference_minor);
        $this->assertSame('closed', $closed->status);
        $this->assertSame($before, ['je' => JournalEntry::count(), 'pay' => Payment::count(), 'rcpt' => FuelSalePaymentReceipt::count(), 'sales' => FuelSale::count()]);
        $this->assertSame(1, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_COLLECTION_FROZEN)->count());

        // مجمَّد: لا حفظ بعد الإغلاق ولا تعديل مباشر.
        $e = $this->rejects(fn () => $this->saveCollection($shift->fresh(), 1, $this->fullLines(1, 1), 'c1-late'));
        $this->assertStringContainsString('الشفت ليس مفتوحاً', $e->getMessage());
        $this->assertThrows(fn () => $d->forceFill(['collected_total_minor' => 1])->save(), \LogicException::class);

        $view = app(FuelShiftCollectionService::class)->view($shift->fresh(), $this->f['actor']);
        $this->assertSame('frozen', $view['state']);
        $this->assertTrue($view['drawer']['frozen']);
        $this->assertSame([], $view['methods']);
    }

    /** @test */
    public function a_declaration_saved_while_the_gate_was_open_is_still_frozen_if_the_gate_closes_before_the_shift_does(): void
    {
        $shift = $this->open('c3');
        $this->saveCollection($shift, 0, $this->fullLines(100, 0), 'c3-a');
        config(['fuel_stations.shift_collection_declaration_enabled' => false]);

        app(FuelShiftService::class)->close($shift->fresh(), self::FLOAT, null, $this->f['actor']);

        $this->assertSame('frozen', FuelShiftCollectionDeclaration::sole()->status);
    }

    /** @test */
    public function closing_without_a_declaration_is_unchanged_and_creates_nothing(): void
    {
        $shift = $this->open('c2');
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $this->assertSame(0, FuelShiftCollectionDeclaration::count());
        $this->assertSame(0, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_COLLECTION_FROZEN)->count());
    }

    // ───────── الصلاحيات والعزل ─────────

    /** @test */
    public function a_seller_without_sale_view_sees_liters_but_no_prices_amounts_or_difference_and_events_are_redacted(): void
    {
        $shift = $this->open('p1');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        $token = $this->token('seller');
        $this->withToken($token)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(20000, 3000), 'p1-k'))->assertCreated();

        $response = $this->withToken($token)->getJson(self::BASE . "/{$shift->id}/collection")->assertOk();
        $response->assertJsonPath('data.sales.visible', false)
            ->assertJsonPath('data.sales.milliliters', 100_000)
            ->assertJsonPath('data.sales.amount_minor', null)
            ->assertJsonPath('data.sales.products.0.price_per_liter_minor', null)
            ->assertJsonPath('data.reconciliation.visible', false)
            ->assertJsonPath('data.declaration.collected_total_minor', 23000);
        $this->assertArrayNotHasKey('price_per_liter_minor', $response->json('data.sales.products.0'));

        $events = collect($this->withToken($token)->getJson(self::BASE . "/{$shift->id}")->assertOk()->json('data.events'))->where('type', 'collection_declared');
        $this->assertCount(1, $events);
        $payload = $events->first()['payload'];
        $this->assertArrayNotHasKey('sales_minor', $payload);
        $this->assertArrayNotHasKey('difference_minor', $payload);
        $this->assertSame(23000, $payload['collected_total_minor']);

        // المالك (يملك fuel.sale.view عبر *) يرى المطابقة.
        $this->withToken($this->token('actor'))->getJson(self::BASE . "/{$shift->id}/collection")->assertOk()
            ->assertJsonPath('data.reconciliation.difference_minor', 0)->assertJsonPath('data.sales.amount_minor', 23000);
    }

    /** @test */
    public function saving_requires_cash_count_and_other_tenants_get_404(): void
    {
        $shift = $this->open('p2');
        $supervisor = $this->token('supervisor'); // fuel.shift.view + approve فقط
        $this->withToken($supervisor)->getJson(self::BASE . "/{$shift->id}/collection")->assertOk();
        $this->withToken($supervisor)->postJson(self::BASE . "/{$shift->id}/collection", $this->payload(0, $this->fullLines(1, 1), 'p2-k'))->assertForbidden();

        // مستخدم مستأجر آخر لا يصل أبداً (403 لانعدام التصريح/الاشتراك أو 404 للعزل — لا 200).
        $foreign = $this->f['foreign_supervisor']->createToken('t')->plainTextToken;
        $this->assertContains($this->withToken($foreign)->getJson(self::BASE . "/{$shift->id}/collection")->status(), [403, 404]);
        $this->assertSame(0, FuelShiftCollectionDeclaration::count());
    }

    // ───────── أدوات ─────────

    private function token(string $who): string
    {
        return $this->f[$who]->createToken('t')->plainTextToken;
    }

    /** @return array<int,array{payment_method_id:string,amount_minor:int}> */
    private function fullLines(int $cash, int $bank): array
    {
        return [
            ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash],
            ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bank],
        ];
    }

    /** @return array<string,mixed> */
    private function payload(int $base, array $lines, string $key): array
    {
        return ['idempotency_key' => $key, 'base_revision' => $base, 'lines' => $lines];
    }

    /** @return array{view:array<string,mixed>,replayed:bool,unchanged:bool} */
    private function saveCollection(FuelShift $shift, int $base, array $lines, string $key): array
    {
        return app(FuelShiftCollectionService::class)->declare($shift->fresh(), $this->payload($base, $lines, $key), $this->f['actor']);
    }

    /** @return array<string,mixed> */
    private function collectionView(FuelShift $shift): array
    {
        return app(FuelShiftCollectionService::class)->view($shift->fresh(), $this->f['actor']);
    }

    private function meter(FuelShift $shift, string $stage, int $ml): void
    {
        app(FuelShiftService::class)->recordMeter($shift->fresh(), [
            'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}",
        ], $this->f['actor']);
    }
}

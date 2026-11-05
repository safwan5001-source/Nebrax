<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCashMovement;
use App\Models\FuelShiftCashVariance;
use App\Models\FuelShiftEvent;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\PaymentReversalService;
use App\Services\CorporateFuelContractService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use Carbon\CarbonImmutable;
use App\Services\FuelCostBasisService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftCashExpectationService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * #2021 — قرارات المالك D1 (التصنيف بوردية الاستلام) وD2 (تجميد الصورة والأثر اللاحق) وD5 (التسليم للخزنة).
 *
 * بيانات اصطناعية معزولة بالكامل (مستأجرون اختباريون على قاعدة اختبار)؛ لا بيانات محطات حقيقية ولا عمليات إنتاجية.
 * الأمثلة العددية توضيحية: عهدة + نقد مبيعات محصَّل − تسليم = متوقع، والمعدود يطابقه ⇒ فرق صفر بلا احتساب مزدوج.
 */
class FuelShiftCashReconciliationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
    }

    // ───────────────────────── D1 ─────────────────────────

    /** @test */
    public function the_gate_closed_keeps_the_legacy_contract_byte_for_byte(): void
    {
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $this->setBasis('movements_only');
        $shift = $this->open('legacy');
        $sale = $this->sale('legacy-sale', $shift);

        $this->collect($sale, 'cash', null, 'legacy-pay');

        $receipt = FuelSalePaymentReceipt::sole();
        $this->assertNull($receipt->fuel_shift_id, 'بوابة مغلقة: لا ختم.');
        $this->assertNull($receipt->settlement_type);
        $event = FuelShiftEvent::where('type', FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED)->sole();
        $this->assertTrue($event->payload['comparison_only'], 'الحدث القديم للمقارنة فقط.');

        $closed = app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $this->assertSame(self::FLOAT, (int) $closed->expected_operational_cash_minor, 'المتوقع القديم لا يشمل نقد المبيعات.');
        $this->assertSame(0, (int) $closed->cash_variance_minor);
        $variance = FuelShiftCashVariance::sole();
        $this->assertSame('movements_only', $variance->official_cash_basis);
        $this->assertNull($variance->documented_official_cash_receipts_minor);
    }

    /** @test */
    public function the_setting_cannot_be_turned_on_while_the_deployment_gate_is_closed(): void
    {
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $error = $this->rejects(fn () => app(FuelStationSettingsService::class)->putStationValues(
            $this->f['station'], ['shift_expected_cash_basis' => 'receiving_shift_receipts'], $this->f['actor'], 'محاولة',
        ));
        $this->assertNotNull($error);
        $this->assertStringContainsString('غير مفعّل', $error->getMessage());
        // مهما كان المخزَّن، الأساس الفعّال والبوابة مغلقة هو movements_only.
        $this->assertSame('movements_only', app(FuelShiftCashExpectationService::class)->effectiveBasis($this->f['station']));
    }

    /** @test */
    public function the_example_float_plus_sales_cash_minus_handover_expects_exactly_and_closes_with_zero_variance(): void
    {
        $shift = $this->open('ex');
        $sale = $this->sale('ex-sale', $shift);
        $total = (int) $sale->invoice->total;
        $this->collect($sale, 'cash', null, 'ex-pay');
        $handover = 10000;
        $this->handover($shift, $handover, 'ex-h1');

        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertTrue($summary['expected_complete']);
        $this->assertSame(self::FLOAT + $total - $handover, $summary['expected_cash_minor']);
        $this->assertSame($total, $summary['components']['official_cash_receipts']['amount_minor']);
        $this->assertSame($handover, $summary['components']['treasury_handover_minor']);
        $this->assertSame($handover, $summary['components']['cash_out_minor'], 'التسليم جزء من الصادر لا يُطرح مرتين.');

        $closed = app(FuelShiftService::class)->close($shift, self::FLOAT + $total - $handover, null, $this->f['actor']);
        $this->assertSame(0, (int) $closed->cash_variance_minor);
        $variance = FuelShiftCashVariance::sole();
        $this->assertSame('not_required', $variance->status);
        $this->assertTrue($variance->expectation_complete);
        $this->assertSame($total, (int) $variance->documented_official_cash_receipts_minor);
    }

    /** @test */
    public function a_payment_is_counted_exactly_once_even_when_the_same_key_is_replayed(): void
    {
        $shift = $this->open('once');
        $sale = $this->sale('once-sale', $shift);
        $total = (int) $sale->invoice->total;

        $first = $this->collect($sale, 'cash', null, 'once-pay');
        $again = $this->collect($sale->fresh(), 'cash', $total, 'once-pay');

        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, Payment::count());
        $this->assertSame(1, FuelSalePaymentReceipt::count());
        $this->assertSame(1, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED)->count());
        $live = app(FuelShiftCashExpectationService::class)->live($shift->fresh(), 'receiving_shift_receipts');
        $this->assertSame($total, $live['receipts']);
        $this->assertSame(self::FLOAT + $total, $live['expected']);
    }

    /** @test */
    public function a_cash_receipt_belongs_to_the_shift_that_received_it_not_the_shift_of_the_sale(): void
    {
        $shift1 = $this->open('later-1');
        $sale = $this->sale('later-sale', $shift1);
        $total = (int) $sale->invoice->total;
        app(FuelShiftService::class)->close($shift1, self::FLOAT, null, $this->f['actor']);
        $frozen1 = FuelShiftCashVariance::where('fuel_shift_id', $shift1->id)->sole();

        $shift2 = $this->open('later-2', 5000);
        $this->collect($sale->fresh(), 'cash', null, 'later-pay');

        $receipt = FuelSalePaymentReceipt::sole();
        $this->assertSame($shift2->id, $receipt->fuel_shift_id);
        $this->assertSame('cash', $receipt->settlement_type);
        $this->assertSame($total, (int) $receipt->amount_minor);
        $this->assertSame($this->f['actor']->id, $receipt->received_by_user_id);
        $this->assertNotNull($receipt->cash_account_id);
        $event = FuelShiftEvent::where('type', FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED)->sole();
        $this->assertSame($shift2->id, $event->fuel_shift_id);
        $this->assertFalse($event->payload['comparison_only']);
        $this->assertSame($shift1->id, $event->payload['sale_shift_id']);

        $this->assertSame(5000 + $total, app(FuelShiftCashExpectationService::class)->live($shift2->fresh(), 'receiving_shift_receipts')['expected']);
        // الوردية السابقة المغلقة لم تتأثر بالتحصيل اللاحق.
        $this->assertEquals($frozen1->only(['expected_operational_cash_minor', 'variance_minor', 'status']), FuelShiftCashVariance::where('fuel_shift_id', $shift1->id)->sole()->only(['expected_operational_cash_minor', 'variance_minor', 'status']));
        $this->assertSame(0, (int) FuelShiftCashVariance::where('fuel_shift_id', $shift1->id)->sole()->documented_official_cash_receipts_minor);
    }

    /** @test */
    public function cash_collection_without_an_open_shift_is_blocked_with_no_partial_effect(): void
    {
        $shift = $this->open('blocked');
        $sale = $this->sale('blocked-sale', $shift);
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $before = ['payments' => Payment::count(), 'journal' => JournalEntry::count(), 'receipts' => FuelSalePaymentReceipt::count(), 'events' => FuelShiftEvent::count()];

        $error = $this->rejects(fn () => $this->collect($sale->fresh(), 'cash', null, 'blocked-pay'));

        $this->assertNotNull($error);
        $this->assertStringContainsString('FUEL_CASH_RECEIPT_NO_OPEN_SHIFT', $error->getMessage());
        $this->assertSame($before, ['payments' => Payment::count(), 'journal' => JournalEntry::count(), 'receipts' => FuelSalePaymentReceipt::count(), 'events' => FuelShiftEvent::count()]);
        $this->assertSame(FuelSale::PAYMENT_UNPAID, $sale->fresh()->payment_status);
    }

    /** @test */
    public function card_and_network_receipts_are_shown_for_information_and_never_enter_expected_cash(): void
    {
        $shift = $this->open('net');
        $sale = $this->sale('net-sale', $shift);
        $total = (int) $sale->invoice->total;
        $this->collect($sale, 'bank', null, 'net-pay');

        $receipt = FuelSalePaymentReceipt::sole();
        $this->assertSame('bank', $receipt->settlement_type);
        $this->assertSame($shift->id, $receipt->fuel_shift_id);
        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame($total, $summary['network_receipts']['amount_minor']);
        $this->assertTrue($summary['network_receipts']['information_only']);
        $this->assertSame(self::FLOAT, $summary['expected_cash_minor'], 'الشبكة لا تدخل النقد.');
        $this->assertSame(0, $summary['components']['official_cash_receipts']['amount_minor']);
        $this->assertCount(0, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED)->get(), 'لا حدث نقد لتحصيل بنكي.');
    }

    /** @test */
    public function a_bank_receipt_without_an_open_shift_is_accepted_unstamped(): void
    {
        $shift = $this->open('net2');
        $sale = $this->sale('net2-sale', $shift);
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);

        $this->collect($sale->fresh(), 'bank', null, 'net2-pay');

        $this->assertNull(FuelSalePaymentReceipt::sole()->fuel_shift_id);
        $this->assertSame(1, Payment::count());
    }

    /** @test */
    public function split_payments_count_each_actual_collection_in_the_shift_that_received_it(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['fuel_sales_allow_deferred_payment' => true], $this->f['actor'], 'سداد جزئي');
        $shift1 = $this->open('split-1');
        $sale = $this->sale('split-sale', $shift1);
        $total = (int) $sale->invoice->total;
        $part1 = 100;
        $this->collect($sale, 'cash', $part1, 'split-p1');
        app(FuelShiftService::class)->close($shift1, self::FLOAT + $part1, null, $this->f['actor']);
        $shift2 = $this->open('split-2', 0);
        $this->collect($sale->fresh(), 'cash', $total - $part1, 'split-p2');

        $live1 = app(FuelShiftCashExpectationService::class)->summary($shift1->fresh(), $this->f['actor']);
        $this->assertSame($part1, $live1['components']['official_cash_receipts']['amount_minor']);
        $this->assertSame(0, $live1['variance_minor']);
        $this->assertSame($total - $part1, app(FuelShiftCashExpectationService::class)->live($shift2->fresh(), 'receiving_shift_receipts')['receipts']);
        $this->assertSame(2, FuelSalePaymentReceipt::count());
    }

    /** @test */
    public function a_corporate_contract_sale_cannot_be_collected_in_cash_into_the_drawer_until_d4_is_decided(): void
    {
        $shift = $this->open('corp');
        $sale = $this->corporateSale('corp-sale', $shift);
        $before = ['payments' => Payment::count(), 'receipts' => FuelSalePaymentReceipt::count()];

        $error = $this->rejects(fn () => $this->collect($sale, 'cash', null, 'corp-pay'));

        $this->assertNotNull($error);
        $this->assertStringContainsString('FUEL_CASH_CORPORATE_SETTLEMENT_UNDECIDED', $error->getMessage());
        $this->assertSame($before, ['payments' => Payment::count(), 'receipts' => FuelSalePaymentReceipt::count()]);
    }

    /** @test */
    public function receipts_recorded_before_the_basis_was_enabled_are_never_attributed_and_make_the_expectation_incomplete(): void
    {
        $this->setBasis('movements_only');
        $shift = $this->open('legacyrec');
        $sale = $this->sale('legacyrec-sale', $shift);
        // تحصيل قبل التفعيل: أساس movements_only ⇒ الإيصال بلا ختم (سلوك قديم).
        $this->collect($sale, 'cash', null, 'legacyrec-pay');
        $this->assertNull(FuelSalePaymentReceipt::sole()->fuel_shift_id);

        $this->setBasis('receiving_shift_receipts');
        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);

        $this->assertFalse($summary['expected_complete']);
        $this->assertNull($summary['expected_cash_minor']);
        $this->assertContains('unattributed_cash_receipts', $summary['incompleteness']);
        $this->assertSame(1, $summary['unattributed_cash_receipts']['count']);
        $this->assertSame(self::FLOAT, $summary['expected_cash_partial_minor'], 'لا نسبة تلقائية: الإيصال غير المنسوب لا يدخل.');

        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $variance = FuelShiftCashVariance::sole();
        $this->assertFalse($variance->expectation_complete);
        $this->assertSame(['unattributed_cash_receipts'], $variance->incompleteness);
        $closedSummary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertFalse($closedSummary['variance_final'], 'فرق غير نهائي عند نقص المتوقع.');
    }

    /** @test */
    public function two_cash_accounts_in_one_shift_make_the_expectation_incomplete_instead_of_guessing(): void
    {
        $shift = $this->open('twoacc');
        $this->collect($this->sale('twoacc-s1', $shift), 'cash', null, 'twoacc-p1');
        $this->collect($this->sale('twoacc-s2', $shift), 'cash', null, 'twoacc-p2');
        // محاكاة صندوق ثانٍ بتجاوز النموذج (الإيصال لا يعدّل عبر Eloquent).
        DB::table('fuel_sale_payment_receipts')->orderBy('id')->limit(1)->update(['cash_account_id' => (string) \Illuminate\Support\Str::uuid()]);

        $live = app(FuelShiftCashExpectationService::class)->live($shift->fresh(), 'receiving_shift_receipts');

        $this->assertFalse($live['complete']);
        $this->assertContains('multiple_cash_accounts', $live['gaps']);
    }

    // ───────────────────────── D2 ─────────────────────────

    /** @test */
    public function close_freezes_the_picture_and_later_activity_never_changes_it(): void
    {
        $shift = $this->open('freeze');
        $sale = $this->sale('freeze-sale', $shift);
        $total = (int) $sale->invoice->total;
        $this->collect($sale, 'cash', null, 'freeze-pay');
        app(FuelShiftService::class)->close($shift, self::FLOAT, 'نقص مقصود', $this->f['actor']);

        $svc = app(FuelShiftCashExpectationService::class);
        $before = $svc->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame('frozen', $before['state']);
        $this->assertSame(self::FLOAT + $total, $before['expected_cash_minor']);
        $this->assertSame(-$total, $before['variance_minor']);

        // نشاط لاحق: وردية جديدة + تحصيل + حركات — لا يغيّر لقطة الأولى.
        $shift2 = $this->open('freeze-2', 0);
        $this->collect($this->sale('freeze-sale-2', $shift2), 'cash', null, 'freeze-pay-2');
        $after = $svc->summary($shift->fresh(), $this->f['actor']);
        $this->assertEquals($before, $after);
        $this->assertSame('pending_review', FuelShiftCashVariance::where('fuel_shift_id', $shift->id)->sole()->status);
    }

    /** @test */
    public function reversing_a_stamped_payment_after_close_records_an_audit_event_without_touching_the_frozen_variance(): void
    {
        $shift = $this->open('rev');
        $sale = $this->sale('rev-sale', $shift);
        $total = (int) $sale->invoice->total;
        $payment = $this->collect($sale, 'cash', null, 'rev-pay');
        app(FuelShiftService::class)->close($shift, self::FLOAT + $total, null, $this->f['actor']);
        $before = FuelShiftCashVariance::sole()->only(['expected_operational_cash_minor', 'counted_cash_minor', 'variance_minor', 'status', 'documented_official_cash_receipts_minor']);
        $entries = JournalEntry::count();

        app(PaymentReversalService::class)->reverse($payment);

        $this->assertEquals($before, FuelShiftCashVariance::sole()->only(array_keys($before)), 'الفرق المجمَّد لا يتغير بصمت.');
        $this->assertSame('closed', $shift->fresh()->status);
        $event = FuelShiftEvent::where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)->sole();
        $this->assertSame($payment->id, $event->payload['payment_id']);
        $this->assertSame($total, $event->payload['amount_minor']);
        $this->assertSame(0, $event->payload['frozen_variance_minor']);
        $this->assertSame($entries + 1, JournalEntry::count(), 'العكس نفسه قيد عكسي واحد؛ الحدث لا يضيف قيوداً.');
        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame(0, $summary['variance_minor']);
        $this->assertSame([['payment_id' => $payment->id, 'amount_minor' => $total]], array_map(fn ($i) => ['payment_id' => $i['payment_id'], 'amount_minor' => $i['amount_minor']], $summary['post_close_adjustments']['items']));
        $this->assertSame(-$total, $summary['post_close_adjustments']['net_effect_minor']);

        // عكس ثانٍ مرفوض أصلاً؛ ولا حدث مكرر.
        $this->assertNotNull($this->rejects(fn () => app(PaymentReversalService::class)->reverse($payment->fresh())));
        $this->assertSame(1, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)->count());
    }

    /** @test */
    public function reversing_a_stamped_payment_before_close_is_excluded_live_and_leaves_no_adjustment_event(): void
    {
        $shift = $this->open('revopen');
        $sale = $this->sale('revopen-sale', $shift);
        $payment = $this->collect($sale, 'cash', null, 'revopen-pay');

        app(PaymentReversalService::class)->reverse($payment);

        $live = app(FuelShiftCashExpectationService::class)->live($shift->fresh(), 'receiving_shift_receipts');
        $this->assertSame(0, $live['receipts']);
        $this->assertSame(0, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)->count());
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $this->assertSame(0, (int) FuelShiftCashVariance::sole()->variance_minor);
    }

    /** @test */
    public function closing_twice_is_rejected_and_keeps_the_first_snapshot(): void
    {
        $shift = $this->open('twice');
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $first = FuelShiftCashVariance::sole()->only(['counted_cash_minor', 'expected_operational_cash_minor']);

        $this->assertNotNull($this->rejects(fn () => app(FuelShiftService::class)->close($shift->fresh(), 1, null, $this->f['actor'])));

        $this->assertSame(1, FuelShiftCashVariance::count());
        $this->assertEquals($first, FuelShiftCashVariance::sole()->only(array_keys($first)));
    }

    /** @test */
    public function a_cash_receipt_can_never_be_stamped_to_a_closed_shift(): void
    {
        $shift = $this->open('noclosed');
        $sale = $this->sale('noclosed-sale', $shift);
        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);

        // لا وردية مفتوحة ⇒ رفض (BLOCKED) لا ختم بالمغلقة.
        $this->assertNotNull($this->rejects(fn () => $this->collect($sale->fresh(), 'cash', null, 'noclosed-pay')));
        $this->assertSame(0, FuelSalePaymentReceipt::whereNotNull('fuel_shift_id')->count());
    }

    // ───────────────────────── D5 ─────────────────────────

    /** @test */
    public function a_treasury_handover_deducts_from_expected_cash_and_creates_no_accounting_entry(): void
    {
        $shift = $this->open('h5');
        $sale = $this->sale('h5-sale', $shift);
        $total = (int) $sale->invoice->total;
        $this->collect($sale, 'cash', null, 'h5-pay');
        $entries = JournalEntry::count();
        $payments = Payment::count();

        $movement = $this->handover($shift, 15000, 'h5-1');

        $this->assertSame('treasury_handover', $movement->purpose);
        $this->assertSame($this->f['supervisor']->id, $movement->received_by_user_id);
        $this->assertSame('RCPT-1', $movement->evidence['proof_reference']);
        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame($payments, Payment::count());
        $this->assertSame(self::FLOAT + $total - 15000, app(FuelShiftCashExpectationService::class)->live($shift->fresh(), 'receiving_shift_receipts')['expected']);
    }

    /** @test */
    public function a_handover_is_limited_to_the_available_cash_including_confirmed_sales_cash_only(): void
    {
        $shift = $this->open('lim');
        $sale = $this->sale('lim-sale', $shift);
        $total = (int) $sale->invoice->total;
        $available = self::FLOAT;
        // قبل التحصيل: المتاح = العهدة فقط.
        $this->assertNotNull($this->rejects(fn () => $this->handover($shift, $available + 1, 'lim-over-1')));
        $this->collect($sale, 'cash', null, 'lim-pay');
        // بعد التحصيل المؤكَّد: المتاح يشمله.
        $this->handover($shift, $available + $total, 'lim-all');
        $this->assertNotNull($this->rejects(fn () => $this->handover($shift, 1, 'lim-over-2')));
        $this->assertSame(1, FuelShiftCashMovement::count());
    }

    /** @test */
    public function a_bank_receipt_does_not_increase_the_cash_available_for_handover(): void
    {
        $shift = $this->open('limbank');
        $sale = $this->sale('limbank-sale', $shift);
        $this->collect($sale, 'bank', null, 'limbank-pay');

        $this->assertNotNull($this->rejects(fn () => $this->handover($shift, self::FLOAT + 1, 'limbank-over')));
    }

    /** @test */
    public function handover_receiver_and_proof_are_enforced(): void
    {
        $shift = $this->open('hrcv');
        $f = $this->f;
        $cases = [
            'self' => ['received_by_user_id' => $f['actor']->id],
            'no authority' => ['received_by_user_id' => $f['seller']->id],
            'unknown' => ['received_by_user_id' => (string) \Illuminate\Support\Str::uuid()],
            'other tenant' => ['received_by_user_id' => $f['foreign_supervisor']->id],
            'inactive' => ['received_by_user_id' => $f['inactive_supervisor']->id],
            'no receiver' => ['received_by_user_id' => null],
            'no proof' => ['evidence' => ['proof_reference' => '  ']],
            'not cash_out' => ['type' => 'cash_in'],
            'receiver without purpose' => ['purpose' => null],
        ];
        foreach ($cases as $name => $override) {
            $payload = $override + $this->handoverPayload($shift, 100, 'hrcv-' . md5($name));
            $this->assertNotNull($this->rejects(fn () => app(FuelShiftService::class)->recordCashMovement($shift->fresh(), $payload, $f['actor'])), $name);
        }
        $this->assertSame(0, FuelShiftCashMovement::count());
        // المشرف الصحيح يُقبل.
        $this->assertNotNull($this->handover($shift, 100, 'hrcv-ok'));
    }

    /** @test */
    public function a_handover_replay_returns_the_first_effect_and_a_changed_payload_is_rejected(): void
    {
        $shift = $this->open('hidem');
        $first = $this->handover($shift, 1000, 'hidem-1');
        $again = $this->handover($shift, 1000, 'hidem-1');
        $this->assertSame($first->id, $again->id);
        $this->assertSame(1, FuelShiftCashMovement::count());

        $this->assertNotNull($this->rejects(fn () => $this->handover($shift, 2000, 'hidem-1')));
        $this->assertSame(1, FuelShiftCashMovement::count());
        $this->assertSame(1000, (int) FuelShiftCashMovement::sole()->amount_minor);
    }

    /** @test */
    public function the_scope_of_the_collecting_actor_is_enforced_server_side_under_the_gate(): void
    {
        $shift = $this->open('scope');
        $sale = $this->sale('scope-sale', $shift);
        $other = Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-OTHER', 'branch_id' => $this->f['branch']->id]);
        $this->f['seller']->warehouses()->attach($other->id);

        $error = $this->rejects(fn () => app(FuelSaleService::class)->collectPayment($sale, [
            'payment_method_id' => $this->f['cash']->id, 'amount_minor' => (int) $sale->invoice->total, 'idempotency_key' => 'scope-pay',
        ], $this->f['seller']->fresh()));

        $this->assertNotNull($error);
        $this->assertSame(0, Payment::count());
    }

    // ───────────────────────── صلاحيات العرض / لا أثر محاسبي ─────────────────────────

    /** @test */
    public function sales_derived_components_are_unavailable_without_sales_view_and_no_number_is_invented(): void
    {
        $shift = $this->open('perm');
        $this->collect($this->sale('perm-sale', $shift), 'cash', null, 'perm-pay');

        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['seller']);

        $this->assertFalse($summary['components']['official_cash_receipts']['available']);
        $this->assertNull($summary['components']['official_cash_receipts']['amount_minor']);
        $this->assertSame('permission', $summary['components']['official_cash_receipts']['reason']);
        $this->assertNull($summary['expected_cash_minor']);
        $this->assertSame(self::FLOAT, $summary['expected_cash_partial_minor'], 'المجموع الجزئي لا يكشف نقد المبيعات المحجوب بالطرح.');
        $this->assertContains('permission_sales_view', $summary['incompleteness']);
        $this->assertFalse($summary['network_receipts']['available']);
        $this->assertNull($summary['unattributed_cash_receipts']);
    }

    /** @test */
    public function legacy_basis_never_presents_a_partial_expected_as_a_complete_total(): void
    {
        $this->setBasis('movements_only');
        $shift = $this->open('legsum');

        $summary = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);

        $this->assertNull($summary['expected_cash_minor']);
        $this->assertSame(self::FLOAT, $summary['expected_cash_partial_minor']);
        $this->assertSame(['sales_cash_not_included'], $summary['incompleteness']);
        $this->assertSame('basis_not_enabled', $summary['components']['official_cash_receipts']['reason']);
    }

    /** @test */
    public function network_receipts_are_unavailable_not_zero_when_stamping_is_disabled(): void
    {
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $shift = $this->open('netoff');
        $sale = $this->sale('netoff-sale', $shift);
        $this->collect($sale, 'bank', null, 'netoff-pay');

        $live = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertFalse($live['network_receipts']['available']);
        $this->assertNull($live['network_receipts']['amount_minor']);
        $this->assertSame('basis_not_enabled', $live['network_receipts']['reason']);

        app(FuelShiftService::class)->close($shift, self::FLOAT, null, $this->f['actor']);
        $closed = app(FuelShiftCashExpectationService::class)->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame($live['network_receipts'], $closed['network_receipts'], 'الحيّ والمجمَّد يتفقان: غير متاح.');
    }

    /** @test */
    public function close_and_handover_and_stamping_never_post_new_ledger_entries(): void
    {
        $shift = $this->open('noled');
        $sale = $this->sale('noled-sale', $shift);
        $this->collect($sale, 'cash', null, 'noled-pay');
        $entries = JournalEntry::count();
        $payments = Payment::count();

        $this->handover($shift, 500, 'noled-h');
        app(FuelShiftService::class)->close($shift, 1, null, $this->f['actor']);

        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame($payments, Payment::count());
    }

    /** @test */
    public function with_the_gate_open_a_viewer_without_sales_view_gets_neither_the_legacy_totals_nor_the_sales_cash(): void
    {
        $shift = $this->open('d8');
        $sale = $this->sale('d8-sale', $shift);
        $total = (int) $sale->invoice->total;
        $this->collect($sale, 'cash', null, 'd8-pay');
        app(FuelShiftService::class)->close($shift, self::FLOAT + $total, null, $this->f['actor']);
        $token = $this->f['seller']->createToken('api')->plainTextToken;

        $response = $this->withToken($token)->getJson('/api/fuel-stations/shifts/' . $shift->id)->assertOk();

        $response->assertJsonPath('data.expected_operational_cash_minor', null)
            ->assertJsonPath('data.cash_variance_minor', null)
            ->assertJsonPath('data.cash_summary.components.official_cash_receipts.available', false)
            ->assertJsonPath('data.cash_summary.expected_cash_minor', null)
            ->assertJsonPath('data.cash_summary.expected_cash_partial_minor', self::FLOAT)
            // المعدود − الفرق = المتوقع الكامل؛ فيُخفى الفرق أيضاً (المعدود يبقى لأنه إدخال العارض نفسه).
            ->assertJsonPath('data.cash_summary.variance_minor', null)
            ->assertJsonPath('data.cash_variance.variance_minor', null);
    }

    /** @test */
    public function the_post_close_adjustment_event_is_hidden_from_a_viewer_without_sales_view(): void
    {
        $shift = $this->open('d8ev');
        $sale = $this->sale('d8ev-sale', $shift);
        $total = (int) $sale->invoice->total;
        $payment = $this->collect($sale, 'cash', null, 'd8ev-pay');
        app(FuelShiftService::class)->close($shift, self::FLOAT + $total, null, $this->f['actor']);
        app(PaymentReversalService::class)->reverse($payment);
        $this->assertSame(1, FuelShiftEvent::where('type', FuelShiftEvent::TYPE_POST_CLOSE_CASH_ADJUSTMENT)->count());

        $seller = $this->withToken($this->f['seller']->createToken('api')->plainTextToken)->getJson('/api/fuel-stations/shifts/' . $shift->id)->assertOk();
        $types = array_column($seller->json('data.events'), 'type');
        $this->assertNotContains('post_close_cash_adjustment', $types);
        $this->assertNotContains('official_cash_payment_recorded', $types);
        $this->assertStringNotContainsString('frozen_expected_cash_minor', (string) $seller->getContent());
        $this->assertStringNotContainsString($payment->id, (string) $seller->getContent());

        $owner = $this->withToken($this->f['actor']->createToken('api')->plainTextToken)->getJson('/api/fuel-stations/shifts/' . $shift->id)->assertOk();
        $this->assertContains('post_close_cash_adjustment', array_column($owner->json('data.events'), 'type'));
    }

    /** @test */
    public function the_show_endpoint_exposes_the_summary_and_the_cash_movement_route_accepts_a_handover(): void
    {
        $shift = $this->open('api');
        $token = $this->f['actor']->createToken('api')->plainTextToken;
        $base = '/api/fuel-stations/shifts/' . $shift->id;

        $this->withToken($token)->postJson($base . '/cash-movements', $this->handoverPayload($shift, 700, 'api-h1'))
            ->assertCreated()->assertJsonPath('data.cash_summary.components.treasury_handover_minor', 700);
        $this->withToken($token)->getJson($base)->assertOk()
            ->assertJsonPath('data.cash_summary.state', 'live')
            ->assertJsonPath('data.cash_summary.basis', 'receiving_shift_receipts')
            ->assertJsonPath('data.cash_summary.expected_cash_minor', self::FLOAT - 700)
            ->assertJsonPath('data.cash_summary.expected_complete', true);
        // purpose غير معروف ⇒ 422 من التحقق.
        $this->withToken($token)->postJson($base . '/cash-movements', ['purpose' => 'other'] + $this->handoverPayload($shift, 5, 'api-h2'))->assertStatus(422);
    }
}

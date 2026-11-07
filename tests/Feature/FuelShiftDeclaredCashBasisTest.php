<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftCashVariance;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Services\FuelShiftCashExpectationService;
use App\Services\FuelShiftCollectionService;
use App\Services\FuelShiftService;
use App\Services\FuelStationSettingsService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * P1-2 — أساس النقد المتوقع `declared_collection`: النقد المُقَرّ به في إقرار التحصيل هو المصدر الوحيد لنقد المبيعات في E،
 * فيصير فرق الدرج V = المعدود − (عهدة + مُقَرّ به + وارد − صادر − مصروف) فرقاً حقيقياً (لا نقد المبيعات نفسه).
 *
 * يثبت: V=0 للوردية السليمة دون مراجعة، عجز/زيادة حقيقيان يظهران ويستوجبان المراجعة، استقلال مطابقة العدادات عن مطابقة الدرج، منع
 * الاحتساب المزدوج مع إيصالات R، الافتراضي القديم محفوظ، البوابة المغلقة تعيد السلوك القديم، حجب الأرقام عمّن لا يرى المبيعات، وأن
 * شيئاً من ذلك لا يكتب قيداً ولا سنداً ولا مخزوناً. بيانات اصطناعية معزولة؛ سعر الاختبار 230 هللة/لتر.
 */
class FuelShiftDeclaredCashBasisTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const PRICE = 230;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_collection_declaration_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        // البوابة المغلقة للإيصالات كما في الإنتاج؛ الأساس المخزَّن يُبدَّل إلى declared_collection خلف بوابة الإقرار وحدها.
        config(['fuel_stations.shift_cash_receipts_enabled' => false]);
        $this->setBasis('declared_collection');
    }

    private function expectation(): FuelShiftCashExpectationService
    {
        return app(FuelShiftCashExpectationService::class);
    }

    /** وردية مبيعات عداداتها 23000 (100 لتر) وإقرارها نقد $cash + شبكة 23000−$cash. */
    private function declaredShift(string $key, int $cash, ?int $bank = null): FuelShift
    {
        $shift = $this->open($key);
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_100_000);
        $this->declare($shift, $cash, $bank ?? 23000 - $cash, $key . '-d');

        return $shift;
    }

    private ?\App\Models\User $approver = null;

    private function approver(): \App\Models\User
    {
        return $this->approver ??= $this->roleUser($this->f['tenant_id'], 'declared-approver', 'approver@declared-basis.test', ['fuel.shift.view', 'fuel.shift.approve']);
    }

    /** @return array<string,int> */
    private function ledgerCounts(): array
    {
        return ['je' => JournalEntry::count(), 'pay' => Payment::count(), 'rcpt' => FuelSalePaymentReceipt::count(), 'sales' => FuelSale::count()];
    }

    // ───────── السلوك الجديد ─────────

    /** @test */
    public function a_sound_cash_shift_has_zero_variance_and_needs_no_review_under_the_declared_basis(): void
    {
        $shift = $this->declaredShift('a1', 20000);
        $before = $this->ledgerCounts();
        $this->assertSame(FuelShiftCashExpectationService::BASIS_DECLARED_COLLECTION, $this->expectation()->effectiveBasis($this->f['station']));

        // الدرج: عهدة 20000 + نقد مبيعات مُقَرّ به 20000 = 40000.
        app(FuelShiftService::class)->close($shift->fresh(), 40000, null, $this->f['actor']);

        $cv = FuelShiftCashVariance::sole();
        $this->assertSame('declared_collection', $cv->official_cash_basis);
        $this->assertSame(40000, $cv->expected_operational_cash_minor);
        $this->assertSame(0, $cv->variance_minor);
        $this->assertSame('not_required', $cv->status);
        $this->assertSame(20000, $cv->documented_declared_cash_minor);
        $this->assertNull($cv->documented_official_cash_receipts_minor, 'R لا يدخل لقطة هذا الأساس');
        $this->assertTrue($cv->expectation_complete);

        // لا مراجعة مطلوبة: الاعتماد ينجح مباشرة (الفرق صفر في الدرج والتحصيل).
        app(FuelShiftService::class)->approve($shift->fresh(), null, $this->approver());
        $this->assertSame('approved', $shift->fresh()->status);
        $this->assertSame($before, $this->ledgerCounts(), 'لا قيد ولا سند ولا إيصال ولا بيع');
    }

    /** @test */
    public function a_real_cash_shortage_and_overage_are_visible_and_require_supervisor_review(): void
    {
        foreach ([['s1', 38500, -1500, 'shortage'], ['o1', 40700, 700, 'overage']] as [$key, $counted, $variance, $direction]) {
            $shift = $this->declaredShift($key, 20000);
            app(FuelShiftService::class)->close($shift->fresh(), $counted, 'ملاحظة', $this->f['actor']);

            $cv = FuelShiftCashVariance::where('fuel_shift_id', $shift->id)->sole();
            $this->assertSame($variance, $cv->variance_minor);
            $this->assertSame($direction, $cv->variance_direction);
            $this->assertSame('pending_review', $cv->status);

            $e = $this->rejects(fn () => app(FuelShiftService::class)->approve($shift->fresh(), null, $this->approver()));
            $this->assertStringContainsString('FUEL_CASH_VARIANCE_REVIEW_REQUIRED', $e->getMessage());
        }
    }

    /** @test */
    public function meter_reconciliation_and_drawer_reconciliation_stay_independent(): void
    {
        // البائع يُقِرّ بأقل من مبيعات العدادات (نقد 15000 + شبكة 3000 = 18000 مقابل 23000) ويسلّم درجاً مطابقاً لإقراره:
        // فرق الدرج صفر، لكن فرق التحصيل −5000 يبقى ظاهراً ويستوجب مراجعته — الضابطان مستقلان ولا يُخفي أحدهما الآخر.
        $shift = $this->declaredShift('i1', 15000, 3000);
        app(FuelShiftService::class)->close($shift->fresh(), 35000, 'إقرار أقل من العدادات', $this->f['actor']);

        $cv = FuelShiftCashVariance::sole();
        $this->assertSame(0, $cv->variance_minor);
        $this->assertSame('not_required', $cv->status);

        $declaration = \App\Models\FuelShiftCollectionDeclaration::sole();
        $this->assertSame(-5000, $declaration->difference_minor);
        $this->assertTrue($declaration->review_required);
        // الهوية: فرق التقاطع = −V.
        $this->assertSame(-$cv->variance_minor, $declaration->cash_cross_difference_minor);

        $e = $this->rejects(fn () => app(FuelShiftService::class)->approve($shift->fresh(), null, $this->approver()));
        $this->assertStringContainsString('FUEL_COLLECTION_REVIEW_REQUIRED', $e->getMessage());
    }

    /** @test */
    public function receipts_are_never_added_on_top_of_the_declared_cash(): void
    {
        // بيع ERP نقدي مختوم بالوردية تحت أساس الإيصالات، ثم يُعتمد أساس الإقرار: E يستعمل D وحده (D يشمل R أصلاً).
        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->setBasis('receiving_shift_receipts');
        $shift = $this->open('d1');
        $sale = $this->sale('d1-sale', $shift);
        $payment = $this->collect($sale, 'cash', null, 'd1-pay');
        $receipts = (int) $payment->amount;
        $this->assertGreaterThan(0, $receipts);
        $this->assertSame(20000 + $receipts, $this->expectation()->live($shift->fresh(), 'receiving_shift_receipts')['expected']);

        $this->setBasis('declared_collection');
        $this->meter($shift, 'opening', 1_000_000);
        $this->meter($shift, 'closing', 1_001_000);
        $this->declare($shift, $receipts + 500, 0, 'd1-decl'); // الإقرار يشمل نقد ERP + نقداً آخر غير ERP

        $live = $this->expectation()->live($shift->fresh(), 'declared_collection');
        $this->assertSame($receipts + 500, $live['declared_cash']);
        $this->assertSame($receipts, $live['receipts']);
        $this->assertSame(20000 + $receipts + 500, $live['expected'], 'لا O + D + R');
        $this->assertSame([], $live['gaps']);
        $this->assertTrue($live['complete']);

        // إقرار نقد أقل من الإيصالات المسجَّلة = تصريح متناقض ⇒ المتوقع غير مكتمل بثغرة صريحة.
        $this->declare($shift, max(0, $receipts - 1), 0, 'd1-decl2', 1);
        $low = $this->expectation()->live($shift->fresh(), 'declared_collection');
        $this->assertSame([FuelShiftCashExpectationService::GAP_DECLARED_BELOW_RECEIPTS], $low['gaps']);
        $this->assertFalse($low['complete']);
    }

    /** @test */
    public function without_a_declaration_the_expected_cash_is_incomplete_and_excludes_sales_cash(): void
    {
        $shift = $this->open('m1');
        $live = $this->expectation()->live($shift->fresh(), 'declared_collection');
        $this->assertSame(20000, $live['expected']);
        $this->assertSame([FuelShiftCashExpectationService::GAP_DECLARATION_MISSING], $live['gaps']);
        $this->assertFalse($live['complete']);
        $summary = $this->expectation()->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame('not_declared', $summary['components']['declared_cash']['reason']);
        $this->assertNull($summary['expected_cash_minor']);
    }

    /** @test */
    public function the_declared_cash_may_be_handed_over_to_the_treasury_but_not_more(): void
    {
        $shift = $this->declaredShift('h1', 20000);
        // المتاح = 20000 عهدة + 20000 مُقَرّ به = 40000.
        $this->handover($shift, 40000, 'h1-ok');
        $e = $this->rejects(fn () => $this->handover($shift, 1, 'h1-over'));
        $this->assertStringContainsString('يتجاوز', $e->getMessage());
    }

    // ───────── الإغلاق والحماية ─────────

    /** @test */
    public function the_default_basis_is_unchanged_and_still_reports_sales_cash_as_a_provisional_difference(): void
    {
        $this->setBasis('movements_only');
        $shift = $this->declaredShift('u1', 20000);
        app(FuelShiftService::class)->close($shift->fresh(), 40000, null, $this->f['actor']);

        $cv = FuelShiftCashVariance::sole();
        $this->assertSame('movements_only', $cv->official_cash_basis);
        $this->assertSame(20000, $cv->expected_operational_cash_minor);
        $this->assertSame(20000, $cv->variance_minor, 'السلوك الافتراضي القديم: الفرق = نقد المبيعات (يحميه الافتراض)');
        $this->assertNull($cv->documented_declared_cash_minor);
        $this->assertFalse($cv->expectation_complete);
    }

    /** @test */
    public function the_basis_needs_the_collection_gate_and_falls_back_when_it_closes(): void
    {
        config(['fuel_stations.shift_collection_declaration_enabled' => false]);
        $this->assertSame(FuelShiftCashExpectationService::BASIS_MOVEMENTS_ONLY, $this->expectation()->effectiveBasis($this->f['station']), 'مخزَّن لكن البوابة مغلقة ⇒ الأساس القديم');
        $e = $this->rejects(fn () => $this->setBasis('declared_collection'));
        $this->assertStringContainsString('إقرار تحصيل الوردية غير مفعّل', $e->getMessage());

        config(['fuel_stations.shift_collection_declaration_enabled' => true]);
        $this->assertSame(FuelShiftCashExpectationService::BASIS_DECLARED_COLLECTION, $this->expectation()->effectiveBasis($this->f['station']));
        $this->assertSame('declared_collection', app(FuelStationSettingsService::class)->forStation($this->f['station'])['shift_expected_cash_basis']);
    }

    /** @test */
    public function a_viewer_without_sale_view_never_sees_the_declared_cash_expected_total_or_variance(): void
    {
        $shift = $this->declaredShift('p1', 20000);
        app(FuelShiftService::class)->close($shift->fresh(), 38500, 'ملاحظة', $this->f['actor']);
        $blind = $this->roleUser($this->f['tenant_id'], 'declared-blind', 'blind@declared-basis.test', ['fuel.shift.view']);

        $summary = $this->expectation()->summary($shift->fresh(), $blind);
        $this->assertFalse($summary['components']['declared_cash']['available']);
        $this->assertNull($summary['components']['declared_cash']['amount_minor']);
        $this->assertSame('permission', $summary['components']['declared_cash']['reason']);
        $this->assertNull($summary['expected_cash_minor']);
        $this->assertNull($summary['variance_minor']);
        $this->assertContains(FuelShiftCashExpectationService::GAP_PERMISSION_SALES_VIEW, $summary['incompleteness']);
        // الجزئي المعروض لا يتضمن المُقَرّ به: لا يمكن استنتاجه بالطرح.
        $this->assertSame(20000, $summary['expected_cash_partial_minor']);

        $seen = $this->expectation()->summary($shift->fresh(), $this->f['actor']);
        $this->assertSame(20000, $seen['components']['declared_cash']['amount_minor']);
        $this->assertSame(40000, $seen['expected_cash_minor']);
        $this->assertSame(-1500, $seen['variance_minor']);
        $this->assertTrue($seen['variance_final']);
    }

    // ───────── مساعدات ─────────

    /** @param int $base نسخة الأساس (0 للإقرار الأول). */
    private function declare(FuelShift $shift, int $cash, int $bank, string $key, int $base = 0): void
    {
        app(FuelShiftCollectionService::class)->declare($shift->fresh(), [
            'idempotency_key' => $key, 'base_revision' => $base,
            'lines' => [
                ['payment_method_id' => $this->f['cash']->id, 'amount_minor' => $cash],
                ['payment_method_id' => $this->f['bank']->id, 'amount_minor' => $bank],
            ],
        ], $this->f['actor']);
    }

    private function meter(FuelShift $shift, string $stage, int $ml): void
    {
        app(FuelShiftService::class)->recordMeter($shift->fresh(), [
            'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "m-{$shift->id}-{$stage}",
        ], $this->f['actor']);
    }
}

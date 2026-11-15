<?php

namespace Tests\Feature;

use App\Models\FuelSale;
use App\Models\FuelShift;
use App\Models\FuelShiftMeterVarianceReview;
use App\Models\FuelShiftNozzleReconciliation;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerOwner;
use App\Models\Partner;
use App\Models\User;
use App\Services\FuelShiftService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR8 — مطابقة قراءات الفوهات عند إغلاق الوردية ومراجعة فروق العدّادات.
 *
 * M = D + T + U: فرق العدّاد = مبيعات مباشرة نهائية + سندات تعبئة صهاريج مسجَّلة + غير مفسَّر. **تشغيلية بحتة**: لا قيد ولا حركة مخزون ولا فاتورة ولا تحصيل.
 * بيانات اصطناعية معزولة (نموذج `BuildsFuelCashFixture`).
 */
class FuelShiftMeterReconciliationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/shifts';

    private FuelTankerOwner $owner;
    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.shift_meter_reconciliation_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        // PR8-S: المطابقة اشتراك اختياري (الافتراضي معطَّل) فوق بوابة النشر؛ هذا الاختبار يفعّلها للمؤسسة صراحةً.
        app(FuelStationSettingsService::class)->putTenant(['shift_meter_reconciliation_enabled' => true], $this->f['actor'], 'اختبار');
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK-' . uniqid(), 'status' => 'active']);
        $this->travel(3)->seconds();
    }

    // ───────── أدوات ─────────

    private function meters(FuelShift $shift, int $opening = 1_000_000, ?int $closing = 1_020_000): void
    {
        foreach (['opening' => $opening, 'closing' => $closing] as $stage => $ml) {
            if ($ml === null) {
                continue;
            }
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mr-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
    }

    private function directSale(FuelShift $shift, int $ml): FuelSale
    {
        $service = app(\App\Services\FuelSaleService::class);

        return $service->finalize($service->createDraft([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'partner_id' => $this->f['customer']->id, 'quantity_milliliters' => $ml, 'idempotency_key' => 'ds-' . ++$this->seq . '-' . $shift->id,
        ], $this->f['actor']), $this->f['actor']);
    }

    private function tankerFill(FuelShift $shift, int $ml): FuelTankerFill
    {
        $result = app(FuelTankerFillService::class)->record([
            'fuel_station_id' => $this->f['station']->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_shift_id' => $shift->id,
            'fuel_tanker_owner_id' => $this->owner->id, 'voucher_number' => 'V-' . ++$this->seq, 'quantity_milliliters' => $ml,
            'idempotency_key' => 'tf-' . $this->seq . '-' . $shift->id,
        ], $this->f['actor']);

        return $result['fill'] ?? $result[0];
    }

    private function close(FuelShift $shift): FuelShift
    {
        return app(FuelShiftService::class)->close($shift->fresh(), 20000, null, $this->f['actor']);
    }

    private function approve(FuelShift $shift): FuelShift
    {
        return app(FuelShiftService::class)->approve($shift->fresh(), null, $this->f['actor']);
    }

    private function snapshot(FuelShift $shift): FuelShiftNozzleReconciliation
    {
        return FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id)->sole();
    }

    private function token(User $user): string
    {
        return $user->createToken('api')->plainTextToken;
    }

    private function review(FuelShift $shift, string $classification, ?string $note = null, ?string $token = null)
    {
        return $this->withToken($token ?? $this->token($this->f['actor']))->postJson(self::BASE . "/{$shift->id}/meter-reconciliation/review", array_filter([
            'nozzle_id' => $this->f['nozzle']->id, 'classification' => $classification, 'note' => $note,
        ], fn ($v) => $v !== null));
    }

    /** @return array<string,int> */
    private function accountingCounts(): array
    {
        return collect(['invoices', 'journal_entries', 'journal_lines', 'payments', 'stock_movements', 'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'fuel_shift_settlements'])
            ->mapWithKeys(fn (string $t) => [$t => DB::table($t)->count()])->all();
    }

    // ───────── المطابقة ─────────

    /** @test */
    public function a_balanced_shift_freezes_one_snapshot_with_direct_and_tanker_liters_separated(): void
    {
        $shift = $this->open('bal');
        $this->meters($shift);                       // M = 20 L
        $this->directSale($shift, 12_000);           // D
        $this->tankerFill($shift, 8_000);            // T
        $before = $this->accountingCounts();
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(20_000, $row->metered_milliliters);
        $this->assertSame(12_000, $row->direct_sale_milliliters);
        $this->assertSame(8_000, $row->tanker_fill_milliliters);
        $this->assertSame(1, $row->tanker_fill_count);
        $this->assertSame(0, $row->unexplained_milliliters);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_BALANCED, $row->status);
        $this->assertFalse($row->requiresReview());
        // الإغلاق لا يضيف أثراً محاسبياً/مخزنياً بسبب المطابقة (الأرقام تتغيّر بحركات الإغلاق القائمة فقط).
        $this->assertSame($before['stock_movements'], $this->accountingCounts()['stock_movements']);
        $this->assertSame($before['fuel_inventory_cost_movements'], $this->accountingCounts()['fuel_inventory_cost_movements']);

        // اعتماد بلا مراجعة (لا فروق).
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function a_tanker_fill_is_never_a_sale_no_invoice_payment_or_ledger_entry(): void
    {
        $shift = $this->open('nosale');
        $this->meters($shift);
        $before = $this->accountingCounts();
        $this->tankerFill($shift, 20_000);
        $this->assertSame($before, $this->accountingCounts());
        $this->close($shift);
        $this->assertSame(0, FuelSale::where('fuel_shift_id', $shift->id)->count());
        $this->assertSame('pending_integration', FuelTankerFill::where('fuel_shift_id', $shift->id)->sole()->inventory_status);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_BALANCED, $this->snapshot($shift)->status);
    }

    /** @test */
    public function unrecorded_liters_create_a_variance_that_blocks_approval_until_classified_by_a_reviewer(): void
    {
        $shift = $this->open('var');
        $this->meters($shift);
        $this->directSale($shift, 5_000);
        $this->tankerFill($shift, 5_000);            // U = 10 L غير مفسَّرة
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(10_000, $row->unexplained_milliliters);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_VARIANCE, $row->status);

        $error = $this->rejects(fn () => $this->approve($shift));
        $this->assertStringContainsString('FUEL_METER_VARIANCE_REVIEW_REQUIRED', $error->getMessage());
        $this->assertSame(FuelShift::STATUS_CLOSED, $shift->fresh()->status);

        $response = $this->review($shift, FuelShiftMeterVarianceReview::UNRECORDED_DIRECT_SALE, 'بيع لم يُسجَّل');
        $response->assertOk();
        $this->assertTrue($response->json('data.summary.review_complete'));
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
        // التصنيف وصفي: لا أثر مالي.
        $this->assertSame(0, DB::table('invoices')->where('notes', 'like', '%تصنيف%')->count());
    }

    /** @test */
    public function over_recorded_entries_are_a_negative_variance_with_their_own_classifications(): void
    {
        $shift = $this->open('over');
        $this->meters($shift);
        $this->directSale($shift, 15_000);
        $this->tankerFill($shift, 10_000);           // 25 > 20 ⇒ U = −5 L
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(-5_000, $row->unexplained_milliliters);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_VARIANCE, $row->status);
        // تصنيف «غير مسجَّل» لا يناسب فرقاً سالباً.
        $this->review($shift, FuelShiftMeterVarianceReview::UNRECORDED_TANKER_FILL)->assertStatus(422);
        $this->review($shift, FuelShiftMeterVarianceReview::OVER_RECORDED_ENTRY)->assertOk();
    }

    /** @test */
    public function a_difference_inside_the_configured_tolerance_needs_no_review(): void
    {
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_meter_tolerance_milliliters' => 1000], $this->f['actor'], 'تفاوت');
        $shift = $this->open('tol');
        $this->meters($shift);
        $this->directSale($shift, 19_500);           // U = 500 ≤ 1000
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_WITHIN_TOLERANCE, $row->status);
        $this->assertSame(1000, $row->tolerance_milliliters);
        $this->approve($shift);
        $this->assertSame(FuelShift::STATUS_APPROVED, $shift->fresh()->status);
    }

    /** @test */
    public function a_voided_fill_is_not_counted(): void
    {
        $shift = $this->open('void');
        $this->meters($shift);
        $this->directSale($shift, 20_000);
        $fill = $this->tankerFill($shift, 3_000);
        app(FuelTankerFillService::class)->void($fill->fresh(), 'خطأ إدخال', $this->f['actor']);
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(0, $row->tanker_fill_milliliters);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_BALANCED, $row->status);
    }

    /** @test */
    public function a_missing_closing_reading_is_incomplete_and_needs_a_reading_error_or_other_review(): void
    {
        $shift = $this->open('inc');
        $this->meters($shift, 1_000_000, null);      // افتتاحية فقط
        $this->tankerFill($shift, 4_000);
        $this->close($shift);

        $row = $this->snapshot($shift);
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_INCOMPLETE, $row->status);
        $this->assertNull($row->metered_milliliters);
        $this->assertNull($row->unexplained_milliliters);
        $this->assertSame(FuelShiftNozzleReconciliation::INCOMPLETE_MISSING_READING, $row->incompleteness);
        $this->assertSame(4_000, $row->tanker_fill_milliliters);
        $this->review($shift, FuelShiftMeterVarianceReview::LOSS_OR_LEAK)->assertStatus(422);
        $this->review($shift, FuelShiftMeterVarianceReview::READING_ERROR)->assertOk();
    }

    // ───────── المراجعة ─────────

    /** @test */
    public function a_review_is_one_immutable_decision_per_snapshot_and_other_requires_a_note(): void
    {
        $shift = $this->open('rev');
        $this->meters($shift);
        $this->close($shift);                        // U = 20 L
        $this->review($shift, FuelShiftMeterVarianceReview::OTHER)->assertStatus(422);                       // «أخرى» بلا ملاحظة
        $this->review($shift, FuelShiftMeterVarianceReview::OTHER, 'تفريغ للمعايرة')->assertOk();
        $this->review($shift, FuelShiftMeterVarianceReview::OTHER, 'تفريغ للمعايرة')->assertOk();            // إعادة آمنة
        $this->review($shift, FuelShiftMeterVarianceReview::LOSS_OR_LEAK)->assertStatus(422);                // قرار ثابت
        $this->assertSame(1, FuelShiftMeterVarianceReview::where('fuel_shift_id', $shift->id)->count());
        $this->assertSame(1, \App\Models\FuelShiftEvent::where('fuel_shift_id', $shift->id)->where('type', 'meter_variance_reviewed')->count());
    }

    /** @test */
    public function only_the_meter_variance_review_permission_can_review_and_a_balanced_nozzle_cannot_be_reviewed(): void
    {
        $shift = $this->open('perm');
        $this->meters($shift);
        $this->directSale($shift, 20_000);
        $this->close($shift);                        // مطابقة تامة
        $this->review($shift, FuelShiftMeterVarianceReview::OTHER, 'x y z')->assertStatus(422);              // لا فرق يُراجَع

        $shift2 = $this->open('perm2');
        $this->meters($shift2, 1_020_000, 1_040_000);
        $this->close($shift2);
        $cash = $this->roleUser($this->f['tenant_id'], 'cashvar', 'cashvar@meter.test', ['fuel.shift.view', 'fuel.shift.cash_variance_review', 'fuel.shift.approve']);
        $this->review($shift2, FuelShiftMeterVarianceReview::READING_ERROR, null, $this->token($cash))->assertForbidden();   // سلطة منفصلة عن مراجعة النقد
        $reviewer = $this->roleUser($this->f['tenant_id'], 'metervar', 'metervar@meter.test', ['fuel.shift.view', 'fuel.shift.meter_variance_review']);
        $this->review($shift2, FuelShiftMeterVarianceReview::READING_ERROR, null, $this->token($reviewer))->assertOk();
    }

    /** @test */
    public function the_review_cannot_be_applied_to_an_open_shift_or_to_other_tenants_data(): void
    {
        $open = $this->open('open');
        $this->meters($open);
        $this->review($open, FuelShiftMeterVarianceReview::READING_ERROR)->assertStatus(422);

        $shift = $open;                              // وردية واحدة مفتوحة لكل محطة: تُغلَق ثم تُستعمل لاختبار العزل
        $this->close($shift);
        $foreign = $this->roleUser($this->f['foreign_tenant_id'], 'foreign-meter', 'foreign-meter@x.test', ['fuel.shift.view', 'fuel.shift.meter_variance_review']);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($this->f['foreign_tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_foreign_isolation', reason: 'اختبار عزل المستأجر.',
        );
        app(\App\Tenancy\TenantContext::class)->set($this->f['tenant_id']);
        $token = $this->token($foreign);
        $this->withToken($token)->getJson(self::BASE . "/{$shift->id}/meter-reconciliation")->assertNotFound();
        $this->review($shift, FuelShiftMeterVarianceReview::READING_ERROR, null, $token)->assertNotFound();
    }

    /** @test */
    public function the_show_endpoint_returns_the_frozen_snapshot_with_a_clear_contract(): void
    {
        $shift = $this->open('show');
        $this->meters($shift);
        $this->directSale($shift, 6_000);
        $this->tankerFill($shift, 4_000);
        $this->close($shift);

        $data = $this->withToken($this->token($this->f['actor']))->getJson(self::BASE . "/{$shift->id}/meter-reconciliation")->assertOk()->json('data');
        $this->assertTrue($data['frozen']);
        $this->assertSame(1, count($data['nozzles']));
        $n = $data['nozzles'][0];
        $this->assertSame([20_000, 6_000, 4_000, 10_000], [$n['metered_milliliters'], $n['direct_sale_milliliters'], $n['tanker_fill_milliliters'], $n['unexplained_milliliters']]);
        $this->assertTrue($n['requires_review']);
        $this->assertSame(1, $data['summary']['pending_review']);
        $this->assertFalse($data['summary']['review_complete']);
        $this->assertTrue($data['can_review']);
        $this->assertContains('tanker_fill_is_not_a_sale', $data['disclaimers']);
        $this->assertArrayNotHasKey('tenant_id', $n);
    }

    // ───────── البوابة والثبات ─────────

    /** @test */
    public function a_closed_gate_leaves_close_and_approval_exactly_as_before(): void
    {
        config(['fuel_stations.shift_meter_reconciliation_enabled' => false]);
        $shift = $this->open('off');
        $this->meters($shift);
        $this->tankerFill($shift, 3_000);            // فرق كبير لكن لا مطابقة
        $this->close($shift);
        $this->assertSame(0, FuelShiftNozzleReconciliation::count());
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
        $this->withToken($this->token($this->f['actor']))->getJson(self::BASE . "/{$shift->id}/meter-reconciliation")->assertNotFound();
        $this->review($shift, FuelShiftMeterVarianceReview::READING_ERROR)->assertNotFound();
    }

    /** @test */
    public function snapshots_and_reviews_are_immutable_in_the_database(): void
    {
        $shift = $this->open('imm');
        $this->meters($shift);
        $this->close($shift);
        $row = $this->snapshot($shift);
        $this->review($shift, FuelShiftMeterVarianceReview::READING_ERROR)->assertOk();

        foreach (['fuel_shift_nozzle_reconciliations', 'fuel_shift_meter_variance_reviews'] as $table) {
            $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table($table)->update(['updated_at' => now()])), 'immutable', \Illuminate\Database\QueryException::class));
            $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table($table)->delete()), 'undeletable', \Illuminate\Database\QueryException::class));
        }
        $this->assertSame(20_000, $row->fresh()->unexplained_milliliters);
        $this->assertInstanceOf(\LogicException::class, $this->thrown(fn () => $row->fresh()->forceFill(['unexplained_milliliters' => 0])->save(), 'model immutable', \LogicException::class));
    }

    /** @test */
    public function the_database_rejects_a_snapshot_whose_numbers_do_not_add_up(): void
    {
        $shift = $this->open('shape');
        $this->meters($shift);
        $this->close($shift);
        $good = DB::table('fuel_shift_nozzle_reconciliations')->first();
        $bad = (array) $good;
        $bad['id'] = (string) \Illuminate\Support\Str::uuid();
        $bad['fuel_nozzle_id'] = $this->f['nozzle']->id;
        $bad['fuel_shift_id'] = (string) \Illuminate\Support\Str::uuid();
        $bad['unexplained_milliliters'] = 1;   // ≠ M − D − T
        $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table('fuel_shift_nozzle_reconciliations')->insert($bad)), 'shape', \Illuminate\Database\QueryException::class));
    }

    /** @test */
    public function the_close_does_not_depend_on_unrecorded_stock_or_tank_policies(): void
    {
        // الإغلاق بفرق عدّاد لا يُحجب (التسجيل فقط)؛ المنع عند الاعتماد وحده.
        $shift = $this->open('noblock');
        $this->meters($shift);
        $closed = $this->close($shift);
        $this->assertSame(FuelShift::STATUS_CLOSED, $closed->status);
    }
}

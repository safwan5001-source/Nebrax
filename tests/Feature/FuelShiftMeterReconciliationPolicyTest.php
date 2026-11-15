<?php

namespace Tests\Feature;

use App\Models\FuelShift;
use App\Models\FuelShiftEvent;
use App\Models\FuelShiftMeterVarianceReview;
use App\Models\FuelShiftNozzleReconciliation;
use App\Models\FuelStation;
use App\Models\FuelStationConfigurationEvent;
use App\Models\User;
use App\Services\FuelShiftMeterReconciliationService;
use App\Services\FuelShiftService;
use App\Services\FuelStationSettingsService;
use App\Support\StationSessionBoundary;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TANKER-PR8-S — إعدادات مطابقة عدّادات الوقود وتثبيت متطلب المراجعة على الوردية.
 *
 * يغطي: الإعداد (افتراضي معطَّل، حوكمة، تدقيق، نطاق محطة، لا override جهاز، لا جلسة PIN)، والفصل بين «إنشاء لقطات جديدة» (بوابة النشر ∧ الإعداد) و«حماية الاعتماد» (اللقطات المجمَّدة):
 * تعطيل الإعداد وإغلاق البوابة قبل الإغلاق وبعده، المراجعة ثم الاعتماد، الفشل المغلق للقطة بلا متطلب، ومحاولات تجاوز الصلاحيات. تشغيلية بحتة: لا قيد ولا مخزون.
 * بيانات اصطناعية معزولة (نموذج `BuildsFuelCashFixture`).
 */
class FuelShiftMeterReconciliationPolicyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;
    use BuildsFuelCashFixture;

    private const BASE = '/api/fuel-stations/shifts';
    private const KEY = 'shift_meter_reconciliation_enabled';
    private const REQUIRED = 'FUEL_METER_VARIANCE_REVIEW_REQUIRED';

    protected function setUp(): void
    {
        parent::setUp();
        // بوابة النشر مفتوحة؛ **الإعداد معطَّل افتراضياً** — كل اختبار يفعّله صراحةً حين يحتاج.
        config(['fuel_stations.shift_meter_reconciliation_enabled' => true, 'fuel_stations.shift_cash_receipts_enabled' => true]);
        $this->f = $this->fixture();
        $this->travel(3)->seconds();
    }

    // ───────── أدوات ─────────

    private function enable(bool $on = true): void
    {
        app(FuelStationSettingsService::class)->putTenant([self::KEY => $on], $this->f['actor'], 'اختبار');
    }

    private function meters(FuelShift $shift, int $opening = 1_000_000, int $closing = 1_020_000): void
    {
        foreach (['opening' => $opening, 'closing' => $closing] as $stage => $ml) {
            app(FuelShiftService::class)->recordMeter($shift->fresh(), [
                'fuel_nozzle_id' => $this->f['nozzle']->id, 'reading_stage' => $stage, 'meter_milliliters' => $ml, 'evidence_key' => "mr-{$shift->id}-{$stage}",
            ], $this->f['actor']);
        }
    }

    private function close(FuelShift $shift): FuelShift
    {
        return app(FuelShiftService::class)->close($shift->fresh(), 20000, null, $this->f['actor']);
    }

    private function approve(FuelShift $shift, ?User $actor = null): FuelShift
    {
        return app(FuelShiftService::class)->approve($shift->fresh(), null, $actor ?? $this->f['actor']);
    }

    /** وردية مغلقة بفرق 20 L غير مفسَّر. */
    private function closedWithVariance(string $key): FuelShift
    {
        $shift = $this->open($key);
        $this->meters($shift);
        $this->close($shift);

        return $shift;
    }

    private function token(User $user): string
    {
        return $user->createToken('api')->plainTextToken;
    }

    private function review(FuelShift $shift, ?string $token = null)
    {
        return $this->withToken($token ?? $this->token($this->f['actor']))->postJson(self::BASE . "/{$shift->id}/meter-reconciliation/review", [
            'nozzle_id' => $this->f['nozzle']->id, 'classification' => FuelShiftMeterVarianceReview::READING_ERROR,
        ]);
    }

    private function show(FuelShift $shift, ?string $token = null)
    {
        return $this->withToken($token ?? $this->token($this->f['actor']))->getJson(self::BASE . "/{$shift->id}/meter-reconciliation");
    }

    private function snapshots(FuelShift $shift)
    {
        return FuelShiftNozzleReconciliation::where('fuel_shift_id', $shift->id);
    }

    private function assertApprovalBlocked(FuelShift $shift, ?User $actor = null): void
    {
        $this->assertStringContainsString(self::REQUIRED, $this->rejects(fn () => $this->approve($shift, $actor))->getMessage());
        $this->assertSame(FuelShift::STATUS_CLOSED, $shift->fresh()->status);
    }

    /** @return array<string,int> */
    private function accountingCounts(): array
    {
        return collect(['invoices', 'journal_entries', 'journal_lines', 'payments', 'stock_movements', 'fuel_inventory_cost_movements', 'fuel_operational_ledgers', 'fuel_shift_settlements'])
            ->mapWithKeys(fn (string $t) => [$t => DB::table($t)->count()])->all();
    }

    private function settingsUser(string $slug, array $extra = []): User
    {
        return $this->roleUser($this->f['tenant_id'], $slug, "{$slug}@meter-policy.test", ['fuel_stations.view', 'fuel_stations.manage', ...$extra]);
    }

    // ───────── الإعداد: الافتراضي والحوكمة والتدقيق والنطاق ─────────

    /** @test */
    public function the_setting_defaults_to_off_and_the_effective_state_separates_the_deployment_gate_from_the_choice(): void
    {
        $token = $this->token($this->f['actor']);
        $stationUrl = "/api/fuel-stations/stations/{$this->f['station']->id}/settings";

        $tenant = $this->withToken($token)->getJson('/api/fuel-stations/settings')->assertOk();
        $this->assertFalse($tenant->json('data.' . self::KEY));
        $this->assertTrue($tenant->json('meta.meter_reconciliation.deployment_open'));
        $this->assertSame(
            ['deployment_open' => true, 'setting_enabled' => false, 'active' => false, 'source' => 'organization'],
            $this->withToken($token)->getJson($stationUrl)->assertOk()->json('meta.meter_reconciliation'),
        );

        $this->enable();
        $this->assertSame(
            ['deployment_open' => true, 'setting_enabled' => true, 'active' => true, 'source' => 'organization'],
            $this->withToken($token)->getJson($stationUrl)->json('meta.meter_reconciliation'),
        );

        // تجاوز المحطة يتقدّم على المؤسسة ويُعلن مصدره.
        $this->withToken($token)->putJson($stationUrl, [self::KEY => false, 'reason' => 'تعطيل لمحطة'])->assertOk();
        $this->assertSame(
            ['deployment_open' => true, 'setting_enabled' => false, 'active' => false, 'source' => 'station'],
            $this->withToken($token)->getJson($stationUrl)->json('meta.meter_reconciliation'),
        );

        // الاختيار المخزَّن لا يعني تشغيلاً: بوابة النشر المغلقة تُبقي «غير فعّال» مهما خُزِّن.
        $this->withToken($token)->putJson($stationUrl, [self::KEY => null])->assertOk();
        config(['fuel_stations.shift_meter_reconciliation_enabled' => false]);
        $this->assertSame(
            ['deployment_open' => false, 'setting_enabled' => true, 'active' => false, 'source' => 'organization'],
            $this->withToken($token)->getJson($stationUrl)->json('meta.meter_reconciliation'),
        );
        $this->assertFalse($this->withToken($token)->getJson('/api/fuel-stations/settings')->json('meta.meter_reconciliation.deployment_open'));
    }

    /** @test */
    public function changing_the_setting_requires_the_governance_permission_at_both_levels_and_when_clearing_an_override(): void
    {
        $stationUrl = "/api/fuel-stations/stations/{$this->f['station']->id}/settings";
        $manager = $this->token($this->settingsUser('manage-only'));
        $governor = $this->token($this->settingsUser('governor', ['fuel.governance.manage']));

        $this->withToken($manager)->putJson('/api/fuel-stations/settings', [self::KEY => true])->assertForbidden();
        $this->withToken($manager)->putJson($stationUrl, [self::KEY => true])->assertForbidden();
        $this->assertFalse(app(FuelShiftMeterReconciliationService::class)->settingEnabled($this->f['station']));

        $this->withToken($governor)->putJson($stationUrl, [self::KEY => true, 'reason' => 'تفعيل للمحطة'])->assertOk();
        $this->assertTrue(app(FuelShiftMeterReconciliationService::class)->settingEnabled($this->f['station']));

        // مسح التجاوز (والعودة للوراثة) لا يُلتفّ به على الحوكمة.
        $this->withToken($manager)->putJson($stationUrl, [self::KEY => null])->assertForbidden();
        $this->assertTrue(app(FuelShiftMeterReconciliationService::class)->settingEnabled($this->f['station']));
        // الحقول غير الحوكمية (التفاوت) تبقى بصلاحية الإدارة وحدها.
        $this->withToken($manager)->putJson($stationUrl, ['shift_meter_tolerance_milliliters' => 50])->assertOk();
    }

    /** @test */
    public function the_setting_accepts_only_a_boolean_and_is_audited_only_when_it_actually_changes(): void
    {
        $governor = $this->token($this->settingsUser('governor-audit', ['fuel.governance.manage']));
        $this->withToken($governor)->putJson('/api/fuel-stations/settings', [self::KEY => 'maybe'])->assertStatus(422);
        $this->withToken($governor)->putJson('/api/fuel-stations/settings', [self::KEY => true])->assertOk();
        $this->assertTrue(app(FuelShiftMeterReconciliationService::class)->settingEnabled($this->f['station']));

        $events = fn () => FuelStationConfigurationEvent::where('setting_key', self::KEY)->orderBy('changed_at')->orderBy('id')->get();
        $this->assertCount(1, $events());
        $first = $events()->first();
        $this->assertSame(['value' => false], $first->before);
        $this->assertSame(['value' => true], $first->after);
        $this->assertNotNull($first->changed_by);

        $this->withToken($governor)->putJson('/api/fuel-stations/settings', [self::KEY => true, 'reason' => 'نفسها'])->assertOk();
        $this->assertCount(1, $events(), 'لا حدث تدقيق لقيمة لم تتغيّر');

        $this->withToken($governor)->putJson('/api/fuel-stations/settings', [self::KEY => false, 'reason' => 'إيقاف'])->assertOk();
        $this->assertCount(2, $events());
        $this->assertSame('إيقاف', $events()->last()->reason);
        $this->assertSame(['value' => false], $events()->last()->after);
    }

    /** @test */
    public function station_scope_is_enforced_on_the_settings_routes_and_a_device_override_is_refused(): void
    {
        $other = FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id, 'code' => 'FCS-OTHER', 'name' => 'محطة أخرى',
        ]);
        $restricted = $this->settingsUser('restricted', ['fuel.governance.manage']);
        $restricted->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
        $restricted->fuelStations()->sync([$other->id]);
        $token = $this->token($restricted);

        $own = "/api/fuel-stations/stations/{$other->id}/settings";
        $foreign = "/api/fuel-stations/stations/{$this->f['station']->id}/settings";
        $this->withToken($token)->putJson($foreign, [self::KEY => true])->assertNotFound();
        $this->withToken($token)->getJson($foreign)->assertNotFound();
        $this->assertFalse(app(FuelShiftMeterReconciliationService::class)->settingEnabled($this->f['station']));
        $this->withToken($token)->putJson($own, [self::KEY => true])->assertOk();

        $message = $this->rejects(fn () => app(FuelStationSettingsService::class)->putDevice($this->f['station'], 'dev-1', self::KEY, true, $this->f['actor']))->getMessage();
        $this->assertNotSame('', $message);
    }

    /** @test */
    public function station_pin_sessions_cannot_write_the_settings_routes(): void
    {
        $this->assertFalse(StationSessionBoundary::routeAllowed('PUT', 'api/fuel-stations/settings'));
        $this->assertFalse(StationSessionBoundary::routeAllowed('PUT', 'api/fuel-stations/stations/{id}/settings'));
        $this->assertFalse(StationSessionBoundary::routeAllowed('POST', 'api/fuel-stations/settings'));
    }

    // ───────── منع إنشاء لقطات جديدة (البوابة ∧ الإعداد) ─────────

    /** @test */
    public function a_shift_closed_while_the_setting_is_off_has_no_snapshot_no_requirement_and_is_not_blocked(): void
    {
        $shift = $this->closedWithVariance('off');
        $this->assertSame(0, $this->snapshots($shift)->count());
        $this->show($shift)->assertNotFound();
        $this->review($shift)->assertNotFound();
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function a_shift_closed_while_the_deployment_gate_is_closed_has_no_snapshot_even_if_the_setting_is_on(): void
    {
        $this->enable();
        config(['fuel_stations.shift_meter_reconciliation_enabled' => false]);
        $shift = $this->closedWithVariance('gate-closed-before');
        $this->assertSame(0, $this->snapshots($shift)->count());
        $this->show($shift)->assertNotFound();
        $this->review($shift)->assertNotFound();
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function enabling_the_setting_later_is_not_retroactive_for_shifts_closed_without_snapshots(): void
    {
        $shift = $this->closedWithVariance('retro');
        $this->enable();

        $data = $this->show($shift)->assertOk()->json('data');
        $this->assertFalse($data['frozen'], 'عرض حيّ فقط — لا لقطة ولا متطلب');
        $this->assertFalse($data['can_review']);
        $this->assertNull($data['policy']['review_requirement']);
        $this->review($shift)->assertStatus(422);                      // لا لقطة تُراجَع
        $this->assertSame(0, $this->snapshots($shift)->count());
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    // ───────── تثبيت المتطلب: تعطيل الإعداد وإغلاق البوابة بعد الإغلاق ─────────

    /** @test */
    public function enabling_freezes_the_requirement_on_every_snapshot_and_records_the_policy_evidence(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('freeze');

        $rows = $this->snapshots($shift)->get();
        $this->assertCount(1, $rows);
        $this->assertSame(FuelShiftNozzleReconciliation::REQUIREMENT_REQUIRED_BEFORE_APPROVAL, $rows->first()->review_requirement);
        $event = FuelShiftEvent::where('fuel_shift_id', $shift->id)->where('type', FuelShiftEvent::TYPE_METER_RECONCILIATION_FROZEN)->sole();
        $this->assertSame('required_before_approval', $event->payload['review_requirement']);
        $this->assertSame('organization', $event->payload['setting_source']);

        $data = $this->show($shift)->assertOk()->json('data');
        $this->assertTrue($data['frozen']);
        $this->assertSame('required_before_approval', $data['policy']['review_requirement']);
        $this->assertTrue($data['policy']['approval_blocked']);
        $this->assertTrue($data['can_review']);
    }

    /** @test */
    public function disabling_the_setting_after_close_does_not_lift_the_requirement_and_the_supervisor_can_still_complete_the_review(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('disable-after');
        $this->enable(false);                                                       // تعطيل على مستوى المؤسسة بعد الإغلاق
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], [self::KEY => false], $this->f['actor'], 'تعطيل للمحطة');   // وتجاوز محطة أيضاً

        $this->assertApprovalBlocked($shift);

        $data = $this->show($shift)->assertOk()->json('data');                       // القراءة تبقى من اللقطة المجمَّدة
        $this->assertTrue($data['frozen']);
        $this->assertFalse($data['policy']['setting_enabled']);
        $this->assertFalse($data['policy']['active']);
        $this->assertTrue($data['policy']['approval_blocked']);
        $this->assertTrue($data['can_review']);

        $this->review($shift)->assertOk();                                           // مسار إكمال المراجعة بعد التعطيل
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function changing_the_tolerance_or_the_policy_after_close_does_not_change_a_frozen_decision(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('tolerance-after');
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_meter_tolerance_milliliters' => 1_000_000], $this->f['actor'], 'تفاوت كبير لاحقاً');
        $this->enable(false);

        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_VARIANCE, $this->snapshots($shift)->sole()->status);
        $this->assertApprovalBlocked($shift);
    }

    /** @test */
    public function closing_the_deployment_gate_after_close_does_not_allow_approving_a_shift_with_a_frozen_requirement(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('gate-after');
        config(['fuel_stations.shift_meter_reconciliation_enabled' => false]);

        $this->assertApprovalBlocked($shift);                                        // لا تُسقط البوابة المتطلب
        $data = $this->show($shift)->assertOk()->json('data');                       // ولا تُخفي اللقطة
        $this->assertTrue($data['frozen']);
        $this->assertFalse($data['policy']['deployment_open']);
        $this->assertTrue($data['can_review']);

        $this->review($shift)->assertOk();                                           // المشرف يُكمل المراجعة بصلاحيته
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function both_off_after_close_still_blocks_until_the_review_is_recorded(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('both-off');
        $this->enable(false);
        config(['fuel_stations.shift_meter_reconciliation_enabled' => false]);

        $this->assertApprovalBlocked($shift);
        $this->review($shift)->assertOk();
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function a_snapshot_without_a_recorded_requirement_fails_closed_as_required(): void
    {
        $shift = $this->closedWithVariance('legacy');                               // أُغلقت والإعداد معطَّل: لا لقطة
        $this->assertSame(0, $this->snapshots($shift)->count());
        $now = now();
        DB::table('fuel_shift_nozzle_reconciliations')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'fuel_station_id' => $this->f['station']->id,
            'fuel_shift_id' => $shift->id, 'fuel_nozzle_id' => $this->f['nozzle']->id, 'fuel_product_id' => $this->f['fuelProduct']->id,
            'metered_milliliters' => 20_000, 'direct_sale_milliliters' => 0, 'tanker_fill_milliliters' => 0, 'tanker_fill_count' => 0, 'draft_sale_milliliters' => 0,
            'unexplained_milliliters' => 20_000, 'tolerance_milliliters' => 0, 'status' => 'variance', 'incompleteness' => null, 'review_requirement' => null,
            'frozen_at' => $now, 'created_at' => $now, 'updated_at' => $now,
        ]);

        $this->assertApprovalBlocked($shift);                                        // لقطة PR-8 الأصلية (NULL) = مطلوبة
        $this->review($shift)->assertOk();
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    /** @test */
    public function a_balanced_or_within_tolerance_snapshot_never_blocks_even_with_a_frozen_requirement(): void
    {
        $this->enable();
        app(FuelStationSettingsService::class)->putStationValues($this->f['station'], ['shift_meter_tolerance_milliliters' => 50_000], $this->f['actor'], 'تفاوت');
        $shift = $this->closedWithVariance('within');
        $this->assertSame(FuelShiftNozzleReconciliation::STATUS_WITHIN_TOLERANCE, $this->snapshots($shift)->sole()->status);
        $this->enable(false);
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift)->status);
    }

    // ───────── المراجعة ثم الاعتماد، ومحاولات تجاوز الصلاحيات ─────────

    /** @test */
    public function review_then_approval_has_no_accounting_or_stock_effect_and_the_review_stays_one_immutable_decision(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('effects');
        $before = $this->accountingCounts();

        $this->review($shift)->assertOk();
        $this->approve($shift);
        $this->review($shift)->assertStatus(422);                                    // بعد الاعتماد لا مراجعة (غير مغلقة)

        $this->assertSame($before, $this->accountingCounts());
        $this->assertSame(1, FuelShiftMeterVarianceReview::where('fuel_shift_id', $shift->id)->count());
    }

    /** @test */
    public function permissions_cannot_be_combined_or_borrowed_to_get_around_the_frozen_requirement(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('bypass');
        $this->enable(false);

        // معتمِد بلا صلاحية المراجعة: لا يعتمد حول المتطلب، ولا يراجع.
        $supervisor = $this->f['supervisor'];
        $this->assertApprovalBlocked($shift, $supervisor);
        $this->review($shift, $this->token($supervisor))->assertForbidden();

        // سلطة مراجعة النقد مستقلة عن مراجعة العدّادات.
        $cash = $this->roleUser($this->f['tenant_id'], 'cash-rev', 'cash-rev@meter-policy.test', ['fuel.shift.view', 'fuel.shift.cash_variance_review', 'fuel.shift.approve']);
        $this->review($shift, $this->token($cash))->assertForbidden();
        $this->assertApprovalBlocked($shift, $cash);

        // مراجع بلا صلاحية الاعتماد لا يعتمد.
        $reviewer = $this->roleUser($this->f['tenant_id'], 'meter-rev', 'meter-rev@meter-policy.test', ['fuel.shift.view', 'fuel.shift.meter_variance_review']);
        $this->review($shift, $this->token($reviewer))->assertOk();
        $this->assertNotNull($this->rejects(fn () => $this->approve($shift, $reviewer)));
        $this->assertSame(FuelShift::STATUS_CLOSED, $shift->fresh()->status);
        $this->assertSame(FuelShift::STATUS_APPROVED, $this->approve($shift, $supervisor)->status);
    }

    /** @test */
    public function a_reviewer_restricted_to_another_station_cannot_review_after_the_setting_is_disabled(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('scope');
        $this->enable(false);
        $other = FuelStation::create([
            'tenant_id' => $this->f['tenant_id'], 'branch_id' => $this->f['branch']->id, 'warehouse_id' => $this->f['warehouse']->id, 'code' => 'FCS-OTHER2', 'name' => 'محطة أخرى',
        ]);
        $reviewer = $this->roleUser($this->f['tenant_id'], 'scoped-rev', 'scoped-rev@meter-policy.test', ['fuel.shift.view', 'fuel.shift.meter_variance_review']);
        $reviewer->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
        $reviewer->fuelStations()->sync([$other->id]);
        app(TenantContext::class)->set($this->f['tenant_id']);

        $this->review($shift, $this->token($reviewer))->assertNotFound();
        $this->show($shift, $this->token($reviewer))->assertNotFound();
        $this->assertApprovalBlocked($shift);
    }

    // ───────── ثبات اللقطة والمتطلب في القاعدة ─────────

    /** @test */
    public function the_database_rejects_an_unknown_requirement_and_any_rewrite_of_a_frozen_one(): void
    {
        $this->enable();
        $shift = $this->closedWithVariance('db');
        $row = (array) DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $shift->id)->first();

        $bad = $row;
        $bad['id'] = (string) Str::uuid();
        $bad['fuel_shift_id'] = (string) Str::uuid();
        $bad['review_requirement'] = 'advisory';                                     // لا خيار تجاوز/استشاري الآن
        $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table('fuel_shift_nozzle_reconciliations')->insert($bad)), 'requirement', \Illuminate\Database\QueryException::class));

        $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $shift->id)->update(['review_requirement' => null])), 'rewrite', \Illuminate\Database\QueryException::class));
        $this->assertSame('required_before_approval', $this->snapshots($shift)->sole()->review_requirement);
        $this->assertInstanceOf(\Illuminate\Database\QueryException::class, $this->thrown(fn () => DB::transaction(fn () => DB::table('fuel_shift_nozzle_reconciliations')->where('fuel_shift_id', $shift->id)->delete()), 'delete', \Illuminate\Database\QueryException::class));
        $this->assertApprovalBlocked($shift);
    }

    /** @test */
    public function rolling_back_the_requirement_column_is_refused_while_any_frozen_requirement_exists(): void
    {
        $this->enable();
        $this->closedWithVariance('rollback');
        $migration = require base_path('database/migrations/2027_01_31_010000_add_review_requirement_to_fuel_shift_nozzle_reconciliations.php');

        $this->assertStringContainsString('Rollback refused', $this->rejects(fn () => $migration->down())->getMessage());
        $this->assertTrue(\Illuminate\Support\Facades\Schema::hasColumn('fuel_shift_nozzle_reconciliations', 'review_requirement'));
    }

    /** @test */
    public function no_service_other_than_the_reconciliation_service_writes_the_requirement_and_nothing_reads_the_setting_in_the_approval_check(): void
    {
        $service = file_get_contents(base_path('app/Services/FuelShiftMeterReconciliationService.php'));
        preg_match('/public function assertApprovable.*?\n    }\n/s', (string) $service, $match);
        $this->assertNotEmpty($match, 'assertApprovable must exist');
        $this->assertStringNotContainsString('enabled()', $match[0], 'حماية الاعتماد لا تعتمد على بوابة النشر');
        $this->assertStringNotContainsString('settingEnabled', $match[0], 'ولا على الإعداد الحالي');
        $this->assertStringNotContainsString('activeFor', $match[0]);

        $writers = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'))) as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php') && str_contains((string) file_get_contents($file->getPathname()), "'review_requirement' =>")) {
                $writers[] = $file->getFilename();
            }
        }
        $this->assertSame(['FuelShiftMeterReconciliationService.php'], $writers);
    }
}

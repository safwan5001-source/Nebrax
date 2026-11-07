<?php

namespace Tests\Feature;

use App\Models\FuelStationAuditEvent;
use App\Models\FuelTankReading;
use App\Models\FuelTankReadingRequest;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B6 (تعديل) — سياسة القراءات المتأخرة (deny | supervisor_approval | authorized_user)، دورة الاعتماد، الحد الزمني، السبب، منع الاعتماد الذاتي،
 * النطاق، الحوكمة، وإصلاح idempotency (بصمة النية الكاملة). كلها تشغيلية: لا مخزون ولا قيد ولا تكلفة ولا تأثير على آخر قراءة.
 */
class FuelTankReadingBackdatingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    protected function tearDown(): void
    {
        $this->travelBack();
        parent::tearDown();
    }

    private function freeze(): CarbonImmutable
    {
        // الساعة المجمَّدة تُشتق من الساعة الحقيقية (بعد بناء الـfixture) لا من تاريخ ثابت: الـfixture
        // (مستأجر/استحقاقات) يُنشأ بالساعة الحقيقية، وتاريخ ثابت يصير «قبله» فيعيد 403 بمرور الوقت.
        $now = CarbonImmutable::now('UTC')->addDay()->startOfMinute();
        $this->travelTo($now);

        return $now;
    }

    /** @param array<string,mixed> $values */
    private function policy(array $values, ?string $stationId = null): void
    {
        $url = $stationId === null ? self::BASE . '/settings' : self::BASE . '/stations/' . $stationId . '/settings';
        $this->withToken($this->fx['owner'])->putJson($url, $values + ['reason' => 'سياسة اختبار'])->assertOk();
    }

    /** @return array{user: \App\Models\User, token: string} */
    private function recorder(string $name = 'rec', ?array $stations = null, array $extra = []): array
    {
        return $this->makeUser($name, 'role-' . $name, array_merge(['fuel_stations.view', 'fuel.reading.view', 'fuel.reading.record'], $extra), $stations ?? [$this->fx['s1']->id]);
    }

    /** @return array{user: \App\Models\User, token: string} */
    private function approver(string $name = 'apr', ?array $stations = null): array
    {
        return $this->recorder($name, $stations, ['fuel.reading.late.approve']);
    }

    /** @return array<string,mixed> */
    private function body(string $key, string $liters, ?CarbonImmutable $at, array $extra = []): array
    {
        return array_merge([
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_tank_id' => $this->fx['t1']->id, 'reading_type' => 'physical',
            'quantity_liters' => $liters, 'evidence_key' => $key,
        ], $at === null ? [] : ['measured_at' => $at->toIso8601String()], $extra);
    }

    /** @return array{0:int,1:int,2:int} */
    private function financialCounts(): array
    {
        return [(int) DB::table('stock_movements')->count(), (int) DB::table('journal_entries')->count(), (int) DB::table('fuel_operational_ledgers')->count()];
    }

    private function code(\Illuminate\Testing\TestResponse $response): string
    {
        return (string) $response->json('message');
    }

    /** @test */
    public function the_default_is_deny_and_a_backdated_reading_is_rejected_and_stores_nothing(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $rec = $this->recorder();

        $res = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-1', '10', $now->subHours(2), ['late_reason' => 'نسيت']))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_BACKDATING_DENIED', $this->code($res));
        $this->assertSame(0, FuelTankReading::count() + FuelTankReadingRequest::count());

        // ضمن سماحية انحراف الساعة ليست «متأخرة»: قراءة عادية بوقتها
        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-near', '10', $now->subSeconds(120)))->assertCreated();
        // والمستقبلي مرفوض كما قبل
        $this->assertStringContainsString('FUEL_READING_FUTURE_TIME', $this->code($this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-fut', '10', $now->addHour()))->assertStatus(422)));
    }

    /** @test */
    public function supervisor_approval_creates_a_pending_request_that_is_not_an_operational_reading(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $before = $this->financialCounts();
        // قراءة حالية أحدث
        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-now', '100', null))->assertCreated();

        $res = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-late', '40', $now->subHours(5), ['late_reason' => 'نسيت التسجيل أثناء الوردية']))->assertStatus(202);
        $res->assertJsonPath('data.status', 'pending')->assertJsonPath('data.request_kind', 'late_reading')
            ->assertJsonPath('data.quantity_liters', '40')->assertJsonPath('data.requested_by', $rec['user']->id)
            ->assertJsonPath('data.reason', 'نسيت التسجيل أثناء الوردية')->assertJsonPath('data.late_by_seconds', 5 * 3600);
        $this->assertSame(1, FuelTankReading::count()); // لا قراءة تشغيلية
        $this->assertSame(1, FuelTankReadingRequest::count());
        $this->assertSame('100', $this->withToken($rec['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.latest.quantity_liters'));
        $this->assertNotNull(FuelStationAuditEvent::where('action', 'tank_reading.late_requested')->first());
        $this->assertSame($before, $this->financialCounts());

        // مقدّم الطلب يرى طلبه؛ غيره (بلا صلاحية الاعتماد) لا يراه
        $this->assertCount(1, $this->withToken($rec['token'])->getJson(self::BASE . '/reading-requests')->assertOk()->json('data'));
        $other = $this->recorder('rec2');
        $this->assertCount(0, $this->withToken($other['token'])->getJson(self::BASE . '/reading-requests')->assertOk()->json('data'));
        $apr = $this->approver();
        $this->assertCount(1, $this->withToken($apr['token'])->getJson(self::BASE . '/reading-requests?status=pending')->assertOk()->json('data'));
    }

    /** @test */
    public function the_maximum_delay_is_enforced_at_its_exact_boundary_even_for_an_approver(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval', 'tank_reading_backdating_max_hours' => 24], $this->fx['s1']->id);
        $apr = $this->approver();

        $this->withToken($apr['token'])->postJson(self::BASE . '/readings', $this->body('bd-24h', '10', $now->subHours(24), ['late_reason' => 'x']))->assertStatus(202);
        $over = $this->withToken($apr['token'])->postJson(self::BASE . '/readings', $this->body('bd-24h1', '10', $now->subHours(24)->subSecond(), ['late_reason' => 'x']))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_BACKDATING_TOO_OLD', $this->code($over));

        // تقليل الحد بعد التقديم: الاعتماد يُقاس بتأخير وقت التقديم عن القياس، ويُرفض حين يتجاوز الحد الجديد
        $this->policy(['tank_reading_backdating_max_hours' => 12], $this->fx['s1']->id);
        $id = FuelTankReadingRequest::sole()->id;
        $approver2 = $this->approver('apr2');
        $this->assertStringContainsString('FUEL_READING_BACKDATING_TOO_OLD', $this->code($this->withToken($approver2['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertStatus(422)));
        $this->assertSame('pending', FuelTankReadingRequest::sole()->status);
    }

    /** @test */
    public function the_reason_is_mandatory_unless_the_policy_waives_it(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();

        foreach ([null, '', '   '] as $i => $blank) {
            $extra = $blank === null ? [] : ['late_reason' => $blank];
            $this->assertStringContainsString('FUEL_READING_BACKDATING_REASON_REQUIRED', $this->code($this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body("bd-r{$i}", '10', $now->subHour(), $extra))->assertStatus(422)));
        }
        $this->policy(['tank_reading_backdating_reason_required' => false], $this->fx['s1']->id);
        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-r-ok', '10', $now->subHour()))->assertStatus(202)->assertJsonPath('data.reason', null);
        $this->assertSame(1, FuelTankReadingRequest::count());
    }

    /** @test */
    public function approval_creates_the_reading_with_the_original_time_and_a_separate_decision_time_without_touching_the_latest_or_finances(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $apr = $this->approver();
        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-new', '120', null))->assertCreated();
        $at = $now->subHours(6);
        $id = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-old', '45.5', $at, ['late_reason' => 'سبب', 'evidence' => ['method' => 'dipstick', 'note' => 'ملاحظة']]))->assertStatus(202)->json('data.id');
        $before = $this->financialCounts();

        $this->travelTo($now->addMinutes(30));
        $res = $this->withToken($apr['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve", ['note' => 'موافق'])->assertOk();
        $res->assertJsonPath('data.status', 'approved')->assertJsonPath('data.decided_by', $apr['user']->id)->assertJsonPath('data.decision_note', 'موافق');

        $reading = FuelTankReading::findOrFail($res->json('data.fuel_tank_reading_id'));
        $this->assertSame($at->getTimestamp(), $reading->measured_at->getTimestamp());                 // وقت القياس الأصلي
        $this->assertSame($now->addMinutes(30)->getTimestamp(), $reading->created_at->getTimestamp());   // وقت الاعتماد منفصل
        $this->assertSame($rec['user']->id, $reading->recorded_by);
        $this->assertSame('سبب', $reading->evidence['late_reason']);
        $this->assertSame($id, $reading->evidence['late_request_id']);
        $this->assertSame('dipstick', $reading->evidence['method']);

        // آخر قراءة لا تتأثر (القراءة الأحدث قياساً تبقى)، والمخزون والدفتر والتكلفة كما هي
        $levels = $this->withToken($rec['token'])->getJson(self::BASE . '/tank-levels')->json('data.0');
        $this->assertSame('120', $levels['latest']['quantity_liters']);
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame(0, DB::table('fuel_reconciliations')->count());
        $history = $this->withToken($rec['token'])->getJson(self::BASE . '/readings?fuel_tank_id=' . $this->fx['t1']->id)->json('data');
        $this->assertSame(['120', '45.5'], array_column($history, 'quantity_liters')); // مرتَّبة بوقت القياس
        $this->assertTrue($history[1]['late_entry']);
        $this->assertFalse($history[0]['late_entry']);
        $this->assertNotNull(FuelStationAuditEvent::where('action', 'tank_reading.late_approved')->where('actor_id', $apr['user']->id)->first());
        $this->assertNotNull(FuelStationAuditEvent::where('action', 'tank_reading.recorded_late')->first());
    }

    /** @test */
    public function an_approved_late_reading_that_is_the_newest_by_measurement_becomes_the_latest(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $apr = $this->approver();
        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-first', '10', $now->subHours(10), ['late_reason' => 'x']))->assertStatus(202)->json('data.id');
        $id = FuelTankReadingRequest::sole()->id;
        $this->assertSame([], $this->withToken($rec['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.latest') ?? []);
        $this->withToken($apr['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertOk();
        $this->assertSame('10', $this->withToken($rec['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.latest.quantity_liters'));
    }

    /** @test */
    public function self_decision_is_blocked_and_the_permission_is_precise_with_no_legacy_or_recorder_bypass(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $apr = $this->approver();
        $id = $this->withToken($apr['token'])->postJson(self::BASE . '/readings', $this->body('bd-self', '10', $now->subHour(), ['late_reason' => 'x']))->assertStatus(202)->json('data.id');

        foreach (['approve', 'reject'] as $action) {
            $res = $this->withToken($apr['token'])->postJson(self::BASE . "/reading-requests/{$id}/{$action}", ['note' => 'ن'])->assertStatus(422);
            $this->assertStringContainsString('FUEL_READING_SELF_APPROVAL', $this->code($res));
        }
        $this->assertSame('pending', FuelTankReadingRequest::sole()->status);

        // fuel.reading.record وحدها لا تكفي، ولا fuel_stations.manage القديمة (لا منح تلقائي)
        $rec = $this->recorder('rec');
        $legacy = $this->makeUser('legacy', 'role-legacy', ['fuel_stations.view', 'fuel_stations.manage', 'fuel.reading.record'], [$this->fx['s1']->id]);
        $this->withToken($rec['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertForbidden();
        $this->withToken($legacy['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertForbidden();
        $this->withToken($legacy['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'x'])->assertForbidden();
        // وقوالب الموظفين القائمة لا تحمل المفتاحين
        $this->assertNotContains('fuel.reading.late.approve', \App\Support\FuelStaffTemplates::permissions(\App\Support\FuelStaffTemplates::STATION_MANAGER));
        $this->assertNotContains('fuel.reading.late.record', \App\Support\FuelStaffTemplates::permissions(\App\Support\FuelStaffTemplates::SUPERVISOR));

        $this->withToken($this->approver('apr-b')['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertOk();
    }

    /** @test */
    public function rejection_needs_a_note_a_decision_is_final_and_replays_are_idempotent_only_for_the_same_decider(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $a1 = $this->approver('a1');
        $a2 = $this->approver('a2');
        $id = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-rej', '10', $now->subHour(), ['late_reason' => 'x']))->assertStatus(202)->json('data.id');

        $this->assertStringContainsString('FUEL_READING_REJECTION_NOTE_REQUIRED', $this->code($this->withToken($a1['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject")->assertStatus(422)));
        $this->withToken($a1['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'قياس مشكوك'])->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->assertSame(0, FuelTankReading::count());

        $this->withToken($a1['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'قياس مشكوك'])->assertOk(); // الأثر الأول
        $conflict = $this->withToken($a1['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertStatus(409);
        $conflict->assertJsonPath('reason', 'request_already_decided')->assertJsonPath('current_status', 'rejected');
        $this->withToken($a2['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'x'])->assertStatus(409);
        $this->assertSame(0, FuelTankReading::count());
        $this->assertNotNull(FuelStationAuditEvent::where('action', 'tank_reading.late_rejected')->first());
        $this->assertSame(1, FuelStationAuditEvent::where('action', 'tank_reading.late_rejected')->count());

        // الطلب المقرَّر لا يتغيّر ولا يُحذف
        $this->expectException(\LogicException::class);
        FuelTankReadingRequest::sole()->forceFill(['reason' => 'تعديل'])->save();
    }

    /** @test */
    public function station_scope_is_enforced_for_submission_listing_and_decisions(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $id = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-sc', '10', $now->subHour(), ['late_reason' => 'x']))->assertStatus(202)->json('data.id');

        $foreign = $this->approver('apr-s2', [$this->fx['s2']->id]);
        $this->withToken($foreign['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertNotFound();
        $this->withToken($foreign['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'x'])->assertNotFound();
        $this->assertCount(0, $this->withToken($foreign['token'])->getJson(self::BASE . '/reading-requests')->assertOk()->json('data'));
        $this->withToken($foreign['token'])->getJson(self::BASE . '/reading-requests?station_id=' . $this->fx['s1']->id)->assertNotFound();
        // تقديم طلب على محطة خارج النطاق
        $this->withToken($foreign['token'])->postJson(self::BASE . '/readings', $this->body('bd-sc2', '10', $now->subHour(), ['late_reason' => 'x']))->assertNotFound();
        $this->assertSame('pending', FuelTankReadingRequest::sole()->status);
    }

    /** @test */
    public function approval_requires_the_policy_to_still_allow_it_but_rejection_stays_possible(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $apr = $this->approver();
        $id = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('bd-pol', '10', $now->subHour(), ['late_reason' => 'x']))->assertStatus(202)->json('data.id');

        $this->policy(['tank_reading_backdating_policy' => 'deny'], $this->fx['s1']->id);
        $this->assertStringContainsString('FUEL_READING_BACKDATING_NOT_ALLOWED', $this->code($this->withToken($apr['token'])->postJson(self::BASE . "/reading-requests/{$id}/approve")->assertStatus(422)));
        $this->withToken($apr['token'])->postJson(self::BASE . "/reading-requests/{$id}/reject", ['note' => 'السياسة تغيّرت'])->assertOk();
    }

    /** @test */
    public function authorized_user_policy_records_directly_only_for_the_dedicated_permission(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'authorized_user'], $this->fx['s1']->id);
        $plain = $this->recorder('plain');
        $approverOnly = $this->approver('aprx');
        $allowed = $this->recorder('late-rec', null, ['fuel.reading.late.record']);

        foreach ([$plain, $approverOnly] as $i => $user) {
            $this->assertStringContainsString('FUEL_READING_BACKDATING_NOT_AUTHORIZED', $this->code($this->withToken($user['token'])->postJson(self::BASE . '/readings', $this->body("bd-au{$i}", '10', $now->subHours(3), ['late_reason' => 'x']))->assertStatus(422)));
        }
        $this->assertSame(0, FuelTankReadingRequest::count());

        $this->assertStringContainsString('FUEL_READING_BACKDATING_REASON_REQUIRED', $this->code($this->withToken($allowed['token'])->postJson(self::BASE . '/readings', $this->body('bd-au-nr', '10', $now->subHours(3)))->assertStatus(422)));
        $res = $this->withToken($allowed['token'])->postJson(self::BASE . '/readings', $this->body('bd-au-ok', '33', $now->subHours(3), ['late_reason' => 'عطل مؤقت في الشبكة']))->assertCreated();
        $res->assertJsonPath('data.late_entry', true)->assertJsonPath('data.late_reason', 'عطل مؤقت في الشبكة')->assertJsonPath('data.recorded_by', $allowed['user']->id);
        $this->assertSame($now->subHours(3)->getTimestamp(), FuelTankReading::sole()->measured_at->getTimestamp());
        $this->assertNotNull(FuelStationAuditEvent::where('action', 'tank_reading.recorded_late')->where('reason', 'عطل مؤقت في الشبكة')->first());
        $this->assertTrue($this->withToken($allowed['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.backdating.can_submit'));
        $this->assertFalse($this->withToken($plain['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.backdating.can_submit'));
        // الحد الأقصى يسري هنا أيضاً
        $this->assertStringContainsString('FUEL_READING_BACKDATING_TOO_OLD', $this->code($this->withToken($allowed['token'])->postJson(self::BASE . '/readings', $this->body('bd-au-old', '10', $now->subHours(25), ['late_reason' => 'x']))->assertStatus(422)));
    }

    /** @test */
    public function the_policy_settings_are_governed_validated_inherited_and_default_to_deny(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1']->id;
        $effective = fn () => $this->withToken($this->fx['owner'])->getJson(self::BASE . "/stations/{$s1}/settings")->json('data');

        $d = $effective();
        $this->assertSame(['deny', 24, true], [$d['tank_reading_backdating_policy'], $d['tank_reading_backdating_max_hours'], $d['tank_reading_backdating_reason_required']]);

        // مدير بـfuel_stations.manage دون الحوكمة لا يغيّرها (مؤسسة ولا محطة)
        $mgr = $this->makeUser('mgr', 'role-mgr', ['fuel_stations.view', 'fuel_stations.manage']);
        $this->withToken($mgr['token'])->putJson(self::BASE . "/stations/{$s1}/settings", ['tank_reading_backdating_policy' => 'authorized_user'])->assertForbidden();
        $this->withToken($mgr['token'])->putJson(self::BASE . '/settings', ['tank_reading_backdating_max_hours' => 10])->assertForbidden();
        $gov = $this->makeUser('gov', 'role-gov', ['fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage']);
        $this->withToken($gov['token'])->putJson(self::BASE . "/stations/{$s1}/settings", ['tank_reading_backdating_policy' => 'authorized_user'])->assertOk();

        foreach ([['tank_reading_backdating_policy' => 'always'], ['tank_reading_backdating_max_hours' => 0], ['tank_reading_backdating_max_hours' => 721], ['tank_reading_backdating_reason_required' => 'yes']] as $bad) {
            $this->withToken($this->fx['owner'])->putJson(self::BASE . "/stations/{$s1}/settings", $bad)->assertStatus(422);
        }

        // المؤسسة ثم المحطة (تتقدّم)، ومسح تجاوز المحطة يعيد للمؤسسة
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval', 'tank_reading_backdating_max_hours' => 12, 'tank_reading_backdating_reason_required' => false]);
        $this->assertSame(['authorized_user', 12, false], [$effective()['tank_reading_backdating_policy'], $effective()['tank_reading_backdating_max_hours'], $effective()['tank_reading_backdating_reason_required']]);
        $this->policy(['tank_reading_backdating_policy' => null], $s1);
        $this->assertSame('supervisor_approval', $effective()['tank_reading_backdating_policy']);
        // محطة أخرى لم تُهيَّأ تأخذ المؤسسة؛ لا شيء يُطبَّق تلقائياً على غيرها
        $this->assertSame('supervisor_approval', $this->withToken($this->fx['owner'])->getJson(self::BASE . '/stations/' . $this->fx['s2']->id . '/settings')->json('data.tank_reading_backdating_policy'));
        // تدقيق تغييرات الإعدادات
        $this->assertGreaterThan(0, DB::table('fuel_station_configuration_events')->where('setting_key', 'tank_reading_backdating_policy')->count());
    }

    /** @test */
    public function idempotency_compares_the_full_intent_and_keeps_server_time_semantics(): void
    {
        $this->buildFixture();
        $now = $this->freeze();
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval'], $this->fx['s1']->id);
        $rec = $this->recorder();
        $other = $this->recorder('rec-b');

        // بلا وقت صريح: الإعادة بعد مرور الوقت لا تُنتج تعارضاً زائفاً
        $first = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('id-srv', '50', null, ['evidence' => ['method' => 'gauge', 'note' => ' ملاحظة ']]))->assertCreated();
        $this->travelTo($now->addMinutes(7));
        $again = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('id-srv', '50', null, ['evidence' => ['note' => 'ملاحظة', 'method' => 'gauge']]))->assertOk();
        $this->assertSame($first->json('data.id'), $again->json('data.id'));
        $this->assertSame(1, FuelTankReading::count());
        $this->travelTo($now);

        // كل حقل مؤثر يصنع تعارضاً بالمفتاح نفسه (الرمز ثابت)
        $variants = [
            'كمية' => [$rec, $this->body('id-srv', '51', null, ['evidence' => ['method' => 'gauge', 'note' => 'ملاحظة']])],
            'نوع' => [$rec, $this->body('id-srv', '50', null, ['reading_type' => 'atg', 'evidence' => ['method' => 'gauge', 'note' => 'ملاحظة']])],
            'خزان' => [$rec, $this->body('id-srv', '50', null, ['fuel_tank_id' => $this->fx['t2']->id, 'evidence' => ['method' => 'gauge', 'note' => 'ملاحظة']])],
            'ملاحظة' => [$rec, $this->body('id-srv', '50', null, ['evidence' => ['method' => 'gauge', 'note' => 'أخرى']])],
            'طريقة' => [$rec, $this->body('id-srv', '50', null, ['evidence' => ['method' => 'dipstick', 'note' => 'ملاحظة']])],
            'بلا أدلة' => [$rec, $this->body('id-srv', '50', null)],
            'فاعل' => [$other, $this->body('id-srv', '50', null, ['evidence' => ['method' => 'gauge', 'note' => 'ملاحظة']])],
            'وقت صريح بعد غيابه' => [$rec, $this->body('id-srv', '50', $now->subSeconds(30), ['evidence' => ['method' => 'gauge', 'note' => 'ملاحظة']])],
        ];
        foreach ($variants as $label => [$user, $payload]) {
            $res = $this->withToken($user['token'])->postJson(self::BASE . '/readings', $payload);
            $this->assertContains($res->status(), [422, 404], $label); // خزان من محطة أخرى ⇒ رفض قبل المقارنة
            if ($label !== 'خزان') {
                $this->assertStringContainsString('FUEL_READING_EVIDENCE_MISMATCH', $this->code($res), $label);
            }
        }
        $this->assertSame(1, FuelTankReading::count());

        // وقت صريح: الإعادة بالوقت نفسه تُرجع الأصل، وبوقت مختلف تتعارض (طلب متأخر)
        $late = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('id-late', '20', $now->subHours(3), ['late_reason' => 'سبب']))->assertStatus(202);
        $replay = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('id-late', '20', $now->subHours(3), ['late_reason' => 'سبب']))->assertOk();
        $this->assertSame($late->json('data.id'), $replay->json('data.id'));
        foreach ([$this->body('id-late', '20', $now->subHours(4), ['late_reason' => 'سبب']), $this->body('id-late', '20', $now->subHours(3), ['late_reason' => 'سبب آخر']), $this->body('id-late', '20', null)] as $payload) {
            $this->assertStringContainsString('FUEL_READING_EVIDENCE_MISMATCH', $this->code($this->withToken($rec['token'])->postJson(self::BASE . '/readings', $payload)->assertStatus(422)));
        }
        $this->assertSame(1, FuelTankReadingRequest::count());

        // بعد الاعتماد: الإعادة تُرجع الطلب (الأثر الأول)، ولا قراءة ثانية
        $apr = $this->approver();
        $this->withToken($apr['token'])->postJson(self::BASE . '/reading-requests/' . $late->json('data.id') . '/approve')->assertOk();
        $after = $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('id-late', '20', $now->subHours(3), ['late_reason' => 'سبب']))->assertOk();
        $this->assertSame($late->json('data.id'), $after->json('data.id'));
        $this->assertSame(2, FuelTankReading::count());
    }

    /** @test */
    public function legacy_readings_without_an_intent_hash_replay_by_their_visible_fields(): void
    {
        $this->buildFixture();
        $this->freeze();
        $rec = $this->recorder();
        $legacy = FuelTankReading::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_tank_id' => $this->fx['t1']->id, 'reading_type' => 'physical',
            'quantity_milliliters' => 70000, 'measured_at' => now()->subDay(), 'evidence_key' => 'legacy-k', 'evidence' => ['method' => 'gauge'], 'recorded_by' => $rec['user']->id,
        ]);
        $this->assertNull($legacy->intent_hash);

        $this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('legacy-k', '70', null, ['evidence' => ['method' => 'gauge']]))->assertOk()->assertJsonPath('data.id', $legacy->id);
        $this->assertStringContainsString('FUEL_READING_EVIDENCE_MISMATCH', $this->code($this->withToken($rec['token'])->postJson(self::BASE . '/readings', $this->body('legacy-k', '70', null, ['evidence' => ['method' => 'dipstick']]))->assertStatus(422)));
        $this->assertSame(1, FuelTankReading::count());
    }

    /** @test */
    public function the_request_service_and_model_never_reach_inventory_ledger_or_cost(): void
    {
        foreach (['app/Services/FuelTankReadingRequestService.php', 'app/Models/FuelTankReadingRequest.php', 'app/Http/Controllers/Api/FuelReadingRequestController.php'] as $file) {
            $source = (string) file_get_contents(base_path($file));
            foreach (['InventoryService', 'LedgerService', 'FuelCostBasisService', 'StockMovement', 'JournalEntry', 'FuelOperationalLedger', 'FuelReconciliation::', 'applyReceipt'] as $forbidden) {
                $this->assertStringNotContainsString($forbidden, $source, "{$file}: {$forbidden}");
            }
        }
        // الكاتب الوحيد لجدول الطلبات هو الخدمة
        foreach (glob(base_path('app/**/*.php')) ?: [] as $file) {
            // (تغطية السطحية: لا أحد غير الخدمة يستدعي forceCreate على النموذج)
        }
        $writers = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app')));
        foreach ($iterator as $file) {
            if ($file->isFile() && str_ends_with($file->getFilename(), '.php') && str_contains((string) file_get_contents($file->getPathname()), 'FuelTankReadingRequest::query()->forceCreate')) {
                $writers[] = $file->getFilename();
            }
        }
        $this->assertSame(['FuelTankReadingRequestService.php'], $writers);
    }

    /** @test */
    public function the_monitor_announces_the_effective_policy_and_who_may_submit(): void
    {
        $this->buildFixture();
        $this->freeze();
        $rec = $this->recorder();
        $row = fn () => $this->withToken($rec['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.backdating');
        $this->assertSame(['policy' => 'deny', 'max_hours' => 24, 'reason_required' => true, 'can_submit' => false], $row());
        $this->policy(['tank_reading_backdating_policy' => 'supervisor_approval', 'tank_reading_backdating_max_hours' => 6], $this->fx['s1']->id);
        $this->assertSame(['policy' => 'supervisor_approval', 'max_hours' => 6, 'reason_required' => true, 'can_submit' => true], $row());
    }
}

<?php

namespace Tests\Feature;

use App\Models\FuelStationAuditEvent;
use App\Models\FuelTank;
use App\Models\FuelTankReading;
use App\Models\Product;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B6 — قراءات الخزانات المستقلة ومراقبة المستويات: التحقق على الخادم، النطاق، idempotency، التدقيق، وعدم المساس بالمخزون والدفتر.
 */
class FuelTankReadingMonitoringTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    private function assign(string $userId, array $body): void
    {
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/staff/' . $userId, $body)->assertOk();
    }

    /** @return array{user: \App\Models\User, token: string} */
    private function supervisor(string $name = 'supervisor', ?array $stations = null): array
    {
        $u = $this->makeUser($name, 'staff');
        $this->assign($u['user']->id, ['template' => 'supervisor', 'station_ids' => $stations ?? [$this->fx['s1']->id]]);

        return $u;
    }

    /** @return array<string,mixed> */
    private function body(string $key, string $liters = '100.000', array $extra = []): array
    {
        return array_merge([
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'reading_type' => 'physical', 'quantity_liters' => $liters, 'evidence_key' => $key,
        ], $extra);
    }

    /** @return array{0:int,1:int,2:int} [المخزون، القيود، الحركات التشغيلية] */
    private function financialCounts(): array
    {
        return [
            (int) DB::table('stock_movements')->count(),
            (int) DB::table('journal_entries')->count(),
            (int) DB::table('fuel_operational_ledgers')->count(),
        ];
    }

    /** @test */
    public function a_standalone_reading_is_recorded_with_actor_time_and_audit_and_touches_no_stock_or_ledger(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $before = $this->financialCounts();
        $avgBefore = Product::query()->pluck('avg_cost', 'id')->all();

        $res = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-a', '123.456', ['evidence' => ['method' => 'dipstick', 'note' => 'قياس بالمسطرة']]))
            ->assertCreated();

        $res->assertJsonPath('data.quantity_liters', '123.456')
            ->assertJsonPath('data.quantity_milliliters', 123456)
            ->assertJsonPath('data.reading_type', 'physical')
            ->assertJsonPath('data.recorded_by', $sup['user']->id)
            ->assertJsonPath('data.recorder.name', 'supervisor')
            ->assertJsonPath('data.evidence.method', 'dipstick')
            ->assertJsonPath('data.flags', []);
        $this->assertNotNull($res->json('data.measured_at'));

        // لا أثر مخزني ولا محاسبي ولا تكلفة
        $this->assertSame($before, $this->financialCounts());
        $this->assertSame($avgBefore, Product::query()->pluck('avg_cost', 'id')->all());

        // التدقيق: الفاعل + المحطة + اللقطة
        $event = FuelStationAuditEvent::where('action', 'tank_reading.recorded')->sole();
        $this->assertSame($sup['user']->id, $event->actor_id);
        $this->assertSame($this->fx['s1']->id, $event->fuel_station_id);
        $this->assertSame(FuelTankReading::class, $event->subject_type);
    }

    /** @test */
    public function negative_malformed_and_over_capacity_quantities_are_rejected_without_a_record(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();

        foreach (['-1', '1.2345', 'abc', '', '١٢٣'] as $bad) {
            $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-bad-' . md5($bad), $bad))->assertStatus(422);
        }
        // السعة 200000 mL = 200 L: ما فوقها مرفوض بسببه، والمساوي مقبول
        $over = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-over', '200.001'))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_EXCEEDS_CAPACITY', (string) $over->json('message'));
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-edge', '200.000'))->assertCreated();
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-zero', '0'))->assertCreated();

        $this->assertSame(2, FuelTankReading::count());
    }

    /** @test */
    public function future_and_back_dated_explicit_times_are_rejected_and_server_time_is_the_default(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $now = CarbonImmutable::now();

        $future = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-future', '10', ['measured_at' => $now->addHour()->toIso8601String()]))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_FUTURE_TIME', (string) $future->json('message'));
        // ضمن سماحية انحراف الساعة (300ث افتراضياً) مقبول
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-skew', '10', ['measured_at' => $now->addSeconds(60)->toIso8601String()]))->assertCreated();

        // أقدم من آخر قراءة لنفس الخزان والنوع: مرفوض بلا سياسة
        $old = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-old', '11', ['measured_at' => $now->subHour()->toIso8601String()]))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_OLDER_THAN_LATEST', (string) $old->json('message'));
        // نوع آخر مستقل (ATG): لا يُقارن بقراءة physical
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-atg-old', '11', ['reading_type' => 'atg', 'measured_at' => $now->subHour()->toIso8601String()]))->assertCreated();
        // بلا measured_at: ساعة الخادم تُقبل دائماً ولو كانت آخر قراءة بوقت مستقبلي ضمن السماحية
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-server', '12'))->assertCreated();

        $this->assertSame(3, FuelTankReading::count());
    }

    /** @test */
    public function the_same_evidence_key_with_the_same_payload_replays_and_a_different_payload_is_rejected(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $other = $this->supervisor('supervisor2');

        $first = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-idem', '50'))->assertCreated();
        $again = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-idem', '50'))->assertOk();
        $this->assertSame($first->json('data.id'), $again->json('data.id'));
        $this->assertSame(1, FuelTankReading::count());
        $this->assertSame(1, FuelStationAuditEvent::where('action', 'tank_reading.recorded')->count());

        // كمية/نوع/خزان مختلف أو فاعل آخر بالمفتاح نفسه ⇒ رفض صريح بلا استبدال
        foreach ([
            [$sup['token'], $this->body('b6-idem', '51')],
            [$sup['token'], $this->body('b6-idem', '50', ['reading_type' => 'atg'])],
            [$other['token'], $this->body('b6-idem', '50')],
        ] as [$token, $payload]) {
            $res = $this->withToken($token)->postJson(self::BASE . '/readings', $payload)->assertStatus(422);
            $this->assertStringContainsString('FUEL_READING_EVIDENCE_MISMATCH', (string) $res->json('message'));
        }
        $this->assertSame(1, FuelTankReading::count());
    }

    /** @test */
    public function permissions_and_station_scope_are_enforced_on_the_server(): void
    {
        $this->buildFixture();
        $seller = $this->makeUser('seller', 'staff');
        $this->assign($seller['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]]);
        $sup = $this->supervisor();
        $s2only = $this->supervisor('sup-s2', [$this->fx['s2']->id]);

        // البائع يقرأ المراقبة (fuel_stations.view) لكنه لا يسجّل
        $this->withToken($seller['token'])->postJson(self::BASE . '/readings', $this->body('b6-seller'))->assertForbidden();
        $this->withToken($seller['token'])->getJson(self::BASE . '/tank-levels')->assertOk();
        // بلا أي صلاحية قراءة/عرض
        $nobody = $this->makeUser('nobody', 'viewer');
        $this->withToken($nobody['token'])->getJson(self::BASE . '/tank-levels')->assertForbidden();

        // خزان خارج محطة المستخدم أو محطة خارج نطاقه ⇒ 404 موحّد
        $this->withToken($s2only['token'])->postJson(self::BASE . '/readings', $this->body('b6-foreign'))->assertNotFound();
        // خزان محطة أخرى بمحطة المستخدم نفسه ⇒ رفض (الخزان لا ينتمي)
        $mismatch = $this->body('b6-mismatch', '10', ['fuel_tank_id' => $this->fx['t2']->id]);
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $mismatch)->assertStatus(422);
        $this->assertSame(0, FuelTankReading::count());

        // القراءة: المراقبة والسجل لا يكشفان محطة خارج النطاق
        $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels?station_id=' . $this->fx['s2']->id)->assertNotFound();
        $codes = collect($this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->assertOk()->json('data'))->pluck('tank.code')->all();
        $this->assertSame(['T-B3S1'], $codes);
        $this->withToken($sup['token'])->getJson(self::BASE . '/readings?fuel_station_id=' . $this->fx['s3']->id)->assertNotFound();
    }

    /** @test */
    public function an_inactive_tank_takes_no_readings_and_is_not_monitored(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $this->fx['t1']->forceFill(['status' => FuelTank::STATUS_INACTIVE])->save();

        $res = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-inactive'))->assertStatus(422);
        $this->assertStringContainsString('FUEL_READING_TANK_INACTIVE', (string) $res->json('message'));
        $this->assertSame([], $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->assertOk()->json('data'));
    }

    /** @test */
    public function the_monitor_reports_latest_fill_headroom_freshness_and_review_flags_without_inventing_thresholds(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $tank = $this->fx['t1'];
        $tank->forceFill(['minimum_level_milliliters' => 20000, 'dead_stock_milliliters' => 5000])->save();

        // خزان بلا قراءة
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->assertOk()->json('data.0');
        $this->assertNull($row['latest']);
        $this->assertSame('none', $row['level']['freshness']);
        $this->assertSame([], $row['level']['flags']);

        // 150 L من 200 L ⇒ 75%؛ المتاح 50 L؛ الحداثة غير مقيَّمة (لا إعداد معتمد)
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-m1', '150'))->assertCreated();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0');
        $this->assertSame('150', $row['latest']['quantity_liters']);
        $this->assertSame(7500, $row['level']['fill_basis_points']);
        $this->assertSame(50000, $row['level']['available_milliliters']);
        $this->assertSame(40000, $row['level']['safe_available_milliliters']);
        $this->assertSame('unrated', $row['level']['freshness']);
        $this->assertNull($row['level']['stale_after_minutes']);
        $this->assertFalse($row['level']['needs_review']);

        // فوق السعة الآمنة (190 L) ⇒ علم مراجعة؛ ATG أحدث يحكم "آخر قراءة" لكن النوعين يظهران
        FuelTankReading::query()->update(['measured_at' => now()->subMinutes(10)]); // تفادي التعادل في الثانية نفسها
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-m2', '195', ['reading_type' => 'atg']))->assertCreated();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0');
        $this->assertSame('atg', $row['latest']['reading_type']);
        $this->assertSame(['above_safe_capacity'], $row['level']['flags']);
        $this->assertTrue($row['level']['needs_review']);
        $this->assertSame('150', $row['latest_by_type']['physical']['quantity_liters']);

        // تحت الحدّ الأدنى المعتمد وتحت المخزون الميت
        FuelTankReading::query()->update(['measured_at' => now()->subMinutes(5)]);
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-m3', '4', ['reading_type' => 'atg']))->assertCreated();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0');
        $this->assertSame(['below_minimum_level', 'below_dead_stock'], $row['level']['flags']);

        // التنبيه لا يصنع تسوية ولا أثراً ماليّاً
        $this->assertSame(0, DB::table('fuel_reconciliations')->count());
        $this->assertSame([0, 0, 0], $this->financialCounts());
    }

    /** @test */
    public function freshness_follows_the_station_policy_only_when_configured(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-f1', '100'))->assertCreated();
        // نقدّم عمر القراءة 3 ساعات مباشرةً
        FuelTankReading::query()->update(['measured_at' => now()->subHours(3)]);

        // الإعداد عبر مسار الإعدادات القائم (بصلاحية الإدارة)
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tank_reading_stale_after_minutes' => 120])->assertOk();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0');
        $this->assertSame('stale', $row['level']['freshness']);
        $this->assertSame(120, $row['level']['stale_after_minutes']);

        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tank_reading_stale_after_minutes' => 600])->assertOk();
        $this->assertSame('fresh', $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.level.freshness'));

        // قيم غير صالحة مرفوضة
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tank_reading_stale_after_minutes' => 0])->assertStatus(422);
        // مسح الـoverride يعيد «غير مضبوطة»
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/stations/' . $this->fx['s1']->id . '/settings', ['tank_reading_stale_after_minutes' => null])->assertOk();
        $this->assertSame('unrated', $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.level.freshness'));
    }

    /** @test */
    public function the_tenant_wide_freshness_policy_can_be_set_inherited_by_stations_and_cleared(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-t1', '100'))->assertCreated();
        FuelTankReading::query()->update(['measured_at' => now()->subHours(3)]);

        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', ['tank_reading_stale_after_minutes' => 90, 'reason' => 'سياسة قِدم القراءة'])->assertOk();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.level');
        $this->assertSame(['stale', 90], [$row['freshness'], $row['stale_after_minutes']]);

        // مسح مستوى المؤسسة يعيد «غير مضبوطة»
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', ['tank_reading_stale_after_minutes' => null, 'reason' => 'مسح'])->assertOk();
        $row = $this->withToken($sup['token'])->getJson(self::BASE . '/tank-levels')->json('data.0.level');
        $this->assertSame(['unrated', null], [$row['freshness'], $row['stale_after_minutes']]);

        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/settings', ['tank_reading_stale_after_minutes' => 50000, 'reason' => 'x'])->assertStatus(422);
    }

    /** @test */
    public function the_history_is_paginated_newest_first_and_the_legacy_unpaginated_list_is_preserved(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        foreach (range(1, 5) as $i) {
            $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body("b6-h{$i}", (string) (10 * $i)))->assertCreated();
        }

        $page = $this->withToken($sup['token'])->getJson(self::BASE . '/readings?fuel_tank_id=' . $this->fx['t1']->id . '&per_page=2')->assertOk();
        $this->assertCount(2, $page->json('data'));
        $this->assertSame(5, $page->json('meta.total'));
        $this->assertSame('50', $page->json('data.0.quantity_liters')); // الأحدث أولاً
        $this->assertSame(['physical'], array_values(array_unique(array_column($page->json('data'), 'reading_type'))));

        $legacy = $this->withToken($sup['token'])->getJson(self::BASE . '/readings')->assertOk();
        $this->assertCount(5, $legacy->json('data'));
        $this->assertNull($legacy->json('meta'));
        $this->withToken($sup['token'])->getJson(self::BASE . '/readings?reading_type=atg')->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function tenants_are_isolated_and_readings_stay_immutable(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        $res = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('b6-iso', '10'))->assertCreated();
        $reading = FuelTankReading::findOrFail($res->json('data.id'));

        $other = $this->registerTenant('fuel-b6-other', 'owner@fuel-b6-other.test', autoEnableApplications: true);
        $this->withToken($other['token'])->getJson(self::BASE . '/tank-levels')->assertForbidden(); // بلا قدرة الوقود
        // مستأجر آخر لا يرى الخزانات ولا القراءات
        app(\App\Tenancy\TenantContext::class)->set($other['tenant_id']);
        $this->assertSame(0, FuelTankReading::count());
        app(\App\Tenancy\TenantContext::class)->set($this->tenantId);

        $this->expectException(\LogicException::class);
        $reading->update(['quantity_milliliters' => 1]);
    }

    /** @test */
    public function the_writer_cannot_reach_inventory_ledger_or_cost_services(): void
    {
        $source = (string) file_get_contents(base_path('app/Services/FuelReconciliationService.php'));
        $start = strpos($source, 'public function recordReading');
        $end = strpos($source, 'public function createDraft');
        $body = substr($source, $start, $end - $start);
        foreach (['inventory->', 'ledger->', 'costBasis->', 'StockMovement', 'JournalEntry', 'FuelOperationalLedger', 'applyReceipt', 'recordReceipt'] as $forbidden) {
            $this->assertStringNotContainsString($forbidden, $body, "قراءة الخزان لا تمس {$forbidden}");
        }
        $monitor = (string) file_get_contents(base_path('app/Services/FuelTankLevelMonitor.php'));
        foreach (['::create(', '->save(', '->update(', 'DB::table', 'insert(', 'delete('] as $write) {
            $this->assertStringNotContainsString($write, $monitor, "مراقب المستويات قراءة فقط: {$write}");
        }
    }

    /** @test */
    public function legacy_receiving_and_shift_readings_are_unaffected(): void
    {
        $this->buildFixture();
        $sup = $this->supervisor();
        // قراءتا استلام قبل/بعد في تعاقب سريع (المسار القائم في تطبيق الاستلام) تُقبلان
        $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('rcv-before', '100.000'))->assertCreated();
        $after = $this->withToken($sup['token'])->postJson(self::BASE . '/readings', $this->body('rcv-after', '110.000'))->assertCreated();
        $payload = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b6-legacy') + ['after_physical_reading_id' => $after->json('data.id')];
        $this->withToken($sup['token'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated();
    }
}

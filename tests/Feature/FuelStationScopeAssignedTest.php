<?php

namespace Tests\Feature;

use App\Models\User;
use App\Services\FuelShiftService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * FUEL-B3 — نطاق المحطة المسنَدة (`users.fuel_station_scope = assigned` + `fuel_station_user`) مفروضٌ على الخادم في كل خدمات الوقود:
 * الاستلام، القراءات، التسويات، فواتير الموردين، الورديات، المبيعات، التقارير، سجل التدقيق، الإعدادات، سعر المؤسسة. يتقاطع مع الفرع والمستودع.
 * وسياسة الغياب صريحة: المقيَّد بلا محطة لا يصل لشيء، والقديم (بلا وضع) كما كان.
 */
class FuelStationScopeAssignedTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    /** مفاتيح تشغيلية واسعة (قديمة + دقيقة) لنختبر أن النطاق وحده هو الحاجز. @return list<string> */
    private function broad(): array
    {
        return [
            'fuel_stations.view', 'fuel_stations.manage',
            'fuel.shift.view', 'fuel.shift.open', 'fuel.shift.close', 'fuel.shift.approve', 'fuel.shift.cash_count',
            'fuel.sale.view', 'fuel.sale.create', 'fuel.sale.price.manage', 'fuel.reports.view',
            'fuel.delivery.view', 'fuel.delivery.create', 'fuel.delivery.approve', 'fuel.reading.view', 'fuel.reading.record',
            'fuel.reconciliation.view', 'fuel.reconciliation.create', 'fuel.reconciliation.approve',
        ];
    }

    /** يزرع بيانات على s1 وs2 بيد المالك. @return array<string, array<string, mixed>> */
    private function seedStations(): array
    {
        $o = $this->fx['owner'];
        $out = [];
        foreach (['s1' => ['t1', 'wA1'], 's2' => ['t2', 'wA2']] as $s => [$t, $w]) {
            $station = $this->fx[$s];
            $delivery = $this->withToken($o)->postJson(self::BASE . '/deliveries', $this->deliveryPayload($station, $this->fx[$t], $this->fx[$w], "seed-{$s}"))->assertCreated()->json('data');
            $reading = $this->withToken($o)->postJson(self::BASE . '/readings', [
                'fuel_station_id' => $station->id, 'fuel_tank_id' => $this->fx[$t]->id, 'reading_type' => 'physical', 'quantity_liters' => '0', 'evidence_key' => "seed-ev-{$s}",
            ])->assertCreated()->json('data');
            $draft = $this->withToken($o)->postJson(self::BASE . '/reconciliations', ['fuel_station_id' => $station->id, 'fuel_tank_id' => $this->fx[$t]->id, 'physical_reading_id' => $reading['id']])->assertCreated()->json('data');
            $shift = $this->withToken($o)->postJson(self::BASE . '/shifts/open', ['fuel_station_id' => $station->id, 'idempotency_key' => "seed-shift-{$s}", 'opening_float_minor' => 0])->assertCreated()->json('data');
            $out[$s] = compact('delivery', 'reading', 'draft', 'shift');
        }

        return $out;
    }

    /** @test */
    public function a_station_scoped_user_reaches_only_their_assigned_stations_across_every_fuel_surface(): void
    {
        $this->buildFixture();
        $seed = $this->seedStations();
        $s1 = $this->fx['s1'];
        $s2 = $this->fx['s2'];
        $u = $this->makeUser('scoped', 'fuel-b3-broad', $this->broad(), stations: [$s1->id]);
        $t = $u['token'];

        // ماستر/مساحة العمل
        $this->assertSame([$s1->id], collect($this->withToken($t)->getJson(self::BASE . '/stations')->assertOk()->json('data'))->pluck('id')->intersect([$s1->id, $s2->id, $this->fx['s3']->id])->values()->all());
        $this->withToken($t)->getJson(self::BASE . '/stations/' . $s2->id . '/settings')->assertNotFound();
        $this->withToken($t)->getJson(self::BASE . '/stations/' . $s1->id . '/settings')->assertOk();
        $this->withToken($t)->putJson(self::BASE . '/stations/' . $s2->id . '/settings', ['shift_mandatory_cash_count' => false])->assertNotFound();

        // الاستلام
        $this->assertSame([$seed['s1']['delivery']['id']], collect($this->withToken($t)->getJson(self::BASE . '/deliveries')->assertOk()->json('data'))->pluck('id')->all());
        $this->withToken($t)->getJson(self::BASE . '/deliveries/' . $seed['s2']['delivery']['id'])->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/deliveries/' . $seed['s2']['delivery']['id'] . '/approve')->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/deliveries', $this->deliveryPayload($s2, $this->fx['t2'], $this->fx['wA2'], 'scoped-out'))->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/deliveries', $this->deliveryPayload($s1, $this->fx['t1'], $this->fx['wA1'], 'scoped-in'))->assertCreated();

        // القراءات والتسويات
        $this->assertSame([$seed['s1']['reading']['id']], collect($this->withToken($t)->getJson(self::BASE . '/readings')->assertOk()->json('data'))->pluck('id')->all());
        $this->withToken($t)->postJson(self::BASE . '/readings', ['fuel_station_id' => $s2->id, 'fuel_tank_id' => $this->fx['t2']->id, 'reading_type' => 'physical', 'quantity_liters' => '1', 'evidence_key' => 'scoped-ev'])->assertNotFound();
        $this->assertSame([$seed['s1']['draft']['id']], collect($this->withToken($t)->getJson(self::BASE . '/reconciliations')->assertOk()->json('data'))->pluck('id')->all());
        $this->withToken($t)->postJson(self::BASE . '/reconciliations', ['fuel_station_id' => $s2->id, 'fuel_tank_id' => $this->fx['t2']->id])->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/reconciliations/' . $seed['s2']['draft']['id'] . '/approve')->assertNotFound();

        // الورديات
        $shifts = collect($this->withToken($t)->getJson(self::BASE . '/shifts')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($seed['s1']['shift']['id'], $shifts);
        $this->assertNotContains($seed['s2']['shift']['id'], $shifts);
        $this->withToken($t)->getJson(self::BASE . '/shifts/' . $seed['s2']['shift']['id'])->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/shifts/open', ['fuel_station_id' => $s2->id, 'idempotency_key' => 'scoped-open-out', 'opening_float_minor' => 0])->assertNotFound();

        // المبيعات + سعر المؤسسة + التقارير + التدقيق + مساحة العمل
        $this->withToken($t)->postJson(self::BASE . '/sales', [
            'fuel_station_id' => $s2->id, 'fuel_nozzle_id' => '00000000-0000-4000-8000-0000000000aa', 'quantity_milliliters' => 1000, 'idempotency_key' => 'scoped-sale-out',
        ])->assertNotFound();
        $this->withToken($t)->postJson(self::BASE . '/prices', ['fuel_product_id' => $this->fx['fuel']->id, 'price_per_liter_minor' => 233, 'idempotency_key' => 'org-price', 'start_now' => true])->assertForbidden();
        $this->withToken($t)->getJson(self::BASE . '/reports/sales?station_id=' . $s2->id)->assertNotFound();
        $this->withToken($t)->getJson(self::BASE . '/reports/sales')->assertOk();
        $events = collect($this->withToken($t)->getJson(self::BASE . '/audit-events')->assertOk()->json('data'))->pluck('fuel_station_id')->unique()->values()->all();
        $this->assertNotContains($s2->id, $events);
        $workspace = json_encode($this->withToken($t)->getJson(self::BASE . '/workspace')->assertOk()->json());
        $this->assertStringContainsString($s1->code, $workspace);
        $this->assertStringNotContainsString($s2->code, $workspace);
    }

    /** @test */
    public function a_scoped_user_with_no_assigned_stations_sees_nothing_while_a_legacy_unscoped_user_with_the_same_role_sees_everything(): void
    {
        $this->buildFixture();
        $seed = $this->seedStations();
        $empty = $this->makeUser('empty', 'fuel-b3-broad', $this->broad(), stations: []);   // مقيَّد صراحةً بلا محطة
        $legacy = $this->makeUser('legacy', 'fuel-b3-broad2', $this->broad());               // دور قديم، بلا وضع نطاق

        $this->assertTrue($empty['user']->isFuelStationScoped());
        $this->assertSame([], $empty['user']->allowedFuelStationIds());
        $this->assertNull($legacy['user']->allowedFuelStationIds());

        foreach (['/stations', '/deliveries', '/readings', '/reconciliations', '/shifts', '/audit-events'] as $path) {
            $this->assertSame([], $this->withToken($empty['token'])->getJson(self::BASE . $path)->assertOk()->json('data'), "scoped-empty {$path}");
        }
        $this->withToken($empty['token'])->getJson(self::BASE . '/deliveries/' . $seed['s1']['delivery']['id'])->assertNotFound();
        $this->withToken($empty['token'])->postJson(self::BASE . '/deliveries/' . $seed['s1']['delivery']['id'] . '/approve')->assertNotFound();
        $this->withToken($empty['token'])->postJson(self::BASE . '/shifts/open', ['fuel_station_id' => $this->fx['s1']->id, 'idempotency_key' => 'empty-open', 'opening_float_minor' => 0])->assertNotFound();

        // القديم: كل المحطات كما كان (لا تقييد ضمني جديد على الأدوار القديمة).
        $this->assertGreaterThanOrEqual(3, count($this->withToken($legacy['token'])->getJson(self::BASE . '/stations')->assertOk()->json('data')));
        $this->assertCount(2, $this->withToken($legacy['token'])->getJson(self::BASE . '/deliveries')->assertOk()->json('data'));
        $this->withToken($legacy['token'])->getJson(self::BASE . '/deliveries/' . $seed['s2']['delivery']['id'])->assertOk();
    }

    /** @test */
    public function the_station_scope_intersects_with_the_branch_and_warehouse_scope_never_widening_them(): void
    {
        $this->buildFixture();
        $seed = $this->seedStations();
        $f = $this->fx;

        // مسنَد له s1 وs3 لكنه مقيَّد بالفرع A: s3 (فرع ب) خارج التقاطع.
        $byBranch = $this->makeUser('by-branch', 'fuel-b3-broad', $this->broad(), stations: [$f['s1']->id, $f['s3']->id], branches: [$f['branchA']->id]);
        $ids = collect($this->withToken($byBranch['token'])->getJson(self::BASE . '/stations')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertContains($f['s1']->id, $ids);
        $this->assertNotContains($f['s3']->id, $ids);
        $this->assertNotContains($f['s2']->id, $ids);

        // مسنَد له s1 لكنه مقيَّد بمستودع آخر (wA2): لا يصل لمحطته.
        $byWarehouse = $this->makeUser('by-wh', 'fuel-b3-broad3', $this->broad(), stations: [$f['s1']->id], warehouses: [$f['wA2']->id]);
        $this->withToken($byWarehouse['token'])->getJson(self::BASE . '/deliveries/' . $seed['s1']['delivery']['id'])->assertNotFound();
        $this->assertSame([], $this->withToken($byWarehouse['token'])->getJson(self::BASE . '/deliveries')->assertOk()->json('data'));
        // والمحطة s2 (في wA2) غير مسنَدة له ⇒ لا تفتحها صلاحية مستودعه.
        $this->withToken($byWarehouse['token'])->getJson(self::BASE . '/deliveries/' . $seed['s2']['delivery']['id'])->assertNotFound();
    }

    /** @test */
    public function the_services_enforce_the_station_scope_even_when_called_directly_with_an_actor(): void
    {
        $this->buildFixture();
        $seed = $this->seedStations();
        $scoped = $this->makeUser('svc', 'fuel-b3-broad', $this->broad(), stations: [$this->fx['s1']->id]);
        $service = app(FuelShiftService::class);

        // الخدمة وحدها (بلا متحكم) ترفض فتح/اعتماد/إسناد خارج المحطات المسنَدة.
        $this->expectException(RuntimeException::class);
        try {
            $service->open(['fuel_station_id' => $this->fx['s2']->id, 'idempotency_key' => 'svc-open-out', 'opening_float_minor' => 0], $scoped['user']);
        } finally {
            $this->assertSame(1, DB::table('fuel_shifts')->where('fuel_station_id', $this->fx['s2']->id)->count(), 'لا وردية جديدة على s2');
            $this->assertNotNull($seed);
        }
    }

    /** @test */
    public function a_scoped_attendant_cannot_be_assigned_to_a_shift_of_a_station_they_do_not_have(): void
    {
        $this->buildFixture();
        $seed = $this->seedStations();
        $attendant = $this->makeUser('att', 'fuel-b3-att', ['fuel_stations.view', 'fuel.shift.view', 'fuel.shift.open'], stations: [$this->fx['s1']->id]);
        $o = $this->fx['owner'];

        // وردية s2 (خارج محطته): مرفوض. وردية s1: مقبول.
        $this->withToken($o)->postJson(self::BASE . '/shifts/' . $seed['s2']['shift']['id'] . '/staff', ['user_id' => $attendant['user']->id, 'role' => 'attendant'])->assertStatus(422);
        $this->withToken($o)->postJson(self::BASE . '/shifts/' . $seed['s1']['shift']['id'] . '/staff', ['user_id' => $attendant['user']->id, 'role' => 'attendant'])->assertSuccessful();
    }

    /** @test */
    public function the_scope_mode_cannot_be_set_through_the_general_users_screen(): void
    {
        $this->buildFixture();
        $e = $this->makeUser('emp', 'staff');

        $this->withToken($this->fx['owner'])->putJson('/api/users/' . $e['user']->id, ['name' => 'emp', 'fuel_station_scope' => 'assigned'])->assertSuccessful();
        $this->assertNull(DB::table('users')->where('id', $e['user']->id)->value('fuel_station_scope'));
        $this->assertNotContains('fuel_station_scope', (new User())->getFillable());
    }

    /** @test */
    public function nothing_outside_the_staff_service_writes_the_scope_mode_or_assignments(): void
    {
        $offenders = [];
        $iterator = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path(), \FilesystemIterator::SKIP_DOTS));
        foreach ($iterator as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php' || in_array($file->getFilename(), ['FuelStaffAccessService.php', 'User.php'], true)) {
                continue;
            }
            $source = (string) file_get_contents($file->getPathname());
            if (preg_match('/fuel_station_scope|fuelStations\(\)->(sync|attach|detach|toggle)|fuel_station_user/', $source) === 1
                && ! in_array($file->getFilename(), ['UserController.php', 'AuthorizesFuelStationScope.php', 'AccessChangeAuditReader.php'], true)) {
                $offenders[] = $file->getPathname();
            }
            // المتحكم العام وقارئ سجل التدقيق (B4، قراءة فقط) يذكران مفتاح الوضع للتدقيق/العرض فقط: لا كتابة (لا sync/attach/forceFill/update بالوضع).
            if (in_array($file->getFilename(), ['UserController.php', 'AccessChangeAuditReader.php'], true) && preg_match('/fuelStations\(\)->(sync|attach|detach|toggle)|forceFill\([^)]*fuel_station_scope/', $source) === 1) {
                $offenders[] = $file->getPathname();
            }
        }

        $this->assertSame([], $offenders);
    }

    /** @test */
    public function deleting_a_station_or_a_user_removes_assignments_but_keeps_the_rest_and_the_fail_closed_mode(): void
    {
        $this->buildFixture();
        $u = $this->makeUser('two', 'staff', stations: [$this->fx['s1']->id, $this->fx['s2']->id]);

        DB::table('fuel_tanks')->where('fuel_station_id', $this->fx['s2']->id)->delete();
        DB::table('fuel_stations')->where('id', $this->fx['s2']->id)->delete();
        $this->assertSame([$this->fx['s1']->id], $u['user']->fresh()->allowedFuelStationIds());

        DB::table('fuel_tanks')->where('fuel_station_id', $this->fx['s1']->id)->delete();
        DB::table('fuel_stations')->where('id', $this->fx['s1']->id)->delete();
        // آخر محطة حُذفت: يبقى مقيَّداً بلا محطة (لا يعود «غير مقيَّد» بالسهو).
        $this->assertSame([], $u['user']->fresh()->allowedFuelStationIds());

        DB::table('users')->where('id', $u['user']->id)->delete();
        $this->assertSame(0, DB::table('fuel_station_user')->where('user_id', $u['user']->id)->count());
    }
}

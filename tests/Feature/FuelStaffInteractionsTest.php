<?php

namespace Tests\Feature;

use App\Models\User;
use App\Support\FuelStaffTemplates;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B3 — تفاعل القوالب والنطاق مع بقية الضوابط: القوالب تعمل فعلاً على المسارات الحقيقية، لا تتجاوز فصل المعتمِد ولا الحوكمة،
 * والأدوار المخزَّنة القديمة تستمر كما كانت، وسحب صلاحية يسري فوراً.
 */
class FuelStaffInteractionsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    private function assign(string $userId, array $body): void
    {
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/staff/' . $userId, $body)->assertOk();
    }

    /** @test */
    public function seller_supervisor_and_manager_templates_work_on_the_real_routes_and_a_revoked_permission_takes_effect_immediately(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $seller = $this->makeUser('seller', 'staff');
        $supervisor = $this->makeUser('supervisor', 'staff');
        $manager = $this->makeUser('manager', 'staff');
        $this->assign($seller['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);
        $this->assign($supervisor['user']->id, ['template' => 'supervisor', 'station_ids' => [$s1->id]]);
        $this->assign($manager['user']->id, ['template' => 'station_manager', 'station_ids' => [$s1->id]]);
        $payload = fn (string $key) => $this->deliveryPayload($s1, $this->fx['t1'], $this->fx['wA1'], $key);

        // البائع: يفتح وردية في محطته؛ لا يسجّل استلاماً ولا يعتمد ولا يدير الإعدادات.
        $this->withToken($seller['token'])->postJson(self::BASE . '/shifts/open', ['fuel_station_id' => $s1->id, 'idempotency_key' => 'tpl-open', 'opening_float_minor' => 0])->assertCreated();
        $this->withToken($seller['token'])->postJson(self::BASE . '/deliveries', $payload('tpl-seller'))->assertForbidden();
        $this->withToken($seller['token'])->putJson(self::BASE . '/stations/' . $s1->id . '/settings', ['shift_mandatory_cash_count' => false])->assertForbidden();

        // المشرف: ينشئ استلاماً ولا يعتمده.
        $delivery = $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries', $payload('tpl-sup'))->assertCreated()->json('data');
        $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertForbidden();
        $this->withToken($supervisor['token'])->postJson(self::BASE . '/supplier-invoices', [])->assertForbidden();

        // مدير المحطة: يعتمد استلام غيره.
        $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk()->assertJsonPath('data.status', 'approved');

        // السحب الفردي يسري فوراً بلا إعادة دخول.
        $this->assign($seller['user']->id, ['remove_permissions' => ['fuel.shift.open']]);
        $this->withToken($seller['token'])->postJson(self::BASE . '/shifts/open', ['fuel_station_id' => $s1->id, 'idempotency_key' => 'tpl-open-2', 'opening_float_minor' => 0])->assertForbidden();
    }

    /** @test */
    public function a_template_granted_approver_is_still_bound_by_the_distinct_approver_policy(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $manager = $this->makeUser('manager', 'staff');
        $this->assign($manager['user']->id, ['template' => 'station_manager', 'station_ids' => [$s1->id]]);
        $payload = $this->deliveryPayload($s1, $this->fx['t1'], $this->fx['wA1'], 'tpl-sod');

        // سياسة فصل المعتمِد تسري (المحطة «جديدة» بحدّ ماضٍ): منح مفتاح الاعتماد بقالب لا يتجاوزها.
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $delivery = $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated()->json('data');
        $response = $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $delivery['id'])->value('status'));
        $this->assertSame(0, DB::table('stock_movements')->count());

        // ويعتمدها غيره (المالك) فقط.
        $this->withToken($this->fx['owner'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();
    }

    /** @test */
    public function no_staff_template_or_delegation_path_can_change_the_distinct_approver_policy(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $stationManager = $this->makeUser('manager', 'staff');
        $this->assign($stationManager['user']->id, ['template' => 'station_manager', 'station_ids' => [$s1->id]]);
        $key = 'fuel_distinct_approver_required';

        // قالب مدير المحطة بلا `fuel_stations.manage` ولا حوكمة: لا يصل لمسار الإعدادات أصلاً.
        $this->withToken($stationManager['token'])->putJson(self::BASE . '/stations/' . $s1->id . '/settings', [$key => false])->assertForbidden();

        // حتى لو مُنح `fuel_stations.manage` فردياً (قرار المالك): الحوكمة مفتاح آخر لا يأتي به ذلك.
        $this->assign($stationManager['user']->id, ['add_permissions' => ['fuel_stations.manage']]);
        $this->withToken($stationManager['token'])->putJson(self::BASE . '/stations/' . $s1->id . '/settings', [$key => false])->assertForbidden();
        $this->withToken($stationManager['token'])->putJson(self::BASE . '/stations/' . $s1->id . '/settings', ['shift_mandatory_cash_count' => false])->assertOk(); // بقية الإعدادات كما كانت

        // مدير يملك `fuel.staff.manage` ويملك حتى `fuel_stations.manage` لا يمنح أحداً الحوكمة، ولا يحصل عليها بنفسه.
        $delegate = $this->makeUser('delegate', 'fuel-b3-delegate', [...$this->managerPermissions(), 'fuel_stations.manage', 'fuel_stations.view']);
        $employee = $this->makeUser('emp', 'staff');
        $this->withToken($delegate['token'])->putJson(self::BASE . '/staff/' . $employee['user']->id, ['add_permissions' => ['fuel.governance.manage']])->assertForbidden();
        $this->withToken($delegate['token'])->putJson(self::BASE . '/stations/' . $s1->id . '/settings', [$key => false])->assertForbidden();
    }

    /** @test */
    public function a_stored_legacy_role_keeps_working_unchanged_and_sits_above_a_lower_staff_manager(): void
    {
        $this->buildFixture();
        $legacy = $this->makeUser('legacy', 'fuel-b3-legacy', ['fuel_stations.view', 'fuel_stations.manage']);
        $s1 = $this->fx['s1'];

        // سلوكه القديم حرفياً: كل المحطات، إنشاء واعتماد بنفسه (السياسة غير مفعّلة على محطة قائمة).
        $this->assertNull($legacy['user']->allowedFuelStationIds());
        $this->assertGreaterThanOrEqual(3, count($this->withToken($legacy['token'])->getJson(self::BASE . '/stations')->assertOk()->json('data')));
        $delivery = $this->withToken($legacy['token'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($s1, $this->fx['t1'], $this->fx['wA1'], 'legacy-1'))->assertCreated()->json('data');
        $this->withToken($legacy['token'])->postJson(self::BASE . '/deliveries/' . $delivery['id'] . '/approve')->assertOk();

        // مدير موظفين لا يملك `fuel_stations.manage` لا يستطيع تعديله (صلاحياته فوق سقفه)؛ المالك يستطيع تحويله إلى قالب.
        $mgr = $this->makeUser('mgr', 'fuel-b3-mgr', $this->managerPermissions());
        $this->withToken($mgr['token'])->putJson(self::BASE . '/staff/' . $legacy['user']->id, ['template' => 'seller'])->assertForbidden();
        $this->assertSame('fuel-b3-legacy', $legacy['user']->fresh()->role);
        $this->assign($legacy['user']->id, ['template' => 'seller', 'station_ids' => [$s1->id]]);
        $this->assertSame([$s1->id], $legacy['user']->fresh()->allowedFuelStationIds());
        // الدور القديم نفسه (المشترك) لم يُمسّ.
        $this->assertSame(['fuel_stations.view', 'fuel_stations.manage'], \App\Models\Role::where('slug', 'fuel-b3-legacy')->value('permissions'));
    }

    /** @test */
    public function the_staff_listing_shows_managed_employees_with_their_template_and_stations(): void
    {
        $this->buildFixture();
        $a = $this->makeUser('emp-a', 'staff');
        $b = $this->makeUser('emp-b', 'staff');
        $this->makeUser('plain', 'staff');
        $this->assign($a['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]]);
        $this->assign($b['user']->id, ['template' => 'supervisor', 'station_ids' => [$this->fx['s1']->id, $this->fx['s2']->id]]);

        $rows = collect($this->withToken($this->fx['owner'])->getJson(self::BASE . '/staff')->assertOk()->json('data'))->keyBy('user.id');
        $this->assertCount(2, $rows);
        $this->assertSame('seller', $rows[$a['user']->id]['template']);
        $this->assertSame('supervisor', $rows[$b['user']->id]['template']);
        $this->assertCount(2, $rows[$b['user']->id]['station_ids']);
        $this->assertSame(FuelStaffTemplates::permissions('supervisor'), $rows[$b['user']->id]['fuel_permissions']);
        $this->assertNotNull(User::find($a['user']->id));
    }
}

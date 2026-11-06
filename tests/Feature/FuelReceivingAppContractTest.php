<?php

namespace Tests\Feature;

use App\Models\FuelDelivery;
use App\Models\FuelTankReading;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\StockMovement;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * FUEL-B5 — عقد استلام الوقود كما يستهلكه تطبيق المحطة: قائمة الموردين الجديدة (قراءة فقط ومحدودة الحقول)، إثراء استجابة الاستلام
 * (إضافي بلا كسر)، وسلوك الدورة الفعلي (لا أثر مخزني/محاسبي قبل الاعتماد، اعتماد واحد، فصل المعتمِد، النطاق، حجب التكلفة).
 */
class FuelReceivingAppContractTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    private function assign(string $userId, array $body): void
    {
        $this->withToken($this->fx['owner'])->putJson(self::BASE . '/staff/' . $userId, $body)->assertOk();
    }

    /** @return array{supervisor: array, manager: array} */
    private function staff(): array
    {
        $s1 = $this->fx['s1'];
        $supervisor = $this->makeUser('supervisor', 'staff');
        $manager = $this->makeUser('manager', 'staff');
        $this->assign($supervisor['user']->id, ['template' => 'supervisor', 'station_ids' => [$s1->id]]);
        $this->assign($manager['user']->id, ['template' => 'station_manager', 'station_ids' => [$s1->id]]);

        return ['supervisor' => $supervisor, 'manager' => $manager];
    }

    /** @test */
    public function the_supplier_list_is_permissioned_minimal_and_limited_to_active_suppliers(): void
    {
        $this->buildFixture();
        $seller = $this->makeUser('seller', 'staff');
        $this->assign($seller['user']->id, ['template' => 'seller', 'station_ids' => [$this->fx['s1']->id]]);
        ['supervisor' => $supervisor] = $this->staff();
        Partner::create(['branch_id' => $this->fx['branchA']->id, 'type' => 'supplier', 'name' => 'مورد غير نشط', 'is_active' => false]);
        Partner::create(['branch_id' => $this->fx['branchA']->id, 'type' => 'customer', 'name' => 'عميل لا مورد', 'is_active' => true]);
        Partner::create(['branch_id' => $this->fx['branchA']->id, 'type' => 'both', 'name' => 'مورد وعميل', 'is_active' => true, 'vat_number' => '300000000000003', 'email' => 'secret@vendor.test']);

        // البائع بلا صلاحية إنشاء الاستلام: ممنوع. المشرف: مسموح.
        $this->withToken($seller['token'])->getJson(self::BASE . '/delivery-suppliers')->assertForbidden();
        $rows = $this->withToken($supervisor['token'])->getJson(self::BASE . '/delivery-suppliers')->assertOk()->json('data');

        $names = collect($rows)->pluck('name')->all();
        $this->assertContains('مورد B3', $names);
        $this->assertContains('مورد وعميل', $names);
        $this->assertNotContains('مورد غير نشط', $names);
        $this->assertNotContains('عميل لا مورد', $names);
        foreach ($rows as $row) {
            $this->assertEqualsCanonicalizing(['id', 'name', 'code'], array_keys($row)); // لا ضريبة ولا بريد ولا رصيد
        }
        $this->assertStringNotContainsString('secret@vendor.test', json_encode($rows));

        $found = $this->withToken($supervisor['token'])->getJson(self::BASE . '/delivery-suppliers?q=' . urlencode('وعميل'))->assertOk()->json('data');
        $this->assertSame(['مورد وعميل'], collect($found)->pluck('name')->all());
        $this->flushHeaders();
        $this->getJson(self::BASE . '/delivery-suppliers')->assertUnauthorized();
    }

    /** @test */
    public function the_delivery_resource_gains_names_creator_and_linked_readings_without_exposing_cost_to_a_cost_blind_user(): void
    {
        $this->buildFixture();
        ['supervisor' => $supervisor] = $this->staff();
        $s1 = $this->fx['s1'];
        $t1 = $this->fx['t1'];
        $before = $this->withToken($supervisor['token'])->postJson(self::BASE . '/readings', [
            'fuel_station_id' => $s1->id, 'fuel_tank_id' => $t1->id, 'reading_type' => 'physical', 'quantity_liters' => '100.000', 'evidence_key' => 'b5-before',
        ])->assertCreated()->json('data');
        $after = $this->withToken($supervisor['token'])->postJson(self::BASE . '/readings', [
            'fuel_station_id' => $s1->id, 'fuel_tank_id' => $t1->id, 'reading_type' => 'physical', 'quantity_liters' => '110.000', 'evidence_key' => 'b5-after',
        ])->assertCreated()->json('data');

        $payload = $this->deliveryPayload($s1, $t1, $this->fx['wA1'], 'b5-dlv-1') + [
            'tanker_identifier' => 'TNK-1', 'driver_name' => 'سائق', 'before_physical_reading_id' => $before['id'], 'after_physical_reading_id' => $after['id'],
        ];
        $created = $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated()->json('data');

        $this->assertSame($supervisor['user']->id, $created['created_by']);
        $this->assertArrayNotHasKey('received_total_cost_minor', $created); // المشرف بلا products.view_cost
        $this->assertSame('TNK-1', $created['tanker_identifier']);
        $this->assertSame($before['id'], $created['readings']['before_physical']['id']);
        $this->assertNull($created['readings']['before_atg']);

        $show = $this->withToken($supervisor['token'])->getJson(self::BASE . '/deliveries/' . $created['id'])->assertOk()->json('data');
        $this->assertSame('مورد B3', $show['supplier']['name']);
        $this->assertSame('T-B3S1', $show['tank']['code']);
        $this->assertSame(110000, $show['readings']['after_physical']['quantity_milliliters']);
        $this->assertArrayNotHasKey('received_total_cost_minor', $show);

        // المالك (يملك التكلفة عبر *) يراها كما كان.
        $owner = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/deliveries/' . $created['id'])->assertOk()->json('data');
        $this->assertSame(2345, $owner['received_total_cost_minor']);
    }

    /** @test */
    public function nothing_touches_stock_or_the_ledger_before_approval_and_approval_applies_once(): void
    {
        $this->buildFixture();
        ['supervisor' => $supervisor, 'manager' => $manager] = $this->staff();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $payload = $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b5-dlv-2');

        $movements = StockMovement::count();
        $entries = JournalEntry::count();
        $draft = $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries', $payload)->assertCreated()->json('data');
        $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries', $payload)->assertOk(); // إعادة بالمفتاح نفسه
        $this->assertSame(1, FuelDelivery::count());
        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($entries, JournalEntry::count());

        // المشرف لا يعتمد (لا مفتاح)، والمدير يعتمد استلام غيره.
        $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries/' . $draft['id'] . '/approve')->assertForbidden();
        $this->assertSame($movements, StockMovement::count());
        $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries/' . $draft['id'] . '/approve')->assertOk()->assertJsonPath('data.status', 'approved');
        $this->assertSame($movements + 1, StockMovement::count());
        $this->assertSame($entries + 1, JournalEntry::count());

        // اعتماد ثانٍ مرفوض بلا أي أثر إضافي.
        $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries/' . $draft['id'] . '/approve')->assertStatus(422);
        $this->withToken($this->fx['owner'])->postJson(self::BASE . '/deliveries/' . $draft['id'] . '/approve')->assertStatus(422);
        $this->assertSame($movements + 1, StockMovement::count());
        $this->assertSame($entries + 1, JournalEntry::count());
        $this->assertSame(1, \App\Models\FuelOperationalLedger::where('source_id', $draft['id'])->count());
    }

    /** @test */
    public function the_creator_cannot_approve_their_own_delivery_when_the_station_policy_applies(): void
    {
        $this->buildFixture();
        ['manager' => $manager] = $this->staff();
        config(['fuel_stations.distinct_approver_cutover_at' => '2000-01-01T00:00:00Z']);
        $draft = $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($this->fx['s1'], $this->fx['t1'], $this->fx['wA1'], 'b5-dlv-3'))->assertCreated()->json('data');
        $this->assertSame($manager['user']->id, $draft['created_by']);

        $movements = StockMovement::count();
        $response = $this->withToken($manager['token'])->postJson(self::BASE . '/deliveries/' . $draft['id'] . '/approve')->assertStatus(422);
        $this->assertStringContainsString('FUEL_DISTINCT_APPROVER_REQUIRED', (string) $response->json('message'));
        $this->assertSame('draft', DB::table('fuel_deliveries')->where('id', $draft['id'])->value('status'));
        $this->assertSame($movements, StockMovement::count());
    }

    /** @test */
    public function the_station_scope_hides_other_stations_deliveries_and_refuses_creating_for_them(): void
    {
        $this->buildFixture();
        ['supervisor' => $supervisor] = $this->staff();
        $other = $this->withToken($this->fx['owner'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($this->fx['s2'], $this->fx['t2'], $this->fx['wA2'], 'b5-dlv-other'))->assertCreated()->json('data');

        $listed = collect($this->withToken($supervisor['token'])->getJson(self::BASE . '/deliveries')->assertOk()->json('data'))->pluck('id')->all();
        $this->assertNotContains($other['id'], $listed);
        $this->withToken($supervisor['token'])->getJson(self::BASE . '/deliveries/' . $other['id'])->assertNotFound();
        $this->withToken($supervisor['token'])->postJson(self::BASE . '/deliveries', $this->deliveryPayload($this->fx['s2'], $this->fx['t2'], $this->fx['wA2'], 'b5-dlv-denied'))->assertNotFound();
        $this->assertSame(1, FuelDelivery::count());
    }

    /** @test */
    public function a_reading_of_another_tank_or_type_cannot_be_linked_to_a_delivery(): void
    {
        $this->buildFixture();
        $s1 = $this->fx['s1'];
        $reading = FuelTankReading::create([
            'branch_id' => $s1->branch_id, 'fuel_station_id' => $s1->id, 'fuel_tank_id' => $this->fx['t1']->id, 'reading_type' => 'atg',
            'quantity_milliliters' => 5000, 'measured_at' => now(), 'evidence_key' => 'b5-atg',
        ]);
        $payload = $this->deliveryPayload($s1, $this->fx['t1'], $this->fx['wA1'], 'b5-dlv-wrongtype') + ['before_physical_reading_id' => $reading->id];
        $this->withToken($this->fx['owner'])->postJson(self::BASE . '/deliveries', $payload)->assertStatus(422);
        $this->assertSame(0, FuelDelivery::count());
    }
}

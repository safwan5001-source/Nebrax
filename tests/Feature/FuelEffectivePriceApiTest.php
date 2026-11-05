<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Models\Product;
use App\Models\Role;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AWJ-FUEL-PRICE-SOURCE (#2008 + #1998): السعر الفعّال في تطبيق المحطة يأتي من القرار الخادمي نفسه الذي
 * يستعمله إنهاء البيع، لا من إعادة بناء في المتصفح ولا من بطاقة المنتج.
 */
class FuelEffectivePriceApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function station_override_beats_tenant_default_and_reports_its_source_unit_and_tax_mode(): void
    {
        $f = $this->fixture();
        $this->price($f, null, 215);
        $this->price($f, $f['a']['station'], 218);

        $row = $this->effective($f['owner_token'], $f['a']['station']->id)[0];
        $this->assertSame('effective', $row['status']);
        $this->assertSame('station_override', $row['source']);
        $this->assertSame(218, $row['price_per_liter_minor']); // هللات صحيحة لا float
        $this->assertSame('L', $row['unit']);
        $this->assertSame('tax_inclusive', $row['tax_mode']);
        $this->assertTrue($row['sellable']);
        $this->assertSame([], $row['blockers']);
        $this->assertNotNull($row['effective_from']);

        // محطة بلا override ترث سعر المؤسسة الافتراضي.
        $other = $this->effective($f['owner_token'], $f['a2']['station']->id)[0];
        $this->assertSame('tenant_default', $other['source']);
        $this->assertSame(215, $other['price_per_liter_minor']);
    }

    /** @test */
    public function a_missing_price_is_not_configured_never_zero_and_the_product_card_price_is_never_used(): void
    {
        $f = $this->fixture(); // بطاقة المنتج الأصلي تحمل sale_price = 1000 عمداً
        $this->assertSame(1000, (int) Product::findOrFail($f['fuel']->product_id)->sale_price);

        $row = $this->effective($f['owner_token'], $f['a']['station']->id)[0];
        $this->assertSame('not_configured', $row['status']);
        $this->assertNull($row['price_per_liter_minor']);
        $this->assertNull($row['source']);
        $this->assertFalse($row['sellable']);
        $this->assertContains('price_not_configured', $row['blockers']);
    }

    /** @test */
    public function future_expired_and_inactive_prices_are_not_effective(): void
    {
        $f = $this->fixture();
        $this->price($f, $f['a']['station'], 300, ['effective_from' => now()->addDay()->toIso8601String()]);
        $this->price($f, $f['a2']['station'], 301, ['effective_from' => now()->subDays(3)->toIso8601String(), 'effective_until' => now()->subDay()->toIso8601String()]);
        FuelStationProductPrice::create([
            'fuel_station_id' => $f['b']['station']->id, 'fuel_product_id' => $f['fuel']->id, 'price_per_liter_minor' => 302,
            'effective_from' => now()->subDay(), 'status' => FuelStationProductPrice::STATUS_INACTIVE,
        ]);

        foreach (['a', 'a2', 'b'] as $key) {
            $row = $this->effective($f['owner_token'], $f[$key]['station']->id)[0];
            $this->assertSame('not_configured', $row['status'], $key);
            $this->assertNull($row['price_per_liter_minor'], $key);
        }
    }

    /** @test */
    public function the_newest_in_window_price_wins_and_a_past_window_falls_back_to_the_tenant_default(): void
    {
        $f = $this->fixture();
        $this->price($f, null, 200);
        $this->price($f, $f['a']['station'], 210, ['effective_from' => now()->subDays(10)->toIso8601String(), 'effective_until' => now()->subDays(5)->toIso8601String()]);
        $this->price($f, $f['a']['station'], 220, ['effective_from' => now()->subDays(5)->toIso8601String()]);

        $row = $this->effective($f['owner_token'], $f['a']['station']->id)[0];
        $this->assertSame(220, $row['price_per_liter_minor']);
        $this->assertSame('station_override', $row['source']);
    }

    /** @test */
    public function an_unset_tax_mode_is_reported_as_a_sale_blocker_not_guessed(): void
    {
        $f = $this->fixture(country: 'US'); // لا افتراض سعودي ⇒ نمط الضريبة غير معيَّن
        $this->price($f, $f['a']['station'], 218);

        $row = $this->effective($f['owner_token'], $f['a']['station']->id)[0];
        $this->assertSame('effective', $row['status']);
        $this->assertSame(218, $row['price_per_liter_minor']);
        $this->assertNull($row['tax_mode']);
        $this->assertFalse($row['sellable']);
        $this->assertSame(['tax_mode_unset'], $row['blockers']);
    }

    /** @test */
    public function a_station_tax_mode_override_is_what_the_display_reports(): void
    {
        $f = $this->fixture();
        $this->price($f, $f['a']['station'], 218);
        app(FuelStationSettingsService::class)->putStationValues($f['a']['station'], ['fuel_price_tax_mode' => 'tax_exclusive'], $f['actor'], 'سعر قبل الضريبة');

        $this->assertSame('tax_exclusive', $this->effective($f['owner_token'], $f['a']['station']->id)[0]['tax_mode']);
        $this->assertSame('tax_inclusive', $this->effective($f['owner_token'], $f['a2']['station']->id)[0]['tax_mode']);
    }

    /** @test */
    public function a_non_liter_unit_mapping_and_an_inactive_product_block_the_sale_visibly(): void
    {
        $f = $this->fixture();
        $this->price($f, $f['a']['station'], 218);

        Product::whereKey($f['fuel']->product_id)->update(['unit' => 'pcs']); // قطعة لا لتر
        $row = $this->effective($f['owner_token'], $f['a']['station']->id)[0];
        $this->assertContains('unit_mapping_invalid', $row['blockers']);
        $this->assertFalse($row['sellable']);

        Product::whereKey($f['fuel']->product_id)->update(['unit' => 'mL']);
        FuelProduct::whereKey($f['fuel']->id)->update(['is_active' => false]);
        $inactive = $this->withToken($f['owner_token'])
            ->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id . '&fuel_product_id=' . $f['fuel']->id)
            ->assertOk()->json('data.0');
        $this->assertSame('product_inactive', $inactive['status']);
        $this->assertNull($inactive['price_per_liter_minor']);
        $this->assertContains('product_inactive', $inactive['blockers']);
    }

    /** @test */
    public function the_endpoint_is_read_only_and_requires_a_station_the_sale_view_permission_and_tenant_scope(): void
    {
        $f = $this->fixture();
        $this->price($f, $f['a']['station'], 218);
        $before = [FuelStationProductPrice::count(), \App\Models\FuelStationConfigurationEvent::count()];

        $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices/effective')->assertUnprocessable();
        $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices/effective?station_id=not-a-uuid')->assertUnprocessable();
        $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id)->assertOk();
        $this->withToken($f['no_price_token'])->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id)->assertForbidden();
        $this->flushHeaders()->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id)->assertUnauthorized();
        // القراءة لم تكتب شيئاً (يُعدّ قبل تبديل سياق المستأجر أدناه).
        $this->assertSame($before, [FuelStationProductPrice::count(), \App\Models\FuelStationConfigurationEvent::count()]);

        // مستأجر آخر لا يصل إلى محطات هذا المستأجر (404 موحّد).
        $foreign = $this->registerTenant('fuel-eff-foreign', 'owner@fuel-eff-foreign.test', autoEnableApplications: true);
        app(EntitlementGrantService::class)->grant(Tenant::findOrFail($foreign['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_price_source', reason: 'مستأجر آخر لاختبار العزل.');
        $this->withToken($foreign['token'])->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id)->assertNotFound();
    }

    /** @test */
    public function a_branch_or_warehouse_restricted_user_cannot_read_effective_prices_of_stations_outside_scope(): void
    {
        $f = $this->fixture();
        $this->price($f, $f['a']['station'], 218);
        $this->price($f, $f['b']['station'], 999);

        $this->assertSame(218, $this->effective($f['branch_user_token'], $f['a']['station']->id)[0]['price_per_liter_minor']);
        $this->withToken($f['branch_user_token'])->getJson(self::BASE . '/prices/effective?station_id=' . $f['b']['station']->id)->assertNotFound();
        // مقيَّد بمخزن أ فقط: محطة أ2 (مخزن آخر) خارج نطاقه.
        $this->assertNotEmpty($this->effective($f['warehouse_user_token'], $f['a']['station']->id));
        $this->withToken($f['warehouse_user_token'])->getJson(self::BASE . '/prices/effective?station_id=' . $f['a2']['station']->id)->assertNotFound();
    }

    /** @test */
    public function the_price_history_endpoint_no_longer_leaks_out_of_scope_station_rows_but_keeps_the_tenant_default(): void
    {
        $f = $this->fixture();
        $this->price($f, null, 215);
        $this->price($f, $f['a']['station'], 218);
        $this->price($f, $f['b']['station'], 999);
        $token = $f['branch_user_token'];

        $rows = $this->withToken($token)->getJson(self::BASE . '/prices')->assertOk()->json('data');
        $this->assertEqualsCanonicalizing([215, 218], array_column($rows, 'price_per_liter_minor'));
        $this->assertNotContains(999, array_column($rows, 'price_per_liter_minor'));

        // station_id خارج النطاق: 404 موحّد (لا صفحة فارغة تكشف الوجود).
        $this->withToken($token)->getJson(self::BASE . '/prices?station_id=' . $f['b']['station']->id)->assertNotFound();
        $this->assertSame([218], array_column($this->withToken($token)->getJson(self::BASE . '/prices?station_id=' . $f['a']['station']->id)->json('data'), 'price_per_liter_minor'));

        // الافتراضي وحده.
        $default = $this->withToken($token)->getJson(self::BASE . '/prices?scope=tenant_default')->assertOk()->json('data');
        $this->assertSame([215], array_column($default, 'price_per_liter_minor'));
        $this->assertNull($default[0]['fuel_station_id']);
        $this->withToken($token)->getJson(self::BASE . '/prices?scope=tenant_default&station_id=' . $f['a']['station']->id)->assertStatus(422);
        $this->withToken($token)->getJson(self::BASE . '/prices?scope=bogus')->assertStatus(422);

        // المالك غير المقيَّد يرى الكل كما كان (لا تغيير للشاشة المكتبية).
        $this->assertCount(3, $this->withToken($f['owner_token'])->getJson(self::BASE . '/prices')->json('data'));
        $this->assertSame(['id', 'fuel_station_id', 'fuel_product_id', 'price_per_liter_minor', 'effective_from', 'effective_until', 'status', 'reason', 'entry_source', 'created_at'], array_keys($rows[0]));
    }

    /** @return list<array<string,mixed>> */
    private function effective(string $token, string $stationId): array
    {
        return $this->withToken($token)->getJson(self::BASE . '/prices/effective?station_id=' . $stationId)->assertOk()->json('data');
    }

    /** @param array<string,mixed> $f */
    private function price(array $f, ?FuelStation $station, int $minor, array $over = []): FuelStationProductPrice
    {
        return app(FuelStationProductPriceService::class)->create($over + [
            'fuel_station_id' => $station?->id,
            'fuel_product_id' => $f['fuel']->id,
            'price_per_liter_minor' => $minor,
            'effective_from' => now()->subMinute()->toIso8601String(),
            'reason' => 'اختبار السعر الفعّال',
        ], $f['actor']);
    }

    /** @return array<string,mixed> */
    private function fixture(string $country = 'SA'): array
    {
        $auth = $this->registerTenant('fuel-eff', 'owner@fuel-eff.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        $tenant = Tenant::findOrFail($tenantId);
        $tenant->update(['country' => $country]);
        app(EntitlementGrantService::class)->grant($tenant, 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_fuel_price_source', reason: 'اختبار مصدر السعر.');

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        // بطاقة المنتج الأصلي بسعر بيع 1000 (هللات لكل mL — وحدة الأساس) عمداً: لا يجوز أن تتسرّب إلى السعر المعروض.
        $productId = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'بنزين بطاقة', 'type' => 'good', 'unit' => 'mL', 'sale_price' => 1000, 'purchase_price' => 10, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
        $fuel = FuelProduct::create(['product_id' => $productId, 'code' => 'F-EFF', 'name' => 'بنزين 95']);

        $station = fn (Branch $branch, Warehouse $warehouse, string $code) => [
            'station' => FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code]),
        ];

        $role = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-eff-viewer', 'name' => 'عارض أسعار مقيَّد',
            'permissions' => ['fuel.sale.view', 'fuel_stations.view'], 'is_system' => false,
        ]);
        $noPrice = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-eff-noprice', 'name' => 'بلا أسعار',
            'permissions' => ['fuel_stations.view'], 'is_system' => false,
        ]);
        $branchUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بفرع', 'email' => 'branch-eff@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $branchUser->branches()->attach($branchA->id);
        $warehouseUser = User::create(['tenant_id' => $tenantId, 'name' => 'مقيَّد بمخزن', 'email' => 'wh-eff@fuel.test', 'password' => 'password123', 'role' => $role->slug]);
        $warehouseUser->warehouses()->attach($warehouseA->id);
        $noPriceUser = User::create(['tenant_id' => $tenantId, 'name' => 'بلا صلاحية سعر', 'email' => 'np-eff@fuel.test', 'password' => 'password123', 'role' => $noPrice->slug]);

        return [
            'owner_token' => $auth['token'],
            'branch_user_token' => $branchUser->createToken('api')->plainTextToken,
            'warehouse_user_token' => $warehouseUser->createToken('api')->plainTextToken,
            'no_price_token' => $noPriceUser->createToken('api')->plainTextToken,
            'actor' => User::where('tenant_id', $tenantId)->where('role', 'owner')->sole(),
            'fuel' => $fuel,
            'a' => $station($branchA, $warehouseA, 'A'),
            'a2' => $station($branchA, $warehouseA2, 'A2'),
            'b' => $station($branchB, $warehouseB, 'B'),
        ];
    }
}

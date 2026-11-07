<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelStation;
use App\Models\FuelTank;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductVariant;
use App\Models\ProductWarehouseStock;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\EntitlementGrantService;
use App\Services\FuelSaleService;
use App\Services\FuelShiftService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Services\FuelSupplyReceivingService;
use App\Services\FuelTankBookBalanceReader;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * TANK-BALANCE-P1 — عقد قراءة فقط: `book_level` للخزانات.
 *
 * الرصيد الرسمي `product_warehouse_stock` (مخزن × منتج) يُنسَب إلى خزان **فقط عندما يكون الخزان الوحيد المغذّي للمجمّع** عبر كل محطات
 * المؤسسة وبكل حالات الخزانات (المعطَّل يُحصى)؛ غير ذلك ⇒ `book_level = null` مع سبب صريح، ولا تخمين: غياب السجل ≠ صفر،
 * و`as_of` دائماً null، ولا أرصدة مجمَّعة لمحطات خارج نطاق المستخدم، وعدد استعلامات ثابت.
 */
class FuelTankBookBalanceApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** مفاتيح استجابة الخزان قبل P1 — يجب أن تبقى كما هي حرفياً. */
    private const LEGACY_KEYS = [
        'id', 'branch_id', 'fuel_station_id', 'station', 'fuel_product_id', 'fuel_product', 'code', 'name', 'capacity_milliliters',
        'safe_capacity_milliliters', 'minimum_level_milliliters', 'dead_stock_milliliters', 'opening_volume_milliliters',
        'measurement_configuration', 'atg_source_key', 'status', 'calibration_points', 'created_at', 'updated_at',
    ];

    private string $tenantId;
    private string $ownerToken;
    private Branch $branchA;
    private Branch $branchB;

    private int $seq = 0;

    // ───────────────────────── الحالات الأساسية ─────────────────────────

    #[Test]
    public function a_sole_tank_returns_the_official_book_balance_in_list_and_show(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $tank = $this->tank($this->station($this->branchA, $wh), $fuel);
        $this->stock($wh, $fuel, 18_700_000);

        $expected = ['milliliters' => 18_700_000, 'basis' => 'warehouse_book', 'as_of' => null];
        $listed = collect($this->ownerGet('/tanks')->json('data'))->firstWhere('id', $tank->id);
        $shown = $this->ownerGet('/tanks/' . $tank->id)->json('data');

        foreach ([$listed, $shown] as $row) {
            $this->assertSame($expected, $row['book_level']);
            $this->assertNull($row['book_level_unavailable_reason']);
        }
    }

    #[Test]
    public function two_tanks_for_the_same_product_in_one_warehouse_return_null_with_multi_tank_and_no_pooled_number(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $station = $this->station($this->branchA, $wh);
        $t1 = $this->tank($station, $fuel, 'T1');
        $t2 = $this->tank($station, $fuel, 'T2');
        $this->stock($wh, $fuel, 7_654_321);

        $response = $this->ownerGet('/tanks');
        foreach ([$t1, $t2] as $tank) {
            $row = collect($response->json('data'))->firstWhere('id', $tank->id);
            $this->assertNull($row['book_level']);
            $this->assertSame('multi_tank', $row['book_level_unavailable_reason']);
        }
        $this->assertStringNotContainsString('7654321', $response->getContent(), 'لا رصيد مجمَّع في الاستجابة');
        $this->assertSame('multi_tank', $this->ownerGet('/tanks/' . $t1->id)->json('data.book_level_unavailable_reason'));
    }

    #[Test]
    public function a_disabled_second_tank_still_counts_so_the_active_tank_is_not_attributed_the_pool(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $station = $this->station($this->branchA, $wh);
        $active = $this->tank($station, $fuel, 'ACT');
        $disabled = $this->tank($station, $fuel, 'OFF', FuelTank::STATUS_INACTIVE);
        $this->stock($wh, $fuel, 5_000_000);

        $rows = collect($this->ownerGet('/tanks')->json('data'))->keyBy('id');
        $this->assertSame('multi_tank', $rows[$active->id]['book_level_unavailable_reason'], 'المعطَّل يُحصى (تشدّد أكبر من FS-01)');
        $this->assertNull($rows[$active->id]['book_level']);
        $this->assertSame('tank_inactive', $rows[$disabled->id]['book_level_unavailable_reason']);
        $this->assertNull($rows[$disabled->id]['book_level']);
    }

    #[Test]
    public function a_sole_inactive_tank_is_not_given_a_level(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $tank = $this->tank($this->station($this->branchA, $wh), $fuel, 'ONLY', FuelTank::STATUS_INACTIVE);
        $this->stock($wh, $fuel, 1_000_000);

        $row = $this->ownerGet('/tanks/' . $tank->id)->json('data');
        $this->assertNull($row['book_level']);
        $this->assertSame('tank_inactive', $row['book_level_unavailable_reason']);
    }

    #[Test]
    public function a_warehouse_shared_by_stations_in_different_branches_blocks_attribution_for_both_but_other_products_stay_independent(): void
    {
        $this->world();
        $shared = $this->warehouse($this->branchA, 'SHARED');
        $petrol = $this->fuel('PET');
        $diesel = $this->fuel('DSL');
        $stationA = $this->station($this->branchA, $shared, 'SA');
        $stationB = $this->station($this->branchB, $shared, 'SB');
        $petrolA = $this->tank($stationA, $petrol, 'PA');
        $petrolB = $this->tank($stationB, $petrol, 'PB');   // نفس المخزن ونفس المنتج ⇒ مجمّع مشترك
        $dieselA = $this->tank($stationA, $diesel, 'DA');   // منتج مختلف في المخزن نفسه ⇒ مجمّعه مستقل
        $this->stock($shared, $petrol, 9_000_000);
        $this->stock($shared, $diesel, 4_000_000);

        $rows = collect($this->ownerGet('/tanks')->json('data'))->keyBy('id');
        $this->assertSame('multi_tank', $rows[$petrolA->id]['book_level_unavailable_reason']);
        $this->assertSame('multi_tank', $rows[$petrolB->id]['book_level_unavailable_reason']);
        $this->assertSame(4_000_000, $rows[$dieselA->id]['book_level']['milliliters']);
    }

    #[Test]
    public function a_missing_stock_record_is_never_read_as_zero_while_a_real_zero_balance_is_zero(): void
    {
        $this->world();
        $fuel = $this->fuel();
        $whMissing = $this->warehouse($this->branchA, 'W-MISSING');
        $whZero = $this->warehouse($this->branchA, 'W-ZERO');
        $missing = $this->tank($this->station($this->branchA, $whMissing, 'S1'), $fuel, 'T-MISSING');
        $zero = $this->tank($this->station($this->branchA, $whZero, 'S2'), $fuel, 'T-ZERO');
        $this->stock($whZero, $fuel, 0);

        $rows = collect($this->ownerGet('/tanks')->json('data'))->keyBy('id');
        $this->assertNull($rows[$missing->id]['book_level']);
        $this->assertSame('no_stock_record', $rows[$missing->id]['book_level_unavailable_reason']);
        $this->assertSame(0, $rows[$zero->id]['book_level']['milliliters']);
        $this->assertNull($rows[$zero->id]['book_level_unavailable_reason']);
    }

    #[Test]
    public function ambiguous_negative_unit_and_warehouse_configuration_problems_return_null_with_a_specific_reason_and_never_a_guess(): void
    {
        $this->world();
        // (أ) سجل رصيد إضافي بمتغيّر لنفس المنتج والمخزن ⇒ غامض.
        $fuelA = $this->fuel('AMB');
        $whA = $this->warehouse($this->branchA, 'W-AMB');
        $ambiguous = $this->tank($this->station($this->branchA, $whA, 'SAMB'), $fuelA, 'TAMB');
        $this->stock($whA, $fuelA, 3_000_000);
        $variant = ProductVariant::create(['product_id' => $fuelA->product_id, 'sku' => 'V-AMB', 'combination_key' => 'amb', 'is_active' => true]);
        ProductWarehouseStock::create(['product_id' => $fuelA->product_id, 'product_variant_id' => $variant->id, 'warehouse_id' => $whA->id, 'quantity' => 10]);
        // (ب) رصيد سالب ⇒ غير صالح.
        $fuelN = $this->fuel('NEG');
        $whN = $this->warehouse($this->branchA, 'W-NEG');
        $negative = $this->tank($this->station($this->branchA, $whN, 'SNEG'), $fuelN, 'TNEG');
        $this->stock($whN, $fuelN, 100);
        DB::table('product_warehouse_stock')->where('warehouse_id', $whN->id)->update(['quantity' => -5]);
        // (ج) وحدة منتج الوقود ليست mL/L.
        $fuelU = $this->fuel('UNIT');
        $fuelU->forceFill(['inventory_base_unit' => 'L'])->save();
        $whU = $this->warehouse($this->branchA, 'W-UNIT');
        $unit = $this->tank($this->station($this->branchA, $whU, 'SUNIT'), $fuelU, 'TUNIT');
        $this->stock($whU, $fuelU, 100);
        // (د) وحدة منتج المخزون ليست mL.
        $fuelP = $this->fuel('PUNIT');
        Product::findOrFail($fuelP->product_id)->forceFill(['unit' => 'L'])->save();
        $whP = $this->warehouse($this->branchA, 'W-PUNIT');
        $productUnit = $this->tank($this->station($this->branchA, $whP, 'SPUNIT'), $fuelP, 'TPUNIT');
        $this->stock($whP, $fuelP, 100);
        // (د2) منتج المخزون محذوف ناعماً ⇒ لا وحدة معروفة ⇒ تكوين غير صالح (لا «عدم تطابق وحدة»).
        $fuelD = $this->fuel('DEL');
        $whD = $this->warehouse($this->branchA, 'W-DEL');
        $deleted = $this->tank($this->station($this->branchA, $whD, 'SDEL'), $fuelD, 'TDEL');
        $this->stock($whD, $fuelD, 100);
        Product::findOrFail($fuelD->product_id)->delete();
        // (هـ) محطة بلا مخزن.
        $fuelW = $this->fuel('NOWH');
        $noWarehouse = $this->tank($this->station($this->branchA, null, 'SNOWH'), $fuelW, 'TNOWH');

        $rows = collect($this->ownerGet('/tanks')->json('data'))->keyBy('id');
        foreach ([
            [$ambiguous, 'ambiguous_stock_record'], [$negative, 'invalid_stock_record'], [$unit, 'unit_mismatch'],
            [$productUnit, 'unit_mismatch'], [$deleted, 'invalid_configuration'], [$noWarehouse, 'no_warehouse'],
        ] as [$tank, $reason]) {
            $this->assertNull($rows[$tank->id]['book_level'], $reason);
            $this->assertSame($reason, $rows[$tank->id]['book_level_unavailable_reason']);
            $this->assertContains($reason, FuelTankBookBalanceReader::REASONS);
        }
    }

    #[Test]
    public function as_of_is_always_null_and_never_derived_from_updated_at(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $tank = $this->tank($this->station($this->branchA, $wh), $fuel);
        $this->stock($wh, $fuel, 1_000_000);
        DB::table('product_warehouse_stock')->where('warehouse_id', $wh->id)->update(['updated_at' => '2020-01-02 03:04:05']);

        $response = $this->ownerGet('/tanks/' . $tank->id);
        $this->assertNull($response->json('data.book_level.as_of'));
        $this->assertStringNotContainsString('2020-01-02', $response->getContent());
    }

    // ───────────────────────── العزل والنطاق ─────────────────────────

    #[Test]
    public function another_tenants_tanks_and_stock_are_never_visible_or_counted(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $mine = $this->tank($this->station($this->branchA, $wh), $fuel);
        $this->stock($wh, $fuel, 2_000_000);

        // مستأجر آخر بشجرته ورصيده الكبير.
        $other = $this->registerTenant('fuel-bb-other', 'owner@fuel-bb-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        $this->grantFuel($other['tenant_id']);
        $otherBranch = Branch::where('tenant_id', $other['tenant_id'])->where('is_main', true)->firstOrFail();
        app(BranchContext::class)->set($otherBranch->id);
        $otherWarehouse = Warehouse::where('tenant_id', $other['tenant_id'])->where('is_default', true)->firstOrFail();
        $otherFuel = $this->fuel('OTH');
        $otherTank = $this->tank($this->station($otherBranch, $otherWarehouse, 'OS'), $otherFuel, 'OT');
        $this->stock($otherWarehouse, $otherFuel, 99_999_999);
        app(TenantContext::class)->set($this->tenantId);
        app(BranchContext::class)->set($this->branchA->id);

        $response = $this->ownerGet('/tanks');
        $ids = collect($response->json('data'))->pluck('id')->all();
        $this->assertContains($mine->id, $ids);
        $this->assertNotContains($otherTank->id, $ids);
        $this->assertStringNotContainsString('99999999', $response->getContent());
        $this->assertSame(2_000_000, collect($response->json('data'))->firstWhere('id', $mine->id)['book_level']['milliliters']);
        $this->withToken($this->ownerToken)->getJson(self::BASE . '/tanks/' . $otherTank->id)->assertNotFound();
        // ومن جهة المستأجر الآخر: رصيده له وحده.
        $theirs = $this->withToken($other['token'])->getJson(self::BASE . '/tanks')->assertOk()->json('data');
        $this->assertSame([$otherTank->id], collect($theirs)->pluck('id')->all());
        $this->assertSame(99_999_999, $theirs[0]['book_level']['milliliters']);
    }

    #[Test]
    public function a_branch_restricted_user_gets_no_pooled_balance_for_a_warehouse_shared_with_a_station_they_cannot_see(): void
    {
        $this->world();
        $shared = $this->warehouse($this->branchA, 'SHARED');
        $fuel = $this->fuel();
        $own = $this->tank($this->station($this->branchA, $shared, 'SA'), $fuel, 'TA');
        $hidden = $this->tank($this->station($this->branchB, $shared, 'SB'), $fuel, 'TB');   // فرع آخر، نفس المخزن والمنتج
        $soloWarehouse = $this->warehouse($this->branchA, 'SOLO');
        $soloFuel = $this->fuel('SOLOF');
        $solo = $this->tank($this->station($this->branchA, $soloWarehouse, 'SS'), $soloFuel, 'TS');
        $this->stock($shared, $fuel, 8_888_888);
        $this->stock($soloWarehouse, $soloFuel, 1_234_000);

        $user = $this->scopedUser('branch-bb', branches: [$this->branchA->id]);
        $response = $this->withToken($user['token'])->getJson(self::BASE . '/tanks')->assertOk();
        $rows = collect($response->json('data'))->keyBy('id');

        $this->assertNotContains($hidden->id, $rows->keys()->all(), 'خزان الفرع الآخر غير ظاهر');
        $this->assertSame('multi_tank', $rows[$own->id]['book_level_unavailable_reason']);
        $this->assertNull($rows[$own->id]['book_level']);
        $this->assertStringNotContainsString('8888888', $response->getContent(), 'لا رصيد مجمَّع يخص محطة خارج النطاق');
        $this->assertSame(1_234_000, $rows[$solo->id]['book_level']['milliliters'], 'خزانه الوحيد داخل نطاقه يظهر رصيده');
        $this->withToken($user['token'])->getJson(self::BASE . '/tanks/' . $hidden->id)->assertNotFound();
    }

    #[Test]
    public function a_station_assigned_user_and_a_warehouse_restricted_user_only_get_levels_for_what_they_can_reach(): void
    {
        $this->world();
        $whOne = $this->warehouse($this->branchA, 'W-ONE');
        $whTwo = $this->warehouse($this->branchA, 'W-TWO');
        $fuel = $this->fuel();
        $one = $this->tank($this->station($this->branchA, $whOne, 'S-ONE'), $fuel, 'T-ONE');
        $two = $this->tank($this->station($this->branchA, $whTwo, 'S-TWO'), $fuel, 'T-TWO');
        $this->stock($whOne, $fuel, 111_000);
        $this->stock($whTwo, $fuel, 222_000);

        $assigned = $this->scopedUser('assigned-bb', stations: [FuelStation::where('code', 'S-ONE')->firstOrFail()->id]);
        $rows = collect($this->withToken($assigned['token'])->getJson(self::BASE . '/tanks')->assertOk()->json('data'))->keyBy('id');
        $this->assertSame([$one->id], $rows->keys()->all());
        $this->assertSame(111_000, $rows[$one->id]['book_level']['milliliters']);
        $this->withToken($assigned['token'])->getJson(self::BASE . '/tanks/' . $two->id)->assertNotFound();

        $emptyScope = $this->scopedUser('empty-bb', stations: []);   // مقيَّد صراحةً بلا محطة ⇒ لا شيء
        $this->assertSame([], $this->withToken($emptyScope['token'])->getJson(self::BASE . '/tanks')->assertOk()->json('data'));

        $byWarehouse = $this->scopedUser('wh-bb', warehouses: [$whTwo->id]);
        $response = $this->withToken($byWarehouse['token'])->getJson(self::BASE . '/tanks')->assertOk();
        $this->assertSame([$two->id], collect($response->json('data'))->pluck('id')->all());
        $this->assertSame(222_000, $response->json('data.0.book_level.milliliters'));
        $this->assertStringNotContainsString('111000', $response->getContent());
    }

    #[Test]
    public function the_endpoint_permission_is_unchanged_and_a_user_without_it_never_sees_a_level(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $tank = $this->tank($this->station($this->branchA, $wh), $fuel);
        $this->stock($wh, $fuel, 6_000_000);

        $noFuel = $this->scopedUser('nofuel-bb', permissions: ['reports.view']);
        $this->withToken($noFuel['token'])->getJson(self::BASE . '/tanks')->assertForbidden();
        $this->withToken($noFuel['token'])->getJson(self::BASE . '/tanks/' . $tank->id)->assertForbidden();
    }

    // ───────────────────────── الأداء والتوافق ─────────────────────────

    #[Test]
    public function the_number_of_queries_is_constant_regardless_of_the_number_of_tanks(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA, 'W-Q');
        $fuel = $this->fuel('Q1');
        $this->tank($this->station($this->branchA, $wh, 'SQ1'), $fuel, 'TQ1');
        $this->stock($wh, $fuel, 1_000);

        $one = $this->requestStatements('/tanks');

        // خمسة خزانات إضافية بحالات متنوعة: وحيد برصيد، متعدد، بلا سجل، بلا مخزن، معطَّل.
        for ($i = 2; $i <= 3; $i++) {
            $w = $this->warehouse($this->branchA, "W-Q{$i}");
            $f = $this->fuel("Q{$i}");
            $this->tank($this->station($this->branchA, $w, "SQ{$i}"), $f, "TQ{$i}");
            $this->stock($w, $f, 1_000 * $i);
        }
        $multiStation = $this->station($this->branchB, $this->warehouse($this->branchB, 'W-QM'), 'SQM');
        $multiFuel = $this->fuel('QM');
        $this->tank($multiStation, $multiFuel, 'TQM1');
        $this->tank($multiStation, $multiFuel, 'TQM2');
        $this->tank($this->station($this->branchA, null, 'SQN'), $this->fuel('QN'), 'TQN');
        $this->tank($this->station($this->branchA, $this->warehouse($this->branchA, 'W-QI'), 'SQI'), $this->fuel('QI'), 'TQI', FuelTank::STATUS_INACTIVE);
        $this->tank($this->station($this->branchA, $this->warehouse($this->branchA, 'W-QX'), 'SQX'), $this->fuel('QX'), 'TQX');   // بلا سجل رصيد
        $this->assertGreaterThanOrEqual(8, count($this->ownerGet('/tanks')->json('data')));

        $many = $this->requestStatements('/tanks');
        $this->assertSame($one, $many, 'عبارات SQL نفسها بالترتيب نفسه مهما كان عدد الخزانات (لا استعلام لكل صف)');
        $this->assertCount(count($one), $many);

        // الخدمة نفسها: ثلاثة استعلامات على الأكثر مهما كان العدد (الخزانات محمَّلة العلاقات مسبقاً كما يفعل المتحكّم).
        $tanks = FuelTank::with(['station', 'fuelProduct'])->get();
        DB::flushQueryLog();
        DB::enableQueryLog();
        app(FuelTankBookBalanceReader::class)->forTanks($tanks);
        $this->assertLessThanOrEqual(3, count(DB::getQueryLog()));
        DB::disableQueryLog();
    }

    #[Test]
    public function reading_is_pure_read_only_and_existing_response_contract_is_backward_compatible(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA);
        $fuel = $this->fuel();
        $tank = $this->tank($this->station($this->branchA, $wh), $fuel);
        $this->stock($wh, $fuel, 500_000);
        $before = [
            'stock' => (int) DB::table('product_warehouse_stock')->sum('quantity'),
            'movements' => StockMovement::count(), 'ledger' => FuelOperationalLedger::count(), 'tanks' => FuelTank::count(),
            'tank_updated_at' => (string) DB::table('fuel_tanks')->where('id', $tank->id)->value('updated_at'),
        ];

        DB::flushQueryLog();
        DB::enableQueryLog();
        $list = $this->ownerGet('/tanks')->json('data.0');
        $show = $this->ownerGet('/tanks/' . $tank->id)->json('data');
        // يُستثنى وحده `personal_access_tokens.last_used_at` (مصادقة Sanctum عند كل طلب، لا أثر للميزة).
        $writes = collect(DB::getQueryLog())->pluck('query')
            ->filter(fn ($q) => preg_match('/^\s*(insert|update|delete|truncate|alter|create|drop)\b/i', $q) === 1 && ! str_contains($q, '"personal_access_tokens"'))
            ->values()->all();
        DB::disableQueryLog();

        $this->assertSame([], $writes, 'القراءة بلا أي كتابة');
        $this->assertSame($before, [
            'stock' => (int) DB::table('product_warehouse_stock')->sum('quantity'),
            'movements' => StockMovement::count(), 'ledger' => FuelOperationalLedger::count(), 'tanks' => FuelTank::count(),
            'tank_updated_at' => (string) DB::table('fuel_tanks')->where('id', $tank->id)->value('updated_at'),
        ]);

        // التوافق الرجعي: كل المفاتيح القديمة قائمة بقيمها، والجديد إضافي فقط.
        foreach ([$list, $show] as $row) {
            foreach (self::LEGACY_KEYS as $key) {
                $this->assertArrayHasKey($key, $row, $key);
            }
            $this->assertSame(self::LEGACY_KEYS, array_slice(array_keys($row), 0, count(self::LEGACY_KEYS)), 'ترتيب المفاتيح القديمة لم يتغير');
            $this->assertSame(['book_level', 'book_level_unavailable_reason'], array_slice(array_keys($row), count(self::LEGACY_KEYS)));
        }

        // الإنشاء والتعديل بلا المفتاحين (لم يتغيرا).
        $created = $this->withToken($this->ownerToken)->postJson(self::BASE . '/tanks', [
            'fuel_station_id' => $tank->fuel_station_id, 'fuel_product_id' => $fuel->id, 'code' => 'T-NEW', 'name' => 'خزان جديد',
            'capacity_milliliters' => 1000, 'safe_capacity_milliliters' => 900,
        ])->assertCreated()->json('data');
        $this->assertSame(self::LEGACY_KEYS, array_keys($created));
        $updated = $this->withToken($this->ownerToken)->putJson(self::BASE . '/tanks/' . $created['id'], ['name' => 'خزان معدّل'])->assertOk()->json('data');
        $this->assertSame(self::LEGACY_KEYS, array_keys($updated));
    }

    // ───────────────────────── من الحركات الحقيقية إلى المؤشر ─────────────────────────

    #[Test]
    public function the_level_follows_real_approved_receipts_and_finalized_sales_but_not_drafts(): void
    {
        $this->world();
        $wh = $this->warehouse($this->branchA, 'W-FLOW');
        $fuel = $this->fuel('FLOW');
        $station = $this->station($this->branchA, $wh, 'SFLOW');
        $tank = $this->tank($station, $fuel, 'TFLOW');
        $pump = FuelPump::create(['branch_id' => $this->branchA->id, 'fuel_station_id' => $station->id, 'pump_number' => 'PFLOW']);
        $nozzle = FuelNozzle::create(['branch_id' => $this->branchA->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'NFLOW']);
        $owner = User::where('tenant_id', $this->tenantId)->where('role', 'owner')->firstOrFail();
        $supplier = Partner::create(['branch_id' => $this->branchA->id, 'type' => 'supplier', 'name' => 'مورد', 'is_active' => true]);
        $customer = Partner::create(['branch_id' => $this->branchA->id, 'type' => 'customer', 'name' => 'عميل']);
        $grni = Account::create(['code' => '2199', 'name' => 'GRNI', 'type' => 'liability', 'normal_balance' => 'credit', 'is_group' => false, 'is_active' => true]);
        app(FuelStationSettingsService::class)->putTenant(['grni_account_id' => $grni->id], $owner, 'GRNI لاختبار المؤشر');
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subMinute()->toIso8601String(), 'reason' => 'سعر اختبار المؤشر',
        ], $owner);
        $level = fn () => $this->ownerGet('/tanks/' . $tank->id)->json('data');

        $this->assertSame('no_stock_record', $level()['book_level_unavailable_reason'], 'قبل أي حركة: لا سجل ⇒ ليس صفراً');

        $receiving = app(FuelSupplyReceivingService::class);
        $deliver = fn (string $key, string $liters) => $receiving->approveDelivery($receiving->createDelivery([
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'warehouse_id' => $wh->id, 'supplier_id' => $supplier->id,
            'dispatched_liters' => $liters, 'received_liters' => $liters, 'received_total_cost_minor' => 2345, 'delivery_note_number' => "DN-{$key}",
            'idempotency_key' => $key, 'received_at' => '2026-08-23 10:00:00', 'created_by' => $owner->id,
        ]), $owner->id);

        // مسودة استلام لا تؤثر؛ الاعتماد يرفع.
        $draft = $receiving->createDelivery([
            'fuel_station_id' => $station->id, 'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'warehouse_id' => $wh->id, 'supplier_id' => $supplier->id,
            'dispatched_liters' => '10.000', 'received_liters' => '10.000', 'received_total_cost_minor' => 2345, 'delivery_note_number' => 'DN-draft',
            'idempotency_key' => 'flow-draft', 'received_at' => '2026-08-23 10:00:00', 'created_by' => $owner->id,
        ]);
        $this->assertSame('no_stock_record', $level()['book_level_unavailable_reason']);
        $receiving->approveDelivery($draft, $owner->id);
        $this->assertSame(10_000, $level()['book_level']['milliliters']);

        // مسودة بيع لا تؤثر؛ الاعتماد ينقص.
        $shift = app(FuelShiftService::class)->open(['fuel_station_id' => $station->id, 'opening_float_minor' => 0, 'idempotency_key' => 'flow-shift'], $owner);
        $sales = app(FuelSaleService::class);
        $sale = $sales->createDraft(['fuel_station_id' => $station->id, 'fuel_nozzle_id' => $nozzle->id, 'fuel_shift_id' => $shift->id, 'partner_id' => $customer->id, 'quantity_milliliters' => 1234, 'idempotency_key' => 'flow-sale'], $owner);
        $this->assertSame(10_000, $level()['book_level']['milliliters'], 'المسودة لا تخصم');
        $sales->finalize($sale, $owner);
        $this->assertSame(8_766, $level()['book_level']['milliliters']);
        $sales->finalize(FuelSale::findOrFail($sale->id), $owner);   // إعادة اعتماد
        $this->assertSame(8_766, $level()['book_level']['milliliters'], 'إعادة الاعتماد لا تخصم مرتين');

        $deliver('flow-d2', '5.000');
        $this->assertSame(13_766, $level()['book_level']['milliliters']);
    }

    // ───────────────────────── أدوات ─────────────────────────

    private function ownerGet(string $path): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->ownerToken)->getJson(self::BASE . $path)->assertOk();
    }

    /**
     * عبارات SQL الفعلية للطلب بعد توحيد أعداد عناصر `IN (…)`، دون مصادقة Sanctum (`last_used_at` يُحدَّث أول طلب فقط).
     * تساوي القائمتين بين خزان واحد وعدة خزانات يثبت غياب أي استعلام لكل صف، وهو أقوى من مقارنة العدد وحده.
     *
     * @return list<string>
     */
    private function requestStatements(string $path): array
    {
        DB::flushQueryLog();
        DB::enableQueryLog();
        $this->ownerGet($path);
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        return collect($log)->pluck('query')
            ->reject(fn ($q) => str_contains($q, '"personal_access_tokens"'))
            ->map(fn ($q) => preg_replace(['/\bin \((?:\?,\s*)*\?\)/i', '/\s+/'], ['in (?)', ' '], $q))
            ->values()->all();
    }

    private function world(): void
    {
        $auth = $this->registerTenant('fuel-bb-main', 'owner@fuel-bb-main.test', autoEnableApplications: true);
        $this->tenantId = $auth['tenant_id'];
        $this->ownerToken = $auth['token'];
        app(TenantContext::class)->set($this->tenantId);
        $this->grantFuel($this->tenantId);
        Tenant::findOrFail($this->tenantId)->update(['country' => 'SA']);
        $this->branchA = Branch::where('is_main', true)->firstOrFail();
        $this->branchB = Branch::create(['code' => 'BR-BB', 'name' => 'فرع ب']);
        app(BranchContext::class)->set($this->branchA->id);
    }

    private function grantFuel(string $tenantId): void
    {
        $grants = app(EntitlementGrantService::class);
        $tenant = Tenant::findOrFail($tenantId);
        foreach (['fuel_stations.core'] as $app) {
            $grants->grant($tenant, $app, EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL, CarbonImmutable::now('UTC'), grantReasonCode: 'test_tank_balance_p1', reason: 'اختبار رصيد الخزان.');
        }
    }

    private function warehouse(Branch $branch, ?string $code = null): Warehouse
    {
        if ($code === null) {
            return Warehouse::where('branch_id', $branch->id)->where('is_default', true)->first()
                ?? Warehouse::create(['name' => 'مخزن ' . $branch->code, 'code' => 'WH-' . $branch->code, 'branch_id' => $branch->id]);
        }

        return Warehouse::create(['name' => "مخزن {$code}", 'code' => $code, 'branch_id' => $branch->id]);
    }

    private function fuel(string $code = 'F'): FuelProduct
    {
        $n = ++$this->seq;
        $product = Product::create(['branch_id' => $this->branchA->id, 'sku' => "BB-{$code}-{$n}", 'name' => "وقود {$code}", 'unit' => 'mL', 'track_inventory' => true]);

        return FuelProduct::create(['product_id' => $product->id, 'code' => "FP-{$code}-{$n}", 'name' => "وقود {$code}"]);
    }

    private function station(Branch $branch, ?Warehouse $warehouse, string $code = 'S'): FuelStation
    {
        $n = ++$this->seq;

        return FuelStation::create(['branch_id' => $branch->id, 'warehouse_id' => $warehouse?->id, 'code' => $code === 'S' ? "FS-{$n}" : $code, 'name' => "محطة {$code}-{$n}"]);
    }

    private function tank(FuelStation $station, FuelProduct $fuel, string $code = 'T', string $status = FuelTank::STATUS_ACTIVE): FuelTank
    {
        $n = ++$this->seq;

        return FuelTank::create([
            'branch_id' => $station->branch_id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
            'code' => $code === 'T' ? "FT-{$n}" : $code, 'name' => "خزان {$code}-{$n}", 'capacity_milliliters' => 34_000_000, 'safe_capacity_milliliters' => 33_000_000, 'status' => $status,
        ]);
    }

    /** سجل الرصيد الرسمي مباشرةً لسيناريوهات القراءة (التدفق الحقيقي له اختبار مستقل أعلاه). */
    private function stock(Warehouse $warehouse, FuelProduct $fuel, int $quantity): void
    {
        ProductWarehouseStock::create(['product_id' => $fuel->product_id, 'warehouse_id' => $warehouse->id, 'quantity' => $quantity]);
    }

    /**
     * @param  list<string>|null  $permissions
     * @param  list<string>|null  $stations
     * @param  list<string>|null  $branches
     * @param  list<string>|null  $warehouses
     * @return array{user: User, token: string}
     */
    private function scopedUser(string $name, ?array $permissions = null, ?array $stations = null, ?array $branches = null, ?array $warehouses = null): array
    {
        app(TenantContext::class)->set($this->tenantId);
        $slug = "role-{$name}";
        Role::create(['tenant_id' => $this->tenantId, 'slug' => $slug, 'name' => $slug, 'permissions' => $permissions ?? ['fuel_stations.view'], 'is_system' => false]);
        $user = User::create(['tenant_id' => $this->tenantId, 'name' => $name, 'email' => "{$name}@fuel-bb.test", 'password' => 'password123', 'role' => $slug]);
        if ($stations !== null) {
            $user->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
            $user->fuelStations()->sync($stations);
        }
        if ($branches !== null) {
            $user->branches()->sync($branches);
        }
        if ($warehouses !== null) {
            $user->warehouses()->sync($warehouses);
        }

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }
}

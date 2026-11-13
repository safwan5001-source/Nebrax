<?php

namespace Tests\Feature;

use App\Models\FuelInventoryCostMovement;
use App\Models\FuelInventoryCostState;
use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStation;
use App\Models\FuelTanker;
use App\Models\FuelTankerFill;
use App\Models\FuelTankerFillInventoryPosting;
use App\Models\FuelTankerOwner;
use App\Models\JournalEntry;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Services\FuelStationSettingsService;
use App\Services\FuelTankerFillInventoryReadiness as Readiness;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * TANKER-PR6A — جاهزية الدمج المخزني للسندات المعلّقة + سياسات المراجعة + ضوابط منع التكرار في القاعدة. **لا خصم ولا ترحيل ولا قيد**: يثبت الاختبار أن عرض المراجعة
 * وتقييم الجاهزية لا يغيّران أي رصيد أو مجمّع تكلفة أو قيد أو حالة سند، وأن جدول الربط المستقبلي يحمي من التكرار والعكس المزدوج في القاعدة نفسها.
 */
class FuelTankerFillInventoryReadinessTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const FILLS = '/api/fuel-stations/tanker-fills';
    private const REVIEW = '/api/fuel-stations/tanker-fills/inventory-review';
    private const VIEW = ['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record', 'fuel.tanker.fill.void', 'fuel.tanker.fill.inventory.view'];

    private FuelNozzle $nozzle;
    private FuelTankerOwner $owner;
    private FuelShift $shift;
    private int $seq = 0;
    private ?\Carbon\CarbonImmutable $clock = null;
    private FuelTanker $tanker;

    protected function setUp(): void
    {
        parent::setUp();
        config(['fuel_stations.tanker_management_enabled' => true, 'fuel_stations.tanker_fills_enabled' => true]);
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => '02', 'name' => 'مضخة 2']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
        $this->owner = FuelTankerOwner::create(['name' => 'عسكر', 'code' => 'ASK', 'status' => 'active']);
        $this->tanker = FuelTanker::create(['fuel_tanker_owner_id' => $this->owner->id, 'plate_number' => 'أ ب ج 1234', 'plate_key' => 'ABJ1234', 'capacity_milliliters' => 5_000_000, 'status' => 'active']);
        $this->shift = FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'number' => 'FSH-T6-1', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-t6-1', 'opened_by' => $this->makeUser('seller-t6', 'role-seller-t6', ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    private function caught(callable $operation): ?\Throwable
    {
        try {
            DB::transaction($operation); // نقطة حفظ: فشل القيد داخل معاملة PostgreSQL لا يفسد بقية الاختبار
        } catch (\Throwable $e) {
            return $e;
        }

        return null;
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    // ───────────────────────── أدوات ─────────────────────────

    /** @param list<string> $permissions @return array{user: \App\Models\User, token: string} */
    private function staff(array $permissions = self::VIEW, ?array $stations = null): array
    {
        $n = ++$this->seq;

        return $this->makeUser("t6staff{$n}", "role-t6-{$n}", $permissions, $stations);
    }

    /** @param array<string, mixed> $extra */
    private function fill(int $milliliters = 1_000_000, ?string $voucher = null, array $extra = []): FuelTankerFill
    {
        $n = ++$this->seq;
        // أوقات تسجيل متمايزة: ترتيب التراكم في المراجعة بوقت التسجيل (ثانية واحدة بينها).
        Carbon::setTestNow(($this->clock ??= \Carbon\CarbonImmutable::now())->addSeconds($n));
        $response = $this->withToken($this->fx['owner'])->postJson(self::FILLS, array_merge([
            'fuel_station_id' => $this->fx['s1']->id, 'fuel_nozzle_id' => $this->nozzle->id, 'fuel_tanker_owner_id' => $this->owner->id,
            'voucher_number' => $voucher ?? "V{$n}", 'quantity_milliliters' => $milliliters, 'idempotency_key' => "fill-t6-{$n}",
        ], $extra))->assertCreated();

        return FuelTankerFill::query()->findOrFail($response->json('data.id'));
    }

    /** رصيد المخزن الرسمي + حالة تكلفة متّسقة (إعداد اختباري: يحاكي مخزوناً قائماً دون أي مسار خصم). */
    private function seedStock(int $milliliters, ?int $poolMilliliters = null, bool $withCostState = true): void
    {
        ProductWarehouseStock::create(['warehouse_id' => $this->fx['wA1']->id, 'product_id' => $this->fx['fuel']->product_id, 'quantity' => $milliliters]);
        if ($withCostState) {
            FuelInventoryCostState::create([
                'warehouse_id' => $this->fx['wA1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'quantity_milliliters' => $poolMilliliters ?? $milliliters,
                'cost_pool_minor' => 123456, 'cost_numerator_minor' => '123456', 'cost_denominator' => (string) max(1, $poolMilliliters ?? $milliliters),
                'allocation_mode' => 'none', 'allocation_basis_quantity_milliliters' => 0, 'allocation_basis_cost_pool_minor' => 0, 'allocation_issued_milliliters' => 0,
                'allocation_posted_minor' => 0, 'carry_remainder_numerator' => '0', 'carry_remainder_denominator' => '1',
            ]);
        }
    }

    /** @return array<string, mixed> */
    private function review(string $token, string $query = ''): array
    {
        return $this->withToken($token)->getJson(self::REVIEW . $query)->assertOk()->json();
    }

    private function itemOf(array $payload, FuelTankerFill $fill): array
    {
        foreach ($payload['data'] as $row) {
            if ($row['id'] === $fill->id) {
                return $row['inventory_readiness'];
            }
        }
        $this->fail('السند غير موجود في المراجعة');
    }

    /** لقطة كل ما لا يجوز أن يتغيّر بهذه الشريحة. */
    private function effects(): array
    {
        return [
            'movements' => StockMovement::query()->count(),
            'journals' => JournalEntry::query()->count(),
            'stock' => ProductWarehouseStock::query()->orderBy('id')->get(['id', 'quantity', 'revision'])->toArray(),
            'pools' => FuelInventoryCostState::query()->orderBy('id')->get()->map->only(['id', 'quantity_milliliters', 'cost_pool_minor', 'cost_numerator_minor', 'cost_denominator'])->all(),
            'cost_movements' => FuelInventoryCostMovement::query()->count(),
            'fills' => FuelTankerFill::query()->orderBy('id')->get(['id', 'status', 'inventory_status'])->toArray(),
            'invoices' => \App\Models\Invoice::query()->count(),
            'postings' => DB::table('fuel_tanker_fill_inventory_postings')->count(),
        ];
    }

    // ───────────────────────── البوابة والصلاحية والعزل ─────────────────────────

    /** @test */
    public function the_review_is_closed_behind_both_deployment_gates_and_needs_its_own_permission(): void
    {
        $viewer = $this->staff();
        config(['fuel_stations.tanker_fills_enabled' => false]);
        $this->withToken($viewer['token'])->getJson(self::REVIEW)->assertNotFound();
        config(['fuel_stations.tanker_fills_enabled' => true, 'fuel_stations.tanker_management_enabled' => false]);
        $this->withToken($viewer['token'])->getJson(self::REVIEW)->assertNotFound();
        config(['fuel_stations.tanker_management_enabled' => true]);

        $withoutPermission = $this->staff(['fuel_stations.view', 'fuel.tanker.fill.view', 'fuel.tanker.fill.record']);
        $this->withToken($withoutPermission['token'])->getJson(self::REVIEW)->assertForbidden();
        $this->withToken($viewer['token'])->getJson(self::REVIEW)->assertOk();
    }

    /** @test */
    public function the_review_is_a_pure_read_with_no_write_routes(): void
    {
        $writes = collect(\Route::getRoutes()->getRoutes())->filter(fn ($route) => str_contains($route->uri(), 'tanker-fills/inventory-review'));
        $this->assertCount(1, $writes);
        $this->assertSame(['GET', 'HEAD'], $writes->first()->methods());
        $viewer = $this->staff();
        foreach (['post', 'put', 'patch', 'delete'] as $method) {
            $this->withToken($viewer['token'])->{$method . 'Json'}(self::REVIEW)->assertStatus(405);
        }
    }

    /** @test */
    public function a_station_scoped_user_sees_only_assigned_stations_and_other_stations_are_not_found(): void
    {
        $this->seedStock(5_000_000);
        $fill = $this->fill();
        $scoped = $this->staff(self::VIEW, [$this->fx['s2']->id]);
        $this->assertSame([], $this->review($scoped['token'])['data']);
        $this->withToken($scoped['token'])->getJson(self::REVIEW . '?station_id=' . $this->fx['s1']->id)->assertNotFound();

        $assigned = $this->staff(self::VIEW, [$this->fx['s1']->id]);
        $this->assertSame([$fill->id], array_column($this->review($assigned['token'])['data'], 'id'));
    }

    /** @test */
    public function another_tenants_fills_never_appear(): void
    {
        $this->seedStock(5_000_000);
        $this->fill();
        $other = $this->registerTenant('fuel-b3-other', 'owner@fuel-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_other', reason: 'عزل المستأجرين.',
        );
        $this->assertSame([], $this->withToken($other['token'])->getJson(self::REVIEW)->assertOk()->json('data'));
    }

    // ───────────────────────── التصنيف ─────────────────────────

    /** @test */
    public function a_fill_with_all_prerequisites_is_ready_and_the_payload_states_posting_is_disabled(): void
    {
        $this->seedStock(5_000_000);
        $fill = $this->fill(1_000_000);
        $payload = $this->review($this->staff()['token']);

        $item = $this->itemOf($payload, $fill);
        $this->assertSame(Readiness::READY, $item['readiness']);
        $this->assertSame([], $item['blockers']);
        $this->assertSame(['available_milliliters' => 5_000_000, 'cumulative_milliliters' => 1_000_000], array_intersect_key($item['pool'], ['available_milliliters' => 1, 'cumulative_milliliters' => 1]));
        $this->assertFalse($payload['meta']['posting_enabled']);
        $this->assertSame(Readiness::RECONCILIATION_REQUIREMENTS, $payload['meta']['reconciliation_requirements']);
        $this->assertSame(FuelTankerFill::INVENTORY_PENDING_INTEGRATION, FuelTankerFill::query()->findOrFail($fill->id)->inventory_status);
        $this->assertSame(['total' => 1, 'ready' => 1, 'needs_review' => 0, 'blocked' => 0, 'overdue' => 0], $payload['meta']['summary']);
    }

    /** @test */
    public function missing_stock_record_baseline_pool_mismatch_and_open_history_are_blockers(): void
    {
        $fill = $this->fill();
        $viewer = $this->staff();
        $this->assertSame([Readiness::B_STOCK_RECORD_MISSING], $this->itemOf($this->review($viewer['token']), $fill)['blockers']);

        $this->seedStock(5_000_000, withCostState: false);
        $this->assertSame([Readiness::B_COST_BASELINE_REQUIRED], $this->itemOf($this->review($viewer['token']), $fill)['blockers']);

        FuelInventoryCostState::query()->delete();
        $this->seedPoolState(4_000_000);
        $this->assertSame([Readiness::B_COST_POOL_MISMATCH], $this->itemOf($this->review($viewer['token']), $fill)['blockers']);

        // (مانع `cost_history_open` يقرأ شرط `FuelCostBasisService::quoteIssue` نفسه من `fuel_cost_pool_open_histories`؛ إنشاء صفه يتطلب سلسلة تسوية وردية كاملة
        //  فيُغطّى بقراءة الشرط حرفياً — انظر التقرير: حد معلن.)
        FuelInventoryCostState::query()->update(['quantity_milliliters' => 5_000_000]);
        $this->assertSame(Readiness::READY, $this->itemOf($this->review($viewer['token']), $fill)['readiness']);
    }

    private function seedPoolState(int $milliliters): void
    {
        FuelInventoryCostState::create([
            'warehouse_id' => $this->fx['wA1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'quantity_milliliters' => $milliliters,
            'cost_pool_minor' => 1000, 'cost_numerator_minor' => '1000', 'cost_denominator' => '1', 'allocation_mode' => 'none',
            'allocation_basis_quantity_milliliters' => 0, 'allocation_basis_cost_pool_minor' => 0, 'allocation_issued_milliliters' => 0, 'allocation_posted_minor' => 0,
            'carry_remainder_numerator' => '0', 'carry_remainder_denominator' => '1',
        ]);
    }

    /** @test */
    public function insufficient_balance_blocks_by_default_and_needs_review_under_hold_policy_and_is_cumulative(): void
    {
        $this->seedStock(1_500_000);
        $first = $this->fill(1_000_000);
        $second = $this->fill(1_000_000);
        $viewer = $this->staff();

        $payload = $this->review($viewer['token']);
        $this->assertSame(Readiness::READY, $this->itemOf($payload, $first)['readiness']);
        $this->assertSame([Readiness::B_INSUFFICIENT_BALANCE], $this->itemOf($payload, $second)['blockers'], 'تراكمي: السند الثاني يتجاوز الرصيد مع الأول');
        $this->assertSame(500_000, $payload['meta']['pools'][0]['shortfall_milliliters']);

        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_insufficient_policy' => 'hold_for_review', 'reason' => 'مراجعة'])->assertOk();
        $held = $this->itemOf($this->review($viewer['token']), $second);
        $this->assertSame(Readiness::NEEDS_REVIEW, $held['readiness']);
        $this->assertSame([], $held['blockers']);
        $this->assertSame([Readiness::R_INSUFFICIENT_BALANCE], $held['review_reasons']);
    }

    /** @test */
    public function the_cumulative_and_pool_totals_come_from_sql_not_from_loading_the_pending_backlog(): void
    {
        $this->seedStock(2_500_000);
        $fills = collect(range(1, 5))->map(fn () => $this->fill(1_000_000))->values(); // 5 × 1,000,000 مقابل رصيد 2,500,000
        $viewer = $this->staff();
        $this->review($viewer['token']); // يسخّن (جلب الأدوار...)

        // تقييم الثالث وحده (كأن الصفحة تحمل سنداً واحداً): تراكمياً يشمل السندين السابقين دون تحميلهما.
        $third = $fills[2]->fresh();
        DB::enableQueryLog();
        $result = app(Readiness::class)->evaluate(collect([$third]));
        $log = DB::getQueryLog();
        DB::disableQueryLog();

        $item = $result['items'][$fills[2]->id];
        $this->assertSame(3_000_000, $item['pool']['cumulative_milliliters']);
        $this->assertSame(2_500_000, $item['pool']['available_milliliters']);
        $this->assertSame([Readiness::B_INSUFFICIENT_BALANCE], $item['blockers']);
        $this->assertSame(5, $result['pools'][0]['pending_count']);
        $this->assertSame(5_000_000, $result['pools'][0]['pending_total_milliliters']);
        $this->assertSame(2_500_000, $result['pools'][0]['shortfall_milliliters']);
        $this->assertSame('وقود B3', $result['pools'][0]['fuel_product_name']);
        $this->assertNotEmpty($result['pools'][0]['warehouse_name']);

        // لا استعلام يجلب صفوف السندات المعلّقة نفسها: كلها تجميع/نافذة.
        foreach ($log as $entry) {
            if (str_contains($entry['query'], 'fuel_tanker_fills')) {
                $this->assertMatchesRegularExpression('/sum\(|count\(\*\)/i', $entry['query'], 'استعلام السندات يجب أن يكون تجميعاً: ' . $entry['query']);
            }
        }
    }

    /** @test */
    public function a_reviewer_of_one_station_never_sees_pending_activity_of_another_station_sharing_the_warehouse(): void
    {
        // المحطة 2 تشارك مخزن المحطة 1 (رصيد واحد): التصنيف يعدّ الاثنتين، والعرض يقتصر على محطات المراجع.
        FuelStation::query()->whereKey($this->fx['s2']->id)->update(['warehouse_id' => $this->fx['wA1']->id]);
        $pump2 = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'pump_number' => '01', 'name' => 'مضخة م2']);
        $nozzle2 = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'fuel_pump_id' => $pump2->id, 'fuel_tank_id' => $this->fx['t2']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
        FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s2']->id, 'number' => 'FSH-T6-2', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'shift-t6-2', 'opened_by' => \App\Models\User::query()->firstOrFail()->id, 'opened_at' => now(),
        ]);
        $this->seedStock(1_500_000);
        $own = $this->fill(1_000_000); // s1 — مرئي للمراجع
        $other = $this->fill(900_000, extra: ['fuel_station_id' => $this->fx['s2']->id, 'fuel_nozzle_id' => $nozzle2->id]); // s2 — غير مرئي له

        $scoped = $this->staff(self::VIEW, [$this->fx['s1']->id]);
        $payload = $this->review($scoped['token']);
        $this->assertSame([$own->id], array_column($payload['data'], 'id'));
        $pool = $payload['meta']['pools'][0];
        $this->assertSame(1, $pool['pending_count'], 'عدّ سنداته وحدها');
        $this->assertSame(1_000_000, $pool['pending_total_milliliters']);
        $this->assertTrue($pool['shared_with_other_stations'], 'يُعلَن أن الرصيد مشترك دون كميات المحطة الأخرى');
        $this->assertSame(0, $pool['shortfall_milliliters'], 'عجز محسوب على سنداته وحدها: لا يكشف طلب المحطة الأخرى');
        $this->assertSame(1_000_000, $this->itemOf($payload, $own)['pool']['cumulative_milliliters']);
        $this->assertStringNotContainsString('900000', (string) json_encode($payload));

        // لكن التصنيف يعدّ المخزن كله: السند الثاني (حسب وقت التسجيل) يتجاوز الرصيد المشترك، وكل ما يُعرض له سبب عام فقط.
        $unrestricted = $this->review($this->staff()['token']);
        $this->assertSame(1_900_000, $unrestricted['meta']['pools'][0]['pending_total_milliliters']);
        $this->assertFalse($unrestricted['meta']['pools'][0]['shared_with_other_stations']);
        $this->assertSame([Readiness::B_INSUFFICIENT_BALANCE], $this->itemOf($unrestricted, $other)['blockers']);
        $this->assertSame(Readiness::READY, $this->itemOf($unrestricted, $own)['readiness']);
    }

    /** @test */
    public function a_confirmed_capacity_overrun_and_an_overdue_fill_need_review_per_the_hours_setting(): void
    {
        $this->seedStock(9_000_000);
        $overrun = $this->fill(5_500_000, extra: ['fuel_tanker_id' => $this->tanker->id, 'confirm_capacity_overrun' => true]); // سعة الصهريج 5,000,000 ⇒ تجاوز مؤكَّد
        $this->assertNotNull(FuelTankerFill::query()->findOrFail($overrun->id)->capacity_overrun_milliliters);
        $viewer = $this->staff();
        $item = $this->itemOf($this->review($viewer['token']), $overrun);
        $this->assertSame(Readiness::NEEDS_REVIEW, $item['readiness']);
        $this->assertContains(Readiness::R_CAPACITY_OVERRUN, $item['review_reasons']);

        $plain = $this->fill(100_000);
        $this->assertSame(Readiness::READY, $this->itemOf($this->review($viewer['token']), $plain)['readiness']);
        Carbon::setTestNow(now()->addHours(25));
        $late = $this->itemOf($this->review($viewer['token']), $plain);
        $this->assertSame(Readiness::NEEDS_REVIEW, $late['readiness']);
        $this->assertTrue($late['overdue']);
        $this->assertContains(Readiness::R_OVERDUE, $late['review_reasons']);

        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_review_after_hours' => 48, 'reason' => 'مهلة أطول'])->assertOk();
        $this->assertSame(Readiness::READY, $this->itemOf($this->review($viewer['token']), $plain)['readiness']);
    }

    /** @test */
    public function a_missing_warehouse_or_inactive_station_blocks_and_voided_fills_are_not_listed(): void
    {
        $this->seedStock(5_000_000);
        $fill = $this->fill();
        $voided = $this->fill(100_000);
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$voided->id}/void", ['reason' => 'خطأ إدخال'])->assertOk();
        $viewer = $this->staff();
        $payload = $this->review($viewer['token']);
        $this->assertSame([$fill->id], array_column($payload['data'], 'id'));

        FuelStation::query()->whereKey($this->fx['s1']->id)->update(['status' => FuelStation::STATUS_MAINTENANCE]);
        $this->assertContains(Readiness::B_STATION_NOT_ACTIVE, $this->itemOf($this->review($viewer['token']), $fill)['blockers']);
    }

    /** @test */
    public function filters_and_paging_work_and_the_pool_value_is_cost_gated(): void
    {
        $this->seedStock(1_000_000);
        $ready = $this->fill(400_000);
        $blocked = $this->fill(900_000);
        $viewer = $this->staff();

        $this->assertSame([$blocked->id], array_column($this->review($viewer['token'], '?readiness=blocked')['data'], 'id'));
        $this->assertSame([$ready->id], array_column($this->review($viewer['token'], '?readiness=ready')['data'], 'id'));
        $this->assertSame(1, $this->review($viewer['token'], '?per_page=1')['meta']['last_page'] - 1);

        $this->assertArrayNotHasKey('cost_pool_value_minor', $this->review($viewer['token'])['meta']['pools'][0], 'بلا products.view_cost لا مبلغ');
        $finance = $this->staff([...self::VIEW, 'products.view_cost']);
        $this->assertSame(123456, $this->review($finance['token'])['meta']['pools'][0]['cost_pool_value_minor']);
    }

    // ───────────────────────── لا أثر مخزني أو محاسبي ─────────────────────────

    /** @test */
    public function reviewing_and_recording_never_deduct_stock_touch_the_pool_post_entries_or_change_fill_status(): void
    {
        $this->seedStock(5_000_000);
        $before = $this->effects();
        $this->fill(1_000_000);
        $this->fill(2_000_000);
        $viewer = $this->staff();
        for ($i = 0; $i < 3; $i++) {
            $this->review($viewer['token']);
        }

        $after = $this->effects();
        $after['fills'] = [];
        $before['fills'] = [];
        $this->assertSame($before, $after, 'لا حركة مخزون ولا قيد ولا تغيير رصيد أو مجمّع تكلفة ولا فاتورة ولا ترحيل');
        $this->assertSame(0, FuelTankerFill::query()->where('inventory_status', '<>', 'pending_integration')->count());
    }

    /** @test */
    public function legacy_pending_fills_are_never_posted_automatically_by_running_the_migrations_or_the_review(): void
    {
        $this->seedStock(5_000_000);
        $fill = $this->fill();
        $this->artisan('migrate', ['--force' => true])->assertExitCode(0);
        $this->review($this->staff()['token']);

        $this->assertSame(FuelTankerFill::INVENTORY_PENDING_INTEGRATION, FuelTankerFill::query()->findOrFail($fill->id)->inventory_status);
        $this->assertSame(0, DB::table('fuel_tanker_fill_inventory_postings')->count());
    }

    /** @test */
    public function the_database_keeps_pending_integration_as_the_only_allowed_inventory_status(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql' && DB::connection()->getDriverName() !== 'sqlite') {
            $this->markTestSkipped('driver');
        }
        $fill = $this->fill();
        $error = $this->caught(fn () => DB::table('fuel_tanker_fills')->where('id', $fill->id)->update(['inventory_status' => 'posted']));
        $this->assertInstanceOf(QueryException::class, $error, 'لا انتقال مخزني ممكن قبل PR-6B ولو بتجاوز النموذج');
    }

    // ───────────────────────── الإعدادات ─────────────────────────

    /** @test */
    public function the_review_settings_have_safe_defaults_inheritance_validation_and_governance(): void
    {
        $station = $this->fx['s1'];
        $service = app(FuelStationSettingsService::class);
        $this->assertSame(['insufficient_policy' => 'block', 'review_after_hours' => 24], $service->tankerInventoryPolicy($station));

        $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_review_after_hours' => 12, 'reason' => 'مؤسسة'])->assertOk();
        $this->assertSame(12, $service->tankerInventoryPolicy($station)['review_after_hours'], 'المؤسسة');
        $this->withToken($this->fx['owner'])->putJson("/api/fuel-stations/stations/{$station->id}/settings", ['tanker_inventory_review_after_hours' => 6, 'reason' => 'محطة'])->assertOk();
        $this->assertSame(6, $service->tankerInventoryPolicy($station->fresh())['review_after_hours'], 'تجاوز المحطة');
        $this->assertSame(12, $service->tankerInventoryPolicy($this->fx['s2'])['review_after_hours'], 'المحطة الأخرى ترث المؤسسة');

        foreach ([['tanker_inventory_insufficient_policy' => 'allow_negative'], ['tanker_inventory_insufficient_policy' => 'silent_adjust'], ['tanker_inventory_review_after_hours' => 0], ['tanker_inventory_review_after_hours' => 721]] as $bad) {
            $this->withToken($this->fx['owner'])->putJson('/api/fuel-stations/settings', $bad + ['reason' => 'خطأ'])->assertStatus(422);
        }

        // الرصيد غير الكافي حساس (حوكمة): يتطلب `fuel.governance.manage` مع `fuel_stations.manage`.
        $manager = $this->staff(['fuel_stations.view', 'fuel_stations.manage']);
        $this->withToken($manager['token'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_review_after_hours' => 10, 'reason' => 'ok'])->assertOk();
        $this->withToken($manager['token'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_insufficient_policy' => 'hold_for_review', 'reason' => 'x'])->assertForbidden();
        $governor = $this->staff(['fuel_stations.view', 'fuel_stations.manage', 'fuel.governance.manage']);
        $this->withToken($governor['token'])->putJson('/api/fuel-stations/settings', ['tanker_inventory_insufficient_policy' => 'hold_for_review', 'reason' => 'x'])->assertOk();

        // لا override على مستوى الجهاز (سياسة محطة/مؤسسة فقط).
        $error = $this->caught(fn () => $service->putDevice($station, 'device-1', 'tanker_inventory_insufficient_policy', 'block'));
        $this->assertInstanceOf(RuntimeException::class, $error);
    }

    /** @test */
    public function there_is_no_setting_that_enables_posting_or_bypasses_the_duplicate_guards(): void
    {
        $defaults = array_keys(\App\Support\Settings::DEFAULTS['fuel_stations']);
        foreach ($defaults as $key) {
            if (str_contains($key, 'tanker_inventory')) {
                $this->assertDoesNotMatchRegularExpression('/(post|enable|allow_negative|bypass|skip|duplicate)/', $key, "مفتاح {$key} لا يجوز أن يفعّل الترحيل أو يتجاوز الضوابط");
            }
        }
        $this->assertFalse(Readiness::POSTING_ENABLED);
    }

    // ───────────────────────── ضوابط منع التكرار في القاعدة (البنية المستقبلية) ─────────────────────────

    /** @return array{fill: FuelTankerFill, rows: array<string, mixed>} */
    private function postingRow(FuelTankerFill $fill, ?StockMovement $stock = null, ?FuelInventoryCostMovement $cost = null, string $key = 'post-1'): array
    {
        $stock ??= $this->stockMovement();
        $cost ??= $this->costMovement($stock);

        return [
            'id' => (string) \Illuminate\Support\Str::uuid(), 'tenant_id' => $this->tenantId, 'branch_id' => $this->fx['branchA']->id, 'fuel_tanker_fill_id' => $fill->id,
            'fuel_station_id' => $fill->fuel_station_id, 'fuel_product_id' => $fill->fuel_product_id, 'warehouse_id' => $this->fx['wA1']->id,
            'stock_movement_id' => $stock->id, 'cost_movement_id' => $cost->id, 'quantity_milliliters' => $fill->quantity_milliliters, 'posted_cost_minor' => 500,
            'idempotency_key' => $key, 'status' => 'posted', 'posted_by' => \App\Models\User::query()->firstOrFail()->id,
            'posted_at' => now(), 'created_at' => now(), 'updated_at' => now(),
        ];
    }

    private function stockMovement(): StockMovement
    {
        return StockMovement::create([
            'product_id' => $this->fx['fuel']->product_id, 'warehouse_id' => $this->fx['wA1']->id, 'branch_id' => $this->fx['branchA']->id,
            'type' => 'out', 'quantity' => 1, 'unit_cost' => 0, 'total_cost' => 0, 'balance_quantity' => 0, 'movement_date' => now()->toDateString(),
        ]);
    }

    private function costMovement(StockMovement $stock): FuelInventoryCostMovement
    {
        return FuelInventoryCostMovement::create([
            'warehouse_id' => $this->fx['wA1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'stock_movement_id' => $stock->id, 'movement_type' => 'issue',
            'quantity_milliliters' => 1, 'posted_cost_minor' => 0, 'cost_pool_minor_before' => 0, 'cost_numerator_before' => '0', 'cost_denominator_before' => '1',
            'quantity_milliliters_before' => 0, 'carry_remainder_numerator_before' => '0', 'carry_remainder_denominator_before' => '1', 'cost_pool_minor_after' => 0,
            'cost_numerator_after' => '0', 'cost_denominator_after' => '1', 'quantity_milliliters_after' => 0, 'carry_remainder_numerator_after' => '0',
            'carry_remainder_denominator_after' => '1', 'occurred_at' => now(),
        ]);
    }

    /** @test */
    public function the_database_allows_one_posting_per_fill_and_one_per_movement_and_one_per_idempotency_key(): void
    {
        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        DB::table('fuel_tanker_fill_inventory_postings')->insert($row);

        // نفس السند مرة ثانية (حركة جديدة ومفتاح جديد) ⇒ مرفوض: ترحيل واحد لكل سند.
        $again = $this->postingRow($fill, key: 'post-2');
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($again)));

        // حركة المخزون نفسها لسند آخر ⇒ مرفوض.
        $other = $this->fill(500_000);
        $stolen = $this->postingRow($other, stock: StockMovement::query()->findOrFail($row['stock_movement_id']), cost: $this->costMovement($this->stockMovement()), key: 'post-3');
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($stolen)));

        // حركة تكلفة نفسها لسند آخر ⇒ مرفوض.
        $stolenCost = $this->postingRow($other, stock: $this->stockMovement(), cost: FuelInventoryCostMovement::query()->findOrFail($row['cost_movement_id']), key: 'post-4');
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($stolenCost)));

        // المفتاح المرجعي نفسه لسند آخر ⇒ مرفوض (إعادة المحاولة/انقطاع الاتصال لا تنتج خصماً ثانياً).
        $sameKey = $this->postingRow($other, key: 'post-1');
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($sameKey)));

        $this->assertSame(1, DB::table('fuel_tanker_fill_inventory_postings')->count());
    }

    /** @test */
    public function a_posting_must_match_a_recorded_fill_and_its_exact_quantity(): void
    {
        $fill = $this->fill(1_000_000);
        $wrongQuantity = array_merge($this->postingRow($fill), ['quantity_milliliters' => 999_999]);
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($wrongQuantity)));

        $voided = $this->fill(200_000);
        $this->withToken($this->fx['owner'])->postJson(self::FILLS . "/{$voided->id}/void", ['reason' => 'خطأ'])->assertOk();
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($this->postingRow($voided->fresh(), key: 'v'))));

        $reversedAtBirth = array_merge($this->postingRow($fill, key: 'r'), ['status' => 'reversed']);
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->insert($reversedAtBirth)));
        $this->assertSame(0, DB::table('fuel_tanker_fill_inventory_postings')->count());
    }

    /** @test */
    public function the_historical_quantity_and_cost_are_immutable_and_a_reversal_happens_once_and_never_reopens(): void
    {
        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        DB::table('fuel_tanker_fill_inventory_postings')->insert($row);
        $table = fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id']);

        // الكمية والتكلفة التاريخيتان والمفتاح والحركة لا تتغيّر أبداً (العكس لاحقاً بالقيمتين الأصليتين لا بإعادة التسعير).
        foreach (['quantity_milliliters' => 1, 'posted_cost_minor' => 9999, 'idempotency_key' => 'other', 'stock_movement_id' => $this->stockMovement()->id] as $column => $value) {
            $this->assertInstanceOf(QueryException::class, $this->caught(fn () => $table()->update([$column => $value])), $column);
        }
        // «معكوس» بلا أعمدة العكس ⇒ مرفوض.
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => $table()->update(['status' => 'reversed'])));

        $reverseStock = $this->stockMovement();
        $reversal = [
            'status' => 'reversed', 'reversal_stock_movement_id' => $reverseStock->id, 'reversal_cost_movement_id' => $this->costMovement($reverseStock)->id,
            'reversed_by' => $row['posted_by'], 'reversed_at' => now(), 'reversal_reason' => 'إلغاء السند',
        ];
        $table()->update($reversal);
        $this->assertSame('reversed', $table()->value('status'));

        // لا عكس ثانٍ ولا إعادة فتح ولا تبديل لحركة العكس.
        $second = $this->stockMovement();
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => $table()->update(['reversal_stock_movement_id' => $second->id])));
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => $table()->update(['status' => 'posted', 'reversal_stock_movement_id' => null, 'reversal_cost_movement_id' => null, 'reversed_by' => null, 'reversed_at' => null, 'reversal_reason' => null])));
        // حركة العكس الواحدة لا تُنسب لترحيلين.
        $other = $this->fill(300_000);
        $otherRow = $this->postingRow($other, key: 'o');
        DB::table('fuel_tanker_fill_inventory_postings')->insert($otherRow);
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $otherRow['id'])->update(['status' => 'reversed'] + array_merge($reversal, ['reversal_reason' => 'x']))));
    }

    /** @test */
    public function postings_cannot_be_deleted_and_the_model_refuses_every_write_in_this_phase(): void
    {
        $fill = $this->fill(1_000_000);
        $row = $this->postingRow($fill);
        DB::table('fuel_tanker_fill_inventory_postings')->insert($row);
        $this->assertInstanceOf(QueryException::class, $this->caught(fn () => DB::table('fuel_tanker_fill_inventory_postings')->where('id', $row['id'])->delete()));

        $posting = FuelTankerFillInventoryPosting::query()->findOrFail($row['id']);
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $posting->forceFill(['posted_cost_minor' => 1])->save()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => $posting->delete()));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => FuelTankerFillInventoryPosting::query()->create([])));
        $this->assertInstanceOf(LogicException::class, $this->caught(fn () => (new FuelTankerFillInventoryPosting())->forceFill($row)->save()));
    }

    // ───────────────────────── حراسة ساكنة ─────────────────────────

    /** @test */
    public function no_application_code_writes_the_posting_table_or_touches_inventory_pool_ledger_or_invoicing_from_the_review_path(): void
    {
        $forbidden = ['InventoryService', 'LedgerService', 'FuelCostBasisService', 'InvoiceService', 'PaymentService', 'applyIssue', 'recordIssue', 'recordSaleCogs', 'StockMovement::create', 'journal_lines'];
        foreach (['app/Services/FuelTankerFillInventoryReadiness.php', 'app/Http/Controllers/Api/FuelTankerFillInventoryReviewController.php'] as $file) {
            $source = file_get_contents(base_path($file));
            $code = preg_replace('~/\*.*?\*/|//[^\n]*~s', '', (string) $source);
            foreach ($forbidden as $needle) {
                $this->assertStringNotContainsString($needle, (string) $code, "{$file} لا يجوز أن يستعمل {$needle}");
            }
            $this->assertDoesNotMatchRegularExpression('/->(create|insert|update|delete|save|forceFill|increment|decrement|lockForUpdate)\(/', (string) $code, "{$file} قراءة فقط");
        }

        // لا مرجع للنموذج الكاتب إلا نفسه (والاختبارات).
        $hits = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(app_path())) as $path) {
            if ($path->isFile() && str_ends_with((string) $path, '.php') && str_contains((string) file_get_contents((string) $path), 'FuelTankerFillInventoryPosting')) {
                $hits[] = basename((string) $path);
            }
        }
        $this->assertSame(['FuelTankerFillInventoryPosting.php'], $hits, 'لا كاتب للربط المخزني قبل PR-6B');
    }

    /** @test */
    public function direct_fuel_sales_do_not_know_about_tanker_inventory_posting_or_readiness(): void
    {
        $sales = (string) file_get_contents(base_path('app/Services/FuelSaleService.php'));
        foreach (['TankerFill', 'tanker_inventory', 'FuelTankerFillInventory'] as $needle) {
            $this->assertStringNotContainsString($needle, $sales);
        }
    }
}

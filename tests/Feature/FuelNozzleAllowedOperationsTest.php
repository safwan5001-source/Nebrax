<?php

namespace Tests\Feature;

use App\Models\FuelNozzle;
use App\Models\FuelPump;
use App\Models\FuelShift;
use App\Models\FuelStationAuditEvent;
use App\Services\FuelStationMasterDataService;
use App\Tenancy\TenantContext;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * TANKER-PR3 (قرارات المالك 6 و7) — `fuel_nozzles.allowed_operations`: `NULL` = كل العمليات (السلوك الحالي)، التطبيع (المجموعة الكاملة ⇒ NULL، فريدة، ترتيب كنسي)،
 * رفض القائمة الفارغة والأنواع المجهولة، **تضييق** عملية على فوهة محطتها وردية مفتوحة يتطلب `fuel.governance.manage` مع `fuel_stations.manage`، التدقيق،
 * عزل المستأجر، وغياب أي أثر مالي/مخزني. التخزين والتحقق فقط: لا يطبَّق القيد على أي مسار بيع (يحرسه اختبار صريح).
 */
class FuelNozzleAllowedOperationsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelStaffFixture;

    private const BASE = '/api/fuel-stations';

    private FuelNozzle $nozzle;

    protected function setUp(): void
    {
        parent::setUp();
        $this->buildFixture();
        app(TenantContext::class)->set($this->tenantId);
        $pump = FuelPump::create(['branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'pump_number' => 'P1', 'name' => 'مضخة 1']);
        $this->nozzle = FuelNozzle::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->fx['t1']->id,
            'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '1',
        ]);
    }

    /** @return array{user: \App\Models\User, token: string} */
    private function manager(bool $governance): array
    {
        return $this->makeUser($governance ? 'gov' : 'mgr', $governance ? 'role-gov' : 'role-mgr', array_merge(['fuel_stations.view', 'fuel_stations.manage'], $governance ? ['fuel.governance.manage'] : []));
    }

    private function openShift(): FuelShift
    {
        return FuelShift::create([
            'branch_id' => $this->fx['branchA']->id, 'fuel_station_id' => $this->fx['s1']->id, 'number' => 'FSH-PR3-1', 'status' => FuelShift::STATUS_OPEN,
            'opening_float_minor' => 0, 'idempotency_key' => 'pr3-shift-1', 'opened_by' => $this->makeUser('seller', 'role-seller', ['fuel_stations.view'])['user']->id, 'opened_at' => now(),
        ]);
    }

    private function setOps(string $token, ?array $ops, array $extra = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->putJson(self::BASE . '/nozzles/' . $this->nozzle->id, ['allowed_operations' => $ops] + $extra);
    }

    /** @return array{0:int,1:int,2:int} */
    private function financialCounts(): array
    {
        return [(int) DB::table('stock_movements')->count(), (int) DB::table('journal_entries')->count(), (int) DB::table('fuel_operational_ledgers')->count()];
    }

    /** @test */
    public function existing_and_new_nozzles_default_to_all_operations(): void
    {
        $show = $this->withToken($this->fx['owner'])->getJson(self::BASE . '/nozzles/' . $this->nozzle->id)->assertOk()->json('data');
        $this->assertNull($show['allowed_operations']);
        $this->assertSame(['direct_sale', 'tanker_fill', 'internal_issue'], $show['effective_operations']);
        $this->assertTrue($this->nozzle->fresh()->allowsOperation('direct_sale'));
        $this->assertTrue($this->nozzle->fresh()->allowsOperation('tanker_fill'));
        $this->assertTrue($this->nozzle->fresh()->allowsOperation('internal_issue'));
    }

    /** @test */
    public function the_set_is_normalised_unique_canonical_and_the_full_set_is_stored_as_null(): void
    {
        $r = $this->setOps($this->fx['owner'], ['internal_issue', 'tanker_fill', 'tanker_fill'])->assertOk()->json('data');
        $this->assertSame(['tanker_fill', 'internal_issue'], $r['allowed_operations']);
        $this->assertSame(['tanker_fill', 'internal_issue'], $r['effective_operations']);
        $this->assertFalse($this->nozzle->fresh()->allowsOperation('direct_sale'));

        $full = $this->setOps($this->fx['owner'], ['internal_issue', 'direct_sale', 'tanker_fill'])->assertOk()->json('data');
        $this->assertNull($full['allowed_operations'], 'the full set is stored as NULL so future operation types are not silently excluded');
        $this->assertNull($this->nozzle->fresh()->allowed_operations);

        // null صريح يعيد «كل العمليات».
        $this->setOps($this->fx['owner'], ['tanker_fill'])->assertOk();
        $this->assertNull($this->setOps($this->fx['owner'], null)->assertOk()->json('data.allowed_operations'));
    }

    /** @test */
    public function empty_unknown_and_malformed_sets_are_rejected_and_nothing_changes(): void
    {
        $this->setOps($this->fx['owner'], ['tanker_fill'])->assertOk();
        foreach ([[], ['sell_everything'], ['tanker_fill', 5], [['x']], ['a' => 'tanker_fill']] as $bad) {
            $this->assertContains($this->setOps($this->fx['owner'], $bad)->status(), [422], json_encode($bad));
        }
        $this->assertSame(['tanker_fill'], $this->nozzle->fresh()->allowed_operations);
    }

    /** @test */
    public function creating_a_nozzle_accepts_and_validates_the_restriction(): void
    {
        $pump = FuelPump::first();
        $payload = ['fuel_pump_id' => $pump->id, 'fuel_tank_id' => $this->fx['t1']->id, 'fuel_product_id' => $this->fx['fuel']->id, 'nozzle_number' => '2'];
        $ok = $this->withToken($this->fx['owner'])->postJson(self::BASE . '/nozzles', $payload + ['allowed_operations' => ['direct_sale', 'internal_issue']])->assertCreated()->json('data');
        $this->assertSame(['direct_sale', 'internal_issue'], $ok['allowed_operations']);
        $this->withToken($this->fx['owner'])->postJson(self::BASE . '/nozzles', ['nozzle_number' => '3'] + $payload + ['allowed_operations' => []])->assertStatus(422);
        $plain = $this->withToken($this->fx['owner'])->postJson(self::BASE . '/nozzles', ['nozzle_number' => '4'] + $payload)->assertCreated()->json('data');
        $this->assertNull($plain['allowed_operations']);
    }

    /** @test */
    public function narrowing_without_an_open_shift_needs_only_station_management_and_is_audited(): void
    {
        $manager = $this->manager(false);
        $this->setOps($manager['token'], ['tanker_fill', 'internal_issue'])->assertOk();

        $event = FuelStationAuditEvent::where('action', 'nozzle.operations_narrowed')->where('subject_id', $this->nozzle->id)->first();
        $this->assertNotNull($event, 'explicit audit event for the narrowing');
        $this->assertSame($manager['user']->id, $event->actor_id);
        $this->assertSame(['effective_operations' => ['direct_sale', 'tanker_fill', 'internal_issue']], $event->before);
        $this->assertSame(['effective_operations' => ['tanker_fill', 'internal_issue']], $event->after);
        $this->assertTrue(FuelStationAuditEvent::where('action', 'nozzle.updated')->where('subject_id', $this->nozzle->id)->exists(), 'general update event still recorded');
    }

    /** @test */
    public function narrowing_under_an_open_shift_requires_governance_in_addition_to_manage(): void
    {
        $this->openShift();
        $manager = $this->manager(false);
        $governance = $this->manager(true);
        $before = $this->financialCounts();

        $this->setOps($manager['token'], ['tanker_fill'])->assertForbidden();
        $this->assertNull($this->nozzle->fresh()->allowed_operations, 'refused ⇒ unchanged');
        $this->assertFalse(FuelStationAuditEvent::where('action', 'nozzle.operations_narrowed')->exists());

        $this->setOps($governance['token'], ['tanker_fill'])->assertOk();
        $this->assertSame(['tanker_fill'], $this->nozzle->fresh()->allowed_operations);
        $this->assertSame($governance['user']->id, FuelStationAuditEvent::where('action', 'nozzle.operations_narrowed')->firstOrFail()->actor_id);

        // التوسيع (وتصفير القيد) أثناء الوردية يكفيه إدارة المحطة.
        $this->setOps($manager['token'], ['tanker_fill', 'direct_sale'])->assertOk();
        $this->setOps($manager['token'], null)->assertOk();
        $this->assertNull($this->nozzle->fresh()->allowed_operations);

        // تعديل لا يغيّر العمليات (حالة الفوهة) لا يتطلب حوكمة حتى لو كان القيد مضيَّقاً.
        $this->setOps($governance['token'], ['tanker_fill'])->assertOk();
        $this->withToken($manager['token'])->putJson(self::BASE . '/nozzles/' . $this->nozzle->id, ['meter_opening_milliliters' => 5])->assertOk();
        $this->assertSame($before, $this->financialCounts(), 'configuration only: no stock, ledger or entry');
    }

    /** @test */
    public function a_missing_actor_cannot_narrow_under_an_open_shift_fail_closed(): void
    {
        $this->openShift();
        $this->expectException(AuthorizationException::class);
        app(FuelStationMasterDataService::class)->updateNozzle($this->nozzle, ['allowed_operations' => ['tanker_fill']], null);
    }

    /** @test */
    public function a_closed_shift_does_not_count_as_open_operations(): void
    {
        $shift = $this->openShift();
        $shift->forceFill(['status' => FuelShift::STATUS_CLOSED])->saveQuietly();
        $this->setOps($this->manager(false)['token'], ['tanker_fill'])->assertOk();
        $this->assertSame(['tanker_fill'], $this->nozzle->fresh()->allowed_operations);
    }

    /** @test */
    public function another_tenant_cannot_read_or_change_the_nozzle_even_by_direct_id(): void
    {
        $other = $this->registerTenant('fuel-pr3-n', 'owner@fuel-pr3-n.test', autoEnableApplications: true);
        // قدرة الوقود مفعّلة للمستأجر الآخر كي يصل الطلب إلى طبقة العزل (لا يُرفض مبكراً بالقدرة).
        app(\App\Services\EntitlementGrantService::class)->grant(
            \App\Models\Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', \App\Support\EntitlementAccessMode::FULL, \App\Support\EntitlementSourceType::MANUAL,
            \Carbon\CarbonImmutable::now('UTC'), grantReasonCode: 'test_pr3_isolation', reason: 'اختبار عزل المستأجر لقيود الفوهات.',
        );
        $this->withToken($other['token'])->putJson(self::BASE . '/nozzles/' . $this->nozzle->id, ['allowed_operations' => ['tanker_fill']])->assertNotFound();
        $this->withToken($other['token'])->getJson(self::BASE . '/nozzles/' . $this->nozzle->id)->assertNotFound();
        app(TenantContext::class)->set($this->tenantId);
        $this->assertNull($this->nozzle->fresh()->allowed_operations);
    }

    /** @test */
    public function the_migration_rollback_refuses_while_any_nozzle_has_a_configured_restriction(): void
    {
        $this->setOps($this->fx['owner'], ['tanker_fill'])->assertOk();
        $migration = require base_path('database/migrations/2027_01_24_010000_add_allowed_operations_to_fuel_nozzles.php');
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rollback refused');
        $migration->down();
    }

    /** @test */
    public function the_restriction_is_stored_only_existing_direct_sales_are_not_gated_by_it_in_this_slice(): void
    {
        $source = file_get_contents(base_path('app/Services/FuelSaleService.php'));
        $this->assertStringNotContainsString('allowed_operations', $source);
        $this->assertStringNotContainsString('allowsOperation', $source);
    }
}

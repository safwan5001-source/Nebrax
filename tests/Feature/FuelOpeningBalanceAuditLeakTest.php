<?php

namespace Tests\Feature;

use App\Models\FuelOpeningBalance;
use App\Models\FuelStation;
use App\Models\FuelStationAuditEvent;
use App\Models\Role;
use App\Models\User;
use App\Services\FuelStationAuditTrail;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Issue #2114: أحداث الرصيد الافتتاحي في سجل المحطة لا تتجاوز بوابة الميزة
 * أو سلطة رؤية التكلفة المعتمدة للمستند نفسه.
 * تُنشأ الأحداث من مساري إنشاء المستند وترحيله الفعليين، لا من بيانات افتراضية فقط.
 */
class FuelOpeningBalanceAuditLeakTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use BuildsFuelOpeningWorld;

    private const AUDIT = '/api/fuel-stations/audit-events';
    private const OPENING = '/api/fuel-stations/opening-balances';

    /** @var array<string,mixed> */
    private array $world;
    private string $documentId;
    private int $userNumber = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->world = $this->openingWorld();
        $token = $this->world['owner_token'];
        $this->documentId = $this->withToken($token)
            ->postJson(self::OPENING, $this->openingPayload($this->world))
            ->assertCreated()->json('data.id');
        $this->withToken($token)->postJson(self::OPENING . "/{$this->documentId}/post")->assertOk();
    }

    /** @param list<string> $permissions @return array{user: User, token: string} */
    private function staff(array $permissions): array
    {
        $slug = 'fob-audit-' . (++$this->userNumber);
        app(TenantContext::class)->set($this->world['tenant_id']);
        Role::create([
            'tenant_id' => $this->world['tenant_id'],
            'slug' => $slug,
            'name' => $slug,
            'permissions' => $permissions,
            'is_system' => false,
        ]);
        $user = User::create([
            'tenant_id' => $this->world['tenant_id'],
            'name' => $slug,
            'email' => "{$slug}-{$this->world['slug']}@fob.test",
            'password' => 'password123',
            'role' => $slug,
        ]);

        return ['user' => $user, 'token' => $user->createToken('api')->plainTextToken];
    }

    private function audit(string $token, string $query = ''): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->getJson(self::AUDIT . '?per_page=100' . $query)->assertOk();
    }

    #[Test]
    public function actual_posted_snapshot_keeps_value_in_database_but_not_in_a_non_cost_readers_response(): void
    {
        $original = FuelStationAuditEvent::query()
            ->where('subject_type', FuelOpeningBalance::class)
            ->where('subject_id', $this->documentId)
            ->where('action', 'opening_balance.posted')
            ->sole();
        $this->assertSame(self::TOTAL_VALUE, (int) $original->after['total_value_minor']);

        $reader = $this->staff(['fuel_stations.view', 'fuel_stations.manage']);
        $show = $this->withToken($reader['token'])->getJson(self::OPENING . "/{$this->documentId}")->assertOk();
        $this->assertArrayNotHasKey('total_value_minor', $show->json('data'));

        $events = $this->audit($reader['token'], '&subject_type=FuelOpeningBalance&subject_id=' . $this->documentId);
        $this->assertCount(2, $events->json('data'));
        foreach ($events->json('data') as $event) {
            foreach (['before', 'after'] as $side) {
                if (is_array($event[$side])) {
                    $this->assertArrayNotHasKey('total_value_minor', $event[$side]);
                }
            }
        }
        $this->assertStringNotContainsString((string) self::TOTAL_VALUE, $events->getContent());

        // القراءة لا تعدّل السجل المحفوظ (append-only).
        $this->assertSame(self::TOTAL_VALUE, (int) $original->fresh()->after['total_value_minor']);
    }

    #[Test]
    public function an_authorized_cost_reader_sees_the_original_amount_and_other_nonfinancial_fields_remain_visible(): void
    {
        $reader = $this->staff(['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $events = $this->audit($reader['token'], '&subject_type=FuelOpeningBalance&action=opening_balance.posted');
        $this->assertCount(1, $events->json('data'));
        $posted = $events->json('data.0');
        $this->assertSame(self::TOTAL_VALUE, (int) $posted['after']['total_value_minor']);
        $this->assertSame('opening_balance.posted', $posted['action']);
        $this->assertSame($this->documentId, $posted['subject_id']);

        $withoutCost = $this->staff(['fuel_stations.view', 'fuel_stations.manage']);
        $limited = $this->audit($withoutCost['token'], '&subject_type=FuelOpeningBalance&action=opening_balance.posted');
        $this->assertSame($posted['subject_id'], $limited->json('data.0.subject_id'));
        $this->assertArrayNotHasKey('total_value_minor', $limited->json('data.0.after'));
    }

    #[Test]
    public function closing_the_opening_gate_hides_all_opening_events_even_from_the_owner_without_hiding_other_events(): void
    {
        app(FuelStationAuditTrail::class)->record(
            'station.updated',
            $this->world['station'],
            ['name' => 'قبل'],
            ['name' => 'بعد'],
            $this->world['actor'],
        );
        $beforeCount = FuelStationAuditEvent::query()->where('subject_type', FuelOpeningBalance::class)->count();
        $this->assertSame(2, $beforeCount);

        config(['fuel_stations.opening_balance_enabled' => false]);
        $reader = $this->staff(['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        foreach ([$reader['token'], $this->world['owner_token']] as $token) {
            foreach ([
                '&subject_type=FuelOpeningBalance',
                '&subject_id=' . $this->documentId,
                '&action=opening_balance.posted',
            ] as $filter) {
                $this->assertSame([], $this->audit($token, $filter)->json('data'));
            }

            $all = $this->audit($token);
            $this->assertNotContains('FuelOpeningBalance', array_column($all->json('data'), 'subject_type'));
            $this->assertContains('station.updated', array_column($all->json('data'), 'action'));
            $this->withToken($token)->getJson(self::OPENING . "/{$this->documentId}")->assertNotFound();
        }

        $this->assertSame($beforeCount, FuelStationAuditEvent::query()->where('subject_type', FuelOpeningBalance::class)->count());
        config(['fuel_stations.opening_balance_enabled' => true]);
        $this->assertCount(2, $this->audit($this->world['owner_token'], '&subject_type=FuelOpeningBalance')->json('data'));
    }

    #[Test]
    public function nested_cost_fields_in_future_opening_snapshots_are_hidden_without_modifying_the_stored_snapshot(): void
    {
        $event = FuelStationAuditEvent::create([
            'tenant_id' => $this->world['tenant_id'],
            'branch_id' => $this->world['branch']->id,
            'warehouse_id' => $this->world['warehouse']->id,
            'fuel_station_id' => $this->world['station']->id,
            'subject_type' => FuelOpeningBalance::class,
            'subject_id' => $this->documentId,
            'action' => 'opening_balance.revalued',
            'before' => ['total_value_minor' => 1000, 'lines' => [['value_minor' => 600, 'unit_cost_per_liter_minor' => 218]]],
            'after' => ['total_value_minor' => 1400, 'lines' => [['value_minor' => 900, 'unit_cost_per_liter_minor' => 233]], 'total_milliliters' => 100000],
            'occurred_at' => now(),
        ]);

        $reader = $this->staff(['fuel_stations.view', 'fuel_stations.manage']);
        $result = $this->audit($reader['token'], '&action=opening_balance.revalued');
        $this->assertCount(1, $result->json('data'));
        foreach (['before', 'after'] as $side) {
            $snapshot = $result->json("data.0.{$side}");
            $this->assertArrayNotHasKey('total_value_minor', $snapshot);
            $this->assertArrayNotHasKey('value_minor', $snapshot['lines'][0]);
            $this->assertArrayNotHasKey('unit_cost_per_liter_minor', $snapshot['lines'][0]);
        }
        $this->assertSame(100000, $result->json('data.0.after.total_milliliters'));
        $this->assertSame(1400, (int) $event->fresh()->after['total_value_minor']);

        $costReader = $this->staff(['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $this->assertSame(1400, $this->audit($costReader['token'], '&action=opening_balance.revalued')->json('data.0.after.total_value_minor'));
    }

    #[Test]
    public function station_scopes_and_manage_permission_still_apply_to_opening_events(): void
    {
        $other = FuelStation::create([
            'branch_id' => $this->world['branch']->id,
            'warehouse_id' => $this->world['warehouse']->id,
            'code' => 'FOB-AUD-OTHER',
            'name' => 'محطة أخرى',
        ]);

        $scoped = $this->staff(['fuel_stations.view', 'fuel_stations.manage', 'products.view_cost']);
        $scoped['user']->forceFill(['fuel_station_scope' => User::FUEL_SCOPE_ASSIGNED])->save();
        $scoped['user']->fuelStations()->sync([$other->id]);
        $this->assertSame([], $this->audit($scoped['token'], '&subject_type=FuelOpeningBalance')->json('data'));

        $noManage = $this->staff(['fuel_stations.view', 'products.view_cost']);
        $this->withToken($noManage['token'])->getJson(self::AUDIT)->assertForbidden();
        $this->assertCount(2, $this->audit($this->world['owner_token'], '&subject_type=FuelOpeningBalance')->json('data'));
    }

    #[Test]
    public function a_different_tenant_cannot_read_the_opening_history(): void
    {
        $another = $this->openingWorld();
        $this->assertSame([], $this->audit($another['owner_token'], '&subject_type=FuelOpeningBalance')->json('data'));
        $this->assertSame([], $this->audit($another['owner_token'], '&subject_id=' . $this->documentId)->json('data'));
    }
}

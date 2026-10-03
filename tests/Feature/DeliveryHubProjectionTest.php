<?php

namespace Tests\Feature;

use App\Models\DeliveryHubOrder;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PosSession;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Support\Rbac;
use App\Tenancy\TenantContext;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DLV-HUB-PROJECTION-1 — إسقاط تشغيلي فقط.
 * تشغيل: php artisan test --filter=DeliveryHubProjectionTest
 */
class DeliveryHubProjectionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function intake_routes_only_when_a_destination_is_named_and_never_posts(): void
    {
        $auth = $this->registerTenant('hub', 'owner@hub.test');
        $branch = $this->branchId($auth['token']);
        $profile = $this->platform($auth['token']);
        $before = $this->financialCounts();

        $unrouted = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-1',
            'external_order_reference' => 'عرض فقط',
            'provider_status' => 'provider-said-ready',
            'intake_payload' => ['amount' => 5000],
        ])->assertCreated();

        $this->assertSame(DeliveryHubOrder::UNROUTED, $unrouted['data']['state']);
        $this->assertNull($unrouted['data']['branch_id']);
        $this->assertFalse($unrouted['idempotent_replay']);
        $this->assertSame($before, $this->financialCounts());

        $received = $this->withToken($auth['token'])->postJson("/api/delivery-hub/orders/{$unrouted['data']['id']}/transition", [
            'action' => 'route',
            'branch_id' => $branch,
        ])->assertOk();
        $this->assertSame(DeliveryHubOrder::RECEIVED, $received['data']['state']);
        $this->assertSame($branch, $received['data']['branch_id']);
        $this->assertSame($before, $this->financialCounts());
    }

    /** @test */
    public function the_state_machine_is_linear_and_reject_is_not_its_own_state(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('linear');
        $id = $this->orderId($auth['token'], $profile, $branch, 'P-linear');

        foreach (['accept' => DeliveryHubOrder::ACCEPTED, 'preparing' => DeliveryHubOrder::PREPARING, 'ready' => DeliveryHubOrder::READY, 'handoff' => DeliveryHubOrder::HANDED_OFF] as $action => $state) {
            $this->transition($auth['token'], $id, $action)->assertOk()->assertJsonPath('data.state', $state);
        }
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, PosSession::count());

        $this->transition($auth['token'], $id, 'preparing')->assertStatus(422);
        $this->assertSame(DeliveryHubOrder::HANDED_OFF, DeliveryHubOrder::findOrFail($id)->state);

        $this->transition($auth['token'], $id, 'reject')->assertOk()->assertJsonPath('data.state', DeliveryHubOrder::CANCELLED);
        $this->assertSame(DeliveryHubOrder::CANCELLED, DeliveryHubOrder::findOrFail($id)->state);
        $again = $this->transition($auth['token'], $id, 'cancel')->assertOk();
        $this->assertTrue($again['idempotent_replay']);
        $this->assertSame(1, DeliveryHubOrder::count());
    }

    /** @test */
    public function a_skip_or_backward_move_leaves_the_row_unchanged(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('skip');
        $id = $this->orderId($auth['token'], $profile, $branch, 'P-skip');

        $this->transition($auth['token'], $id, 'ready')->assertStatus(422);
        $this->assertSame(DeliveryHubOrder::RECEIVED, DeliveryHubOrder::findOrFail($id)->state);
        $this->assertSame($branch, DeliveryHubOrder::findOrFail($id)->branch_id);
    }

    /** @test */
    public function repeating_the_current_state_replays_but_a_different_branch_reroutes(): void
    {
        $auth = $this->registerTenant('reroute', 'owner@reroute.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $id = $this->orderId($auth['token'], $profile, $first, 'P-route');

        $replay = $this->transition($auth['token'], $id, 'route', $first)->assertOk();
        $this->assertTrue($replay['idempotent_replay']);
        $this->assertSame($first, $replay['data']['branch_id']);

        $moved = $this->transition($auth['token'], $id, 'route', $second)->assertOk();
        $this->assertFalse($moved['idempotent_replay']);
        $this->assertSame(DeliveryHubOrder::RECEIVED, $moved['data']['state']);
        $this->assertSame($second, $moved['data']['branch_id']);
        $this->assertSame(1, DeliveryHubOrder::count());
    }

    /** @test */
    public function the_branch_is_immutable_once_accepted(): void
    {
        $auth = $this->registerTenant('frozen', 'owner@frozen.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $id = $this->orderId($auth['token'], $profile, $first, 'P-frozen');
        $this->transition($auth['token'], $id, 'accept')->assertOk();

        $this->transition($auth['token'], $id, 'route', $second)->assertStatus(422);
        $this->assertSame($first, DeliveryHubOrder::findOrFail($id)->branch_id);
        $this->assertSame(DeliveryHubOrder::ACCEPTED, DeliveryHubOrder::findOrFail($id)->state);

        $this->transition($auth['token'], $id, 'cancel')->assertOk()->assertJsonPath('data.state', DeliveryHubOrder::CANCELLED);
        $this->assertSame($first, DeliveryHubOrder::findOrFail($id)->branch_id);
        $this->assertSame(1, DeliveryHubOrder::count());
    }

    /** @test */
    public function provider_identity_stays_permanent_after_cancellation(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('identity');
        $body = [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-perm',
            'branch_id' => $branch,
            'external_order_reference' => 'REF-1',
        ];
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', $body)->assertCreated();
        $this->transition($auth['token'], $created['data']['id'], 'cancel')->assertOk();

        $replay = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', $body)->assertOk();
        $this->assertTrue($replay['idempotent_replay']);
        $this->assertSame($created['data']['id'], $replay['data']['id']);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            ...$body,
            'external_order_reference' => 'REF-2',
            'idempotency_key' => (string) Str::uuid(),
        ])->assertStatus(409);
        $this->assertSame(1, DeliveryHubOrder::count());
        $this->assertSame('REF-1', DeliveryHubOrder::findOrFail($created['data']['id'])->external_order_reference);
    }

    /** @test */
    public function a_client_uuid_replays_or_conflicts_and_is_not_derived_from_the_reference(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('uuid');
        $key = (string) Str::uuid();
        $body = [
            'delivery_platform_profile_id' => $profile,
            'idempotency_key' => $key,
            'branch_id' => $branch,
            'external_order_reference' => 'HUMAN-1',
        ];
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', $body)->assertCreated();
        $this->assertNull($created['data']['provider_order_id']);
        $this->assertSame($key, $created['data']['idempotency_key']);

        $replay = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            ...$body,
            'external_order_reference' => 'HUMAN-1   ',
        ])->assertOk();
        $this->assertTrue($replay['idempotent_replay']);
        $this->assertSame($created['data']['id'], $replay['data']['id']);

        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            ...$body,
            'external_order_reference' => 'HUMAN-2',
        ])->assertStatus(409);
        $this->assertSame(1, DeliveryHubOrder::count());

        $second = (string) Str::uuid();
        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'idempotency_key' => $second,
            'branch_id' => $branch,
        ])->assertCreated();
        $this->assertSame(2, DeliveryHubOrder::count());
    }

    /** @test */
    public function intake_without_a_provider_id_and_without_a_uuid_is_rejected(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('empty');
        $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'branch_id' => $branch,
            'external_order_reference' => 'ONLY-A-LABEL',
        ])->assertStatus(422);
        $this->assertSame(0, DeliveryHubOrder::count());
    }

    /** @test */
    public function the_database_rejects_a_second_row_for_the_same_provider_identity(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('constraint');
        $this->orderId($auth['token'], $profile, $branch, 'P-db');
        app(TenantContext::class)->set($auth['tenant_id']);
        $existing = DeliveryHubOrder::firstOrFail();

        try {
            DB::transaction(function () use ($auth, $branch, $profile, $existing) {
                DeliveryHubOrder::create([
                    'tenant_id' => $auth['tenant_id'],
                    'branch_id' => $branch,
                    'delivery_platform_profile_id' => $profile,
                    'state' => DeliveryHubOrder::RECEIVED,
                    'provider_order_id' => 'P-db',
                    'idempotency_key' => (string) Str::uuid(),
                    'request_checksum' => str_repeat('a', 64),
                    'intake_payload_hash' => str_repeat('b', 64),
                    'created_by' => $existing->created_by,
                    'updated_by' => $existing->updated_by,
                ]);
            });
            $this->fail('A second provider identity row was inserted.');
        } catch (UniqueConstraintViolationException) {
            $this->assertSame(1, DeliveryHubOrder::count());
        }
    }

    /** @test */
    public function another_tenant_cannot_read_or_learn_the_order(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('alpha');
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-secret',
            'idempotency_key' => (string) Str::uuid(),
            'branch_id' => $branch,
            'external_order_reference' => 'UNIQUE-B-REF',
        ])->assertCreated();
        $other = $this->registerTenant('beta', 'owner@beta.test');

        $byId = $this->withToken($other['token'])->getJson('/api/delivery-hub/orders/'.$created['data']['id'])->assertNotFound();
        $this->assertStringNotContainsString('UNIQUE-B-REF', $byId->getContent());
        $listed = $this->withToken($other['token'])->getJson('/api/delivery-hub/orders?unrouted=1')->assertOk();
        $this->assertStringNotContainsString('UNIQUE-B-REF', $listed->getContent());
        $this->assertStringNotContainsString('P-secret', $listed->getContent());

        $foreignProfile = $this->withToken($other['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-secret',
            'idempotency_key' => $created['data']['idempotency_key'],
        ])->assertNotFound();
        $this->assertStringNotContainsString('UNIQUE-B-REF', $foreignProfile->getContent());
        $this->assertSame(1, DeliveryHubOrder::withoutGlobalScopes()->count());
    }

    /** @test */
    public function branch_scope_hides_other_branches_and_the_unrouted_queue(): void
    {
        $auth = $this->registerTenant('scope', 'owner@scope.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $unrouted = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-unrouted',
            'external_order_reference' => 'UNROUTED-SECRET',
        ])->assertCreated();
        $onSecond = $this->orderId($auth['token'], $profile, $second, 'P-second');
        $token = $this->restricted($auth, [$first], 'one@scope.test');

        $this->withToken($token)->getJson('/api/delivery-hub/orders?unrouted=1')->assertOk()->assertJsonCount(0, 'data');
        $hidden = $this->withToken($token)->getJson('/api/delivery-hub/orders/'.$unrouted['data']['id'])->assertNotFound();
        $this->assertStringNotContainsString('UNROUTED-SECRET', $hidden->getContent());
        $other = $this->withToken($token)->getJson('/api/delivery-hub/orders/'.$onSecond)->assertNotFound();
        $this->assertStringNotContainsString('P-second', $other->getContent());
        $this->withToken($token)->getJson('/api/delivery-hub/orders?branch_id='.$second)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($token)->postJson('/api/delivery-hub/orders/'.$unrouted['data']['id'].'/transition', [
            'action' => 'route',
            'branch_id' => $first,
        ])->assertNotFound();
        $this->assertSame(DeliveryHubOrder::UNROUTED, DeliveryHubOrder::findOrFail($unrouted['data']['id'])->state);
    }

    /** @test */
    public function reroute_requires_access_to_both_branches(): void
    {
        $auth = $this->registerTenant('both', 'owner@both.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $id = $this->orderId($auth['token'], $profile, $first, 'P-both');
        $onlyFirst = $this->restricted($auth, [$first], 'first@both.test');
        $both = $this->restricted($auth, [$first, $second], 'both@both.test');

        $this->withToken($onlyFirst)->postJson("/api/delivery-hub/orders/{$id}/transition", [
            'action' => 'route',
            'branch_id' => $second,
        ])->assertNotFound();
        $this->assertSame($first, DeliveryHubOrder::findOrFail($id)->branch_id);

        $this->withToken($both)->postJson("/api/delivery-hub/orders/{$id}/transition", [
            'action' => 'route',
            'branch_id' => $second,
        ])->assertOk()->assertJsonPath('data.branch_id', $second);
    }

    /** @test */
    public function view_cannot_mutate_and_accountant_or_staff_are_not_operators(): void
    {
        [$auth, $branch, $profile] = $this->receivedOrder('perms');
        $id = $this->orderId($auth['token'], $profile, $branch, 'P-perms');
        $view = $this->roleToken($auth, ['delivery_hub.view'], 'view@perms.test');
        $operate = $this->roleToken($auth, ['delivery_hub.operate'], 'op@perms.test');

        $this->withToken($view)->getJson('/api/delivery-hub/orders/'.$id)->assertOk();
        $this->withToken($view)->postJson('/api/delivery-hub/orders/'.$id.'/transition', ['action' => 'accept'])->assertForbidden();
        $this->assertSame(DeliveryHubOrder::RECEIVED, DeliveryHubOrder::findOrFail($id)->state);

        $this->withToken($operate)->postJson('/api/delivery-hub/orders/'.$id.'/transition', ['action' => 'accept'])->assertOk();
        $this->withToken($operate)->getJson('/api/delivery-hub/orders/'.$id)->assertForbidden();

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@perms.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acct@perms.test');
        $this->withToken($staff)->getJson('/api/delivery-hub/orders')->assertForbidden();
        $this->withToken($accountant)->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-acct',
            'branch_id' => $branch,
        ])->assertForbidden();
        $this->assertNotContains('delivery_hub.view', Rbac::MATRIX['accountant']);
        $this->assertNotContains('delivery_hub.operate', Rbac::MATRIX['staff']);
        $this->assertContains('delivery_hub.view', Rbac::PERMISSIONS);
        $this->assertContains('delivery_hub.operate', Rbac::PERMISSIONS);
    }

    /** @test */
    public function a_restricted_operator_must_name_a_branch_they_can_access(): void
    {
        $auth = $this->registerTenant('named', 'owner@named.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $token = $this->restricted($auth, [$first], 'op@named.test');

        $this->withToken($token)->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-named',
        ])->assertStatus(422);
        $this->assertSame(0, DeliveryHubOrder::count());

        $this->withToken($token)->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-named',
            'branch_id' => $second,
        ])->assertNotFound();
        $this->assertSame(0, DeliveryHubOrder::count());

        $this->withToken($token)->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-named',
            'branch_id' => $first,
        ])->assertCreated()->assertJsonPath('data.state', DeliveryHubOrder::RECEIVED);
    }

    /** @test */
    public function hub_context_and_filters_stay_inside_the_actor_scope(): void
    {
        $auth = $this->registerTenant('ctx', 'owner@ctx.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $profile = $this->platform($auth['token']);
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-ctx',
            'branch_id' => $second,
        ])->assertCreated();
        $this->assertSame('jahez', $created['data']['platform_key']);
        $this->assertSame('جاهز', $created['data']['platform_name']);
        $this->assertArrayNotHasKey('amount', $created['data']);

        $context = $this->withToken($auth['token'])->getJson('/api/delivery-hub/context')->assertOk();
        $this->assertTrue($context['data']['can_see_unrouted']);
        $this->assertTrue(collect($context['data']['platforms'])->contains('id', $profile));

        $this->withToken($auth['token'])->getJson('/api/delivery-hub/orders?state=received&delivery_platform_profile_id='.$profile)
            ->assertOk()
            ->assertJsonPath('data.0.id', $created['data']['id']);
        $this->withToken($auth['token'])->getJson('/api/delivery-hub/orders?state=accepted')
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $other = $this->registerTenant('ctxb', 'owner@ctxb.test');
        $this->withToken($auth['token'])->getJson('/api/delivery-hub/orders?delivery_platform_profile_id='.$this->platform($other['token']))
            ->assertOk()
            ->assertJsonCount(0, 'data');

        $token = $this->restricted($auth, [$first], 'one@ctx.test');
        $limited = $this->withToken($token)->getJson('/api/delivery-hub/context')->assertOk();
        $this->assertFalse($limited['data']['can_see_unrouted']);
        $this->assertSame([$first], collect($limited['data']['branches'])->pluck('id')->all());
        $this->assertStringNotContainsString('P-ctx', $limited->getContent());
    }

    /** @test */
    public function an_inactive_branch_is_not_a_routing_target(): void
    {
        $auth = $this->registerTenant('inact', 'owner@inact.test');
        [$first, $second] = $this->twoBranches($auth['token']);
        $this->withToken($auth['token'])->putJson("/api/branches/{$second}", [
            'name' => 'فرع ثان',
            'is_active' => false,
        ])->assertOk();
        $profile = $this->platform($auth['token']);
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => 'P-inact',
            'branch_id' => $first,
        ])->assertCreated();

        $context = $this->withToken($auth['token'])->getJson('/api/delivery-hub/context')->assertOk();
        $rows = collect($context['data']['branches'])->keyBy('id');
        $this->assertTrue($rows[$first]['is_active']);
        $this->assertFalse($rows[$second]['is_active']);

        $this->transition($auth['token'], $created['data']['id'], 'route', $second)->assertStatus(422);
        $this->withToken($auth['token'])->getJson('/api/delivery-hub/orders/'.$created['data']['id'])
            ->assertOk()
            ->assertJsonPath('data.branch_id', $first)
            ->assertJsonPath('data.state', DeliveryHubOrder::RECEIVED);
    }

    /** @return array{0: array{token: string, tenant_id: string}, 1: string, 2: string} */
    private function receivedOrder(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");

        return [$auth, $this->branchId($auth['token']), $this->platform($auth['token'])];
    }

    private function branchId(string $token): string
    {
        return $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
    }

    /** @return array{0: string, 1: string} */
    private function twoBranches(string $token): array
    {
        $first = $this->branchId($token);
        $second = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع ثان'])->assertCreated()['data']['id'];

        return [$first, $second];
    }

    private function platform(string $token): string
    {
        return $this->withToken($token)->postJson('/api/delivery-platforms', [
            'platform_key' => 'jahez',
            'collection_mode' => Version::COLLECTION_PLATFORM,
        ])->assertCreated()['data']['id'];
    }

    private function orderId(string $token, string $profile, string $branch, string $providerId): string
    {
        return $this->withToken($token)->postJson('/api/delivery-hub/orders', [
            'delivery_platform_profile_id' => $profile,
            'provider_order_id' => $providerId,
            'branch_id' => $branch,
        ])->assertCreated()['data']['id'];
    }

    private function transition(string $token, string $id, string $action, ?string $branchId = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson("/api/delivery-hub/orders/{$id}/transition", array_filter([
            'action' => $action,
            'branch_id' => $branchId,
        ], fn ($value) => $value !== null));
    }

    /** @param  array<int, string>  $branchIds */
    private function restricted(array $auth, array $branchIds, string $email): string
    {
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $limits = $tenant->plan_limits ?? [];
        $limits['users'] = null;
        $tenant->plan_limits = $limits;
        $tenant->save();

        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مشغّل فرع',
            'email' => $email,
            'password' => 'password123',
            'role' => 'admin',
            'branch_ids' => $branchIds,
        ])->assertCreated();

        return $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];
    }

    /** @param  array<int, string>  $permissions */
    private function roleToken(array $auth, array $permissions, string $email): string
    {
        $role = $this->withToken($auth['token'])->postJson('/api/roles', [
            'name' => 'دور '.$email,
            'permissions' => $permissions,
        ])->assertCreated()['data'];

        return $this->tokenForRole($auth['tenant_id'], $role['slug'], $email);
    }

    /** @return array<string, int> */
    private function financialCounts(): array
    {
        return [
            'invoices' => Invoice::count(),
            'payments' => Payment::count(),
            'journals' => JournalEntry::count(),
            'stock' => StockMovement::count(),
            'sessions' => PosSession::count(),
        ];
    }
}

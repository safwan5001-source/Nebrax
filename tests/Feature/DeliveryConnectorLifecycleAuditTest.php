<?php

namespace Tests\Feature;

use App\Models\DeliveryConnectorAccount;
use App\Models\DeliveryConnectorLifecycleEvent as Event;
use App\Models\DeliveryConnectorOperatorEvent;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Tenant;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Services\DeliveryHub\DeliveryConnectorAccountService;
use App\Services\DeliveryHub\DeliveryConnectorException;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use LogicException;
use Tests\TestCase;

/**
 * INT-AUDIT-1 / DP-F — سجل إلحاقي لإنشاء نقطة الاستقبال وتدوير سرّها وتعطيلها.
 * تشغيل: php artisan test --filter=DeliveryConnectorLifecycleAuditTest
 */
class DeliveryConnectorLifecycleAuditTest extends TestCase
{
    use \Illuminate\Foundation\Testing\RefreshDatabase;
    use InteractsWithApi;

    private function all(): \Illuminate\Support\Collection
    {
        return Event::withoutGlobalScopes()->orderBy('created_at')->orderBy('id')->get();
    }

    /** @test */
    public function creating_an_ingress_writes_one_event_with_safe_metadata_only(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('create');
        $ownerId = $this->userId('owner@create.test');

        $created = $this->connector($auth['token'], $profile, 'store-create', $branch);

        $events = $this->all();
        $this->assertCount(1, $events);
        $event = $events[0];
        $this->assertSame($auth['tenant_id'], (string) $event->tenant_id);
        $this->assertSame($created['data']['id'], (string) $event->delivery_connector_account_id);
        $this->assertSame('ingress.created', $event->event_code);
        $this->assertSame($ownerId, (string) $event->actor_user_id);
        $this->assertSame('jahez', $event->platform_key);
        $this->assertSame('store-create', $event->external_store_id);
        $this->assertSame($branch, (string) $event->branch_id);
        $this->assertNull($event->secret_version_from);
        $this->assertSame(1, $event->secret_version_to);
        $this->assertNotNull($event->created_at);
        $this->assertSame(0, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->count());
    }

    /** @test */
    public function rotating_writes_one_event_per_rotation_with_versions_and_the_real_actor(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('rotate');
        $account = $this->connector($auth['token'], $profile, 'store-rotate', $branch);
        $second = $this->user($auth, 'second@rotate.test');

        $first = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret')->assertOk();
        $this->withToken($second['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret')->assertOk();

        $events = $this->all()->where('event_code', 'secret.rotated')->values();
        $this->assertCount(2, $events);
        $this->assertSame([1, 2], $events->pluck('secret_version_from')->all());
        $this->assertSame([2, 3], $events->pluck('secret_version_to')->all());
        $this->assertSame($this->userId('owner@rotate.test'), (string) $events[0]->actor_user_id);
        $this->assertSame($second['id'], (string) $events[1]->actor_user_id);
        $this->assertSame($account['data']['id'], (string) $events[1]->delivery_connector_account_id);
        $this->assertSame(2, $first['data']['secret_version']);
        $this->assertSame(3, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($account['data']['id'])->secret_version);
    }

    /** @test */
    public function disabling_writes_one_event_and_repeating_it_is_idempotent_with_the_same_contract(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('disable');
        $account = $this->connector($auth['token'], $profile, 'store-disable', $branch);
        $id = $account['data']['id'];

        $first = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertOk();
        $this->assertSame('disabled', $first['data']['status']);
        $disabledAt = DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->disabled_at;
        $this->assertNotNull($disabledAt);
        $this->assertCount(1, $this->all()->where('event_code', 'ingress.disabled'));
        $event = $this->all()->firstWhere('event_code', 'ingress.disabled');
        $this->assertSame(1, $event->secret_version_from);
        $this->assertSame(1, $event->secret_version_to);
        $this->assertSame($branch, (string) $event->branch_id);

        // نفس العقد: 200 وبنية الاستجابة نفسها، بلا تحديث للوقت الأصلي وبلا حدث ثانٍ.
        $this->travel(5)->minutes();
        $again = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertOk();
        $this->assertSame(array_keys($first->json('data')), array_keys($again->json('data')));
        $this->assertSame($first['data']['disabled_at'], $again['data']['disabled_at']);
        $this->assertSame('disabled', $again['data']['status']);
        $this->assertTrue($disabledAt->equalTo(DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id)->disabled_at));
        $this->assertCount(1, $this->all()->where('event_code', 'ingress.disabled'));
        $this->assertCount(2, $this->all());
    }

    /** @test */
    public function failed_or_rejected_operations_write_no_events(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('fail');
        [, $other] = $this->twoBranches($auth['token']);
        $account = $this->connector($auth['token'], $profile, 'store-fail', $branch);
        $id = $account['data']['id'];
        $base = $this->all()->count();
        $this->assertSame(1, $base);

        // بيانات غير صالحة / متجر مكرر (409) / ملف منصة غير موجود (404).
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'store-fail', 'branch_id' => $branch])->assertStatus(409);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => '  '])->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => (string) \Illuminate\Support\Str::uuid(), 'external_store_id' => 'x'])->assertStatus(404);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.\Illuminate\Support\Str::uuid().'/rotate-secret')->assertNotFound();
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.\Illuminate\Support\Str::uuid().'/disable')->assertNotFound();

        // بلا صلاحية: المحاسب والموظف والخدمة الذاتية.
        foreach (['accountant', 'staff', 'self_service'] as $role) {
            $token = $this->tokenForRole($auth['tenant_id'], $role, $role.'@fail.test');
            $this->withToken($token)->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'x-'.$role])->assertForbidden();
            $this->withToken($token)->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertForbidden();
            $this->withToken($token)->postJson('/api/delivery-connectors/'.$id.'/disable')->assertForbidden();
        }

        // مستخدم مقيَّد بفرع آخر: لا يرى الحساب (404) ولا ينشئ بلا فرع أو في فرع غير مسموح.
        $limited = $this->restricted($auth, [$other], 'limited@fail.test');
        $this->withToken($limited)->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertNotFound();
        $this->withToken($limited)->postJson('/api/delivery-connectors/'.$id.'/disable')->assertNotFound();
        $this->withToken($limited)->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'x-limited'])->assertStatus(422);
        $this->withToken($limited)->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'x-limited', 'branch_id' => $branch])->assertNotFound();

        // القدرة POS معطّلة: كل الكتابات مرفوضة.
        $this->setApplicationStatus($auth['tenant_id'], 'disabled');
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'x-off', 'branch_id' => $branch])->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertForbidden();
        $this->setApplicationStatus($auth['tenant_id'], 'suspended');
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertForbidden();

        $this->assertSame($base, $this->all()->count());
        $stored = DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($id);
        $this->assertSame(1, (int) $stored->secret_version);
        $this->assertSame('configured', $stored->status);
        $this->assertSame(1, DeliveryConnectorAccount::withoutGlobalScopes()->count());
    }

    /** @test */
    public function an_audit_write_failure_rolls_the_whole_operation_back(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('rollback');
        $account = $this->connector($auth['token'], $profile, 'store-rollback', $branch);
        $id = $account['data']['id'];
        $before = DB::table('delivery_connector_accounts')->where('id', $id)->first();

        // فشل حقيقي في قاعدة البيانات: الجدول غير موجود (يعمل على SQLite وPostgreSQL، ويُسترجع بإنهاء معاملة الاختبار).
        Schema::drop('delivery_connector_lifecycle_events');

        $created = $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'store-new', 'branch_id' => $branch]);
        $created->assertStatus(500);
        $rotated = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/rotate-secret');
        $rotated->assertStatus(500);
        $disabled = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable');
        $disabled->assertStatus(500);

        foreach ([$created, $rotated, $disabled] as $response) {
            $this->assertStringNotContainsString('dsec_', $response->getContent());
            $this->assertArrayNotHasKey('secret', $response->json() ?? []);
        }
        // لا حساب جديد، والحساب القائم كما كان حرفياً (السر المشفَّر والإصدار والبادئة والحالة).
        $this->assertSame(1, DB::table('delivery_connector_accounts')->count());
        $after = DB::table('delivery_connector_accounts')->where('id', $id)->first();
        $this->assertEquals($before, $after);
    }

    /** @test */
    public function an_audit_listener_failure_rolls_back_without_touching_the_secret(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('listener');
        $account = $this->connector($auth['token'], $profile, 'store-listener', $branch);
        $id = $account['data']['id'];
        $before = DB::table('delivery_connector_accounts')->where('id', $id)->first();

        $eventName = 'eloquent.creating: '.Event::class;
        Event::getEventDispatcher()->listen($eventName, function () {
            throw new \RuntimeException('audit sink unavailable');
        });

        try {
            $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertStatus(500);
            $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertStatus(500);
            $this->assertEquals($before, DB::table('delivery_connector_accounts')->where('id', $id)->first());
            $this->assertSame(1, $this->all()->count());
        } finally {
            Event::getEventDispatcher()->forget($eventName);
        }
    }

    /** @test */
    public function events_are_tenant_isolated_and_a_foreign_actor_or_account_is_refused(): void
    {
        [$authA, $branchA, $profileA] = $this->tenantWithPlatform('tenanta');
        [$authB, $branchB, $profileB] = $this->tenantWithPlatform('tenantb');
        $a = $this->connector($authA['token'], $profileA, 'store-a', $branchA);
        $b = $this->connector($authB['token'], $profileB, 'store-b', $branchB);

        // تدوير/تعطيل حساب مستأجر آخر: 404 ولا أي حدث لأيٍّ منهما.
        $this->withToken($authB['token'])->postJson('/api/delivery-connectors/'.$a['data']['id'].'/rotate-secret')->assertNotFound();
        $this->withToken($authB['token'])->postJson('/api/delivery-connectors/'.$a['data']['id'].'/disable')->assertNotFound();
        $this->withToken($authA['token'])->postJson('/api/delivery-connectors/'.$a['data']['id'].'/rotate-secret')->assertOk();

        $this->assertSame(3, $this->all()->count());
        $this->assertSame(2, $this->all()->where('tenant_id', $authA['tenant_id'])->count());
        $this->assertSame(1, $this->all()->where('tenant_id', $authB['tenant_id'])->count());

        // القراءة عبر النموذج مقيَّدة بسياق المستأجر.
        app(TenantContext::class)->set($authB['tenant_id']);
        $this->assertSame([$b['data']['id']], Event::query()->pluck('delivery_connector_account_id')->unique()->values()->all());
        app(TenantContext::class)->set($authA['tenant_id']);
        $this->assertSame(2, Event::query()->count());

        // فاعل من مستأجر آخر يُرفض في الخدمة ولا يُكتب شيء.
        $foreignActor = User::withoutGlobalScopes()->where('email', 'owner@tenantb.test')->firstOrFail();
        $account = DeliveryConnectorAccount::query()->findOrFail($a['data']['id']);
        $service = app(DeliveryConnectorAccountService::class);
        try {
            $service->rotateSecret($account, $foreignActor);
            $this->fail('a foreign actor must be refused');
        } catch (DeliveryConnectorException $e) {
            $this->assertSame('tenant_required', $e->errorCode);
        }
        try {
            $service->disable($account, $foreignActor);
            $this->fail('a foreign actor must be refused');
        } catch (DeliveryConnectorException $e) {
            $this->assertSame('tenant_required', $e->errorCode);
        }
        $this->assertSame(3, $this->all()->count());
        $this->assertSame(2, (int) DeliveryConnectorAccount::withoutGlobalScopes()->findOrFail($a['data']['id'])->secret_version);
    }

    /** @test */
    public function the_log_is_append_only_and_validates_what_it_stores(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('append');
        $this->connector($auth['token'], $profile, 'store-append', $branch);
        app(TenantContext::class)->set($auth['tenant_id']);
        $event = Event::query()->firstOrFail();

        try {
            $event->forceFill(['event_code' => 'ingress.disabled'])->save();
            $this->fail('updates must be rejected');
        } catch (LogicException) {
            $this->assertSame('ingress.created', Event::query()->firstOrFail()->event_code);
        }
        try {
            $event->delete();
            $this->fail('deletes must be rejected');
        } catch (LogicException) {
            $this->assertSame(1, Event::query()->count());
        }

        $base = [
            'delivery_connector_account_id' => (string) \Illuminate\Support\Str::uuid(),
            'platform_key' => 'jahez', 'external_store_id' => 's', 'actor_user_id' => (string) \Illuminate\Support\Str::uuid(),
        ];
        foreach ([
            [['event_code' => 'secret.revealed'], 'unknown code'],
            [['event_code' => 'ingress.created', 'actor_user_id' => null], 'missing actor'],
            [['event_code' => 'ingress.created', 'tenant_id' => (string) \Illuminate\Support\Str::uuid()], 'forged tenant'],
        ] as [$override, $why]) {
            try {
                (new Event())->forceFill($override + $base)->save();
                $this->fail("must reject: $why");
            } catch (DomainException) {
                $this->assertSame(1, Event::query()->count(), $why);
            }
        }
    }

    /** @test */
    public function no_secret_prefix_token_or_request_data_is_ever_stored(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('nosecret');
        $account = $this->connector($auth['token'], $profile, 'store-nosecret', $branch);
        $rotated = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret', [], ['X-Request-Id' => 'req-abc-123', 'User-Agent' => 'audit-agent'])->assertOk();
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/disable')->assertOk();

        // الأعمدة محصورة في القائمة الآمنة: لا سر ولا بادئة ولا رمز ولا IP ولا request id ولا نص حر.
        $columns = Schema::getColumnListing('delivery_connector_lifecycle_events');
        $this->assertEqualsCanonicalizing([
            'id', 'tenant_id', 'delivery_connector_account_id', 'platform_key', 'external_store_id', 'event_code',
            'actor_user_id', 'branch_id', 'secret_version_from', 'secret_version_to', 'created_at',
        ], $columns);

        $dump = json_encode(DB::table('delivery_connector_lifecycle_events')->get()->all(), JSON_THROW_ON_ERROR);
        foreach ([$account['secret'], $rotated['secret'], substr($account['secret'], 0, 14), substr($rotated['secret'], 0, 14), 'dsec_', 'req-abc-123', 'audit-agent', '127.0.0.1'] as $needle) {
            $this->assertStringNotContainsString($needle, $dump);
        }
    }

    /** @test */
    public function events_outlive_a_deleted_account_row(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('outlive');
        $account = $this->connector($auth['token'], $profile, 'store-outlive', $branch);
        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/rotate-secret')->assertOk();
        $this->assertSame(2, $this->all()->count());

        DB::table('delivery_connector_accounts')->where('id', $account['data']['id'])->delete();

        $kept = $this->all();
        $this->assertCount(2, $kept);
        $this->assertSame(['ingress.created', 'secret.rotated'], $kept->pluck('event_code')->all());
        $this->assertSame('store-outlive', $kept[0]->external_store_id);
    }

    /** @test */
    public function operator_reassignment_keeps_its_own_log_and_writes_no_lifecycle_event(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('reassign');
        $account = $this->connector($auth['token'], $profile, 'store-reassign', $branch);
        $successor = $this->user($auth, 'successor@reassign.test');

        $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$account['data']['id'].'/reassign', ['user_id' => $successor['id']])->assertOk();

        $this->assertSame(1, DeliveryConnectorOperatorEvent::withoutGlobalScopes()->count());
        $this->assertSame(['ingress.created'], $this->all()->pluck('event_code')->all());
    }

    /** @test */
    public function the_existing_response_contract_is_unchanged(): void
    {
        [$auth, $branch, $profile] = $this->tenantWithPlatform('contract');
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-connectors', ['delivery_platform_profile_id' => $profile, 'external_store_id' => 'store-contract', 'branch_id' => $branch])->assertCreated();
        $id = $created['data']['id'];
        $keys = ['id', 'delivery_platform_profile_id', 'platform_key', 'external_store_id', 'branch_id', 'configured_by', 'operated_by', 'status', 'secret_prefix', 'secret_version', 'disabled_at', 'created_at'];
        $this->assertEqualsCanonicalizing($keys, array_keys($created['data']));
        $this->assertStringStartsWith('dsec_', $created['secret']);
        $rotated = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/rotate-secret')->assertOk();
        $this->assertEqualsCanonicalizing($keys, array_keys($rotated['data']));
        $this->assertStringStartsWith('dsec_', $rotated['secret']);
        $disabled = $this->withToken($auth['token'])->postJson('/api/delivery-connectors/'.$id.'/disable')->assertOk();
        $this->assertEqualsCanonicalizing($keys, array_keys($disabled['data']));
        $this->assertArrayNotHasKey('secret', $disabled->json());
        $this->assertSame(['ingress.created', 'secret.rotated', 'ingress.disabled'], $this->all()->pluck('event_code')->all());
    }

    private function userId(string $email): string
    {
        return (string) User::withoutGlobalScopes()->where('email', $email)->value('id');
    }

    /** @return array{0: array{token: string, tenant_id: string}, 1: string, 2: string} */
    private function tenantWithPlatform(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $branch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $profile = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'jahez',
            'collection_mode' => Version::COLLECTION_PLATFORM,
        ])->assertCreated()['data']['id'];

        return [$auth, $branch, $profile];
    }

    /** @return array{0: string, 1: string} */
    private function twoBranches(string $token): array
    {
        $first = $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $second = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع ثان'])->assertCreated()['data']['id'];

        return [$first, $second];
    }

    /** @return array{data: array<string, mixed>, secret: string} */
    private function connector(string $token, string $profile, string $store, ?string $branch): array
    {
        $created = $this->withToken($token)->postJson('/api/delivery-connectors', array_filter([
            'delivery_platform_profile_id' => $profile,
            'external_store_id' => $store,
            'branch_id' => $branch,
        ], fn ($value) => $value !== null))->assertCreated();

        return ['data' => $created['data'], 'secret' => $created['secret']];
    }

    private function setApplicationStatus(string $tenantId, string $status): void
    {
        app(TenantContext::class)->set($tenantId);
        TenantApplicationState::query()->where('application_key', 'sales.pos')->update(['status' => $status]);
        app(TenantContext::class)->forget();
    }

    /** @param  array<int, string>  $branchIds */
    private function restricted(array $auth, array $branchIds, string $email): string
    {
        $this->raiseUserLimit($auth['tenant_id']);
        $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مشغّل فرع', 'email' => $email, 'password' => 'password123', 'role' => 'admin', 'branch_ids' => $branchIds,
        ])->assertCreated();

        return $this->postJson('/api/login', ['email' => $email, 'password' => 'password123'])->assertOk()['token'];
    }

    private function raiseUserLimit(string $tenantId): void
    {
        $tenant = Tenant::findOrFail($tenantId);
        $limits = $tenant->plan_limits ?? [];
        $limits['users'] = null;
        $tenant->plan_limits = $limits;
        $tenant->save();
    }

    /** @return array{id: string, token: string} */
    private function user(array $auth, string $email, string $role = 'admin'): array
    {
        $this->raiseUserLimit($auth['tenant_id']);
        $created = $this->withToken($auth['token'])->postJson('/api/users', [
            'name' => 'مستخدم تشغيلي', 'email' => $email, 'password' => 'password123', 'role' => $role,
        ])->assertCreated();
        app(TenantContext::class)->set($auth['tenant_id']);
        $user = User::query()->findOrFail($created['data']['id']);

        return ['id' => (string) $user->id, 'token' => $user->createToken('api')->plainTextToken];
    }
}

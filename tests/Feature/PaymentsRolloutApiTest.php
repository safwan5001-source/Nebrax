<?php

namespace Tests\Feature;

use App\Models\PlatformAdministrator;
use App\Support\SchedulerHeartbeat;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** PAY-H1-02 — مسارات المنصة لضوابط تفعيل المدفوعات: الصلاحيات، العزل، الإيقاف الطارئ، وعدم تجاوز صلاحيات المستأجر. */
class PaymentsRolloutApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        SchedulerHeartbeat::record();
    }

    private function platformToken(array $abilities = ['platform:read', 'platform:manage']): string
    {
        return PlatformAdministrator::create([
            'name' => 'مشغّل', 'email' => 'ops+'.uniqid().'@nebrax.test', 'password' => 'platform-password-123',
        ])->createToken('platform-console', $abilities)->plainTextToken;
    }

    /** @test */
    public function only_platform_administrators_can_reach_the_routes_and_tenant_tokens_never_can(): void
    {
        $a = $this->registerTenant('pr-a', 'owner@pr-a.test');
        $routes = [
            ['getJson', '/api/platform/payments-rollout', []],
            ['putJson', '/api/platform/payments-rollout', ['stopped' => true, 'reason' => 'محاولة مستأجر']],
            ['getJson', "/api/platform/tenants/{$a['tenant_id']}/payments-rollout", []],
            ['putJson', "/api/platform/tenants/{$a['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'محاولة مستأجر']],
        ];

        foreach ($routes as [$verb, $uri, $body]) {
            $this->flushHeaders();
            $this->{$verb}($uri, $body)->assertUnauthorized();
            $this->withToken($a['token'])->{$verb}($uri, $body)->assertForbidden();
        }

        $this->assertSame(0, DB::table('payments_rollout_controls')->count());
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
    }

    /** @test */
    public function a_read_only_platform_token_can_read_but_not_change(): void
    {
        $a = $this->registerTenant('pr-ro', 'owner@pr-ro.test');
        $token = $this->platformToken(['platform:read']);

        $this->withToken($token)->getJson('/api/platform/payments-rollout')->assertOk()
            ->assertJsonPath('data.emergency_stop', false)->assertJsonPath('data.scheduler.fresh', true);
        $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout")->assertOk()
            ->assertJsonPath('data.effective_enabled', false)->assertJsonPath('data.reason', 'tenant_not_configured');
        $this->withToken($token)->putJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'قراءة فقط'])->assertForbidden();
        $this->withToken($token)->putJson('/api/platform/payments-rollout', ['stopped' => true, 'reason' => 'قراءة فقط'])->assertForbidden();
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
    }

    /** @test */
    public function enabling_one_tenant_neither_enables_another_nor_leaks_into_its_read(): void
    {
        $a = $this->registerTenant('pr-iso-a', 'owner@pr-iso-a.test');
        $b = $this->registerTenant('pr-iso-b', 'owner@pr-iso-b.test');
        $token = $this->platformToken();

        $this->withToken($token)->putJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'تفعيل تجريبي للمستأجر أ'])
            ->assertOk()->assertJsonPath('data.changed', true)->assertJsonPath('data.effective_enabled', true);

        $this->withToken($token)->getJson("/api/platform/tenants/{$b['tenant_id']}/payments-rollout")->assertOk()
            ->assertJsonPath('data.effective_enabled', false)->assertJsonPath('data.reason', 'tenant_not_configured')
            ->assertJsonCount(0, 'data.events');
        $show = $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout")->assertOk();
        $show->assertJsonCount(1, 'data.events')->assertJsonPath('data.events.0.version', 1);
        $this->assertSame(1, DB::table('payments_rollout_controls')->count());
    }

    /** @test */
    public function the_platform_emergency_stop_overrides_every_tenant_and_release_restores_them(): void
    {
        $a = $this->registerTenant('pr-stop-a', 'owner@pr-stop-a.test');
        $token = $this->platformToken();
        $this->withToken($token)->putJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'تفعيل قبل الإيقاف'])->assertOk();

        $this->withToken($token)->putJson('/api/platform/payments-rollout', ['stopped' => true, 'reason' => 'حادثة تشغيلية'])
            ->assertOk()->assertJsonPath('data.emergency_stop', true);
        $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout")->assertOk()
            ->assertJsonPath('data.effective_enabled', false)->assertJsonPath('data.reason', 'platform_stop')->assertJsonPath('data.tenant_enabled', true);

        // تكرار الإيقاف idempotent بلا حدث جديد.
        $this->withToken($token)->putJson('/api/platform/payments-rollout', ['stopped' => true, 'reason' => 'تكرار الإيقاف'])->assertOk()->assertJsonPath('data.changed', false);

        $this->withToken($token)->putJson('/api/platform/payments-rollout', ['stopped' => false, 'reason' => 'انتهاء الحادثة'])->assertOk()->assertJsonPath('data.emergency_stop', false);
        $this->withToken($token)->getJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout")->assertOk()
            ->assertJsonPath('data.effective_enabled', true);
        $this->assertSame(2, DB::table('payments_rollout_control_events')->where('scope', 'platform')->count());
    }

    /** @test */
    public function enabling_is_refused_with_409_while_the_scheduler_is_unproven_and_disabling_still_works(): void
    {
        $a = $this->registerTenant('pr-d25', 'owner@pr-d25.test');
        $token = $this->platformToken();
        $uri = "/api/platform/tenants/{$a['tenant_id']}/payments-rollout";
        $this->withToken($token)->putJson($uri, ['enabled' => true, 'reason' => 'تفعيل قبل تعطل المجدول'])->assertOk();

        DB::table('platform_runtime_heartbeats')->where('component', SchedulerHeartbeat::COMPONENT)
            ->update(['last_seen_at' => now('UTC')->subMinutes(SchedulerHeartbeat::MAX_AGE_MINUTES + 1)]);
        $b = $this->registerTenant('pr-d25-b', 'owner@pr-d25-b.test');

        $this->withToken($token)->getJson('/api/platform/payments-rollout')->assertOk()->assertJsonPath('data.scheduler.fresh', false);
        $this->withToken($token)->putJson("/api/platform/tenants/{$b['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'مجدول غير مثبت'])->assertStatus(409);
        $this->withToken($token)->putJson($uri, ['enabled' => false, 'reason' => 'تعطيل مسموح دائماً'])->assertOk()->assertJsonPath('data.changed', true);
        $this->assertSame(0, DB::table('payments_rollout_controls')->where('tenant_id', $b['tenant_id'])->count());
    }

    /** @test */
    public function invalid_input_unknown_tenant_and_inactive_administrators_are_rejected(): void
    {
        $a = $this->registerTenant('pr-val', 'owner@pr-val.test');
        $admin = PlatformAdministrator::create(['name' => 'م', 'email' => 'v@nebrax.test', 'password' => 'platform-password-123']);
        $token = $admin->createToken('c', ['platform:read', 'platform:manage'])->plainTextToken;
        $uri = "/api/platform/tenants/{$a['tenant_id']}/payments-rollout";

        $this->withToken($token)->putJson($uri, ['enabled' => true])->assertStatus(422);
        $this->withToken($token)->putJson($uri, ['enabled' => 'maybe', 'reason' => 'سبب كافٍ'])->assertStatus(422);
        $this->withToken($token)->putJson($uri, ['enabled' => true, 'reason' => 'ab'])->assertStatus(422);
        $this->withToken($token)->putJson($uri, ['reason' => 'سبب كافٍ'])->assertStatus(422);
        $this->withToken($token)->putJson('/api/platform/payments-rollout', ['reason' => 'سبب كافٍ'])->assertStatus(422);
        $this->withToken($token)->putJson('/api/platform/tenants/'.fake()->uuid().'/payments-rollout', ['enabled' => true, 'reason' => 'مستأجر مجهول'])->assertNotFound();
        $this->withToken($token)->getJson('/api/platform/tenants/'.fake()->uuid().'/payments-rollout')->assertNotFound();
        $this->withToken($token)->putJson('/api/platform/tenants/not-a-uuid/payments-rollout', ['enabled' => true, 'reason' => 'معرّف فاسد'])->assertNotFound();

        $admin->forceFill(['is_active' => false])->save();
        $this->withToken($token)->putJson($uri, ['enabled' => true, 'reason' => 'مدير معطّل'])->assertForbidden();
        $this->assertSame(0, DB::table('payments_rollout_control_events')->count());
    }

    /** @test */
    public function enabling_the_rollout_does_not_widen_tenant_permissions_or_cross_company_access(): void
    {
        $a = $this->registerTenant('pr-perm-a', 'owner@pr-perm-a.test');
        $b = $this->registerTenant('pr-perm-b', 'owner@pr-perm-b.test');
        $staff = $this->tokenForRole($a['tenant_id'], 'staff', 'staff@pr-perm-a.test');
        $accountant = $this->tokenForRole($a['tenant_id'], 'accountant', 'acc@pr-perm-a.test');
        $platform = $this->platformToken();

        $gateway = $this->withToken($b['token'])->postJson('/api/payment-gateways', [
            'provider' => 'custom', 'name' => 'بوابة ب', 'environment' => 'sandbox',
        ])->assertCreated()->json('data.id');

        foreach ([$a, $b] as $tenant) {
            $this->withToken($platform)->putJson("/api/platform/tenants/{$tenant['tenant_id']}/payments-rollout", ['enabled' => true, 'reason' => 'تفعيل الشركتين'])->assertOk();
        }

        // الصلاحيات كما هي: المحاسب والموظف لا يديران الاتصالات، والمستأجر أ لا يرى بوابة ب.
        $this->withToken($accountant)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'x', 'environment' => 'sandbox'])->assertForbidden();
        $this->withToken($staff)->postJson('/api/payment-gateways', ['provider' => 'custom', 'name' => 'x', 'environment' => 'sandbox'])->assertForbidden();
        $this->withToken($a['token'])->getJson("/api/payment-gateways/{$gateway}")->assertNotFound();
        $this->withToken($a['token'])->postJson("/api/payment-gateways/{$gateway}/activate")->assertNotFound();

        // ولا مسار للمستأجر على الضوابط نفسها.
        $this->withToken($a['token'])->putJson("/api/platform/tenants/{$a['tenant_id']}/payments-rollout", ['enabled' => false, 'reason' => 'تعطيل ذاتي'])->assertForbidden();
        $this->assertSame(2, DB::table('payments_rollout_control_events')->count());
    }
}

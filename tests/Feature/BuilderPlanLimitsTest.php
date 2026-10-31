<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\PreviewSession;
use App\Models\Tenant;
use App\Support\PlanGate;
use App\Support\Plans;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * DRF-07 (S02c) — حدود كمية صانع التطبيقات عبر `PlanGate`: تطبيقات لكل مستأجر، نسخ منشورة لكل تطبيق، جلسات معاينة
 * نشطة لكل تطبيق. **افتراضات سخية** لكل خطة، **قابلة للضبط لكل مستأجر** (`plan_limits`، null = بلا حد)، **بلا كسر
 * للحسابات التجريبية** (لا حد افتراضي يلمسها عملياً). تجاوز الحد ⇒ 422 `plan_limit_reached` بلا أي كتابة.
 *
 * تشغيل: php artisan test --filter=BuilderPlanLimitsTest
 */
class BuilderPlanLimitsTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array{0: array<string, mixed>, 1: Tenant} */
    private function tenant(string $slug, ?array $limits = null, ?string $plan = null): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        $update = array_filter(['plan_limits' => $limits, 'plan' => $plan], fn ($v) => $v !== null);
        if ($update !== []) {
            $tenant->forceFill($update)->save();
        }

        return [$auth, $tenant];
    }

    private function createApp(string $token)
    {
        return $this->withToken($token)->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch']);
    }

    private function appsCount(string $tenantId): int
    {
        return BuilderApp::withoutGlobalScopes()->where('tenant_id', $tenantId)->count();
    }

    /** @test */
    public function every_plan_has_generous_builder_defaults_and_enterprise_is_unlimited(): void
    {
        foreach (['free', 'basic', 'pro'] as $plan) {
            $defaults = Plans::defaults($plan);
            $this->assertGreaterThanOrEqual(10, $defaults['builder_apps'], $plan);
            $this->assertGreaterThanOrEqual(100, $defaults['builder_versions_per_app'], $plan);
            $this->assertGreaterThanOrEqual(50, $defaults['builder_active_previews'], $plan);
        }
        $this->assertNull(Plans::defaults('enterprise')['builder_apps']);
        $this->assertNull(Plans::defaults('enterprise')['builder_versions_per_app']);
        $this->assertNull(Plans::defaults('enterprise')['builder_active_previews']);
        // خطة مجهولة ⇒ افتراضيات free (سلوك PlanGate القائم).
        $this->assertSame(Plans::defaults('free')['builder_apps'], Plans::defaults('nope')['builder_apps']);
    }

    /** @test */
    public function the_per_tenant_override_beats_the_plan_default_and_null_means_unlimited(): void
    {
        [, $tenant] = $this->tenant('pl-override', ['builder_apps' => 3, 'builder_versions_per_app' => null]);

        $this->assertSame(3, PlanGate::limit($tenant, 'builder_apps'));
        $this->assertNull(PlanGate::limit($tenant, 'builder_versions_per_app'));
        $this->assertSame(Plans::defaults('free')['builder_active_previews'], PlanGate::limit($tenant, 'builder_active_previews'));
    }

    /** @test */
    public function creating_an_app_beyond_the_tenant_limit_is_422_plan_limit_reached_and_writes_nothing(): void
    {
        [$auth, $tenant] = $this->tenant('pl-apps', ['builder_apps' => 2]);

        $this->createApp($auth['token'])->assertCreated();
        $this->createApp($auth['token'])->assertCreated();
        $before = $this->appsCount($tenant->id);

        $this->createApp($auth['token'])->assertStatus(422)
            ->assertJsonPath('reason', 'plan_limit_reached')
            ->assertJsonPath('resource', 'builder_apps')
            ->assertJsonPath('limit', 2);
        $this->assertSame($before, $this->appsCount($tenant->id));
    }

    /** @test */
    public function an_unlimited_override_never_blocks_and_one_tenants_usage_never_counts_for_another(): void
    {
        [$authA] = $this->tenant('pl-un-a', ['builder_apps' => null]);
        [$authB, $tenantB] = $this->tenant('pl-un-b', ['builder_apps' => 1]);

        for ($i = 0; $i < 4; $i++) {
            $this->createApp($authA['token'])->assertCreated();
        }
        $this->createApp($authB['token'])->assertCreated(); // A's four apps don't count against B
        $this->createApp($authB['token'])->assertStatus(422)->assertJsonPath('reason', 'plan_limit_reached');
        $this->assertSame(1, $this->appsCount($tenantB->id));
    }

    /** @test */
    public function publishing_beyond_the_per_app_version_limit_is_422_and_creates_no_version(): void
    {
        [$auth] = $this->tenant('pl-ver', ['builder_versions_per_app' => 2]);
        $appId = $this->createApp($auth['token'])->json('data.id');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422)
            ->assertJsonPath('reason', 'plan_limit_reached')
            ->assertJsonPath('resource', 'builder_versions_per_app')
            ->assertJsonPath('limit', 2);

        $this->assertSame(2, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());

        // التطبيق الآخر له حدّه الخاص.
        $other = $this->createApp($auth['token'])->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$other}/versions", [])->assertCreated();
    }

    /** @test */
    public function active_preview_sessions_are_capped_per_app_but_revoked_and_expired_ones_free_capacity(): void
    {
        [$auth] = $this->tenant('pl-prev', ['builder_active_previews' => 2]);
        $appId = $this->createApp($auth['token'])->json('data.id');
        $issue = fn () => $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/preview-sessions", ['channel' => 'browser']);

        $first = $issue()->assertCreated();
        $issue()->assertCreated();
        $issue()->assertStatus(422)->assertJsonPath('reason', 'plan_limit_reached')->assertJsonPath('resource', 'builder_active_previews');
        $this->assertSame(2, PreviewSession::withoutGlobalScopes()->where('builder_app_id', $appId)->count());

        // انتهاء صلاحية جلسة يحرّر السعة.
        PreviewSession::withoutGlobalScopes()->where('id', $first->json('data.id') ?? PreviewSession::withoutGlobalScopes()->where('builder_app_id', $appId)->value('id'))->update(['expires_at' => now()->subMinute()]);
        $issue()->assertCreated();
        $issue()->assertStatus(422);

        // الإبطال يحرّر السعة أيضاً.
        PreviewSession::withoutGlobalScopes()->where('builder_app_id', $appId)->whereNull('revoked_at')->where('expires_at', '>', now())->limit(1)->update(['revoked_at' => now()]);
        $issue()->assertCreated();
    }

    /** @test */
    public function the_subscription_endpoint_reports_the_builder_limits_and_usage(): void
    {
        [$auth] = $this->tenant('pl-sub', ['builder_apps' => 7]);
        $this->createApp($auth['token'])->assertCreated();

        $this->withToken($auth['token'])->getJson('/api/subscription')->assertOk()
            ->assertJsonPath('limits.builder_apps', 7)
            ->assertJsonPath('usage.builder_apps', 1);
    }

    /** @test */
    public function a_trial_account_on_the_free_plan_is_never_blocked_in_ordinary_use(): void
    {
        [$auth] = $this->tenant('pl-trial', null, 'free');

        for ($i = 0; $i < 5; $i++) {
            $appId = $this->createApp($auth['token'])->assertCreated()->json('data.id');
            $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
            $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/preview-sessions", ['channel' => 'browser'])->assertCreated();
        }
    }
}

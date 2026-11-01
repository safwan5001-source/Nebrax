<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderLivePointer;
use App\Models\BuilderLivePointerEvent;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Services\ApiClientKeyService;
use App\Services\AppBuilder\BuilderLivePointerService;
use App\Services\AppBuilder\LivePointerConflictException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

/**
 * AD-06 / S05c — المؤشر الحي لقناة الجوال: ترقية/تراجع/ETag خلف بوابة نشر، مع بقاء السلوك المؤقت حرفياً حين تُغلق
 * البوابة أو لا مؤشر. عزل المستأجر وRBAC وحدّ السقف (لا يُخدَم ما بعد النسخة الحيّة).
 *
 * تشغيل: php artisan test --filter=BuilderLivePointerTest
 */
class BuilderLivePointerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{token: string, tenant_id: string, mobile: string, channel: SalesChannel} */
    private function store(string $slug, bool $withChannel = true): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $channel = null;
        $mobile = '';
        if ($withChannel) {
            app(TenantContext::class)->set($auth['tenant_id']);
            $channel = SalesChannel::create([
                'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
            ]);
            app(TenantContext::class)->forget();
            $tenant = \App\Models\Tenant::find($auth['tenant_id']);
            $client = app(ApiClientKeyService::class)->createClient($tenant, 'mobile-app', true);
            $mobile = app(ApiClientKeyService::class)->issueKey($client, 'default', [])->plainTextToken;
        }

        return $auth + ['mobile' => $mobile, 'channel' => $channel];
    }

    private function app(string $tenantId, string $name = 'تطبيقي'): BuilderApp
    {
        app(TenantContext::class)->set($tenantId);
        $app = BuilderApp::create(['name' => $name, 'creation_source' => BuilderApp::SOURCE_SCRATCH]);
        app(TenantContext::class)->forget();

        return $app;
    }

    private function version(string $tenantId, BuilderApp $app, int $version, string $marker = 'm', ?array $schema = null): BuilderPublishedExperienceVersion
    {
        app(TenantContext::class)->set($tenantId);
        $schema ??= array_merge(BuilderDraftExperience::minimalSafeSchema(), ['theme' => ['tokens' => ['marker' => $marker]]]);
        $row = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id,
            'version' => $version,
            'schema' => $schema,
            'schema_version' => (string) $schema['schemaVersion'],
            'published_at' => now()->addSeconds($version),
        ]);
        app(TenantContext::class)->forget();

        return $row->fresh();
    }

    private function served(array $store, array $headers = []): \Illuminate\Testing\TestResponse
    {
        return $this->getJson('/commerce/v1/experience', ['Authorization' => 'Bearer '.$store['mobile']] + $headers);
    }

    private function promote(array $store, BuilderApp $app, int $version, array $body = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($store['token'])->postJson("/api/app-builder/apps/{$app->id}/versions/{$version}/promote", $body);
    }

    // ── البوابة مغلقة (الافتراضي) ────────────────────────────────────

    /** @test */
    public function with_the_gate_closed_management_is_404_and_the_legacy_latest_wins(): void
    {
        $s = $this->store('lp-closed');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');

        $this->promote($s, $a, 1)->assertNotFound();
        $this->withToken($s['token'])->getJson('/api/app-builder/live')->assertNotFound();
        $this->withToken($s['token'])->postJson('/api/app-builder/live/rollback')->assertNotFound();
        $this->assertSame(0, BuilderLivePointer::withoutGlobalScopes()->count());

        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'two');
    }

    // ── البوابة مفتوحة ──────────────────────────────────────────────

    /** @test */
    public function a_pointer_pins_the_live_version_and_newer_publishes_do_not_move_it(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-pin');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');

        $this->promote($s, $a, 1, ['reason' => 'اعتماد'])->assertOk()->assertJsonPath('data.version', 1);
        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'one');

        // نشر نسخة أحدث لا يحرّك المؤشر.
        $this->version($s['tenant_id'], $a, 3, 'three');
        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'one');

        $this->promote($s, $a, 3)->assertOk();
        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'three');
    }

    /** @test */
    public function publishing_a_second_app_does_not_steal_the_live_experience(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-steal');
        $a = $this->app($s['tenant_id'], 'الأول');
        $this->version($s['tenant_id'], $a, 1, 'app-a');
        $this->promote($s, $a, 1)->assertOk();

        $b = $this->app($s['tenant_id'], 'الثاني');
        $this->version($s['tenant_id'], $b, 1, 'app-b');

        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'app-a');
    }

    /** @test */
    public function the_live_app_is_never_replaced_by_another_apps_version_for_an_old_runtime(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-oldrt');
        $other = $this->app($s['tenant_id'], 'آخر');
        $this->version($s['tenant_id'], $other, 1, 'other-app');

        // النسخة الحيّة تحتاج الجيل 1.1.0 (غلاف التنقل)؛ جهاز 1.0.0 يأخذ 404 لا تجربة تطبيق آخر.
        $shell = json_decode((string) file_get_contents(base_path('contracts/app-builder/archive/v1-1-shell.json')), true);
        $live = $this->app($s['tenant_id'], 'الحيّ');
        $this->version($s['tenant_id'], $live, 1, 'x', $shell);
        $this->promote($s, $live, 1)->assertOk();

        $this->served($s, ['X-Runtime-Version' => '1.0.0'])->assertNotFound();
        $this->served($s, ['X-Runtime-Version' => '1.1.0'])->assertOk()->assertJsonPath('data.schema.navigation.tabs.0.pageId', 'home');
    }

    /** @test */
    public function closing_the_gate_again_returns_to_the_legacy_selection_even_with_a_pointer(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-reclose');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');
        $this->promote($s, $a, 1)->assertOk();
        $this->served($s)->assertJsonPath('data.schema.theme.tokens.marker', 'one');

        config(['app_builder.live_pointer_enabled' => false]);
        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'two');
    }

    /** @test */
    public function the_live_version_is_a_ceiling_never_serve_newer_than_it(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-ceiling');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');
        $this->version($s['tenant_id'], $a, 3, 'three');
        $this->promote($s, $a, 2)->assertOk();

        $this->served($s)->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.schema.theme.tokens.marker', 'two');
    }

    /** @test */
    public function with_the_gate_open_but_no_pointer_the_legacy_behaviour_remains(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-nopointer');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');

        $this->served($s)->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'two');
    }

    /** @test */
    public function rollback_without_a_body_returns_to_the_previously_live_version_and_is_audited(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-rollback');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');
        $this->version($s['tenant_id'], $a, 2, 'two');
        $this->promote($s, $a, 1)->assertOk();
        $this->promote($s, $a, 2)->assertOk();
        $this->served($s)->assertJsonPath('data.schema.theme.tokens.marker', 'two');

        $this->withToken($s['token'])->postJson('/api/app-builder/live/rollback', ['reason' => 'خلل'])
            ->assertOk()->assertJsonPath('data.version', 1);
        $this->served($s)->assertJsonPath('data.schema.theme.tokens.marker', 'one');

        $live = $this->withToken($s['token'])->getJson('/api/app-builder/live')->assertOk();
        $live->assertJsonPath('data.live.version', 1);
        $live->assertJsonPath('data.history.0.action', 'rollback');
        $live->assertJsonPath('data.history.0.from_version', 2);
        $live->assertJsonPath('data.history.0.to_version', 1);
        $live->assertJsonPath('data.history.0.reason', 'خلل');
        $this->assertSame(['promote', 'promote', 'rollback'], BuilderLivePointerEvent::withoutGlobalScopes()->orderBy('created_at')->orderBy('id')->pluck('action')->all());
    }

    /** @test */
    public function rollback_with_nothing_to_return_to_is_a_409(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-norb');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);

        $this->withToken($s['token'])->postJson('/api/app-builder/live/rollback')
            ->assertStatus(409)->assertJsonPath('reason', 'no_rollback_target');

        $this->promote($s, $a, 1)->assertOk();
        $this->withToken($s['token'])->postJson('/api/app-builder/live/rollback')
            ->assertStatus(409)->assertJsonPath('reason', 'no_rollback_target');
    }

    /** @test */
    public function promoting_the_already_live_version_is_idempotent_without_a_new_event(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-idem');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);

        $this->promote($s, $a, 1)->assertOk();
        $this->promote($s, $a, 1)->assertOk();

        $this->assertSame(1, BuilderLivePointerEvent::withoutGlobalScopes()->count());
        $this->assertSame(1, BuilderLivePointer::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_version_no_runtime_can_render_cannot_become_live(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-incompat');
        $a = $this->app($s['tenant_id']);
        $future = array_merge(BuilderDraftExperience::minimalSafeSchema(), ['schemaVersion' => '9.0.0']);
        $this->version($s['tenant_id'], $a, 1, 'x', $future);

        $this->promote($s, $a, 1)->assertStatus(422);
        $this->assertSame(0, BuilderLivePointer::withoutGlobalScopes()->count());
    }

    /** @test */
    public function promote_fails_cleanly_when_the_tenant_has_no_mobile_channel(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-nochan', withChannel: false);
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);

        $this->promote($s, $a, 1)->assertStatus(422);
    }

    // ── العزل وRBAC ─────────────────────────────────────────────────

    /** @test */
    public function a_tenant_cannot_promote_another_tenants_version_and_pointers_never_leak(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $a = $this->store('lp-iso-a');
        $b = $this->store('lp-iso-b');
        $appA = $this->app($a['tenant_id']);
        $this->version($a['tenant_id'], $appA, 1, 'a-only');

        $this->promote($b, $appA, 1)->assertNotFound();

        $this->promote($a, $appA, 1)->assertOk();
        $this->served($b)->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/app-builder/live')->assertOk()->assertJsonPath('data.live', null);
    }

    /** @test */
    public function promote_and_rollback_require_the_publish_permission(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-rbac');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);
        $staff = $this->tokenForRole($s['tenant_id'], 'staff', 'staff@lp-rbac.test');

        $this->withToken($staff)->postJson("/api/app-builder/apps/{$a->id}/versions/1/promote")->assertForbidden();
        $this->withToken($staff)->postJson('/api/app-builder/live/rollback')->assertForbidden();
        $this->withToken($staff)->getJson('/api/app-builder/live')->assertForbidden();
    }

    // ── ETag ────────────────────────────────────────────────────────

    /** @test */
    public function experience_carries_an_etag_and_answers_304_to_a_matching_if_none_match(): void
    {
        $s = $this->store('lp-etag');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1, 'one');

        $first = $this->served($s)->assertOk();
        $etag = $first->headers->get('ETag');
        $this->assertNotEmpty($etag);
        $this->assertStringContainsString('no-cache', (string) $first->headers->get('Cache-Control'));

        $this->served($s, ['If-None-Match' => $etag])->assertStatus(304);
        $this->served($s, ['If-None-Match' => 'W/'.$etag])->assertStatus(304);
        $this->served($s, ['If-None-Match' => '"nope", '.$etag])->assertStatus(304);
        $this->served($s, ['If-None-Match' => '"stale"'])->assertOk();

        // نشر نسخة جديدة يغيّر الـETag فيُخدَم المحتوى الجديد.
        $this->version($s['tenant_id'], $a, 2, 'two');
        $this->served($s, ['If-None-Match' => $etag])->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'two');
    }

    /** @test */
    public function the_etag_differs_per_runtime_generation(): void
    {
        $s = $this->store('lp-etag-gen');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);

        $old = $this->served($s, ['X-Runtime-Version' => '1.0.0'])->assertOk()->headers->get('ETag');
        $new = $this->served($s, ['X-Runtime-Version' => '1.1.0'])->assertOk()->headers->get('ETag');
        $this->assertNotSame($old, $new);
    }

    // ── نشر وتفعيل ──────────────────────────────────────────────────

    /** @test */
    public function publish_with_promote_makes_the_new_version_live_atomically(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-pubpromote');
        $appId = $this->withToken($s['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['promote' => true])->assertCreated();

        $this->withToken($s['token'])->getJson('/api/app-builder/live')->assertOk()
            ->assertJsonPath('data.live.builder_app_id', $appId)
            ->assertJsonPath('data.live.version', 1);

        // نشر فقط: المؤشر يبقى.
        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
        $this->withToken($s['token'])->getJson('/api/app-builder/live')->assertJsonPath('data.live.version', 1);
    }

    /** @test */
    public function publish_with_promote_while_the_gate_is_closed_is_rejected_without_creating_a_version(): void
    {
        $s = $this->store('lp-pubclosed');
        $appId = $this->withToken($s['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['promote' => true])->assertStatus(422);
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->count());
    }

    /** @test */
    public function publish_with_promote_rolls_the_publish_back_when_activation_fails(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-pubfail', withChannel: false);
        $appId = $this->withToken($s['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        $this->withToken($s['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['promote' => true])->assertStatus(422);
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->count());
    }

    // ── الخدمة والثبات ──────────────────────────────────────────────

    /** @test */
    public function the_service_rejects_a_pointer_that_moved_since_the_caller_read_it(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-moved');
        $a = $this->app($s['tenant_id']);
        $v1 = $this->version($s['tenant_id'], $a, 1);
        $v2 = $this->version($s['tenant_id'], $a, 2);

        app(TenantContext::class)->set($s['tenant_id']);
        $service = app(BuilderLivePointerService::class);
        $service->promote($v1, null);
        $service->promote($v2, null);

        try {
            $service->promote($v1, null, null, BuilderLivePointerEvent::ACTION_ROLLBACK, expectedCurrentVersionId: $v1->id);
            $this->fail('expected a conflict');
        } catch (LivePointerConflictException $e) {
            $this->assertSame('pointer_changed', $e->reason);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    /** @test */
    public function pointer_events_are_immutable(): void
    {
        config(['app_builder.live_pointer_enabled' => true]);
        $s = $this->store('lp-immutable');
        $a = $this->app($s['tenant_id']);
        $this->version($s['tenant_id'], $a, 1);
        $this->promote($s, $a, 1)->assertOk();

        app(TenantContext::class)->set($s['tenant_id']);
        $event = BuilderLivePointerEvent::query()->firstOrFail();
        try {
            $this->expectException(LogicException::class);
            $event->update(['reason' => 'x']);
        } finally {
            app(TenantContext::class)->forget();
        }
    }
}

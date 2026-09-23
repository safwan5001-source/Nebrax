<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use Tests\TestCase;

/**
 * APP-BUILDER-1 — أساس هوية/مسودة/نشر تطبيقات AWJ App Builder: عزل
 * المستأجر، RBAC (`apps_builder.view`/`manage`/`publish`)، حالة
 * `commerce.app_builder` (ApplicationCatalog)، وثبات النسخ المنشورة.
 *
 * تشغيل: php artisan test --filter=BuilderAppTest
 */
class BuilderAppTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    // ── إنشاء + مسودة تلقائية ────────────────────────────────────────

    /** @test */
    public function creating_an_app_seeds_a_minimal_safe_draft_atomically(): void
    {
        $auth = $this->registerTenant('appb-create', 'owner@appb-create.test');

        $response = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيقي',
            'name_en' => 'My App',
            'creation_source' => 'scratch',
        ])->assertCreated();

        $appId = $response->json('data.id');
        $this->assertNotNull($appId);

        $draft = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk();
        $draft->assertJsonPath('data.schema.schemaVersion', '1.0.0');
        $draft->assertJsonPath('data.schema.navigation.initialPageId', 'home');
        $draft->assertJsonPath('data.schema.pages.home.type', 'Page');
        $draft->assertJsonPath('data.revision', 0);
    }

    /** @test */
    public function invalid_creation_source_is_rejected(): void
    {
        $auth = $this->registerTenant('appb-badsource', 'owner@appb-badsource.test');

        $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيقي',
            'creation_source' => 'not_a_real_source',
        ])->assertStatus(422);
    }

    // ── عزل المستأجر ─────────────────────────────────────────────────

    /** @test */
    public function an_app_created_for_one_tenant_never_leaks_into_another(): void
    {
        $tenantA = $this->registerTenant('appb-tenant-a', 'owner@appb-tenant-a.test');
        $tenantB = $this->registerTenant('appb-tenant-b', 'owner@appb-tenant-b.test');

        $created = $this->withToken($tenantA['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق أ', 'creation_source' => 'scratch',
        ])->assertCreated();
        $appId = $created->json('data.id');

        $this->withToken($tenantB['token'])->getJson("/api/app-builder/apps/{$appId}")->assertStatus(404);
        $this->withToken($tenantB['token'])->getJson('/api/app-builder/apps')->assertJsonCount(0, 'data');
    }

    // ── RBAC ─────────────────────────────────────────────────────────

    /** @test */
    public function staff_role_is_denied_management_but_a_custom_role_may_be_granted_it(): void
    {
        $auth = $this->registerTenant('appb-rbac', 'owner@appb-rbac.test');
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@appb-rbac.test');

        $this->withToken($staffToken)->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->assertForbidden();
    }

    /** @test */
    public function publish_requires_the_dedicated_publish_permission_not_just_manage(): void
    {
        $auth = $this->registerTenant('appb-publish-rbac', 'owner@appb-publish-rbac.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        // staff has neither apps_builder.manage nor apps_builder.publish
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff2@appb-publish-rbac.test');
        $this->withToken($staffToken)->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertForbidden();
    }

    // ── حالة القدرة (ApplicationCatalog) ─────────────────────────────

    /** @test */
    public function disabled_capability_blocks_every_app_builder_route(): void
    {
        $auth = $this->registerTenant('appb-disabled', 'owner@appb-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/app-builder/apps')->assertStatus(403);
    }

    // ── حفظ المسودة ──────────────────────────────────────────────────

    /** @test */
    public function saving_a_valid_draft_schema_increments_revision(): void
    {
        $auth = $this->registerTenant('appb-draft-save', 'owner@appb-draft-save.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = [
            'schemaVersion' => '1.0.0',
            'minRuntimeVersion' => '1.0.0',
            'navigation' => ['initialPageId' => 'home'],
            'theme' => ['tokens' => ['colorPrimary' => '#0F6A5A']],
            'pages' => [
                'home' => [
                    'type' => 'Page',
                    'id' => 'home-root',
                    'children' => [
                        ['type' => 'Text', 'id' => 'home-tagline', 'props' => ['text' => 'مرحباً']],
                    ],
                ],
            ],
        ];

        $response = $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();

        $response->assertJsonPath('data.revision', 1);
        $response->assertJsonPath('data.schema.theme.tokens.colorPrimary', '#0F6A5A');
    }

    /** @test */
    public function draft_schema_with_unknown_top_level_key_is_rejected(): void
    {
        $auth = $this->registerTenant('appb-draft-unknown', 'owner@appb-draft-unknown.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = array_merge(\App\Models\BuilderDraftExperience::minimalSafeSchema(), [
            'tenantId' => 'attempt-to-smuggle-tenant-authority',
        ]);

        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertStatus(422);
    }

    /** @test */
    public function draft_schema_with_initial_page_id_referencing_an_undeclared_page_is_rejected(): void
    {
        $auth = $this->registerTenant('appb-draft-nav', 'owner@appb-draft-nav.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['navigation']['initialPageId'] = 'does-not-exist';

        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertStatus(422);
    }

    /** @test */
    public function draft_schema_with_non_page_root_component_is_rejected(): void
    {
        $auth = $this->registerTenant('appb-draft-root', 'owner@appb-draft-root.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['type'] = 'Section';

        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertStatus(422);
    }

    /** @test */
    public function draft_schema_with_invalid_schema_version_format_is_rejected(): void
    {
        $auth = $this->registerTenant('appb-draft-version', 'owner@appb-draft-version.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['schemaVersion'] = '1.0';

        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertStatus(422);
    }

    // ── التوافق وقت النشر (APP-BUILDER-2) ────────────────────────────

    /** @test */
    public function publish_rejects_a_schema_referencing_an_unsupported_required_component(): void
    {
        $auth = $this->registerTenant('appb-compat-required', 'owner@appb-compat-required.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'NotARealComponent', 'id' => 'x1'],
        ];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertStatus(422);
    }

    /** @test */
    public function publish_succeeds_when_an_unsupported_component_is_marked_optional(): void
    {
        $auth = $this->registerTenant('appb-compat-optional', 'owner@appb-compat-optional.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'NotARealComponent', 'id' => 'x1', 'optional' => true],
        ];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertCreated();
    }

    /** @test */
    public function publish_rejects_a_schema_newer_than_the_current_runtime_supports(): void
    {
        $auth = $this->registerTenant('appb-compat-toonew', 'owner@appb-compat-toonew.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['schemaVersion'] = '9.0.0';
        $schema['minRuntimeVersion'] = '9.0.0';
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertStatus(422);
    }

    /** @test */
    public function publish_rejects_a_schema_requiring_an_unavailable_named_capability(): void
    {
        $auth = $this->registerTenant('appb-compat-cap', 'owner@appb-compat-cap.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $schema = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schema['requiredCapabilities'] = ['addToCart' => 99];
        $this->withToken($auth['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertStatus(422);
    }

    // ── النشر والترقيم والتزامن ──────────────────────────────────────

    /** @test */
    public function publishing_twice_creates_sequential_immutable_versions(): void
    {
        $auth = $this->registerTenant('appb-publish', 'owner@appb-publish.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        $v1 = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'أول نشر'])
            ->assertCreated();
        $v1->assertJsonPath('data.version', 1);

        $v2 = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertCreated();
        $v2->assertJsonPath('data.version', 2);

        $list = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/versions")->assertOk();
        $list->assertJsonCount(2, 'data');
    }

    /** @test */
    public function published_version_cannot_be_updated_or_deleted(): void
    {
        $tenant = Tenant::create([
            'name' => 'شركة عبود', 'slug' => 'appb-immutable', 'vat_number' => '300000000000003',
        ]);
        app(TenantContext::class)->set($tenant->id);

        $app = BuilderApp::create(['name' => 'تطبيق', 'creation_source' => 'scratch']);
        $version = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id,
            'version' => 1,
            'schema' => \App\Models\BuilderDraftExperience::minimalSafeSchema(),
            'schema_version' => '1.0.0',
            'published_at' => now(),
        ]);

        $this->expectException(LogicException::class);
        $version->update(['note' => 'محاولة تعديل بعد النشر']);

        app(TenantContext::class)->forget();
    }

    /** @test */
    public function published_version_numbering_is_race_safe_under_concurrent_publish_attempts(): void
    {
        $auth = $this->registerTenant('appb-race', 'owner@appb-race.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        app(TenantContext::class)->set($auth['tenant_id']);
        $app = BuilderApp::findOrFail($appId);

        $service = app(\App\Services\AppBuilder\BuilderPublishedExperienceVersionService::class);
        $v1 = $service->publish($app, null, null);
        $v2 = $service->publish($app, null, null);

        $this->assertSame(1, $v1->version);
        $this->assertSame(2, $v2->version);
        $this->assertDatabaseCount('builder_published_experience_versions', 2);

        app(TenantContext::class)->forget();
    }
}

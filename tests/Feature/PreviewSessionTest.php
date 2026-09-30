<?php

namespace Tests\Feature;

use App\Models\PreviewSession;
use App\Models\PreviewSessionEvent;
use App\Models\Role;
use App\Models\User;
use App\Support\Rbac;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\PersonalAccessToken;
use Tests\TestCase;

/**
 * MOBILE-PREVIEW-6 — جلسات معاينة App Builder: RBAC، عزل المستأجر/التطبيق،
 * دورة حياة التوكن (إصدار/انتهاء/إبطال)، عزل `preview/v1` عن كل سطح آخر،
 * ولقطة Draft المجمَّدة (لا تتأثر بتعديل لاحق ولا بالنشر).
 *
 * تشغيل: php artisan test --filter=PreviewSessionTest
 */
class PreviewSessionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createApp(string $token): string
    {
        return $this->withToken($token)->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');
    }

    private function saveDraft(string $token, string $appId, array $schema): void
    {
        $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $schema])
            ->assertOk();
    }

    // ── RBAC (القرار الإلزامي: apps_builder.view، لا صلاحية جديدة) ──────

    /** @test */
    public function issuance_requires_apps_builder_view_staff_is_denied(): void
    {
        $auth = $this->registerTenant('mp6-rbac-deny', 'owner@mp6-rbac-deny.test');
        $appId = $this->createApp($auth['token']);

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@mp6-rbac-deny.test');

        $this->withToken($staffToken)->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertForbidden();
    }

    /** @test */
    public function a_custom_role_granted_only_apps_builder_view_may_issue_a_preview_session(): void
    {
        $auth = $this->registerTenant('mp6-rbac-custom', 'owner@mp6-rbac-custom.test');
        $appId = $this->createApp($auth['token']);

        $role = Role::create([
            'tenant_id' => $auth['tenant_id'], 'slug' => 'preview-only', 'name' => 'معاينة فقط',
            'permissions' => ['apps_builder.view'], 'is_system' => false,
        ]);
        $this->assertTrue(Rbac::allows($role->slug, 'apps_builder.view'));
        $this->assertFalse(Rbac::allows($role->slug, 'apps_builder.manage'));

        $user = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'معاينة فقط', 'email' => 'preview-only@mp6-rbac-custom.test',
            'password' => 'password123', 'role' => $role->slug,
        ]);
        $token = $user->createToken('api')->plainTextToken;

        $this->withToken($token)->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertCreated();
    }

    /** @test */
    public function disabled_app_builder_capability_blocks_issuance(): void
    {
        $auth = $this->registerTenant('mp6-cap-disabled', 'owner@mp6-cap-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->assertStatus(403);
    }

    // ── عزل المستأجر/التطبيق ─────────────────────────────────────────

    /** @test */
    public function issuance_for_another_tenants_app_id_is_denied(): void
    {
        $tenantA = $this->registerTenant('mp6-tenant-a', 'owner@mp6-tenant-a.test');
        $tenantB = $this->registerTenant('mp6-tenant-b', 'owner@mp6-tenant-b.test');
        $appId = $this->createApp($tenantA['token']);

        $this->withToken($tenantB['token'])->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertStatus(404);
    }

    /** @test */
    public function a_preview_token_never_fetches_another_tenants_experience(): void
    {
        $tenantA = $this->registerTenant('mp6-fetch-a', 'owner@mp6-fetch-a.test');
        $tenantB = $this->registerTenant('mp6-fetch-b', 'owner@mp6-fetch-b.test');

        $appA = $this->createApp($tenantA['token']);
        $schemaA = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schemaA['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'marker-a', 'props' => ['text' => 'محتوى المستأجر أ']],
        ];
        $this->saveDraft($tenantA['token'], $appA, $schemaA);

        $tokenA = $this->withToken($tenantA['token'])
            ->postJson("/api/app-builder/apps/{$appA}/preview-sessions", [])
            ->assertCreated()->json('token');

        // مستأجر ب لا يملك حتى هذا التطبيق — يتأكد أن الجلب لا يتسرّب مهما
        // كان سياق الطلب (لا معامل مستأجر/تطبيق في preview/v1 أصلاً — E6).
        $response = $this->withToken($tokenA)->getJson('/preview/v1/experience')->assertOk();
        $response->assertJsonPath('data.schema.pages.home.children.0.id', 'marker-a');
    }

    /** @test */
    public function cross_app_retargeting_is_structurally_impossible_each_token_only_ever_sees_its_own_app(): void
    {
        $auth = $this->registerTenant('mp6-cross-app', 'owner@mp6-cross-app.test');
        $appOne = $this->createApp($auth['token']);
        $appTwo = $this->createApp($auth['token']);

        $schemaOne = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schemaOne['pages']['home']['children'] = [['type' => 'Text', 'id' => 'app-one', 'props' => ['text' => 'واحد']]];
        $this->saveDraft($auth['token'], $appOne, $schemaOne);

        $schemaTwo = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $schemaTwo['pages']['home']['children'] = [['type' => 'Text', 'id' => 'app-two', 'props' => ['text' => 'اثنان']]];
        $this->saveDraft($auth['token'], $appTwo, $schemaTwo);

        $tokenOne = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appOne}/preview-sessions", [])->json('token');
        $tokenTwo = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appTwo}/preview-sessions", [])->json('token');

        $this->withToken($tokenOne)->getJson('/preview/v1/experience')
            ->assertJsonPath('data.schema.pages.home.children.0.id', 'app-one');
        $this->withToken($tokenTwo)->getJson('/preview/v1/experience')
            ->assertJsonPath('data.schema.pages.home.children.0.id', 'app-two');
    }

    // ── إصدار: النصّ الخام مرّة واحدة، التجزئة فقط تُخزَّن ─────────────

    /** @test */
    public function issuance_returns_the_raw_bearer_once_and_persists_only_its_hash(): void
    {
        $auth = $this->registerTenant('mp6-raw-once', 'owner@mp6-raw-once.test');
        $appId = $this->createApp($auth['token']);

        $response = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertCreated();

        $raw = $response->json('token');
        $this->assertIsString($raw);
        $this->assertNotEmpty($raw);
        // شكل مطابقة Sanctum القياسي — `id|secret`.
        $this->assertMatchesRegularExpression('/^\d+\|/', $raw);

        $sessionId = $response->json('session.id');
        $this->assertArrayNotHasKey('token', $response->json('session'));

        $tokenRow = PersonalAccessToken::query()
            ->where('tokenable_type', PreviewSession::class)
            ->where('tokenable_id', $sessionId)
            ->firstOrFail();
        $this->assertNotEquals($raw, $tokenRow->token);
        $this->assertSame(64, strlen($tokenRow->token)); // sha256 hex
        $this->assertSame([PreviewSession::ABILITY_READ], $tokenRow->abilities);

        // القائمة (index) لا تحمل التوكن أبداً — وصفية فقط.
        $list = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/preview-sessions")->assertOk();
        $this->assertArrayNotHasKey('token', $list->json('data.0'));
    }

    // ── الانتهاء والإبطال ────────────────────────────────────────────

    /** @test */
    public function an_expired_session_is_rejected_generically(): void
    {
        $auth = $this->registerTenant('mp6-expired', 'owner@mp6-expired.test');
        $appId = $this->createApp($auth['token']);

        $raw = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->json('token');

        app(\App\Tenancy\TenantContext::class)->set($auth['tenant_id']);
        PreviewSession::query()->update(['expires_at' => now()->subMinute()]);
        app(\App\Tenancy\TenantContext::class)->forget();

        $response = $this->withToken($raw)->getJson('/preview/v1/experience');
        $response->assertStatus(401);
        $this->assertSame('unauthenticated', $response->json('error.code'));
    }

    /** @test */
    public function a_revoked_session_is_rejected_identically_to_expired(): void
    {
        $auth = $this->registerTenant('mp6-revoked', 'owner@mp6-revoked.test');
        $appId = $this->createApp($auth['token']);

        $issued = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertCreated();
        $raw = $issued->json('token');
        $sessionId = $issued->json('session.id');

        // إثبات جلب ناجح أولاً — يثبت أن الرفض بعده سببه الإبطال لا خللاً آخر.
        $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();

        $this->withToken($auth['token'])
            ->deleteJson("/api/app-builder/apps/{$appId}/preview-sessions/{$sessionId}")
            ->assertOk();

        $response = $this->withToken($raw)->getJson('/preview/v1/experience');
        $response->assertStatus(401);
        $this->assertSame('unauthenticated', $response->json('error.code'));
    }

    /** @test */
    public function a_malformed_or_unknown_token_is_rejected_before_any_lookup_succeeds(): void
    {
        $this->withToken('not-a-real-token')->getJson('/preview/v1/experience')->assertStatus(401);
        $this->withToken('999999|totally-fake-secret-value')->getJson('/preview/v1/experience')->assertStatus(401);
        $this->getJson('/preview/v1/experience')->assertStatus(401);
    }

    // ── عزل عن كل سطح مصادقة آخر ─────────────────────────────────────

    /** @test */
    public function a_preview_token_cannot_reach_merchant_admin_routes(): void
    {
        $auth = $this->registerTenant('mp6-no-admin', 'owner@mp6-no-admin.test');
        $appId = $this->createApp($auth['token']);
        $raw = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])->json('token');

        // `auth:sanctum` يصادق أي توكن Sanctum صالح بصرف النظر عن نوع tokenable
        // (يجعل `$request->user()` هو الجلسة نفسها)، فيرفضها `EnsureUserPrincipal`
        // فوراً بعدها — 403 لا 401، لأنّ المصادقة نجحت والمرفوض هو **نوع** المصادَق
        // (`instanceof User` فقط)، لا غيابها. نفس ما يحدث لتوكن `ApiClient` أو
        // `CustomerIdentity` يصل هذا المسار حرفياً — سلوكٌ قائم لا يخصّ المعاينة.
        $this->withToken($raw)->getJson('/api/app-builder/apps')->assertStatus(403);
        $this->withToken($raw)->getJson('/api/me')->assertStatus(403);
    }

    /** @test */
    public function a_preview_token_cannot_authenticate_against_commerce_v1(): void
    {
        $auth = $this->registerTenant('mp6-no-commerce', 'owner@mp6-no-commerce.test');
        $appId = $this->createApp($auth['token']);
        $raw = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])->json('token');

        $this->withToken($raw)->getJson('/commerce/v1/experience')->assertStatus(401);
    }

    // ── لقطة Draft: مستقلّة، لا تتأثر بتعديل لاحق ولا تنشر شيئاً ─────

    /** @test */
    public function draft_mutation_after_issuance_never_changes_the_already_issued_snapshot(): void
    {
        $auth = $this->registerTenant('mp6-snapshot', 'owner@mp6-snapshot.test');
        $appId = $this->createApp($auth['token']);

        $v1 = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $v1['pages']['home']['children'] = [['type' => 'Text', 'id' => 'v1', 'props' => ['text' => 'نسخة أولى']]];
        $this->saveDraft($auth['token'], $appId, $v1);

        $raw = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])->json('token');

        $before = $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();
        $before->assertJsonPath('data.schema.pages.home.children.0.id', 'v1');
        $before->assertJsonPath('data.draft_changed', false);

        $v2 = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $v2['pages']['home']['children'] = [['type' => 'Text', 'id' => 'v2', 'props' => ['text' => 'نسخة ثانية']]];
        $this->saveDraft($auth['token'], $appId, $v2);

        $after = $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();
        // اللقطة المجمَّدة لم تتغيّر — نفس محتوى v1 رغم تحديث المسودة الحيّة.
        $after->assertJsonPath('data.schema.pages.home.children.0.id', 'v1');
        // لكن العلَم الاستشاري يعكس الانحراف الحقيقي — دون حجب أو استبدال.
        $after->assertJsonPath('data.draft_changed', true);
    }

    /** @test */
    public function preview_never_publishes_the_draft(): void
    {
        $auth = $this->registerTenant('mp6-no-publish', 'owner@mp6-no-publish.test');
        $appId = $this->createApp($auth['token']);

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertCreated();

        $this->assertDatabaseCount('builder_published_experience_versions', 0);
    }

    /** @test */
    public function preview_schema_is_the_draft_not_a_published_version(): void
    {
        $auth = $this->registerTenant('mp6-draft-vs-published', 'owner@mp6-draft-vs-published.test');
        $appId = $this->createApp($auth['token']);

        $published = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $published['pages']['home']['children'] = [['type' => 'Text', 'id' => 'published-marker', 'props' => ['text' => 'منشور']]];
        $this->saveDraft($auth['token'], $appId, $published);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();

        $draft = \App\Models\BuilderDraftExperience::minimalSafeSchema();
        $draft['pages']['home']['children'] = [['type' => 'Text', 'id' => 'draft-marker', 'props' => ['text' => 'مسودة جديدة']]];
        $this->saveDraft($auth['token'], $appId, $draft);

        $raw = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])->json('token');

        $response = $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();
        $response->assertJsonPath('data.schema.pages.home.children.0.id', 'draft-marker');
        $response->assertJsonPath('data.source', 'draft');
    }

    // ── تدقيق: لا نصّ خام في أي سجلّ ─────────────────────────────────

    /** @test */
    public function raw_credential_never_appears_in_any_audit_row(): void
    {
        $auth = $this->registerTenant('mp6-no-log-leak', 'owner@mp6-no-log-leak.test');
        $appId = $this->createApp($auth['token']);

        $issued = $this->withToken($auth['token'])
            ->postJson("/api/app-builder/apps/{$appId}/preview-sessions", [])
            ->assertCreated();
        $raw = $issued->json('token');
        $sessionId = $issued->json('session.id');

        $this->withToken($raw)->getJson('/preview/v1/experience')->assertOk();
        $this->withToken($auth['token'])
            ->deleteJson("/api/app-builder/apps/{$appId}/preview-sessions/{$sessionId}")
            ->assertOk();

        $events = PreviewSessionEvent::withoutGlobalScopes()->where('preview_session_id', $sessionId)->get();
        $this->assertGreaterThanOrEqual(3, $events->count()); // created, opened, revoked
        foreach ($events as $event) {
            $this->assertStringNotContainsString($raw, (string) $event->reason);
            $this->assertStringNotContainsString($raw, json_encode($event->toArray()));
        }
    }
}

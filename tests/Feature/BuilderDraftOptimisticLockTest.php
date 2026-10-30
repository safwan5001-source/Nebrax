<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\Role;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * AD-01 (S01a) — القفل التفاؤلي لمسودة صانع التطبيقات على الخادم:
 * `base_revision` داخل الجسم (اختياري انتقالياً) · 409 `draft_conflict` عند التعارض بلا أي كتابة ·
 * توافق رجعي لمن لا يرسله · عزل مستأجرين · صلاحيات. التزامن الحقيقي على PostgreSQL في
 * `BuilderDraftOptimisticLockPostgresTest`.
 *
 * تشغيل: php artisan test --filter=BuilderDraftOptimisticLockTest
 */
class BuilderDraftOptimisticLockTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function newApp(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيق', 'creation_source' => 'scratch',
        ])->json('data.id');

        return [$auth, $appId];
    }

    /** @return array<string, mixed> */
    private function schema(string $marker): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'home-text', 'props' => ['text' => $marker]],
        ];

        return $schema;
    }

    private function saveDraft(string $token, string $appId, array $body)
    {
        return $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", $body);
    }

    private function draft(string $token, string $appId): array
    {
        return $this->withToken($token)->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk()->json('data');
    }

    // ── المسار السعيد ────────────────────────────────────────────────

    /** @test */
    public function saving_with_the_current_base_revision_succeeds_and_increments(): void
    {
        [$auth, $appId] = $this->newApp('ad01-ok');

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('أ'), 'base_revision' => 0])
            ->assertOk()->assertJsonPath('data.revision', 1);
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('ب'), 'base_revision' => 1])
            ->assertOk()->assertJsonPath('data.revision', 2);
    }

    // ── التعارض ──────────────────────────────────────────────────────

    /** @test */
    public function a_stale_base_revision_returns_409_with_a_structured_body_and_writes_nothing(): void
    {
        [$auth, $appId] = $this->newApp('ad01-stale');
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('الأولى'), 'base_revision' => 0])->assertOk();

        $response = $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('قديمة'), 'base_revision' => 0]);

        $response->assertStatus(409);
        $response->assertJsonPath('reason', 'draft_conflict');
        $response->assertJsonPath('current_revision', 1);
        $response->assertJsonPath('base_revision', 0);
        $this->assertNotEmpty($response->json('message'));
        $this->assertNotNull($response->json('updated_at'));
        $this->assertNotNull($response->json('updated_by'));

        $draft = $this->draft($auth['token'], $appId);
        $this->assertSame(1, $draft['revision'], 'لا زيادة عند التعارض');
        $this->assertSame('الأولى', $draft['schema']['pages']['home']['children'][0]['props']['text'], 'لا كتابة عند التعارض');
    }

    /** @test */
    public function a_base_revision_ahead_of_the_server_is_also_a_conflict(): void
    {
        [$auth, $appId] = $this->newApp('ad01-ahead');

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('س'), 'base_revision' => 5])
            ->assertStatus(409)->assertJsonPath('current_revision', 0);
        $this->assertSame(0, $this->draft($auth['token'], $appId)['revision']);
    }

    /** @test */
    public function the_client_can_rebase_after_a_conflict_by_rereading_the_current_revision(): void
    {
        [$auth, $appId] = $this->newApp('ad01-rebase');
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('1'), 'base_revision' => 0])->assertOk();
        $conflict = $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('2'), 'base_revision' => 0])->assertStatus(409);

        $current = $this->draft($auth['token'], $appId)['revision'];
        $this->assertSame($conflict->json('current_revision'), $current);

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('3'), 'base_revision' => $current])
            ->assertOk()->assertJsonPath('data.revision', 2);
    }

    /** @test */
    public function a_restore_style_overwrite_with_a_stale_revision_is_rejected_and_published_versions_are_untouched(): void
    {
        [$auth, $appId] = $this->newApp('ad01-restore');
        $versionNo = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", ['note' => 'v1'])
            ->assertCreated()->json('data.version');
        $snapshot = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/versions/{$versionNo}")->assertOk()->json('data.schema');

        // مستخدم آخر يحرّر بعد أن قرأ العميل المسودة عند revision 0
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('أحدث'), 'base_revision' => 0])->assertOk();

        // «استعادة» نسخة v1 بأساس قديم ⇒ مرفوضة
        $this->saveDraft($auth['token'], $appId, ['schema' => $snapshot, 'base_revision' => 0])->assertStatus(409);

        $this->assertSame('أحدث', $this->draft($auth['token'], $appId)['schema']['pages']['home']['children'][0]['props']['text']);
        $this->assertSame($snapshot, $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/versions/{$versionNo}")->json('data.schema'));
    }

    // ── التوافق الرجعي ───────────────────────────────────────────────

    /** @test */
    public function a_save_without_base_revision_still_works_as_before_and_is_counted(): void
    {
        [$auth, $appId] = $this->newApp('ad01-legacy');
        Log::spy();

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('قديم')])
            ->assertOk()->assertJsonPath('data.revision', 1);
        // آخر كتابة تفوز كما كان (لا قفل تفاؤلي بلا base_revision)
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('قديم 2')])
            ->assertOk()->assertJsonPath('data.revision', 2);

        Log::shouldHaveReceived('info')
            ->with('app_builder.draft_save_without_base_revision', \Mockery::on(fn ($ctx) => is_array($ctx)
                && array_key_exists('tenant_id', $ctx) && array_key_exists('builder_app_id', $ctx) && ($ctx['revision'] ?? null) === 1))
            ->once();
    }

    /** @test */
    public function a_null_base_revision_is_treated_as_absent_and_a_versioned_save_is_not_counted_as_legacy(): void
    {
        [$auth, $appId] = $this->newApp('ad01-null');
        Log::spy();

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('n'), 'base_revision' => null])->assertOk();
        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('m'), 'base_revision' => 1])->assertOk();

        Log::shouldHaveReceived('info')->with('app_builder.draft_save_without_base_revision', \Mockery::any())->once();
    }

    /** @test */
    public function the_conflict_body_matches_the_shared_contract_fixture(): void
    {
        $fixture = json_decode(file_get_contents(base_path('contracts/app-builder/draft-save-conflict.v1.json')), true, 512, JSON_THROW_ON_ERROR);
        [$auth, $appId] = $this->newApp('ad01-contract');

        $ok = $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('c'), 'base_revision' => 0])->assertStatus($fixture['success']['status']);
        $this->assertEqualsCanonicalizing($fixture['success']['data_keys'], array_keys($ok->json('data')));

        $conflict = $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('d'), 'base_revision' => 0])->assertStatus($fixture['conflict']['status']);
        $this->assertEqualsCanonicalizing(array_keys($fixture['conflict']['body']), array_keys($conflict->json()));
        $this->assertSame('draft_conflict', $conflict->json('reason'));
        $this->assertIsInt($conflict->json('current_revision'));
        $this->assertIsInt($conflict->json('base_revision'));
    }

    // ── التحقق من المدخلات ───────────────────────────────────────────

    /**
     * @test
     * @dataProvider invalidBaseRevisions
     */
    public function an_invalid_base_revision_is_a_422_and_writes_nothing(mixed $invalid): void
    {
        [$auth, $appId] = $this->newApp('ad01-invalid-'.substr(md5(json_encode($invalid)), 0, 6));

        $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('x'), 'base_revision' => $invalid])->assertStatus(422);
        $this->assertSame(0, $this->draft($auth['token'], $appId)['revision']);
    }

    public static function invalidBaseRevisions(): array
    {
        return [['abc'], [-1], [1.5], [[1]], [true]];
    }

    /** @test */
    public function an_invalid_schema_is_a_422_even_with_a_correct_base_revision_and_does_not_bump_the_revision(): void
    {
        [$auth, $appId] = $this->newApp('ad01-bad-schema');
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['unknownTopLevelKey'] = true;

        $this->saveDraft($auth['token'], $appId, ['schema' => $schema, 'base_revision' => 0])->assertStatus(422);
        $this->assertSame(0, $this->draft($auth['token'], $appId)['revision']);
    }

    // ── عزل المستأجرين والصلاحيات ────────────────────────────────────

    /** @test */
    public function another_tenant_gets_404_and_learns_nothing_about_revisions(): void
    {
        [$authA, $appId] = $this->newApp('ad01-iso-a');
        $authB = $this->registerTenant('ad01-iso-b', 'owner@ad01-iso-b.test');
        $this->saveDraft($authA['token'], $appId, ['schema' => $this->schema('خاص'), 'base_revision' => 0])->assertOk();

        $response = $this->saveDraft($authB['token'], $appId, ['schema' => $this->schema('تسلل'), 'base_revision' => 0]);

        $response->assertStatus(404);
        $this->assertNull($response->json('current_revision'));
        $this->assertNull($response->json('updated_by'));
        $this->assertSame(1, $this->draft($authA['token'], $appId)['revision']);
    }

    /** @test */
    public function the_conflict_updated_by_is_a_user_of_the_same_tenant(): void
    {
        [$auth, $appId] = $this->newApp('ad01-actor');
        $editorToken = $this->tokenForRole($auth['tenant_id'], 'admin', 'admin@ad01-actor.test');
        $editor = User::query()->where('email', 'admin@ad01-actor.test')->firstOrFail();

        $this->saveDraft($editorToken, $appId, ['schema' => $this->schema('محرّر'), 'base_revision' => 0])->assertOk();
        $conflict = $this->saveDraft($auth['token'], $appId, ['schema' => $this->schema('مالك'), 'base_revision' => 0])->assertStatus(409);

        $this->assertSame($editor->id, $conflict->json('updated_by'));
    }

    /** @test */
    public function staff_and_view_only_roles_cannot_save_even_with_a_valid_base_revision(): void
    {
        [$auth, $appId] = $this->newApp('ad01-rbac');

        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@ad01-rbac.test');
        $this->saveDraft($staffToken, $appId, ['schema' => $this->schema('s'), 'base_revision' => 0])->assertForbidden();

        Role::create([
            'tenant_id' => $auth['tenant_id'], 'slug' => 'ad01-view-only', 'name' => 'قراءة فقط',
            'permissions' => ['apps_builder.view'], 'is_system' => false,
        ]);
        $viewer = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'قارئ', 'email' => 'viewer@ad01-rbac.test',
            'password' => 'password123', 'role' => 'ad01-view-only',
        ]);
        $viewerToken = $viewer->createToken('api')->plainTextToken;

        $this->withToken($viewerToken)->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk();
        $this->saveDraft($viewerToken, $appId, ['schema' => $this->schema('v'), 'base_revision' => 0])->assertForbidden();
        $this->assertSame(0, $this->draft($auth['token'], $appId)['revision']);
    }
}

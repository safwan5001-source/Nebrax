<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-12 (S02a) عبر الـAPI: الحفظ يقبل المسودة ويعيد `issues[]` تحذيرياً، ويرفض المعرّف المكرَّر داخل الصفحة وتجاوز
 * السقف (422 بلا كتابة)؛ النشر والفحص يمنعهما أي `error` برمز `contract_violations`؛ المسودة القديمة المخالفة تُحفظ
 * ولا تُنشر حتى تُصلَح؛ العزل والصلاحيات كما هي.
 *
 * تشغيل: php artisan test --filter=BuilderContractEnforcementApiTest
 */
class BuilderContractEnforcementApiTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array{0: array<string, mixed>, 1: string} */
    private function newApp(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        return [$auth, $appId];
    }

    private function schemaWith(array $children): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = $children;

        return $schema;
    }

    private function save(string $token, string $appId, array $schema)
    {
        return $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $schema));
    }

    private function badNavigate(): array
    {
        return [['type' => 'Button', 'id' => 'go', 'props' => ['label' => 'x'], 'action' => ['type' => 'navigate', 'params' => ['pageId' => 'ghost']]]];
    }

    /** @test */
    public function saving_a_contract_violating_draft_succeeds_and_returns_issues_as_non_blocking_warnings(): void
    {
        [$auth, $appId] = $this->newApp('ad12-save');

        $response = $this->save($auth['token'], $appId, $this->schemaWith($this->badNavigate()))->assertOk();
        $response->assertJsonPath('data.revision', 1);
        $issue = collect($response->json('issues'))->firstWhere('code', 'navigate_target_missing');
        $this->assertNotNull($issue);
        $this->assertSame('error', $issue['severity']);
        $this->assertTrue($issue['blocks_publish']);
        $this->assertSame('go', $issue['node_id']);
        $this->assertSame('home', $issue['page_id']);

        $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk()
            ->assertJsonFragment(['code' => 'navigate_target_missing']);
    }

    /** @test */
    public function a_clean_draft_returns_an_empty_issues_list(): void
    {
        [$auth, $appId] = $this->newApp('ad12-clean');

        $this->save($auth['token'], $appId, $this->schemaWith([['type' => 'Text', 'id' => 't', 'props' => ['text' => 'ok']]]))
            ->assertOk()->assertJsonPath('issues', []);
    }

    /** @test */
    public function a_duplicate_id_inside_a_page_is_422_and_writes_nothing(): void
    {
        [$auth, $appId] = $this->newApp('ad12-dup');
        $schema = $this->schemaWith([
            ['type' => 'Text', 'id' => 'same', 'props' => ['text' => 'a']],
            ['type' => 'Text', 'id' => 'same', 'props' => ['text' => 'b']],
        ]);

        $this->save($auth['token'], $appId, $schema)->assertStatus(422);
        $this->assertSame(0, (int) BuilderDraftExperience::withoutGlobalScopes()->where('builder_app_id', $appId)->value('revision'));
    }

    /** @test */
    public function an_oversized_draft_is_422_and_writes_nothing(): void
    {
        [$auth, $appId] = $this->newApp('ad12-size');
        config(['app_builder.max_schema_bytes' => 2000]);

        $this->save($auth['token'], $appId, $this->schemaWith([['type' => 'Text', 'id' => 't', 'props' => ['text' => str_repeat('ا', 4000)]]]))
            ->assertStatus(422);
        $this->assertSame(0, (int) BuilderDraftExperience::withoutGlobalScopes()->where('builder_app_id', $appId)->value('revision'));
    }

    /** @test */
    public function publish_and_validate_are_blocked_by_contract_errors_with_structured_issues_and_create_no_version(): void
    {
        [$auth, $appId] = $this->newApp('ad12-pub');
        $this->save($auth['token'], $appId, $this->schemaWith($this->badNavigate()))->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate")
            ->assertStatus(422)->assertJsonPath('reason', 'contract_violations')
            ->assertJsonPath('issues.0.code', 'navigate_target_missing')
            ->assertJsonPath('issues.0.node_id', 'go');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])
            ->assertStatus(422)->assertJsonPath('reason', 'contract_violations');
        $this->assertSame(0, BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->count());
    }

    /** @test */
    public function a_legacy_violating_draft_can_be_fixed_in_place_and_then_published(): void
    {
        [$auth, $appId] = $this->newApp('ad12-fix');
        $this->save($auth['token'], $appId, $this->schemaWith($this->badNavigate()))->assertOk();
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422);

        $fixed = $this->schemaWith([['type' => 'Button', 'id' => 'go', 'props' => ['label' => 'x'], 'action' => ['type' => 'navigate', 'params' => ['pageId' => 'home']]]]);
        $this->save($auth['token'], $appId, $fixed)->assertOk()->assertJsonPath('issues', []);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function warnings_alone_do_not_block_publishing(): void
    {
        [$auth, $appId] = $this->newApp('ad12-warn');
        $this->save($auth['token'], $appId, $this->schemaWith([['type' => 'Text', 'id' => 't', 'props' => ['text' => 'x', 'mystery' => 1]]]))
            ->assertOk()->assertJsonFragment(['code' => 'unknown_prop']);

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function a_draft_with_an_unsupported_optional_subtree_still_publishes_through_the_compatibility_fallback(): void
    {
        [$auth, $appId] = $this->newApp('ad12-optional');
        $this->save($auth['token'], $appId, $this->schemaWith([
            ['type' => 'FutureLayout', 'id' => 'f', 'optional' => true, 'children' => [['type' => 'Text', 'id' => 'inner', 'props' => ['text' => 'x']]]],
        ]))->assertOk()->assertJsonPath('issues', []);

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function registries_expose_allowed_parents_and_children(): void
    {
        $auth = $this->registerTenant('ad12-reg', 'owner@ad12-reg.test');

        $components = collect($this->withToken($auth['token'])->getJson('/api/app-builder/registries')->assertOk()->json('data.components'))->keyBy('type');
        $this->assertSame([], $components['Page']['allowed_parents']);
        $this->assertNotContains('Page', $components['Section']['allowed_children']);
        $this->assertContains('Section', $components['Text']['allowed_parents']);
        $this->assertSame([], $components['Text']['allowed_children']);
    }

    /** @test */
    public function another_tenant_cannot_read_issues_and_an_unprivileged_role_cannot_save(): void
    {
        [$authA, $appId] = $this->newApp('ad12-iso-a');
        $authB = $this->registerTenant('ad12-iso-b', 'owner@ad12-iso-b.test');
        $this->save($authA['token'], $appId, $this->schemaWith($this->badNavigate()))->assertOk();

        $this->withToken($authB['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertStatus(404)->assertJsonMissingPath('issues');
        $staff = $this->tokenForRole($authA['tenant_id'], 'staff', 'staff@ad12-iso-a.test');
        $this->withToken($staff)->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $this->schemaWith([]), 'base_revision' => 1])->assertForbidden();
    }
}

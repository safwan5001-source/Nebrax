<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\PreviewSession;
use App\Services\AppBuilder\EditorMeta;
use App\Services\AppBuilder\SchemaFormatException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-05 (S20a) — `editor_meta`: اسم القسم/إخفاؤه/preset/عناوين الصفحات مستقلة عن المخطط المنشور.
 * تُحفظ بالقفل التفاؤلي نفسه، تُتحقَّق (الشكل/الأطوال/الحجم/الجذر) وتُنظَّف من العقد المحذوفة، ولا تدخل النسخة المنشورة ولا المعاينة
 * (العقد المخفية تُسقَط منها).
 *
 * تشغيل: php artisan test --filter=BuilderEditorMetaTest
 */
class BuilderEditorMetaTest extends TestCase
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

    private function schema(): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Section', 'id' => 'sec-a', 'props' => ['title' => 'أ'], 'children' => [['type' => 'Text', 'id' => 'txt-a', 'props' => ['text' => 'مرئي']]]],
            ['type' => 'Section', 'id' => 'sec-b', 'props' => ['title' => 'ب'], 'children' => [['type' => 'Text', 'id' => 'txt-b', 'props' => ['text' => 'سأُخفى']]]],
        ];
        $schema['pages']['about'] = ['type' => 'Page', 'id' => 'about-root', 'children' => []];

        return $schema;
    }

    private function save(string $token, string $appId, array $extra = [], ?array $schema = null)
    {
        return $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $schema ?? $this->schema()) + $extra);
    }

    /** @param array<string, array<string, mixed>> $nodes عقد صفحة `home` (الصفحات الأخرى عبر $otherPages: ['about' => [...]]) */
    private function meta(array $nodes = [], array $pages = [], array $otherPages = []): array
    {
        $byPage = array_filter(['home' => $nodes] + $otherPages, fn ($n) => $n !== []);

        return ['v' => 1, 'nodes' => $byPage, 'pages' => $pages];
    }

    /** @test */
    public function meta_is_saved_with_the_schema_under_the_same_revision_and_returned_by_get(): void
    {
        [$auth, $appId] = $this->newApp('ad05-save');
        $meta = $this->meta(['sec-a' => ['name' => 'الترحيب', 'preset' => 'text'], 'sec-b' => ['hidden' => true]], ['about' => ['title' => 'من نحن']]);

        $this->save($auth['token'], $appId, ['editor_meta' => $meta])->assertOk()
            ->assertJsonPath('data.revision', 1)
            ->assertJsonPath('data.editor_meta.nodes.home.sec-a.name', 'الترحيب')
            ->assertJsonPath('data.editor_meta.nodes.home.sec-b.hidden', true)
            ->assertJsonPath('data.editor_meta.pages.about.title', 'من نحن');

        $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk()
            ->assertJsonPath('data.editor_meta.nodes.home.sec-a.preset', 'text');
    }

    /** @test */
    public function an_absent_editor_meta_leaves_it_unchanged_and_null_clears_it(): void
    {
        [$auth, $appId] = $this->newApp('ad05-absent');
        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['sec-a' => ['name' => 'س']])])->assertOk();

        $this->save($auth['token'], $appId)->assertOk()->assertJsonPath('data.editor_meta.nodes.home.sec-a.name', 'س');
        $this->save($auth['token'], $appId, ['editor_meta' => null])->assertOk()->assertJsonPath('data.editor_meta', null);
    }

    /** @test */
    public function hidden_nodes_never_reach_the_published_version_or_the_preview_but_stay_in_the_draft(): void
    {
        [$auth, $appId] = $this->newApp('ad05-publish');
        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['sec-b' => ['hidden' => true, 'name' => 'سر داخلي']])])->assertOk();

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();

        $version = BuilderPublishedExperienceVersion::withoutGlobalScopes()->where('builder_app_id', $appId)->firstOrFail();
        $ids = array_map(fn ($c) => $c['id'], $version->schema['pages']['home']['children']);
        $this->assertSame(['sec-a'], $ids);
        $this->assertStringNotContainsString('سأُخفى', json_encode($version->schema, JSON_UNESCAPED_UNICODE));
        $this->assertStringNotContainsString('سر داخلي', json_encode($version->schema, JSON_UNESCAPED_UNICODE), 'اسم القسم لا يغادر المسودة');
        $this->assertArrayNotHasKey('editor_meta', $version->schema);

        $draft = BuilderDraftExperience::withoutGlobalScopes()->where('builder_app_id', $appId)->firstOrFail();
        $this->assertCount(2, $draft->schema['pages']['home']['children'], 'المسودة تحتفظ بالقسم المخفي');

        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/preview-sessions", ['channel' => 'browser'])->assertCreated();
        $snapshot = PreviewSession::withoutGlobalScopes()->where('builder_app_id', $appId)->firstOrFail()->schema_snapshot;
        $this->assertSame(['sec-a'], array_map(fn ($c) => $c['id'], $snapshot['pages']['home']['children']));
    }

    /** @test */
    public function a_hidden_invalid_node_does_not_block_publishing_and_its_issues_are_not_reported(): void
    {
        [$auth, $appId] = $this->newApp('ad05-hidden-invalid');
        $schema = $this->schema();
        $schema['pages']['home']['children'][] = ['type' => 'Button', 'id' => 'bad', 'props' => ['label' => 'x'], 'action' => ['type' => 'navigate', 'params' => ['pageId' => 'ghost']]];

        $this->save($auth['token'], $appId, [], $schema)->assertOk()->assertJsonFragment(['code' => 'navigate_target_missing']);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $schema) + ['editor_meta' => $this->meta(['bad' => ['hidden' => true]])])
            ->assertOk()->assertJsonPath('issues', []);
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function stale_entries_are_pruned_when_a_node_disappears_from_the_schema(): void
    {
        [$auth, $appId] = $this->newApp('ad05-prune');
        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['sec-a' => ['name' => 'أ'], 'sec-b' => ['name' => 'ب']])])->assertOk();

        $smaller = $this->schema();
        array_pop($smaller['pages']['home']['children']); // حُذف sec-b
        $response = $this->save($auth['token'], $appId, [], $smaller)->assertOk();

        $this->assertSame(['sec-a'], array_keys($response->json('data.editor_meta.nodes.home')));
    }

    /** @test */
    public function an_unknown_node_in_the_submitted_meta_is_dropped_not_stored(): void
    {
        [$auth, $appId] = $this->newApp('ad05-unknown-node');

        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['ghost' => ['name' => 'x']])])->assertOk()
            ->assertJsonPath('data.editor_meta', null);
    }

    /**
     * @test
     *
     * @dataProvider invalidMetas
     */
    public function invalid_meta_is_422_and_writes_nothing(array $meta): void
    {
        [$auth, $appId] = $this->newApp('ad05-invalid-'.md5(json_encode($meta)));

        $this->save($auth['token'], $appId, ['editor_meta' => $meta])->assertStatus(422);
        $this->assertSame(0, (int) BuilderDraftExperience::withoutGlobalScopes()->where('builder_app_id', $appId)->value('revision'));
    }

    public static function invalidMetas(): array
    {
        $long = str_repeat('ا', 81);

        return [
            'unknown top key' => [['v' => 1, 'mystery' => 1]],
            'wrong version' => [['v' => 2, 'nodes' => []]],
            'flat (unscoped) node entry' => [['v' => 1, 'nodes' => ['sec-a' => ['name' => 'x']]]],
            'unknown node key' => [['v' => 1, 'nodes' => ['home' => ['sec-a' => ['color' => 'red']]]]],
            'name not a string' => [['v' => 1, 'nodes' => ['home' => ['sec-a' => ['name' => 5]]]]],
            'name too long' => [['v' => 1, 'nodes' => ['home' => ['sec-a' => ['name' => $long]]]]],
            'hidden not bool' => [['v' => 1, 'nodes' => ['home' => ['sec-a' => ['hidden' => 'yes']]]]],
            'bad preset' => [['v' => 1, 'nodes' => ['home' => ['sec-a' => ['preset' => 'bad preset!']]]]],
            'page title too long' => [['v' => 1, 'pages' => ['home' => ['title' => $long]]]],
            'hiding a page root' => [['v' => 1, 'nodes' => ['home' => ['home-root' => ['hidden' => true]]]]],
        ];
    }

    /** @test */
    public function an_oversized_meta_is_422_and_the_cap_is_configurable(): void
    {
        [$auth, $appId] = $this->newApp('ad05-size');
        config(['app_builder.max_editor_meta_bytes' => 100]);

        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['sec-a' => ['name' => str_repeat('ا', 70)], 'sec-b' => ['name' => str_repeat('ب', 70)]])])->assertStatus(422);
    }

    /** @test */
    public function a_conflicting_save_with_meta_writes_neither_schema_nor_meta(): void
    {
        [$auth, $appId] = $this->newApp('ad05-conflict');
        $this->save($auth['token'], $appId, ['editor_meta' => $this->meta(['sec-a' => ['name' => 'قديم']])])->assertOk();

        $this->withToken($auth['token'])->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $this->schema(), 'base_revision' => 0, 'editor_meta' => $this->meta(['sec-a' => ['name' => 'جديد']])])
            ->assertStatus(409);

        $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertJsonPath('data.editor_meta.nodes.home.sec-a.name', 'قديم');
    }

    /** @test */
    public function another_tenant_cannot_read_meta_and_an_unprivileged_role_cannot_write_it(): void
    {
        [$authA, $appId] = $this->newApp('ad05-iso-a');
        $authB = $this->registerTenant('ad05-iso-b', 'owner@ad05-iso-b.test');
        $this->save($authA['token'], $appId, ['editor_meta' => $this->meta(['sec-a' => ['name' => 'خاص']])])->assertOk();

        $this->withToken($authB['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertStatus(404)->assertJsonMissingPath('data.editor_meta');
        $staff = $this->tokenForRole($authA['tenant_id'], 'staff', 'staff@ad05-iso-a.test');
        $this->withToken($staff)->putJson("/api/app-builder/apps/{$appId}/draft", ['schema' => $this->schema(), 'base_revision' => 1, 'editor_meta' => $this->meta(['sec-a' => ['name' => 'اختراق']])])->assertForbidden();
    }

    /** @test */
    public function hiding_a_node_on_one_page_never_hides_a_same_id_node_on_another_page(): void
    {
        // فرادة component.id داخل الصفحة وحدها (تكرارها عبر صفحات تحذير فقط) — مفتاح الإخفاء (الصفحة، العقدة).
        $schema = $this->schema();
        $schema['pages']['home']['children'][] = ['type' => 'Section', 'id' => 'shared', 'props' => ['title' => 'في home'], 'children' => []];
        $schema['pages']['about']['children'] = [['type' => 'Section', 'id' => 'shared', 'props' => ['title' => 'في about'], 'children' => []]];

        $projected = (new EditorMeta())->project($schema, $this->meta([], [], ['about' => ['shared' => ['hidden' => true]]]));
        $this->assertSame([], $projected['pages']['about']['children'], 'المخفي في about');
        $this->assertContains('shared', array_map(fn ($c) => $c['id'], $projected['pages']['home']['children']), 'النظير في home يبقى');

        $projected = (new EditorMeta())->project($schema, $this->meta(['shared' => ['hidden' => true]]));
        $this->assertNotSame([], $projected['pages']['about']['children'], 'إخفاء home لا يمسّ about');
        $this->assertNotContains('shared', array_map(fn ($c) => $c['id'], $projected['pages']['home']['children']));
    }

    /** @test */
    public function entries_are_kept_per_page_and_an_entry_under_the_wrong_page_is_pruned(): void
    {
        [$auth, $appId] = $this->newApp('ad05-scope');
        $schema = $this->schema();
        $schema['pages']['about']['children'] = [['type' => 'Section', 'id' => 'about-sec', 'props' => ['title' => 'ع'], 'children' => []]];

        // sec-a ينتمي إلى home لا about؛ about-sec ينتمي إلى about.
        $meta = $this->meta(['sec-a' => ['name' => 'صحيح']], [], ['about' => ['sec-a' => ['name' => 'خاطئ'], 'about-sec' => ['hidden' => true]], 'ghost' => ['x' => ['name' => 'y']]]);
        $response = $this->save($auth['token'], $appId, ['editor_meta' => $meta], $schema)->assertOk();

        $this->assertSame(['home', 'about'], array_keys($response->json('data.editor_meta.nodes')));
        $this->assertSame(['about-sec'], array_keys($response->json('data.editor_meta.nodes.about')));
        $this->assertTrue($response->json('data.editor_meta.nodes.about.about-sec.hidden'));
    }

    /** @test */
    public function numeric_component_and_page_ids_are_valid_keys_even_though_php_reads_them_as_a_list(): void
    {
        // JSON {"0": {...}} يُفكّ في PHP إلى [0 => ...] فتبدو قائمة؛ معرّف المكوّن "0" صالح في المخطط (مراجعة Codex P2).
        [$auth, $appId] = $this->newApp('ad05-numeric');
        $schema = $this->schema();
        $schema['pages']['home']['children'][] = ['type' => 'Section', 'id' => '0', 'props' => ['title' => 'صفري'], 'children' => []];
        $schema['pages']['7'] = ['type' => 'Page', 'id' => '7-root', 'children' => [['type' => 'Section', 'id' => '1', 'props' => ['title' => 'سبعة'], 'children' => []]]];

        $meta = ['v' => 1, 'nodes' => ['home' => ['0' => ['hidden' => true, 'name' => 'مخفي']], '7' => ['1' => ['name' => 'مسمّى']]], 'pages' => ['7' => ['title' => 'صفحة سبعة']]];
        $response = $this->save($auth['token'], $appId, ['editor_meta' => $meta], $schema)->assertOk();

        // الاستجابة تحفظ المفاتيح الرقمية كما هي (JsonResource كان يعيد فهرستها ⇒ «7» تصير «0»).
        $body = json_decode($response->getContent(), false);
        $this->assertTrue($body->data->editor_meta->nodes->home->{'0'}->hidden);
        $this->assertSame('مسمّى', $body->data->editor_meta->nodes->{'7'}->{'1'}->name);
        $this->assertSame('صفحة سبعة', $body->data->editor_meta->pages->{'7'}->title);
        $this->assertSame(['home', 'about', '7'], array_map('strval', array_keys((array) $body->data->schema->pages)), 'معرّفات الصفحات تبقى كما هي');

        $projected = (new EditorMeta())->project($schema, json_decode(json_encode($meta), true));
        $this->assertNotContains('0', array_map(fn ($c) => (string) $c['id'], $projected['pages']['home']['children']));
        $this->assertCount(1, $projected['pages']['7']['children'], 'إخفاء "0" في home لا يمسّ "1" في الصفحة 7');
    }

    /** @test */
    public function a_list_shaped_map_is_read_as_an_id_keyed_map_never_stored_as_garbage(): void
    {
        [$auth, $appId] = $this->newApp('ad05-list');

        // [ [...] ] ≡ {"0": [...]}: معرّف صفحة «0» غير موجود ⇒ يُنظَّف ولا يُخزَّن شيء.
        $this->save($auth['token'], $appId, ['editor_meta' => ['v' => 1, 'nodes' => [['sec-a' => ['name' => 'x']]]]])->assertOk()
            ->assertJsonPath('data.editor_meta', null);
        // وإدخال عقدة ليس كائناً (نصّ) ⇒ 422 كما كان.
        $this->save($auth['token'], $appId, ['editor_meta' => ['v' => 1, 'nodes' => [['name' => 'x']]]])->assertStatus(422);
    }

    /** @test */
    public function the_projection_is_pure_and_handles_nested_and_absent_meta(): void
    {
        $meta = new EditorMeta();
        $schema = $this->schema();
        $schema['pages']['home']['children'][0]['children'][] = ['type' => 'Text', 'id' => 'deep', 'props' => ['text' => 'x']];

        $same = $meta->project($schema, null);
        $this->assertSame($schema, $same);
        $projected = $meta->project($schema, ['v' => 1, 'nodes' => ['home' => ['deep' => ['hidden' => true], 'sec-b' => ['hidden' => true]]]]);
        $this->assertSame(['txt-a'], array_map(fn ($c) => $c['id'], $projected['pages']['home']['children'][0]['children']));
        $this->assertCount(1, $projected['pages']['home']['children']);
        $this->assertCount(2, $schema['pages']['home']['children'], 'المدخل لا يُحوَّر');
    }

    /** @test */
    public function normalize_throws_a_coded_exception(): void
    {
        try {
            (new EditorMeta())->normalize(['v' => 1, 'nodes' => ['home' => ['home-root' => ['hidden' => true]]]], $this->schema());
            $this->fail('كان يجب رفض إخفاء الجذر.');
        } catch (SchemaFormatException $e) {
            $this->assertSame('editor_meta_hidden_root', $e->errorCode);
        }
    }
}

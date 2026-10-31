<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaVersion;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * DRF-03 / CMP-10 (S03b) — تقرير توافق **استشاري** لكل جيل Runtime معروف: يُعاد مع `GET/PUT draft` و`validate` و`versions`،
 * **ولا يمنع الحفظ أبداً**. الغاية: لا يُسقَط شيء **بصمت** — كل مكوّن اختياري (`optional`) سيُحذف على جيل ما يظهر بمعرّفه ونوعه
 * قبل النشر، ويُعلَن أول جيل يعرض كل شيء (`full_runtime`).
 *
 * تشغيل: php artisan test --filter=BuilderCompatReportTest
 */
class BuilderCompatReportTest extends TestCase
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

    /** قسم اختياري مربوط بمورد (`commerce.categories`) لا يفعّله الجيل 1.0.0. */
    private function schemaWithOptionalCategories(bool $optional = true, string $id = 'cat-strip'): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $section = ['type' => 'Section', 'id' => $id, 'props' => ['title' => 'التصنيفات'], 'children' => [
            ['type' => 'ProductList', 'id' => $id.'-list', 'binding' => ['resource' => 'commerce.categories'], 'children' => []],
        ]];
        if ($optional) {
            $section['optional'] = true;
        }
        $schema['pages']['home']['children'] = [['type' => 'Text', 'id' => 'intro', 'props' => ['text' => 'متجري']], $section];

        return $schema;
    }

    private function save(string $token, string $appId, array $schema, array $extra = [])
    {
        return $this->withToken($token)->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $schema) + $extra);
    }

    /** جيلان: 1.0.0 بلا مكوّن `Image` و1.1.0 يعرفه — فارق يعتمد على قدرات الجيل لا على سجل المكوّنات. */
    private function generationsWhereImageIsNew(): void
    {
        $base = CapabilityManifest::current();
        $older = new CapabilityManifest(
            runtimeVersion: new SchemaVersion(1, 0, 0),
            minSupportedSchemaVersion: $base->minSupportedSchemaVersion,
            maxSupportedSchemaVersion: $base->maxSupportedSchemaVersion,
            components: array_diff_key($base->components, ['Image' => 1]),
            actions: $base->actions,
            nativeCapabilities: $base->nativeCapabilities,
            dataResources: $base->dataResources,
            schemaFeatures: $base->schemaFeatures,
        );
        $newer = new CapabilityManifest(
            runtimeVersion: new SchemaVersion(1, 1, 0),
            minSupportedSchemaVersion: $base->minSupportedSchemaVersion,
            maxSupportedSchemaVersion: new SchemaVersion(1, 1, 0),
            components: $base->components,
            actions: $base->actions,
            nativeCapabilities: $base->nativeCapabilities,
            dataResources: $base->dataResources,
            schemaFeatures: $base->schemaFeatures,
        );
        $this->app->instance(RuntimeGenerations::class, new RuntimeGenerations([$older, $newer]));
    }

    private function schemaWithOptionalImage(): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [
            ['type' => 'Text', 'id' => 'intro', 'props' => ['text' => 'متجري']],
            ['type' => 'Image', 'id' => 'pic', 'optional' => true, 'props' => ['url' => 'https://example.com/a.png']],
        ];

        return $schema;
    }

    /** @test */
    public function a_fully_supported_draft_reports_every_generation_compatible_with_nothing_dropped(): void
    {
        [$auth, $appId] = $this->newApp('compat-clean');

        $compat = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk()->json('compat');

        $this->assertSame('1.0.0', $compat['min_runtime']);
        $this->assertSame('1.0.0', $compat['full_runtime']);
        $this->assertFalse($compat['has_drops']);
        $this->assertSame([['runtime' => '1.0.0', 'compatible' => true, 'reason' => null, 'dropped' => []]], $compat['generations']);
    }

    /** @test */
    public function an_optional_component_dropped_by_a_generation_is_disclosed_by_id_and_type_never_silent(): void
    {
        [$auth, $appId] = $this->newApp('compat-drop');

        $compat = $this->save($auth['token'], $appId, $this->schemaWithOptionalCategories())->assertOk()->json('compat');

        $this->assertTrue($compat['has_drops']);
        $this->assertTrue($compat['generations'][0]['compatible']);
        $this->assertSame([['component_id' => 'cat-strip', 'component_type' => 'Section', 'page_id' => 'home']], $compat['generations'][0]['dropped']);
        $this->assertSame('1.0.0', $compat['min_runtime']);
        $this->assertNull($compat['full_runtime'], 'لا جيل معروف يعرض كل شيء بعد');
    }

    /** @test */
    public function a_dropped_entry_carries_its_page_so_a_same_id_component_on_another_page_is_never_confused_with_it(): void
    {
        // فرادة component.id داخل الصفحة وحدها: «shared» في home مدعوم، و«shared» في about اختياري يُحذف (مراجعة Codex P2).
        [$auth, $appId] = $this->newApp('compat-page');
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [['type' => 'Section', 'id' => 'shared', 'props' => ['title' => 'مدعوم'], 'children' => []]];
        $schema['pages']['about'] = ['type' => 'Page', 'id' => 'about-root', 'children' => [
            ['type' => 'Section', 'id' => 'shared', 'optional' => true, 'props' => ['title' => 'محذوف'], 'children' => [
                ['type' => 'ProductList', 'id' => 'shared-list', 'binding' => ['resource' => 'commerce.categories'], 'children' => []],
            ]],
        ]];

        $compat = $this->save($auth['token'], $appId, $schema)->assertOk()->json('compat');

        $this->assertSame([['component_id' => 'shared', 'component_type' => 'Section', 'page_id' => 'about']], $compat['generations'][0]['dropped']);
    }

    /** @test */
    public function with_several_generations_each_reports_its_own_drops_and_the_first_full_runtime_is_named(): void
    {
        $this->generationsWhereImageIsNew();
        [$auth, $appId] = $this->newApp('compat-multi');

        $compat = $this->save($auth['token'], $appId, $this->schemaWithOptionalImage())->assertOk()->json('compat');

        $this->assertSame(['1.0.0', '1.1.0'], array_column($compat['generations'], 'runtime'));
        $this->assertSame([['component_id' => 'pic', 'component_type' => 'Image', 'page_id' => 'home']], $compat['generations'][0]['dropped']);
        $this->assertSame([], $compat['generations'][1]['dropped']);
        $this->assertSame('1.0.0', $compat['min_runtime']);
        $this->assertSame('1.1.0', $compat['full_runtime']);
    }

    /** @test */
    public function a_required_unsupported_component_is_incompatible_everywhere_yet_saving_is_never_blocked(): void
    {
        [$auth, $appId] = $this->newApp('compat-required');

        $response = $this->save($auth['token'], $appId, $this->schemaWithOptionalCategories(optional: false))->assertOk();
        $compat = $response->json('compat');

        $this->assertFalse($compat['generations'][0]['compatible']);
        $this->assertSame('missingRequiredCapability', $compat['generations'][0]['reason']);
        $this->assertNull($compat['min_runtime']);
        $this->assertNull($compat['full_runtime']);

        // الحفظ نجح (استشاري)، والنشر يُرفض كما كان.
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertStatus(422);
    }

    /** @test */
    public function a_hidden_section_is_not_reported_because_it_is_not_published(): void
    {
        [$auth, $appId] = $this->newApp('compat-hidden');
        $meta = ['v' => 1, 'nodes' => ['home' => ['cat-strip' => ['hidden' => true]]], 'pages' => []];

        $compat = $this->save($auth['token'], $appId, $this->schemaWithOptionalCategories(), ['editor_meta' => $meta])->assertOk()->json('compat');

        $this->assertFalse($compat['has_drops']);
        $this->assertSame([], $compat['generations'][0]['dropped']);
    }

    /** @test */
    public function validate_and_publish_carry_the_same_disclosure(): void
    {
        [$auth, $appId] = $this->newApp('compat-publish');
        $this->save($auth['token'], $appId, $this->schemaWithOptionalCategories())->assertOk();

        $validate = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/validate", [])->assertOk();
        $this->assertTrue($validate->json('compat.has_drops'));
        $this->assertSame('cat-strip', $validate->json('compat.generations.0.dropped.0.component_id'));

        $publish = $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
        $this->assertTrue($publish->json('compat.has_drops'));
        $this->assertSame('cat-strip', $publish->json('compat.generations.0.dropped.0.component_id'));
    }

    /** @test */
    public function the_report_never_leaks_across_tenants_and_a_missing_app_is_404(): void
    {
        [$authA, $appId] = $this->newApp('compat-iso-a');
        $authB = $this->registerTenant('compat-iso-b', 'owner@compat-iso-b.test');

        $this->withToken($authB['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertStatus(404)->assertJsonMissingPath('compat');
        $this->assertNotNull($this->withToken($authA['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->json('compat'));
    }
}

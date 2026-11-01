<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Services\AppBuilder\AppSchemaContractChecker;
use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\AppTemplateRegistry;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\RuntimeGenerations;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-11 / S22a — سجل قوالب برمجي موحّد (لا محرك قوالب موازٍ) + بوابة CI: كل قالب يمرّ على المحلل والفاحصة والمحلل التوافقي،
 * و`GET app-builder/templates` يقدّمه، و`POST apps` بـ`template_key` ينسخه إلى المسودة بلا ارتباط حي.
 */
class AppTemplateRegistryTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function registry(): AppTemplateRegistry
    {
        return app(AppTemplateRegistry::class);
    }

    /** @test */
    public function the_registry_ships_at_least_three_well_formed_templates(): void
    {
        $templates = $this->registry()->all();
        $this->assertGreaterThanOrEqual(3, count($templates));

        $keys = array_map(fn ($t) => $t['key'], $templates);
        $this->assertSame($keys, array_values(array_unique($keys)), 'مفاتيح القوالب فريدة');
        foreach ($templates as $t) {
            $this->assertMatchesRegularExpression('/^[a-z][a-z0-9-]{1,40}$/', $t['key']);
            $this->assertIsInt($t['version']);
            $this->assertNotSame('', trim($t['name']['ar']));
            $this->assertNotSame('', trim($t['name']['en']));
            $this->assertNotSame('', trim($t['description']['ar']));
            $this->assertNotSame('', trim($t['description']['en']));
            $this->assertContains($t['vertical'], AppTemplateRegistry::VERTICALS);
        }
    }

    /** @test */
    public function every_template_parses_has_no_blocking_contract_issue_and_renders_on_a_known_generation_without_dropping_anything(): void
    {
        $parser = app(AppSchemaParser::class);
        $checker = app(AppSchemaContractChecker::class);
        $resolver = app(CompatibilityResolver::class);
        $generations = app(RuntimeGenerations::class);

        foreach ($this->registry()->all() as $t) {
            $schema = $t['schema'];
            $parser->validate($schema);
            $checker->assertHardLimits($schema);
            $this->assertSame([], AppSchemaContractChecker::blocking($checker->check($schema)), "{$t['key']}: مشكلات عقد حاجبة");

            $lowest = $generations->lowestRendering($schema, $resolver);
            $this->assertNotNull($lowest, "{$t['key']}: لا جيل يعرضه");
            $result = $resolver->resolve($schema, $lowest);
            $this->assertTrue($result->compatible, "{$t['key']}: غير متوافق");
            $this->assertSame([], $result->fallbacks, "{$t['key']}: يُسقِط عقداً اختيارية");

            // قوالب اليوم لا تتطلب غلاف 1.1.0 (تعمل على الأجهزة الحالية).
            $this->assertSame('1.0.0', (string) $lowest->runtimeVersion, "{$t['key']}: يتطلب جيلاً أحدث من 1.0.0");
        }
    }

    /** @test */
    public function a_template_is_a_copy_not_a_reference(): void
    {
        $a = $this->registry()->find('catalog');
        $a['schema']['pages']['home']['children'] = [];
        $b = $this->registry()->find('catalog');
        $this->assertNotEmpty($b['schema']['pages']['home']['children']);
        $this->assertNull($this->registry()->find('does-not-exist'));
    }

    /** @test */
    public function listing_returns_metadata_without_schemas_and_requires_a_session(): void
    {
        $this->getJson('/api/app-builder/templates')->assertStatus(401);

        $auth = $this->registerTenant('tpl-list', 'owner@tpl-list.test');
        $res = $this->withToken($auth['token'])->getJson('/api/app-builder/templates')->assertOk();
        $data = $res->json('data');
        $this->assertGreaterThanOrEqual(3, count($data));
        foreach ($data as $row) {
            $this->assertArrayNotHasKey('schema', $row);
            $this->assertSame(['key', 'version', 'vertical', 'name', 'description', 'min_runtime'], array_keys($row));
            $this->assertSame('1.0.0', $row['min_runtime']);
        }
        $this->assertContains('blank', array_column($data, 'key'));
    }

    /** @test */
    public function creating_an_app_from_a_template_copies_its_schema_into_the_draft(): void
    {
        $auth = $this->registerTenant('tpl-create', 'owner@tpl-create.test');
        $res = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', [
            'name' => 'تطبيقي', 'creation_source' => 'template', 'template_key' => 'catalog',
        ])->assertCreated();
        $appId = $res->json('data.id');

        $draft = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk();
        $expected = $this->registry()->find('catalog')['schema'];
        $this->assertEquals($expected['pages']['home']['id'], $draft->json('data.schema.pages.home.id'));
        $this->assertEquals(count($expected['pages']), count($draft->json('data.schema.pages')));
        $this->assertSame(0, $draft->json('data.revision'));
    }

    /** @test */
    public function an_unknown_template_or_a_template_key_with_another_source_is_rejected_and_creates_nothing(): void
    {
        $auth = $this->registerTenant('tpl-bad', 'owner@tpl-bad.test');
        $before = $this->withToken($auth['token'])->getJson('/api/app-builder/apps')->json('data');

        $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'x', 'creation_source' => 'template', 'template_key' => 'nope'])->assertStatus(422);
        $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'x', 'creation_source' => 'scratch', 'template_key' => 'catalog'])->assertStatus(422);

        $after = $this->withToken($auth['token'])->getJson('/api/app-builder/apps')->json('data');
        $this->assertCount(count($before), $after);
    }

    /** @test */
    public function the_template_source_without_a_key_keeps_the_old_minimal_draft(): void
    {
        $auth = $this->registerTenant('tpl-legacy', 'owner@tpl-legacy.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'قديم', 'creation_source' => 'template'])->assertCreated()->json('data.id');
        $draft = $this->withToken($auth['token'])->getJson("/api/app-builder/apps/{$appId}/draft")->assertOk()->json('data.schema');
        $this->assertEquals(BuilderDraftExperience::minimalSafeSchema()['pages']['home']['id'], $draft['pages']['home']['id']);
    }

    /** @test */
    public function a_template_built_app_publishes_and_never_links_back_to_the_template(): void
    {
        $auth = $this->registerTenant('tpl-pub', 'owner@tpl-pub.test');
        $appId = $this->withToken($auth['token'])->postJson('/api/app-builder/apps', ['name' => 'ناشر', 'creation_source' => 'template', 'template_key' => 'promo'])->assertCreated()->json('data.id');
        $this->withToken($auth['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
    }

    /** @test */
    public function shop_templates_cart_page_binds_real_line_items_with_quantity_and_removal(): void
    {
        // مراجعة Codex: صفحة سلة بملخص فقط تُخفي بنود السلة عن المتسوّق؛ قوالب المتجر تربط `commerce.cart` بقالب بند فيه الكمية والحذف.
        foreach (['catalog', 'promo'] as $key) {
            $cart = $this->registry()->find($key)['schema']['pages']['cart'];
            $list = collect($cart['children'])->firstWhere('type', 'CartList');
            $this->assertNotNull($list, "{$key}: CartList");
            $this->assertSame(['resource' => 'commerce.cart', 'collect' => 'items'], array_intersect_key($list['binding'], ['resource' => 1, 'collect' => 1]), "{$key}: ربط السلة");

            $flat = [];
            $walk = function (array $n) use (&$walk, &$flat): void {
                $flat[] = $n;
                foreach ($n['children'] ?? [] as $c) {
                    $walk($c);
                }
            };
            $walk($list);
            $actions = array_values(array_filter(array_map(fn ($n) => $n['action']['type'] ?? null, $flat)));
            $this->assertContains('updateCartQuantity', $actions, "{$key}: تعديل الكمية");
            $this->assertContains('removeCartItem', $actions, "{$key}: حذف البند");
            // الملخص خارج البنود المكرَّرة (لا يتكرر مع كل بند).
            $this->assertNotNull(collect($cart['children'])->firstWhere('type', 'CartSummary'), "{$key}: الملخص خارج القائمة");
        }
    }

    /** @test */
    public function shop_templates_mirror_the_bundled_runtime_page_for_localized_names_and_variant_descriptors(): void
    {
        // مراجعة Codex: العنوان من `display_name` (يختار اللغة في الجهاز) وبند السلة يعرض `variant_descriptor` كما في الصفحة المضمَّنة.
        foreach (['catalog', 'promo'] as $key) {
            $json = json_encode($this->registry()->find($key)['schema']);
            $this->assertStringNotContainsString('$item.name', $json, "{$key}: العنوان يجب أن يستعمل display_name");
            $this->assertStringContainsString('$item.display_name', $json, "{$key}: display_name");
            $this->assertStringContainsString('$item.variant_descriptor', $json, "{$key}: variant_descriptor");
        }
    }
}

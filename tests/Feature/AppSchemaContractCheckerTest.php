<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Services\AppBuilder\AppSchemaContractChecker;
use App\Services\AppBuilder\ComponentRegistry;
use App\Services\AppBuilder\ContractIssue;
use App\Services\AppBuilder\SchemaFormatException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-12 (S02a) — فاحصة العقد: حدود صارمة عند الحفظ (فرادة المعرّف داخل الصفحة + سقف البايتات) وفحص عقد
 * يُنتج `issues[]` (`error` تمنع النشر، `warning` لا). دالة نقية: لا مستأجر ولا قاعدة بيانات.
 *
 * تشغيل: php artisan test --filter=AppSchemaContractCheckerTest
 */
class AppSchemaContractCheckerTest extends TestCase
{
    use RefreshDatabase;

    private AppSchemaContractChecker $checker;

    protected function setUp(): void
    {
        parent::setUp();
        $this->checker = new AppSchemaContractChecker();
    }

    /** @param  list<array<string, mixed>>  $children */
    private function schema(array $children, array $extraPages = []): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = $children;
        foreach ($extraPages as $id => $root) {
            $schema['pages'][$id] = $root;
        }

        return $schema;
    }

    /** @return list<string> */
    private function codes(array $schema, ?string $severity = null): array
    {
        return array_values(array_map(
            fn (ContractIssue $i) => $i->code,
            array_filter($this->checker->check($schema), fn (ContractIssue $i) => $severity === null || $i->severity === $severity),
        ));
    }

    /** @test */
    public function the_minimal_safe_schema_and_a_valid_tree_have_no_issues(): void
    {
        $this->assertSame([], $this->checker->check(BuilderDraftExperience::minimalSafeSchema()));
        $schema = $this->schema([
            ['type' => 'Section', 'id' => 's', 'props' => ['title' => 'قسم'], 'children' => [
                ['type' => 'Text', 'id' => 't', 'props' => ['text' => 'مرحبا', 'style' => 'title']],
                ['type' => 'Button', 'id' => 'b', 'props' => ['label' => 'اذهب', 'style' => 'primary'], 'action' => ['type' => 'navigate', 'params' => ['pageId' => 'home']]],
            ]],
        ]);
        $this->assertSame([], $this->checker->check($schema));
    }

    /** @test */
    public function a_duplicate_id_inside_one_page_is_a_hard_error(): void
    {
        $schema = $this->schema([
            ['type' => 'Text', 'id' => 'dup', 'props' => ['text' => 'أ']],
            ['type' => 'Section', 'id' => 's', 'children' => [['type' => 'Text', 'id' => 'dup', 'props' => ['text' => 'ب']]]],
        ]);

        try {
            $this->checker->assertHardLimits($schema);
            $this->fail('كان يجب أن يُرفض المعرّف المكرَّر.');
        } catch (SchemaFormatException $e) {
            $this->assertSame('duplicate_id', $e->errorCode);
            $this->assertStringContainsString('dup', $e->getMessage());
        }
    }

    /** @test */
    public function the_same_id_on_two_different_pages_is_only_a_warning(): void
    {
        $about = ['type' => 'Page', 'id' => 'about-root', 'children' => [['type' => 'Text', 'id' => 'shared', 'props' => ['text' => 'ص']]]];
        $schema = $this->schema([['type' => 'Text', 'id' => 'shared', 'props' => ['text' => 'ح']]], ['about' => $about]);

        $this->checker->assertHardLimits($schema);
        $this->assertSame(['duplicate_id_across_pages'], $this->codes($schema));
        $this->assertSame([], $this->codes($schema, ContractIssue::ERROR));
    }

    /** @test */
    public function an_oversized_schema_is_a_hard_error_and_the_cap_is_configurable(): void
    {
        $big = $this->schema([['type' => 'Text', 'id' => 't', 'props' => ['text' => str_repeat('ا', 2000)]]]);
        config(['app_builder.max_schema_bytes' => 1000]);

        try {
            $this->checker->assertHardLimits($big);
            $this->fail('كان يجب أن يُرفض الحجم الزائد.');
        } catch (SchemaFormatException $e) {
            $this->assertSame('schema_too_large', $e->errorCode);
        }

        config(['app_builder.max_schema_bytes' => 1_000_000]);
        $this->checker->assertHardLimits($big);
        $this->addToAssertionCount(1);
    }

    /** @test */
    public function an_unsupported_optional_subtree_is_not_checked_so_its_compatibility_fallback_still_publishes(): void
    {
        $schema = $this->schema([
            ['type' => 'FutureLayout', 'id' => 'f', 'optional' => true, 'children' => [['type' => 'Text', 'id' => 'inner', 'props' => ['text' => 'x']]]],
            ['type' => 'Button', 'id' => 'b', 'optional' => true, 'props' => ['label' => 'x', 'style' => 'wild'], 'action' => ['type' => 'futureAction', 'params' => []]],
        ]);

        $this->assertSame([], $this->checker->check($schema));
    }

    /** @test */
    public function a_page_nested_inside_a_section_is_a_blocking_error(): void
    {
        $schema = $this->schema([['type' => 'Section', 'id' => 's', 'children' => [['type' => 'Page', 'id' => 'p2']]]]);

        $this->assertSame(['page_not_root'], $this->codes($schema, ContractIssue::ERROR));
    }

    /** @test */
    public function children_under_a_leaf_component_are_a_blocking_error(): void
    {
        $schema = $this->schema([['type' => 'Text', 'id' => 't', 'props' => ['text' => 'x'], 'children' => [['type' => 'Text', 'id' => 'u', 'props' => ['text' => 'y']]]]]);

        $this->assertContains('children_not_allowed', $this->codes($schema, ContractIssue::ERROR));
    }

    /** @test */
    public function registry_exposes_consistent_allowed_parents_and_children(): void
    {
        $this->assertSame([], ComponentRegistry::allowedParentTypes('Page'), 'الصفحة جذر فقط');
        $this->assertSame([], ComponentRegistry::allowedChildTypes('Text'));
        $this->assertNotContains('Page', ComponentRegistry::allowedChildTypes('Section'));
        $this->assertContains('Text', ComponentRegistry::allowedChildTypes('Section'));
        foreach (array_keys(ComponentRegistry::definitions()) as $type) {
            foreach (ComponentRegistry::allowedChildTypes($type) as $child) {
                $this->assertContains($type, ComponentRegistry::allowedParentTypes($child), "{$type} ⇒ {$child} متناظر");
            }
        }
    }

    /** @test */
    public function a_wrong_typed_or_out_of_enum_prop_blocks_publish_while_unknown_and_missing_only_warn(): void
    {
        $schema = $this->schema([
            ['type' => 'Text', 'id' => 'a', 'props' => ['text' => 123]],
            ['type' => 'Text', 'id' => 'b', 'props' => ['text' => 'x', 'style' => 'giant']],
            ['type' => 'Text', 'id' => 'c', 'props' => ['text' => 'x', 'mystery' => true]],
            ['type' => 'Image', 'id' => 'd', 'props' => []],
            ['type' => 'Price', 'id' => 'e', 'props' => ['amountMinor' => 12.5]],
        ]);

        $this->assertSame(['prop_type_mismatch', 'prop_enum_invalid', 'prop_type_mismatch'], $this->codes($schema, ContractIssue::ERROR));
        $warnings = $this->codes($schema, ContractIssue::WARNING);
        $this->assertContains('unknown_prop', $warnings);
        $this->assertContains('missing_required_prop', $warnings);
    }

    /** @test */
    public function binding_references_and_bound_props_are_not_flagged(): void
    {
        $schema = $this->schema([[
            'type' => 'ProductList', 'id' => 'pl', 'binding' => ['resource' => 'products', 'itemProps' => ['title' => 'name']],
            'children' => [[
                'type' => 'ProductCard', 'id' => 'pc', 'props' => ['amountMinor' => '$item.price'],
                'action' => ['type' => 'openProduct', 'params' => ['productId' => '$item.id']],
            ]],
        ]]);

        $this->assertSame([], $this->codes($schema, ContractIssue::ERROR));
    }

    /** @test */
    public function a_navigate_target_that_does_not_exist_blocks_publish(): void
    {
        $schema = $this->schema([
            ['type' => 'Button', 'id' => 'b', 'props' => ['label' => 'x'], 'action' => ['type' => 'navigate', 'params' => ['pageId' => 'ghost']]],
        ]);

        $this->assertSame(['navigate_target_missing'], $this->codes($schema, ContractIssue::ERROR));
    }

    /** @test */
    public function action_params_are_checked_for_presence_type_and_minimum(): void
    {
        $schema = $this->schema([
            ['type' => 'Button', 'id' => 'a', 'props' => ['label' => 'x'], 'action' => ['type' => 'addToCart', 'params' => []]],
            ['type' => 'Button', 'id' => 'b', 'props' => ['label' => 'x'], 'action' => ['type' => 'addToCart', 'params' => ['productId' => 'p1', 'quantity' => 0]]],
            ['type' => 'Button', 'id' => 'c', 'props' => ['label' => 'x'], 'action' => ['type' => 'updateCartQuantity', 'params' => ['cartItemId' => 'ci', 'quantity' => 0]]],
            ['type' => 'Button', 'id' => 'd', 'props' => ['label' => 'x'], 'action' => ['type' => 'refresh', 'params' => ['stray' => 1]]],
        ]);

        $this->assertSame(['missing_action_param', 'action_param_invalid'], $this->codes($schema, ContractIssue::ERROR), 'quantity=0 مسموح لـupdateCartQuantity فقط');
        $this->assertContains('unknown_action_param', $this->codes($schema, ContractIssue::WARNING));
    }

    /** @test */
    public function an_action_on_a_non_actionable_component_is_a_warning(): void
    {
        $schema = $this->schema([['type' => 'Text', 'id' => 't', 'props' => ['text' => 'x'], 'action' => ['type' => 'refresh', 'params' => []]]]);

        $this->assertSame([], $this->codes($schema, ContractIssue::ERROR));
        $this->assertContains('action_not_supported', $this->codes($schema, ContractIssue::WARNING));
    }

    /** @test */
    public function issues_never_echo_schema_content(): void
    {
        $secret = 'سر-التاجر-الحساس';
        $schema = $this->schema([['type' => 'Text', 'id' => 'a', 'props' => ['text' => 5, 'style' => $secret]]]);

        $json = json_encode(array_map(fn ($i) => $i->toArray(), $this->checker->check($schema)), JSON_UNESCAPED_UNICODE);
        $this->assertStringNotContainsString($secret, (string) $json);
    }

    /** @test */
    public function every_issue_code_the_checker_can_emit_is_listed_in_the_shared_contract_fixture(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('contracts/app-builder/contract-issues.v1.json')), true);
        $listed = array_merge($fixture['codes']['error'], $fixture['codes']['warning']);
        $source = (string) file_get_contents(app_path('Services/AppBuilder/AppSchemaContractChecker.php'));
        preg_match_all("/new ContractIssue\\(\\s*'([a-z_]+)'/", $source, $m);

        $this->assertNotEmpty($m[1]);
        foreach (array_unique($m[1]) as $code) {
            $this->assertContains($code, $listed, "الرمز {$code} غير موثَّق في العقد المشترك");
        }
        foreach ($listed as $code) {
            $this->assertContains($code, $m[1], "الرمز {$code} في العقد ولا تُصدره الفاحصة");
        }
    }

    /** @test */
    public function the_server_registries_match_the_shared_identifier_fixture_so_a_new_component_cannot_skip_the_contract(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('contracts/app-builder/registry-identifiers.v1.json')), true);

        $components = $fixture['components'];
        $actions = $fixture['actions'];
        sort($components);
        sort($actions);
        $serverComponents = array_keys(ComponentRegistry::definitions());
        $serverActions = array_keys(\App\Services\AppBuilder\ActionRegistry::definitions());
        sort($serverComponents);
        sort($serverActions);

        $this->assertSame($components, $serverComponents, 'أضف المكوّن إلى fixture العقد المشترك (Dart + الويب + الخادم) في الـPR نفسه');
        $this->assertSame($actions, $serverActions);
    }
}

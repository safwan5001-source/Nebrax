<?php

namespace Tests\Feature;

use App\Models\BuilderDraftExperience;
use App\Services\AppBuilder\AppSchemaContractChecker;
use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\CompatibilityResult;
use App\Services\AppBuilder\ContractIssue;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaFormatException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * AD-04 / S09a — عقد الغلاف: `navigation.tabs[]` و`navigation.appBar`. مفتاحان جديدان على مستوى `navigation`
 * ⇒ جيل Runtime 1.1.0 (AD-02): الجيل 1.0.0 يراهما غير مدعومَين (فشل مغلق، لا إسقاط صامت للتبويبات).
 */
class AppSchemaNavigationShellTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, mixed> */
    private function schema(array $navigation = [], array $extraPages = ['shop', 'about']): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        foreach ($extraPages as $id) {
            $schema['pages'][$id] = ['type' => 'Page', 'id' => $id.'-root', 'children' => []];
        }
        $schema['navigation'] = array_merge(['initialPageId' => 'home'], $navigation);

        return $schema;
    }

    private function tab(string $pageId, string $title = 'عنوان', string $icon = 'home', ?bool $hidden = null): array
    {
        return array_filter(['pageId' => $pageId, 'title' => $title, 'icon' => $icon, 'hidden' => $hidden], fn ($v) => $v !== null);
    }

    private function parse(array $schema): void
    {
        app(AppSchemaParser::class)->validate($schema);
    }

    private function parseFails(array $schema): string
    {
        try {
            $this->parse($schema);
        } catch (SchemaFormatException $e) {
            return $e->getMessage();
        }
        $this->fail('الاعتماد المتوقع أن يُرفض المخطط.');
    }

    // ── parser ────────────────────────────────────────────────────────────

    /** @test */
    public function a_valid_shell_parses(): void
    {
        $this->parse($this->schema([
            'tabs' => [$this->tab('home', 'الرئيسية', 'home'), $this->tab('shop', 'المتجر', 'store'), $this->tab('about', 'عنّا', 'menu', true)],
            'appBar' => ['title' => 'متجري', 'showCart' => true],
        ]));
        $this->addToAssertionCount(1);
    }

    /** @test */
    public function schemas_without_the_shell_keys_are_unchanged(): void
    {
        $this->parse($this->schema());
        $this->addToAssertionCount(1);
    }

    /** @test */
    public function structural_violations_are_rejected(): void
    {
        $bad = [
            'tabs not a list' => ['tabs' => ['a' => $this->tab('home')]],
            'empty tabs' => ['tabs' => []],
            'unknown tab key' => ['tabs' => [array_merge($this->tab('home'), ['evil' => 1])]],
            'missing title' => ['tabs' => [['pageId' => 'home', 'icon' => 'home']]],
            'empty title' => ['tabs' => [$this->tab('home', '')]],
            'long title' => ['tabs' => [$this->tab('home', str_repeat('ا', 25))]],
            'unknown icon' => ['tabs' => [$this->tab('home', 'x', 'rocket')]],
            'hidden not bool' => ['tabs' => [array_merge($this->tab('home'), ['hidden' => 'yes'])]],
            'page not declared' => ['tabs' => [$this->tab('ghost')]],
            'duplicate page' => ['tabs' => [$this->tab('home'), $this->tab('home', 'تكرار')]],
            'sixth visible' => ['tabs' => array_map(fn ($p) => $this->tab($p, 'ت'.$p), ['home', 'shop', 'about', 'p4', 'p5', 'p6'])],
            'appBar not object' => ['appBar' => 'x'],
            'appBar unknown key' => ['appBar' => ['title' => 'a', 'evil' => true]],
            'appBar long title' => ['appBar' => ['title' => str_repeat('a', 41)]],
            'appBar showCart not bool' => ['appBar' => ['showCart' => 'yes']],
        ];
        foreach ($bad as $label => $nav) {
            try {
                $this->parse($this->schema($nav, ['shop', 'about', 'p4', 'p5', 'p6']));
                $this->fail("لم يُرفض: {$label}");
            } catch (SchemaFormatException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    /** @test */
    public function hidden_tabs_do_not_count_toward_the_visible_limit(): void
    {
        $tabs = [];
        foreach (['home', 'shop', 'about', 'p4', 'p5'] as $p) {
            $tabs[] = $this->tab($p, 'ت'.$p);
        }
        $tabs[] = $this->tab('p6', 'مخفي', 'menu', true);
        $this->parse($this->schema(['tabs' => $tabs], ['shop', 'about', 'p4', 'p5', 'p6']));
        $this->addToAssertionCount(1);
    }

    /** @test */
    public function the_shared_fixture_agrees_with_the_parser_and_the_php_constants(): void
    {
        $fixture = json_decode(file_get_contents(base_path('contracts/app-builder/navigation-shell.v1.json')), true);

        $this->assertSame(\App\Services\AppBuilder\NavigationShell::TAB_ICONS, $fixture['limits']['icons']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::MAX_TABS, $fixture['limits']['max_tabs']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::MAX_VISIBLE_TABS, $fixture['limits']['max_visible_tabs']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::MAX_TAB_TITLE, $fixture['limits']['max_tab_title']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::MAX_APP_BAR_TITLE, $fixture['limits']['max_app_bar_title']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::FEATURE_TABS, $fixture['features']['tabs']);
        $this->assertSame(\App\Services\AppBuilder\NavigationShell::FEATURE_APP_BAR, $fixture['features']['appBar']);

        foreach ($fixture['cases'] as $case) {
            $schema = $this->schema($case['navigation'], array_values(array_diff($fixture['pages'], ['home'])));
            try {
                $this->parse($schema);
                $this->assertTrue($case['valid'], "قُبل ما كان يجب رفضه: {$case['name']}");
                // رحلة الخادم→الجهاز: فك JSON إلى مصفوفات PHP ثم ترميزه لا يغيّر الشكل (كائن فارغ `{}` يصير `[]` ويكسر Dart).
                $served = json_decode(json_encode(json_decode(json_encode($case['navigation']), true)), true);
                $this->assertSame(
                    json_encode($case['navigation'], JSON_UNESCAPED_UNICODE),
                    json_encode($served, JSON_UNESCAPED_UNICODE),
                    "رحلة الخادم تغيّر شكل حالة صالحة: {$case['name']}",
                );
            } catch (SchemaFormatException) {
                $this->assertFalse($case['valid'], "رُفض ما كان يجب قبوله: {$case['name']}");
            }
        }
    }

    /** @test */
    public function generation_1_1_0_declares_exactly_what_the_shipped_dart_build_declares(): void
    {
        $fixture = json_decode(file_get_contents(base_path('contracts/app-builder/navigation-shell.v1.json')), true)['generation_1_1_0'];
        $manifest = CapabilityManifest::v110();

        $this->assertSame($fixture['runtime'], (string) $manifest->runtimeVersion);
        $features = $manifest->schemaFeatures;
        ksort($features);
        $expected = $fixture['schemaFeatures'];
        ksort($expected);
        $this->assertSame($expected, $features);
        $resources = $manifest->dataResources;
        ksort($resources);
        $expectedResources = $fixture['dataResources'];
        ksort($expectedResources);
        $this->assertSame($expectedResources, $resources);
    }

    // ── مولّد العقد (checker) ─────────────────────────────────────────────

    /** @test */
    public function the_contract_checker_flags_tab_problems_before_publish(): void
    {
        $checker = new AppSchemaContractChecker;
        $codes = fn (array $schema) => array_map(fn (ContractIssue $i) => $i->code, $checker->check($schema));

        $this->assertSame([], $codes($this->schema(['tabs' => [$this->tab('home'), $this->tab('shop', 'م', 'store')]])));
        $this->assertContains('tab_page_missing', $codes($this->schema(['tabs' => [$this->tab('ghost')]])));
        $this->assertContains('tab_duplicate_page', $codes($this->schema(['tabs' => [$this->tab('home'), $this->tab('home', 'x')]])));
        $this->assertContains('tabs_too_many_visible', $codes($this->schema(
            ['tabs' => array_map(fn ($p) => $this->tab($p, 'ت'.$p), ['home', 'shop', 'about', 'p4', 'p5', 'p6'])],
            ['shop', 'about', 'p4', 'p5', 'p6'],
        )));
        foreach ($checker->check($this->schema(['tabs' => [$this->tab('ghost')]])) as $issue) {
            $this->assertSame(ContractIssue::ERROR, $issue->severity);
        }
    }

    // ── الجيل والتوافق ────────────────────────────────────────────────────

    /** @test */
    public function generation_1_0_0_cannot_render_the_shell_but_1_1_0_can(): void
    {
        $schema = $this->schema(['tabs' => [$this->tab('home')], 'appBar' => ['title' => 'متجري']]);
        $generations = RuntimeGenerations::current();
        $resolver = new CompatibilityResolver;

        $old = $generations->forRuntime('1.0.0');
        $this->assertSame('1.0.0', (string) $old->runtimeVersion);
        $oldResult = $resolver->resolve($schema, $old);
        $this->assertInstanceOf(CompatibilityResult::class, $oldResult);
        $this->assertFalse($oldResult->compatible);
        $this->assertSame(CompatibilityResult::REASON_MISSING_REQUIRED_CAPABILITY, $oldResult->reason);

        $new = $generations->forRuntime('1.1.0');
        $this->assertSame('1.1.0', (string) $new->runtimeVersion);
        $this->assertTrue($resolver->resolve($schema, $new)->compatible);

        $this->assertSame('1.1.0', (string) $generations->lowestRendering($schema, $resolver)?->runtimeVersion);
    }

    /** @test */
    public function a_schema_without_the_shell_still_renders_on_1_0_0_and_the_lowest_generation_is_1_0_0(): void
    {
        $schema = $this->schema();
        $generations = RuntimeGenerations::current();
        $resolver = new CompatibilityResolver;

        $this->assertTrue($resolver->resolve($schema, $generations->oldest())->compatible);
        $this->assertSame('1.0.0', (string) $generations->lowestRendering($schema, $resolver)?->runtimeVersion);
    }

    /** @test */
    public function each_shell_key_is_gated_by_its_own_feature(): void
    {
        $resolver = new CompatibilityResolver;
        $only = fn (array $features) => new CapabilityManifest(
            runtimeVersion: \App\Services\AppBuilder\SchemaVersion::tryParse('1.1.0'),
            minSupportedSchemaVersion: \App\Services\AppBuilder\SchemaVersion::tryParse('1.0.0'),
            maxSupportedSchemaVersion: \App\Services\AppBuilder\SchemaVersion::tryParse('1.0.0'),
            components: \App\Services\AppBuilder\RuntimeCapabilities::COMPONENTS,
            actions: \App\Services\AppBuilder\RuntimeCapabilities::ACTIONS,
            schemaFeatures: $features,
        );

        $tabsOnly = $this->schema(['tabs' => [$this->tab('home')]]);
        $barOnly = $this->schema(['appBar' => ['title' => 'x']]);

        $this->assertFalse($resolver->resolve($tabsOnly, $only(['navigation.appBar' => 1]))->compatible);
        $this->assertTrue($resolver->resolve($tabsOnly, $only(['navigation.tabs' => 1]))->compatible);
        $this->assertFalse($resolver->resolve($barOnly, $only(['navigation.tabs' => 1]))->compatible);
        $this->assertTrue($resolver->resolve($barOnly, $only(['navigation.appBar' => 1]))->compatible);
    }
}

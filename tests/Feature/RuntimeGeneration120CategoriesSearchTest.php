<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Services\AppBuilder\AppSchemaContractChecker;
use App\Services\AppBuilder\AppSchemaParser;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\CompatibilityResolver;
use App\Services\AppBuilder\ContractIssue;
use App\Services\AppBuilder\RuntimeCapabilities;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AD-02 / S11a — الجيل 1.2.0 (التصنيفات والبحث): `CategoryList` + مورد `commerce.categories` + `openCategory` + `openSearch`.
 * الخادم يعلنه قبل Flutter (S11b): كل ما يستعمله يُخدَم فقط لجهاز يعلن هذا الجيل، ولا يُسقَط شيء صامتاً عن جيل أقدم.
 *
 * تشغيل: php artisan test --filter=RuntimeGeneration120CategoriesSearchTest
 */
class RuntimeGeneration120CategoriesSearchTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array<string, mixed> */
    private function categoriesSchema(bool $optional = false): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $list = [
            'type' => 'CategoryList', 'id' => 'cats', 'props' => ['layout' => 'grid', 'columns' => 3],
            'binding' => ['resource' => 'commerce.categories', 'itemProps' => ['label' => 'name']],
            'children' => [[
                'type' => 'Button', 'id' => 'cat-btn', 'props' => ['label' => '$item.name'],
                'action' => ['type' => 'openCategory', 'params' => ['categoryId' => '$item.id']],
            ]],
        ];
        if ($optional) {
            $list['optional'] = true;
        }
        $schema['pages']['home']['children'] = [$list];

        return $schema;
    }

    /** @return array<string, mixed> */
    private function searchSchema(): array
    {
        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['pages']['home']['children'] = [[
            'type' => 'Button', 'id' => 'search-btn', 'props' => ['label' => 'بحث'], 'action' => ['type' => 'openSearch'],
        ]];

        return $schema;
    }

    private function generation(string $runtime): CapabilityManifest
    {
        return match ($runtime) {
            '1.0.0' => CapabilityManifest::current(),
            '1.1.0' => CapabilityManifest::v110(),
            '1.2.0' => CapabilityManifest::v120(),
        };
    }

    /** @test */
    public function the_new_generation_adds_only_the_s11_capabilities_and_older_generations_are_untouched(): void
    {
        $v120 = CapabilityManifest::v120();

        $this->assertSame('1.2.0', (string) $v120->runtimeVersion);
        $this->assertSame(1, $v120->componentVersion('CategoryList'));
        $this->assertSame(1, $v120->actionVersion('openCategory'));
        $this->assertSame(1, $v120->actionVersion('openSearch'));
        $this->assertSame(1, $v120->resourceVersion('commerce.categories'));
        // كل ما في 1.1.0 باقٍ (تراكمي) بما فيه ميزتا الغلاف.
        foreach ([CapabilityManifest::v110()->components, CapabilityManifest::v110()->actions, CapabilityManifest::v110()->dataResources, CapabilityManifest::v110()->schemaFeatures] as $i => $set) {
            $own = [$v120->components, $v120->actions, $v120->dataResources, $v120->schemaFeatures][$i];
            foreach ($set as $key => $version) {
                $this->assertSame($version, $own[$key] ?? null, "1.2.0 فقد {$key}");
            }
        }
        // الجيلان المجمَّدان لا يعرفان شيئاً منها.
        foreach (['1.0.0', '1.1.0'] as $older) {
            $m = $this->generation($older);
            $this->assertNull($m->componentVersion('CategoryList'), $older);
            $this->assertNull($m->actionVersion('openCategory'), $older);
            $this->assertNull($m->actionVersion('openSearch'), $older);
            $this->assertNull($m->resourceVersion('commerce.categories'), $older);
        }
        $this->assertArrayNotHasKey('CategoryList', RuntimeCapabilities::COMPONENTS);
    }

    /** @test */
    public function a_categories_schema_parses_and_renders_only_on_the_new_generation(): void
    {
        $schema = $this->categoriesSchema();
        app(AppSchemaParser::class)->validate($schema);
        $resolver = app(CompatibilityResolver::class);

        $this->assertTrue($resolver->resolve($schema, $this->generation('1.2.0'))->compatible);
        $this->assertFalse($resolver->resolve($schema, $this->generation('1.1.0'))->compatible, 'لا إسقاط صامت: جيل أقدم يرفض');
        $this->assertFalse($resolver->resolve($schema, $this->generation('1.0.0'))->compatible);
    }

    /** @test */
    public function the_open_search_action_needs_the_new_generation_too(): void
    {
        $schema = $this->searchSchema();
        $resolver = app(CompatibilityResolver::class);

        $this->assertTrue($resolver->resolve($schema, $this->generation('1.2.0'))->compatible);
        $this->assertFalse($resolver->resolve($schema, $this->generation('1.1.0'))->compatible);
    }

    /** @test */
    public function an_optional_category_list_is_dropped_and_disclosed_on_older_generations_never_silently(): void
    {
        $resolver = app(CompatibilityResolver::class);
        $schema = $this->categoriesSchema(optional: true);

        $this->assertSame([], $resolver->resolve($schema, $this->generation('1.2.0'))->fallbacks);
        foreach (['1.0.0', '1.1.0'] as $older) {
            $result = $resolver->resolve($schema, $this->generation($older));
            $this->assertTrue($result->compatible, $older);
            $this->assertSame(['cats'], array_map(fn ($f) => $f['componentId'], $result->fallbacks), $older);
        }
    }

    /** @test */
    public function the_contract_checker_validates_the_new_action_and_component(): void
    {
        $checker = app(AppSchemaContractChecker::class);

        $this->assertSame([], AppSchemaContractChecker::blocking($checker->check($this->categoriesSchema())));
        $this->assertSame([], AppSchemaContractChecker::blocking($checker->check($this->searchSchema())));

        $missing = $this->categoriesSchema();
        $missing['pages']['home']['children'][0]['children'][0]['action'] = ['type' => 'openCategory', 'params' => []];
        $codes = array_map(fn (ContractIssue $i) => $i->code, AppSchemaContractChecker::blocking($checker->check($missing)));
        $this->assertContains('missing_action_param', $codes);

        $badLayout = $this->categoriesSchema();
        $badLayout['pages']['home']['children'][0]['props']['layout'] = 'carousel';
        $codes = array_map(fn (ContractIssue $i) => $i->code, AppSchemaContractChecker::blocking($checker->check($badLayout)));
        $this->assertContains('prop_enum_invalid', $codes);
    }

    // ── النشر والتقديم بحسب الجيل ───────────────────────────────────

    /** @return array{tenant: Tenant, token: string, auth: array<string, mixed>} */
    private function store(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $tenant = Tenant::findOrFail($auth['tenant_id']);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();
        $service = app(ApiClientKeyService::class);

        return ['tenant' => $tenant, 'auth' => $auth, 'token' => $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', [])->plainTextToken];
    }

    /** @test */
    public function publishing_a_categories_experience_is_accepted_and_served_only_to_devices_on_the_new_generation(): void
    {
        $s = $this->store('g120-serve');
        $appId = $this->withToken($s['auth']['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        // نسخة قديمة بسيطة (تعرضها كل الأجيال) ثم نسخة التصنيفات (1.2.0 فقط).
        $this->withToken($s['auth']['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();
        $this->travel(5)->seconds(); // تمييز زمن النشر (دقة الثانية) فلا يعتمد الترتيب على تعادل
        $this->withToken($s['auth']['token'])->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $this->categoriesSchema()))->assertOk();
        $this->withToken($s['auth']['token'])->postJson("/api/app-builder/apps/{$appId}/versions", [])->assertCreated();

        $fetch = fn (?string $runtime) => $this->getJson('/commerce/v1/experience', ['Authorization' => 'Bearer '.$s['token']] + ($runtime ? ['X-Runtime-Version' => $runtime] : []));

        $fetch('1.2.0')->assertOk()->assertJsonPath('data.version', 2)->assertJsonPath('data.schema.pages.home.children.0.type', 'CategoryList');
        // الأجهزة الأقدم (وبلا ترويسة) تأخذ النسخة الأقدم التي تعرضها، لا نسخة لا تفهمها.
        $fetch('1.1.0')->assertOk()->assertJsonPath('data.version', 1);
        $fetch('1.0.0')->assertOk()->assertJsonPath('data.version', 1);
        $fetch(null)->assertOk()->assertJsonPath('data.version', 1);
    }

    /** @test */
    public function the_draft_compat_report_names_the_new_generation_as_the_minimum_for_categories(): void
    {
        $s = $this->store('g120-report');
        $appId = $this->withToken($s['auth']['token'])->postJson('/api/app-builder/apps', ['name' => 'تطبيق', 'creation_source' => 'scratch'])->json('data.id');

        $compat = $this->withToken($s['auth']['token'])
            ->putJson("/api/app-builder/apps/{$appId}/draft", $this->builderDraftBody($appId, $this->categoriesSchema()))
            ->assertOk()->json('compat');

        $this->assertSame('1.2.0', $compat['min_runtime']);
        $byRuntime = collect($compat['generations'])->keyBy('runtime');
        $this->assertFalse($byRuntime['1.0.0']['compatible']);
        $this->assertFalse($byRuntime['1.1.0']['compatible']);
        $this->assertTrue($byRuntime['1.2.0']['compatible']);
    }
}

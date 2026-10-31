<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderDraftExperience;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\AppBuilder\CapabilityManifest;
use App\Services\AppBuilder\RuntimeGenerations;
use App\Services\AppBuilder\SchemaVersion;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AD-02 (S05b) — أجيال Runtime: `GET commerce/v1/experience` يخدم **أعلى نسخة منشورة متوافقة** مع جيل الجهاز
 * (`X-Runtime-Version`)، لا «الأحدث نشراً» أيّاً كان. الجهاز بلا ترويسة أو بترويسة تالفة يُعامَل كأقدم جيل معروف (1.0.0).
 *
 * الأجيال الإضافية تُحقن بسجلّ اختباري (الإنتاج اليوم جيل واحد 1.0.0)، والنسخ تحمل `minRuntimeVersion` مختلفاً
 * لأنه الفارق الذي يقرؤه المحلل دون الحاجة إلى مكوّن جديد.
 *
 * تشغيل: php artisan test --filter=CommerceExperienceRuntimeGenerationTest
 */
class CommerceExperienceRuntimeGenerationTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array{tenant: Tenant, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        SalesChannel::create(['slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true]);
        app(TenantContext::class)->forget();

        $service = app(ApiClientKeyService::class);
        $key = $service->issueKey($service->createClient($tenant, 'mobile-app', true), 'default', []);

        return ['tenant' => $tenant, 'token' => $key->plainTextToken];
    }

    /** يحقن سجل أجيال: 1.0.0 (الحالي) و1.1.0 (يقبل مخططات `minRuntimeVersion` حتى 1.1.0). */
    private function twoGenerations(): void
    {
        $base = CapabilityManifest::current();
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
        $this->app->instance(RuntimeGenerations::class, new RuntimeGenerations([$newer, $base])); // الترتيب لا يهم: السجل يرتّب
    }

    /** نسخة منشورة صالحة (تمرّ المحلل) بـ`minRuntimeVersion` معيّن وعلامة في رمز ثيم للتمييز. */
    private function publish(Tenant $tenant, string $marker, string $minRuntime, string $publishedAt, string $schemaVersion = '1.0.0'): BuilderPublishedExperienceVersion
    {
        app(TenantContext::class)->set($tenant->id);
        $app = BuilderApp::create(['name' => 'تطبيقي', 'creation_source' => BuilderApp::SOURCE_SCRATCH]);

        $schema = BuilderDraftExperience::minimalSafeSchema();
        $schema['schemaVersion'] = $schemaVersion;
        $schema['minRuntimeVersion'] = $minRuntime;
        $schema['theme'] = ['tokens' => ['marker' => $marker]];

        $row = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id,
            'version' => 1,
            'schema' => $schema,
            'schema_version' => $schemaVersion,
            'published_at' => Carbon::parse($publishedAt),
        ]);
        app(TenantContext::class)->forget();

        return $row;
    }

    private function fetch(string $token, ?string $runtime = null)
    {
        $headers = ['Authorization' => 'Bearer '.$token] + ($runtime === null ? [] : ['X-Runtime-Version' => $runtime]);

        return $this->getJson('/commerce/v1/experience', $headers);
    }

    /** @test */
    public function each_runtime_generation_receives_the_highest_published_version_it_can_render(): void
    {
        $this->twoGenerations();
        $store = $this->seedMobileStore('gen');
        $this->publish($store['tenant'], 'for-1.0', '1.0.0', '2026-10-01 10:00:00');
        $this->publish($store['tenant'], 'needs-1.1', '1.1.0', '2026-10-02 10:00:00'); // الأحدث لكنه يتطلب 1.1.0

        $this->fetch($store['token'], '1.0.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'for-1.0');
        $this->fetch($store['token'], '1.1.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'needs-1.1');
    }

    /** @test */
    public function a_runtime_newer_than_every_known_generation_is_served_as_the_highest_known_one(): void
    {
        $this->twoGenerations();
        $store = $this->seedMobileStore('gen-future');
        $this->publish($store['tenant'], 'for-1.0', '1.0.0', '2026-10-01 10:00:00');
        $this->publish($store['tenant'], 'needs-1.1', '1.1.0', '2026-10-02 10:00:00');

        $this->fetch($store['token'], '9.9.9')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'needs-1.1');
    }

    /** @test */
    public function a_missing_or_malformed_header_is_treated_as_the_oldest_generation_never_the_newest(): void
    {
        $this->twoGenerations();
        $store = $this->seedMobileStore('gen-legacy');
        $this->publish($store['tenant'], 'for-1.0', '1.0.0', '2026-10-01 10:00:00');
        $this->publish($store['tenant'], 'needs-1.1', '1.1.0', '2026-10-02 10:00:00');

        foreach ([null, '', 'latest', '1.1', '1.1.0-beta', '1.1.0.0', 'x.y.z', str_repeat('9', 300), '0.0.1'] as $header) {
            $this->fetch($store['token'], $header)->assertOk()
                ->assertJsonPath('data.schema.theme.tokens.marker', 'for-1.0');
        }
    }

    /** @test */
    public function when_no_published_version_is_renderable_by_the_runtime_the_answer_is_404_not_an_incompatible_document(): void
    {
        $this->twoGenerations();
        $store = $this->seedMobileStore('gen-none');
        $this->publish($store['tenant'], 'needs-1.1', '1.1.0', '2026-10-02 10:00:00');

        $this->fetch($store['token'], '1.0.0')->assertStatus(404);
        $this->fetch($store['token'], '1.1.0')->assertOk();
    }

    /** @test */
    public function a_newer_schema_version_than_the_generation_supports_is_skipped(): void
    {
        $this->twoGenerations();
        $store = $this->seedMobileStore('gen-schema');
        $this->publish($store['tenant'], 'old', '1.0.0', '2026-10-01 10:00:00');
        $this->publish($store['tenant'], 'schema-1.1', '1.0.0', '2026-10-02 10:00:00', schemaVersion: '1.1.0');

        $this->fetch($store['token'], '1.0.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'old');
        $this->fetch($store['token'], '1.1.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'schema-1.1');
    }

    /** @test */
    public function a_corrupt_newer_row_never_hides_an_older_good_one(): void
    {
        $store = $this->seedMobileStore('gen-corrupt');
        $this->publish($store['tenant'], 'good', '1.0.0', '2026-10-01 10:00:00');

        app(TenantContext::class)->set($store['tenant']->id);
        $app = BuilderApp::create(['name' => 'تالف', 'creation_source' => BuilderApp::SOURCE_SCRATCH]);
        BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id, 'version' => 1, 'schema' => ['broken' => true],
            'schema_version' => '1.0.0', 'published_at' => Carbon::parse('2026-10-05 10:00:00'),
        ]);
        app(TenantContext::class)->forget();

        $this->fetch($store['token'], '1.0.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'good');
    }

    /** @test */
    public function the_response_declares_that_it_varies_by_runtime_version(): void
    {
        $store = $this->seedMobileStore('gen-vary');
        $this->publish($store['tenant'], 'x', '1.0.0', '2026-10-01 10:00:00');

        $this->assertStringContainsString('X-Runtime-Version', (string) $this->fetch($store['token'], '1.0.0')->assertOk()->headers->get('Vary'));
    }

    /** @test */
    public function the_production_registry_is_a_single_generation_and_selection_never_crosses_tenants(): void
    {
        $this->assertCount(1, app(RuntimeGenerations::class)->all());
        $this->assertSame('1.0.0', (string) app(RuntimeGenerations::class)->oldest()->runtimeVersion);

        $a = $this->seedMobileStore('gen-a');
        $b = $this->seedMobileStore('gen-b');
        $this->publish($b['tenant'], 'b-only', '1.0.0', '2026-10-01 10:00:00');

        $this->fetch($a['token'], '1.0.0')->assertStatus(404);
        $this->fetch($b['token'], '1.0.0')->assertOk()->assertJsonPath('data.schema.theme.tokens.marker', 'b-only');
    }

    /** @test */
    public function the_registry_orders_generations_and_rejects_an_empty_or_duplicate_set(): void
    {
        $base = CapabilityManifest::current();
        $older = $base;
        $newer = new CapabilityManifest(new SchemaVersion(1, 2, 0), $base->minSupportedSchemaVersion, new SchemaVersion(1, 2, 0), $base->components, $base->actions);
        $registry = new RuntimeGenerations([$newer, $older]);

        $this->assertSame(['1.0.0', '1.2.0'], array_map(fn ($m) => (string) $m->runtimeVersion, $registry->all()));
        $this->assertSame('1.0.0', (string) $registry->forRuntime('1.1.9')->runtimeVersion);
        $this->assertSame('1.2.0', (string) $registry->forRuntime('1.2.0')->runtimeVersion);
        $this->assertSame('1.0.0', (string) $registry->forRuntime(null)->runtimeVersion);

        $this->expectException(\InvalidArgumentException::class);
        new RuntimeGenerations([$older, $older]);
    }

    /** @test */
    public function an_empty_registry_is_rejected(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new RuntimeGenerations([]);
    }
}

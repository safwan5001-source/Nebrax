<?php

namespace Tests\Feature;

use App\Models\BuilderApp;
use App\Models\BuilderPublishedExperienceVersion;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * APP-BUILDER-19 — `GET commerce/v1/experience`. Mirrors
 * CommerceCatalogApiTest's tenant/mobile-channel seeding pattern.
 *
 * تشغيل: php artisan test --filter=CommerceExperienceApiTest
 */
class CommerceExperienceApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, token: string} */
    private function seedMobileStore(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$slug}", 'slug' => $slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'mobile', 'name' => 'تطبيق الجوال', 'type' => SalesChannel::TYPE_MOBILE, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        $client = $this->service()->createClient($tenant, 'mobile-app', true);
        $key = $this->service()->issueKey($client, 'default', []);

        return ['tenant' => $tenant, 'channel' => $channel, 'token' => $key->plainTextToken];
    }

    private function bearer(string $token): array
    {
        return ['Authorization' => 'Bearer '.$token];
    }

    /** أنشئ تطبيقاً ونسخة منشورة له مباشرة (بلا مرور بخط أنابيب النشر — الصفّ ثابتٌ لأغراض الاختبار). */
    private function publishExperience(Tenant $tenant, int $version, array $schemaOverrides = []): BuilderPublishedExperienceVersion
    {
        app(TenantContext::class)->set($tenant->id);

        $app = BuilderApp::create([
            'name' => 'تطبيقي', 'creation_source' => BuilderApp::SOURCE_SCRATCH,
        ]);

        $schema = array_merge([
            'schemaVersion' => 1,
            'minRuntimeVersion' => 1,
            'requiredCapabilities' => [],
            'theme' => ['tokens' => []],
            'navigation' => ['initialPage' => 'home'],
            'pages' => ['home' => ['type' => 'Page', 'children' => []]],
        ], $schemaOverrides);

        $row = BuilderPublishedExperienceVersion::create([
            'builder_app_id' => $app->id,
            'version' => $version,
            'schema' => $schema,
            'schema_version' => (string) $schema['schemaVersion'],
            'published_at' => now(),
        ]);

        app(TenantContext::class)->forget();

        return $row->fresh();
    }

    /** @test */
    public function it_returns_the_most_recently_published_experience_across_all_of_the_tenants_apps(): void
    {
        $store = $this->seedMobileStore('exp');

        $this->publishExperience($store['tenant'], 1, ['navigation' => ['initialPage' => 'old']]);
        // إنشاء ثانٍ متأخر زمنياً بثانية كاملة يضمن ترتيباً حتمياً بلا اعتماد
        // على دقّة الطابع الزمني دون الثانية.
        sleep(1);
        $latest = $this->publishExperience($store['tenant'], 1, ['navigation' => ['initialPage' => 'new']]);

        $res = $this->getJson('/commerce/v1/experience', $this->bearer($store['token']))->assertOk();

        $res->assertJsonPath('data.version', $latest->version);
        $res->assertJsonPath('data.schema.navigation.initialPage', 'new');
        $res->assertJsonPath('data.schema_version', '1');
    }

    /** @test */
    public function tenant_a_never_sees_tenant_bs_published_experience(): void
    {
        $a = $this->seedMobileStore('exp-a');
        $b = $this->seedMobileStore('exp-b');

        $this->publishExperience($b['tenant'], 1, ['navigation' => ['initialPage' => 'b-only']]);

        $this->getJson('/commerce/v1/experience', $this->bearer($a['token']))
            ->assertStatus(404);
    }

    /** @test */
    public function a_tenant_that_never_published_gets_a_404_not_a_500(): void
    {
        $store = $this->seedMobileStore('exp-none');

        $this->getJson('/commerce/v1/experience', $this->bearer($store['token']))
            ->assertStatus(404)
            ->assertJsonPath('error.code', 'not_found');
    }

    /** @test */
    public function it_requires_authentication(): void
    {
        $this->getJson('/commerce/v1/experience')->assertStatus(401);
    }
}

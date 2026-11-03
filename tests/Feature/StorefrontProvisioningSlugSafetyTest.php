<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontBusinessProfile;
use App\Models\StorefrontDomain;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Support\TenantSlugNotHostnameSafeException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Tests\TestCase;

/**
 * Regression — «تعذّر إنشاء المتجر» (HTTP 500 صامت على POST /api/commerce/workspace/storefronts).
 *
 * السبب: التسجيل كان يقبل slug لا يصلح شريحة hostname (حروف غير لاتينية، `_`، شرطة طرفية…)
 * لأن `alpha_dash` أوسع من قاعدة hostname، ثم يفشل توليد `{slug}.{base}` عند إنشاء المتجر،
 * ويتحوّل الاستثناء إلى `abort(500)` وهو HttpException لا يُسجَّله Laravel أصلاً.
 *
 * تشغيل: php artisan test --filter=StorefrontProvisioningSlugSafetyTest
 */
class StorefrontProvisioningSlugSafetyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const PATH = '/api/commerce/workspace/storefronts';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => 'storefronts.test']);
    }

    /** يحاكي مستأجراً قديماً سُجِّل قبل التشديد: يغيّر slug مباشرةً لأن التسجيل لم يعد يقبله. */
    private function forceLegacySlug(string $tenantId, string $slug): void
    {
        DB::table('tenants')->where('id', $tenantId)->update(['slug' => $slug]);
    }

    /** @return array<string, int> */
    private function graphCounts(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $counts = [
            'channels' => SalesChannel::query()->count(),
            'storefronts' => Storefront::query()->count(),
            'domains' => StorefrontDomain::query()->count(),
            'profiles' => StorefrontBusinessProfile::query()->count(),
        ];
        app(TenantContext::class)->forget();

        return $counts;
    }

    /** @test */
    public function first_storefront_with_flowers_gifts_vertical_is_created_for_an_arabic_named_tenant(): void
    {
        $auth = $this->registerTenant('nebras-flowers', 'owner@nebras-flowers.test');
        DB::table('tenants')->where('id', $auth['tenant_id'])->update(['name' => 'نبراس للورد والهدايا | Nebras Flowers & Gifts']);

        $res = $this->withToken($auth['token'])
            ->postJson(self::PATH, ['business_vertical' => 'flowers_gifts'])
            ->assertCreated();

        $this->assertSame('https://nebras-flowers.storefronts.test/', $res->json('data.store.preview_url'));
        $this->assertSame('flowers_gifts', $res->json('data.store.business_vertical'));
        $this->assertSame('نبراس للورد والهدايا | Nebras Flowers & Gifts', $res->json('data.store.name'));
        $this->assertSame(['channels' => 1, 'storefronts' => 1, 'domains' => 1, 'profiles' => 1], $this->graphCounts($auth['tenant_id']));

        // يظهر في قائمة المتاجر.
        $list = $this->withToken($auth['token'])->getJson(self::PATH)->assertOk();
        $this->assertCount(1, $list->json('data.stores'));
    }

    /** @test */
    public function repeating_the_request_does_not_duplicate_anything(): void
    {
        $auth = $this->registerTenant('idem-flowers', 'owner@idem-flowers.test');

        $this->withToken($auth['token'])->postJson(self::PATH, ['business_vertical' => 'flowers_gifts'])->assertCreated();
        $this->withToken($auth['token'])->postJson(self::PATH, ['business_vertical' => 'flowers_gifts'])->assertOk();

        $this->assertSame(['channels' => 1, 'storefronts' => 1, 'domains' => 1, 'profiles' => 1], $this->graphCounts($auth['tenant_id']));
    }

    /**
     * @test
     * @dataProvider unsafeSlugs
     */
    public function a_legacy_tenant_whose_slug_cannot_be_a_hostname_gets_an_actionable_422_and_no_partial_graph(string $slug): void
    {
        $auth = $this->registerTenant('legacy-bad', 'owner@legacy-bad.test');
        $this->forceLegacySlug($auth['tenant_id'], $slug);

        $res = $this->withToken($auth['token'])
            ->postJson(self::PATH, ['business_vertical' => 'flowers_gifts'])
            ->assertStatus(422);

        $this->assertSame('tenant_slug_not_hostname_safe', $res->json('reason'));
        $this->assertStringContainsString('معرّف', (string) $res->json('message'));
        $this->assertSame(['channels' => 0, 'storefronts' => 0, 'domains' => 0, 'profiles' => 0], $this->graphCounts($auth['tenant_id']));
    }

    /** @return array<string, array{string}> */
    public static function unsafeSlugs(): array
    {
        return [
            'underscore' => ['nebras_flowers'],
            'arabic' => ['نبراس-للورد'],
            'leading dash' => ['-nebras'],
            'trailing dash' => ['nebras-'],
            'dot' => ['nebras.flowers'],
            'over 63 chars' => [str_repeat('a', 64)],
        ];
    }

    /** @test */
    public function an_unsafe_legacy_tenant_does_not_affect_other_tenants_or_existing_stores(): void
    {
        $good = $this->registerTenant('good-store', 'owner@good-store.test');
        $bad = $this->registerTenant('bad-store', 'owner@bad-store.test');
        $this->withToken($good['token'])->postJson(self::PATH)->assertCreated();
        $this->forceLegacySlug($bad['tenant_id'], 'bad_store');

        $this->withToken($bad['token'])->postJson(self::PATH)->assertStatus(422);

        // المتجر القائم للمستأجر الآخر سليم، ولا تسرّب بين المستأجرين.
        $this->assertSame(['channels' => 1, 'storefronts' => 1, 'domains' => 1, 'profiles' => 0], $this->graphCounts($good['tenant_id']));
        $this->assertSame(['channels' => 0, 'storefronts' => 0, 'domains' => 0, 'profiles' => 0], $this->graphCounts($bad['tenant_id']));
        $this->assertCount(1, $this->withToken($good['token'])->getJson(self::PATH)->json('data.stores'));
        $this->assertCount(0, $this->withToken($bad['token'])->getJson(self::PATH)->json('data.stores'));
    }

    /** @test */
    public function the_additional_store_path_also_returns_422_for_an_unsafe_slug(): void
    {
        $auth = $this->registerTenant('multi-bad', 'owner@multi-bad.test');
        $this->withToken($auth['token'])->postJson(self::PATH)->assertCreated();
        $this->forceLegacySlug($auth['tenant_id'], 'multi_bad');

        $res = $this->withToken($auth['token'])->postJson(self::PATH.'/create', ['name' => 'فرع الورد'])->assertStatus(422);

        $this->assertSame('tenant_slug_not_hostname_safe', $res->json('reason'));
        $this->assertSame(1, $this->graphCounts($auth['tenant_id'])['storefronts']);
    }

    /**
     * @test
     * @dataProvider misconfiguredBaseDomains
     */
    public function a_misconfigured_base_domain_stays_a_logged_500_with_no_partial_graph(?string $value): void
    {
        config(['storefront.managed_base_domain' => $value]);
        Log::spy();
        $auth = $this->registerTenant('base-bad', 'owner@base-bad.test');

        $this->withToken($auth['token'])->postJson(self::PATH)->assertStatus(500);

        Log::shouldHaveReceived('error')->withArgs(fn ($message) => $message === 'storefront.provisioning.base_domain_misconfigured')->once();
        $this->assertSame(['channels' => 0, 'storefronts' => 0, 'domains' => 0, 'profiles' => 0], $this->graphCounts($auth['tenant_id']));
    }

    /** @return array<string, array{?string}> */
    public static function misconfiguredBaseDomains(): array
    {
        return [
            'missing' => [null],
            'blank' => ['  '],
            'wildcard' => ['*.store.awj.app'],
            'garbage' => ['not a domain'],
        ];
    }

    /** @test */
    public function provisioning_still_requires_commerce_manage(): void
    {
        $auth = $this->registerTenant('rbac-slug', 'owner@rbac-slug.test');
        $this->forceLegacySlug($auth['tenant_id'], 'rbac_slug');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@rbac-slug.test');

        // الصلاحية تُفحص قبل أي توليد hostname: 403 لا 422، ولا تسريب لحالة المعرّف.
        $this->withToken($staff)->postJson(self::PATH)->assertForbidden();
    }

    /**
     * @test
     * @dataProvider unsafeSlugsForRegistration
     */
    public function registration_rejects_a_slug_that_cannot_become_a_storefront_hostname(string $slug): void
    {
        $this->postJson('/api/register', [
            'company_name' => 'نبراس للورد والهدايا',
            'slug' => $slug,
            'name' => 'المالك',
            'email' => 'owner@reg-reject.test',
            'password' => 'password123',
        ])->assertStatus(422)->assertJsonValidationErrors('slug');

        $this->assertSame(0, DB::table('tenants')->count());
    }

    /** @return array<string, array{string}> */
    public static function unsafeSlugsForRegistration(): array
    {
        return [
            'underscore' => ['nebras_flowers'],
            'arabic' => ['نبراس-للورد'],
            'leading dash' => ['-nebras'],
            'trailing dash' => ['nebras-'],
            'over 63 chars' => [str_repeat('a', 64)],
        ];
    }

    /**
     * @test
     * @dataProvider safeSlugsForRegistration
     */
    public function registration_still_accepts_safe_slugs_including_the_63_char_boundary(string $slug): void
    {
        $this->postJson('/api/register', [
            'company_name' => 'نبراس للورد والهدايا',
            'slug' => $slug,
            'name' => 'المالك',
            'email' => 'owner@reg-ok.test',
            'password' => 'password123',
        ])->assertCreated();
    }

    /** @return array<string, array{string}> */
    public static function safeSlugsForRegistration(): array
    {
        return [
            'typical' => ['nebras-flowers'],
            'letters and digits' => ['a1'],
            'single char' => ['x'],
            '63 chars' => [str_repeat('b', 63)],
        ];
    }

    /** @test */
    public function hostname_generation_classifies_slug_failures_apart_from_base_domain_failures(): void
    {
        try {
            ManagedStorefrontHostname::forSlug('nebras_flowers', 'storefronts.test');
            $this->fail('expected exception');
        } catch (TenantSlugNotHostnameSafeException $e) {
            // يبقى نوعاً فرعياً من الأصل فلا ينكسر أي مستدعٍ قائم يلتقط الأصل.
            $this->assertInstanceOf(StorefrontBaseDomainMisconfiguredException::class, $e);
        }

        try {
            ManagedStorefrontHostname::forSlug('nebras-flowers', '*.storefronts.test');
            $this->fail('expected exception');
        } catch (StorefrontBaseDomainMisconfiguredException $e) {
            $this->assertNotInstanceOf(TenantSlugNotHostnameSafeException::class, $e);
        }

        $this->assertSame('nebras-flowers.storefronts.test', ManagedStorefrontHostname::forSlug('nebras-flowers', 'storefronts.test'));
    }
}

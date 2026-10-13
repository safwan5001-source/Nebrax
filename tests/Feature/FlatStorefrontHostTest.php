<?php

namespace Tests\Feature;

use App\Console\Commands\StorefrontFlatHostPlanCommand;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\Commerce\CreateStorefrontForCurrentTenant;
use App\Services\Commerce\FlatHostMigrationPlanner;
use App\Services\Commerce\StorefrontProvisioningService;
use App\Support\ManagedStorefrontHostname;
use App\Support\StorefrontBaseDomainMisconfiguredException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * الخيار A (مضيف بشريحة واحدة): المتجر الأول `{tenant}.{base}`، الإضافي
 * `{tenant}-{store}.{base}`. يغطي: الباني الموحّد، التفرّد العالمي والتصادم
 * بالدمج بالشرطة، حجز سلاج المستأجر، العزل، انتحال الترويسات، والمخطِّط القراءة-فقط.
 *
 * تشغيل: php artisan test --filter=FlatStorefrontHostTest
 */
class FlatStorefrontHostTest extends TestCase
{
    use RefreshDatabase;

    private const BASE = 'store.awjdev.xyz';

    protected function setUp(): void
    {
        parent::setUp();
        config(['storefront.managed_base_domain' => self::BASE, 'storefront.gateway_secret' => 'flat-secret']);
    }

    private function tenant(string $slug): Tenant
    {
        return Tenant::create([
            'name' => $slug, 'slug' => $slug, 'currency' => 'SAR', 'is_active' => true,
            'vat_number' => '3'.str_pad((string) random_int(1, 9999999999999), 13, '0', STR_PAD_LEFT),
        ]);
    }

    private function addStore(Tenant $tenant, string $name, string $locale = 'ar'): array
    {
        app(TenantContext::class)->set($tenant->id);
        try {
            return app(CreateStorefrontForCurrentTenant::class)->create($name, $locale);
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    private function firstStore(Tenant $tenant): array
    {
        app(TenantContext::class)->set($tenant->id);
        try {
            return app(StorefrontProvisioningService::class)->provisionFirstStorefrontForCurrentTenant();
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    // ── الباني ───────────────────────────────────────────────────────────

    /** @test */
    public function additional_store_host_is_a_single_label_tenant_dash_store(): void
    {
        $host = ManagedStorefrontHostname::forAdditionalStoreSlug('zhor-tyb', 'dominah', self::BASE);

        $this->assertSame('dominah-zhor-tyb.store.awjdev.xyz', $host);
        $this->assertTrue(ManagedStorefrontHostname::isUnderBaseDomain($host, self::BASE));
        $this->assertSame('dominah-zhor-tyb', ManagedStorefrontHostname::labelOf($host, self::BASE));
    }

    /** @test */
    public function the_nested_legacy_form_is_never_generated(): void
    {
        $host = ManagedStorefrontHostname::forAdditionalStoreSlug('zhor-tyb', 'dominah', self::BASE);

        $this->assertNotSame('zhor-tyb.dominah.store.awjdev.xyz', $host);
        $this->assertFalse(ManagedStorefrontHostname::isUnderBaseDomain('zhor-tyb.dominah.store.awjdev.xyz', self::BASE));
    }

    /**
     * @test
     * @dataProvider invalidParts
     */
    public function invalid_or_malicious_parts_fail_closed(string $store, string $tenant): void
    {
        $this->expectException(StorefrontBaseDomainMisconfiguredException::class);
        ManagedStorefrontHostname::forAdditionalStoreSlug($store, $tenant, self::BASE);
    }

    public static function invalidParts(): array
    {
        return [
            'dot in store creates a second label' => ['x.evil', 'acme'],
            'dot in tenant creates a second label' => ['shop', 'acme.evil'],
            'slash/path' => ['shop/../x', 'acme'],
            'userinfo' => ['shop@evil.com', 'acme'],
            'underscore' => ['shop_a', 'acme'],
            'unicode/IDN lookalike' => ['shоp', 'acme'],
            'label over 63 chars' => [str_repeat('s', 40), str_repeat('t', 30)],
            'empty store' => ['', 'acme'],
            'empty tenant' => ['shop', '  '],
        ];
    }

    /** @test */
    public function builder_normalizes_case_and_never_reads_request_headers(): void
    {
        $this->withHeaders(['Host' => 'evil.example', 'X-Forwarded-Host' => 'evil.example', 'X-Forwarded-Proto' => 'http']);

        $this->assertSame('acme-shop.store.awjdev.xyz', ManagedStorefrontHostname::forAdditionalStoreSlug('Shop', 'ACME', 'STORE.awjdev.XYZ'));
    }

    // ── التفرّد العالمي ──────────────────────────────────────────────────

    /** @test */
    public function identical_store_slugs_under_two_tenants_get_distinct_hosts_each_owned_by_its_tenant(): void
    {
        $a = $this->tenant('alpha');
        $b = $this->tenant('beta');

        $sa = $this->addStore($a, 'Gifts');
        $sb = $this->addStore($b, 'Gifts');

        $this->assertSame('https://alpha-gifts.store.awjdev.xyz/', $sa['preview_url']);
        $this->assertSame('https://beta-gifts.store.awjdev.xyz/', $sb['preview_url']);
        $this->assertSame($a->id, StorefrontDomain::withoutGlobalScopes()->where('hostname', 'alpha-gifts.store.awjdev.xyz')->sole()->tenant_id);
        $this->assertSame($b->id, StorefrontDomain::withoutGlobalScopes()->where('hostname', 'beta-gifts.store.awjdev.xyz')->sole()->tenant_id);
    }

    /** @test */
    public function dash_concatenation_ambiguity_between_tenants_is_resolved_deterministically_without_sharing_a_host(): void
    {
        $a = $this->tenant('a');
        $ab = $this->tenant('a-b');

        $first = $this->addStore($a, 'b-c');      // a + b-c   -> a-b-c
        $second = $this->addStore($ab, 'c');      // a-b + c   -> a-b-c (taken) -> a-b-c-2

        $this->assertSame('https://a-b-c.store.awjdev.xyz/', $first['preview_url']);
        $this->assertSame('https://a-b-c-2.store.awjdev.xyz/', $second['preview_url']);
        $this->assertSame(2, StorefrontDomain::withoutGlobalScopes()->count());
        $this->assertSame(2, StorefrontDomain::withoutGlobalScopes()->distinct('hostname')->count('hostname'));
    }

    /** @test */
    public function a_label_equal_to_another_tenants_slug_is_reserved_even_before_that_tenant_has_a_store(): void
    {
        $a = $this->tenant('a');
        $this->tenant('a-b-c'); // لم يُزوَّد متجره الأول بعد

        $store = $this->addStore($a, 'b-c');

        $this->assertSame('https://a-b-c-2.store.awjdev.xyz/', $store['preview_url']);

        // وعند تزويد المتجر الأول للمستأجر المحجوز لاحقاً: مضيفه سليم وغير مأخوذ.
        $first = $this->firstStore(Tenant::where('slug', 'a-b-c')->sole());
        $this->assertSame('https://a-b-c.store.awjdev.xyz/', $first['preview_url']);
    }

    /** @test */
    public function registration_rejects_a_slug_that_collides_with_an_existing_additional_store_host(): void
    {
        $a = $this->tenant('a');
        $this->addStore($a, 'b-c'); // a-b-c.store.awjdev.xyz

        $this->postJson('/api/register', [
            'company_name' => 'X', 'slug' => 'a-b-c', 'email' => 'x@flat.test', 'password' => 'password123',
        ])->assertUnprocessable()->assertJsonValidationErrors('slug');
    }

    /** @test */
    public function a_db_level_hostname_collision_still_fails_closed(): void
    {
        $a = $this->tenant('dup');
        $this->addStore($a, 'one');

        $this->expectException(\Illuminate\Database\QueryException::class);
        DB::table('storefront_domains')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $a->id,
            'storefront_id' => Storefront::withoutGlobalScopes()->firstOrFail()->id,
            'hostname' => 'dup-one.store.awjdev.xyz', 'type' => 'awj_subdomain',
            'is_primary' => false, 'is_active' => true, 'verification_status' => 'verified',
            'created_at' => now(), 'updated_at' => now(),
        ]);
    }

    // ── العزل وانتحال الترويسات (حسم المضيف بمطابقة دقيقة) ─────────────────

    /** @return array{0: Tenant, 1: Tenant} */
    private function twoTenantsWithGiftsStores(): array
    {
        $a = $this->tenant('alpha');
        $b = $this->tenant('beta');
        $this->addStore($a, 'Gifts', 'en');
        $this->addStore($b, 'Gifts', 'ar');

        return [$a, $b];
    }

    private function localeFor(string $host, array $headers = []): ?string
    {
        return $this->withHeaders($headers)->getJson("http://{$host}/store/v1/storefront")->json('data.default_locale');
    }

    /** @test */
    public function each_flat_host_resolves_only_to_its_own_tenant_storefront(): void
    {
        $this->twoTenantsWithGiftsStores();

        $this->assertSame('en', $this->localeFor('alpha-gifts.store.awjdev.xyz'));
        $this->assertSame('ar', $this->localeFor('beta-gifts.store.awjdev.xyz'));
        // الإنفاذ على مستوى الاستجابة: لا أثر لبيانات المستأجر الآخر.
        $this->assertStringNotContainsString('beta', $this->getJson('http://alpha-gifts.store.awjdev.xyz/store/v1/storefront')->getContent());
    }

    /**
     * @test
     * @dataProvider nonResolvingHosts
     */
    public function legacy_nested_lookalike_and_unknown_hosts_fail_closed_with_no_fallback(string $host): void
    {
        $this->twoTenantsWithGiftsStores();

        $this->getJson("http://{$host}/store/v1/storefront")->assertNotFound();
    }

    public static function nonResolvingHosts(): array
    {
        return [
            'legacy nested form' => ['gifts.alpha.store.awjdev.xyz'],
            'extra leading label on a real host' => ['evil.alpha-gifts.store.awjdev.xyz'],
            'real host with suffix appended' => ['alpha-gifts.store.awjdev.xyz.evil.com'],
            'prefix of a real host (no fuzzy match)' => ['alpha-gift.store.awjdev.xyz'],
            'bare tenant slug (no first store provisioned)' => ['alpha.store.awjdev.xyz'],
            'unknown label' => ['nobody.store.awjdev.xyz'],
            'base domain itself' => ['store.awjdev.xyz'],
        ];
    }

    /** @test */
    public function host_case_and_trailing_dot_normalize_to_the_same_tenant_only(): void
    {
        $this->twoTenantsWithGiftsStores();

        $this->assertSame('en', $this->localeFor('ALPHA-Gifts.Store.AwjDev.XYZ'));
        $this->assertSame('en', $this->localeFor('alpha-gifts.store.awjdev.xyz.'));
    }

    /** @test */
    public function forwarded_host_without_a_valid_secret_cannot_switch_tenant(): void
    {
        $this->twoTenantsWithGiftsStores();
        $victim = 'beta-gifts.store.awjdev.xyz';

        // سرّ خاطئ / غائب / ترويسات انتحال شائعة: الحسم يبقى على Host الاتصال.
        $this->assertSame('en', $this->localeFor('alpha-gifts.store.awjdev.xyz', [
            'X-Storefront-Forwarded-Host' => $victim, 'X-Storefront-Gateway-Secret' => 'wrong',
        ]));
        $this->assertSame('en', $this->localeFor('alpha-gifts.store.awjdev.xyz', [
            'X-Storefront-Forwarded-Host' => $victim,
        ]));
        $this->assertSame('en', $this->localeFor('alpha-gifts.store.awjdev.xyz', [
            'X-Forwarded-Host' => $victim, 'X-Original-Host' => $victim, 'X-Host' => $victim,
            'Forwarded' => 'host='.$victim, 'X-Forwarded-Proto' => 'http',
        ]));
    }

    /** @test */
    public function a_valid_secret_resolves_the_exact_forwarded_host_and_an_invalid_forwarded_value_fails_closed(): void
    {
        $this->twoTenantsWithGiftsStores();
        $signed = fn (string $h) => ['X-Storefront-Forwarded-Host' => $h, 'X-Storefront-Gateway-Secret' => 'flat-secret'];

        $this->assertSame('ar', $this->localeFor('laravel-internal.test', $signed('beta-gifts.store.awjdev.xyz')));
        $this->getJson('http://laravel-internal.test/store/v1/storefront', $signed('gifts.beta.store.awjdev.xyz'))->assertNotFound();
        $this->getJson('http://laravel-internal.test/store/v1/storefront', $signed('beta-gifts.store.awjdev.xyz@evil.com'))->assertNotFound();
        $this->getJson('http://laravel-internal.test/store/v1/storefront', $signed('beta-gifts.store.awjdev.xyz/../x'))->assertNotFound();
    }

    /** @test */
    public function inactive_or_unverified_flat_host_fails_closed(): void
    {
        [$a] = $this->twoTenantsWithGiftsStores();
        StorefrontDomain::withoutGlobalScopes()->where('tenant_id', $a->id)->update(['is_active' => false]);
        $this->getJson('http://alpha-gifts.store.awjdev.xyz/store/v1/storefront')->assertNotFound();

        StorefrontDomain::withoutGlobalScopes()->where('tenant_id', $a->id)->update(['is_active' => true, 'verification_status' => 'pending']);
        $this->getJson('http://alpha-gifts.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
    }

    /** @test */
    public function consecutive_requests_for_different_hosts_never_share_resolved_context(): void
    {
        $this->twoTenantsWithGiftsStores();

        // تسلسل A,B,A,B على نفس العملية: لا تسرّب سياق بين الطلبات.
        foreach (['alpha' => 'en', 'beta' => 'ar', 'alpha ' => 'en', 'beta ' => 'ar'] as $slug => $expected) {
            $this->assertSame($expected, $this->localeFor(trim($slug).'-gifts.store.awjdev.xyz'));
            $this->assertNull(app(TenantContext::class)->id());
        }
    }

    /** @test */
    public function preview_url_is_built_from_stored_rows_and_ignores_spoofed_request_headers(): void
    {
        $this->twoTenantsWithGiftsStores();

        $this->withHeaders(['Host' => 'evil.example', 'X-Forwarded-Host' => 'evil.example', 'X-Forwarded-Proto' => 'http']);
        $store = $this->addStore(Tenant::where('slug', 'alpha')->sole(), 'Second');

        $this->assertSame('https://alpha-second.store.awjdev.xyz/', $store['preview_url']);
        $this->assertStringNotContainsString('evil', json_encode($store));
    }

    // ── المخطِّط (Dry Run) ───────────────────────────────────────────────

    private function legacyRow(Tenant $tenant, string $storeSlug, ?string $hostname = null, bool $active = true): array
    {
        $channel = SalesChannel::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'slug' => 'c-'.$storeSlug, 'name' => $storeSlug, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $sf = Storefront::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'sales_channel_id' => $channel->id, 'slug' => $storeSlug, 'name' => $storeSlug, 'is_active' => $active,
        ]);
        $domain = StorefrontDomain::withoutGlobalScopes()->create([
            'tenant_id' => $tenant->id, 'storefront_id' => $sf->id,
            'hostname' => $hostname ?? "{$storeSlug}.{$tenant->slug}.".self::BASE,
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN, 'is_primary' => true, 'is_active' => $active,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        return ['storefront' => $sf, 'domain' => $domain];
    }

    /** @test */
    public function planner_maps_legacy_hosts_flags_conflicts_and_writes_nothing(): void
    {
        $dominah = $this->tenant('dominah');
        $a = $this->tenant('a');
        $ab = $this->tenant('a-b');
        $this->tenant('dominah-taken');                 // سلاج مستأجر يطابق هدفاً محتملاً
        $this->legacyRow($dominah, 'zhor-tyb');         // -> dominah-zhor-tyb (آمن)
        $this->legacyRow($dominah, 'taken');            // -> dominah-taken (= سلاج مستأجر)
        $this->legacyRow($a, 'b-c');                    // -> a-b-c  ┐ هدف مكرر
        $this->legacyRow($ab, 'c');                     // -> a-b-c  ┘
        $this->legacyRow($dominah, 'odd', 'weird.store.awjdev.xyz'); // غير معروف
        $this->firstStore($this->tenant('solo'));       // المتجر الأول

        $before = [DB::table('storefront_domains')->count(), DB::table('storefront_domains')->pluck('hostname')->sort()->values()->all()];
        $plan = app(FlatHostMigrationPlanner::class)->plan();
        $after = [DB::table('storefront_domains')->count(), DB::table('storefront_domains')->pluck('hostname')->sort()->values()->all()];

        $this->assertSame($before, $after, 'planner must be read-only');
        $by = collect($plan['rows'])->keyBy('hostname');
        $this->assertSame('dominah-zhor-tyb.store.awjdev.xyz', $by['zhor-tyb.dominah.store.awjdev.xyz']['target']);
        $this->assertSame([], $by['zhor-tyb.dominah.store.awjdev.xyz']['conflicts']);
        $this->assertSame(['target_is_tenant_slug'], $by['taken.dominah.store.awjdev.xyz']['conflicts']);
        $this->assertContains('duplicate_target', $by['b-c.a.store.awjdev.xyz']['conflicts']);
        $this->assertContains('duplicate_target', $by['c.a-b.store.awjdev.xyz']['conflicts']);
        $this->assertSame('unrecognized', $by['weird.store.awjdev.xyz']['status']);
        $this->assertSame('first', $by['solo.store.awjdev.xyz']['status']);
        $this->assertSame(1, $plan['summary']['safe_to_migrate']);
        $this->assertSame(3, $plan['summary']['conflicting']);
    }

    /** @test */
    public function plan_command_is_dry_run_only_and_fails_on_conflicts(): void
    {
        $this->assertArrayNotHasKey('apply', (new StorefrontFlatHostPlanCommand)->getDefinition()->getOptions());
        $this->artisan('storefront:flat-host-plan')->assertSuccessful();

        $dominah = $this->tenant('dominah');
        $this->tenant('dominah-x');
        $this->legacyRow($dominah, 'x');
        $this->artisan('storefront:flat-host-plan')->assertFailed();
    }

    /** @test */
    public function production_shape_h_inactive_and_zhor_tyb_active_map_to_free_targets_and_inactive_stays_inactive(): void
    {
        $dominah = $this->tenant('dominah');
        $other = $this->tenant('other');
        $h = $this->legacyRow($dominah, 'h', null, false);
        $z = $this->legacyRow($dominah, 'zhor-tyb');
        $this->legacyRow($other, 'h'); // نفس سلاج المتجر عند مستأجر آخر: لا يؤثر على أهداف dominah

        $snapshot = DB::table('storefront_domains')->orderBy('id')->get()->toJson();
        $plan = app(FlatHostMigrationPlanner::class)->plan();
        $by = collect($plan['rows'])->keyBy('hostname');

        $hRow = $by['h.dominah.store.awjdev.xyz'];
        $this->assertSame('dominah-h.store.awjdev.xyz', $hRow['target']);
        $this->assertSame([], $hRow['conflicts']);
        $this->assertSame('inactive', $hRow['apply_as']);          // لا تفعيل
        $this->assertSame($dominah->id, $hRow['tenant_id']);
        $this->assertSame($h['storefront']->id, $hRow['storefront_id']);

        $zRow = $by['zhor-tyb.dominah.store.awjdev.xyz'];
        $this->assertSame('dominah-zhor-tyb.store.awjdev.xyz', $zRow['target']);
        $this->assertSame([], $zRow['conflicts']);
        $this->assertSame('active', $zRow['apply_as']);
        $this->assertSame($z['storefront']->id, $zRow['storefront_id']);

        // مستأجر آخر بنفس سلاج المتجر → هدف مختلف تماماً
        $this->assertSame('other-h.store.awjdev.xyz', $by['h.other.store.awjdev.xyz']['target']);
        $this->assertSame(1, $plan['summary']['inactive_sources']);
        $this->assertSame($snapshot, DB::table('storefront_domains')->orderBy('id')->get()->toJson(), 'planner must not write');
    }

    /** @test */
    public function creating_new_stores_never_reactivates_an_inactive_store_or_domain(): void
    {
        $dominah = $this->tenant('dominah');
        $h = $this->legacyRow($dominah, 'h', null, false);

        // محاولة إنشاء متجر باسم «h» لنفس المستأجر: يأخذ سلاجاً جديداً (h-2)، ولا يمسّ القديم.
        $new = $this->addStore($dominah, 'h');

        $this->assertSame('https://dominah-h-2.store.awjdev.xyz/', $new['preview_url']);
        $this->assertFalse((bool) Storefront::withoutGlobalScopes()->findOrFail($h['storefront']->id)->is_active);
        $this->assertFalse((bool) StorefrontDomain::withoutGlobalScopes()->findOrFail($h['domain']->id)->is_active);
        // والمضيف القديم لا يحسم (غير نشط) → 404
        $this->getJson('http://h.dominah.store.awjdev.xyz/store/v1/storefront')->assertNotFound();
    }
}

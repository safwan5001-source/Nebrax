<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  COM-7-P2A — Trusted hostname → Storefront/Tenant/SalesChannel resolution
 *  (ResolveStorefrontDomain) — الاختبارات الأمنية الإلزامية §11 من
 *  AWJ_COM_7_P2_STOREFRONT_DOMAIN_RESOLUTION_DECISION.md.
 * ═══════════════════════════════════════════════════════════════
 *  ملاحظة تقنية: عميل اختبار Laravel يشتقّ الـ Host من الرابط المطلَق نفسه
 *  حين يُمرَّر (`Request::create()` في Symfony)، فتُستدعى المسارات هنا عبر
 *  `http://{hostname}/store/v1/...` مباشرةً، لا عبر ترويسة `Host` منفصلة —
 *  وهذا **هو بالضبط** ما يستقبله `$request->getHost()` في الإنتاج أيضاً.
 *
 *  تشغيل: php artisan test --filter=StorefrontDomainResolutionApiTest
 */
class StorefrontDomainResolutionApiTest extends TestCase
{
    use RefreshDatabase;

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront, domain: StorefrontDomain} */
    private function seedDomainStore(string $hostname, array $domainOverrides = [], array $storefrontOverrides = []): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'store-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create(array_merge([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ], $storefrontOverrides));

        $domain = StorefrontDomain::create(array_merge([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ], $domainOverrides));

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront', 'domain');
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel, array $attrs = []): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'name_en' => 'Published Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15,
            'is_active' => true,
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function url(string $hostname, string $path): string
    {
        return "http://{$hostname}/store/v1/{$path}";
    }

    // ── 1/2. Domain A / Domain B isolation ──────────────────────────────

    /** @test */
    public function domain_a_resolves_only_to_tenant_storefront_channel_a(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('a.example.com');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedDomainStore('b.example.com');

        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج أ']);
        $productB = $this->publishedProduct($tenantB, $channelB, ['name' => 'منتج ب']);

        $resA = $this->getJson($this->url('a.example.com', 'products'))->assertOk();
        $idsA = collect($resA->json('data'))->pluck('id')->all();
        $this->assertContains($productA->id, $idsA);
        $this->assertNotContains($productB->id, $idsA);

        // منتج المستأجر الآخر بمعرّفه المباشر عبر نطاق أ — 404 لا تسريب وجوده.
        $this->getJson($this->url('a.example.com', "products/{$productB->id}"))->assertStatus(404);
    }

    /** @test */
    public function domain_b_resolves_only_to_tenant_storefront_channel_b(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('c.example.com');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedDomainStore('d.example.com');

        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج أ2']);
        $productB = $this->publishedProduct($tenantB, $channelB, ['name' => 'منتج ب2']);

        $resB = $this->getJson($this->url('d.example.com', 'products'))->assertOk();
        $idsB = collect($resB->json('data'))->pluck('id')->all();
        $this->assertContains($productB->id, $idsB);
        $this->assertNotContains($productA->id, $idsB);

        $this->getJson($this->url('d.example.com', "products/{$productA->id}"))->assertStatus(404);
    }

    // ── 3. Unknown / malformed hostname ──────────────────────────────────

    /** @test */
    public function unknown_hostname_fails_closed(): void
    {
        $this->getJson($this->url('no-such-domain.example.com', 'products'))->assertStatus(404);
        $this->getJson($this->url('no-such-domain.example.com', 'categories'))->assertStatus(404);
    }

    /** @test */
    public function a_malformed_hostname_fails_closed_instead_of_crashing(): void
    {
        // "localhost" مقبولٌ تركيبياً عند Symfony (لا يتجاوز نمطها الأساسي
        // لصلاحية الـ Host)، فيصل فعلياً إلى `ResolveStorefrontDomain` — لكنه
        // مرفوضٌ عند `HostnameNormalizer` تحديداً (تسمية واحدة، بلا نقطة).
        // هذا هو المسار الذي يثبت أن **تحقّقنا نحن**، لا حارس Symfony وحده،
        // هو ما يفشل مغلقاً هنا. الحالات الأشدّ فساداً تركيبياً (نقطتان
        // متتاليتان، شرطة بادئة...) يرفضها Symfony نفسه قبل بناء الطلب حتى
        // في التطوير (`BadRequestException`/`SuspiciousOperationException`
        // → 400 لا 200 لا تسريب) — مغطاة مباشرةً في `HostnameNormalizerTest`
        // على مستوى الدالة، بلا حاجة لعبور طبقة HTTP لإثباتها.
        $this->getJson('/store/v1/products')->assertStatus(404);
    }

    // ── 4/5. Inactive / unverified domain ────────────────────────────────

    /** @test */
    public function an_inactive_domain_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('inactive-domain.example.com', ['is_active' => false]);
        $this->publishedProduct($tenant, $channel);

        $this->getJson($this->url('inactive-domain.example.com', 'products'))->assertStatus(404);
    }

    /** @test */
    public function an_unverified_custom_domain_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('unverified.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_PENDING,
        ]);
        $this->publishedProduct($tenant, $channel);

        $this->getJson($this->url('unverified.example.com', 'products'))->assertStatus(404);
    }

    /** @test */
    public function a_failed_verification_domain_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('failed-verify.example.com', [
            'verification_status' => StorefrontDomain::VERIFICATION_FAILED,
        ]);
        $this->publishedProduct($tenant, $channel);

        $this->getJson($this->url('failed-verify.example.com', 'products'))->assertStatus(404);
    }

    // ── 6. Inactive storefront ────────────────────────────────────────────

    /** @test */
    public function an_inactive_storefront_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront] =
            $this->seedDomainStore('inactive-store.example.com');
        $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $storefront->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->getJson($this->url('inactive-store.example.com', 'products'))->assertStatus(404);
    }

    // ── 7/8. Inactive / non-web SalesChannel ─────────────────────────────

    /** @test */
    public function an_inactive_sales_channel_fails_closed(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('inactive-channel.example.com');
        $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $channel->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $this->getJson($this->url('inactive-channel.example.com', 'products'))->assertStatus(404);
    }

    /** @test */
    public function a_channel_that_changes_away_from_web_type_can_no_longer_establish_storefront_authority(): void
    {
        // القناة كانت `web` صحيحة وقت ربط المتجر (يفرضه booted())، لكن هذا
        // الاختبار يثبت أن `ResolveStorefrontDomain` **يعيد التحقق حياً** من
        // النوع أيضاً — لا يثق بصحّة الربط وقت الإنشاء فقط.
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('type-changed.example.com');
        $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $channel->update(['type' => SalesChannel::TYPE_POS]);
        app(TenantContext::class)->forget();

        $this->getJson($this->url('type-changed.example.com', 'products'))->assertStatus(404);
    }

    // ── 9/10. Cross-tenant binding rejected at creation ──────────────────
    // مغطّاة بالكامل في StorefrontModelTest (مستوى النموذج المباشر) — لا
    // تكرار هنا؛ هذا الملف يغطي طبقة الحسم/HTTP فقط.

    // ── 11. Duplicate hostname ────────────────────────────────────────────
    // مغطّاة في StorefrontModelTest::duplicate_hostname_is_rejected_globally_even_across_tenants.

    // ── 12/13. Client-supplied tenant authority is inert ─────────────────

    /** @test */
    public function a_conflicting_client_supplied_tenant_id_never_changes_authority(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('e.example.com');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedDomainStore('f.example.com');

        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج هـ']);
        $this->publishedProduct($tenantB, $channelB, ['name' => 'منتج و']);

        // يحاول انتحال هوية tenantB عبر معامل استعلام أثناء الاتصال بنطاق tenantA.
        $res = $this->getJson($this->url('e.example.com', "products?tenant_id={$tenantB->id}"))->assertOk();
        $ids = collect($res->json('data'))->pluck('id')->all();

        $this->assertContains($productA->id, $ids);
        $this->assertCount(1, $ids, 'تجاهل tenant_id تماماً — لا يوسّع ولا يبدّل نطاق الكتالوج المُعاد.');
    }

    /** @test */
    public function a_tenant_like_client_header_or_cookie_never_changes_authority(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('g.example.com');
        ['tenant' => $tenantB] = $this->seedDomainStore('h.example.com');

        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج ز']);

        $res = $this->withHeaders(['X-Tenant-ID' => $tenantB->id])
            ->withCookie('tenant_id', $tenantB->id)
            ->getJson($this->url('g.example.com', 'products'))
            ->assertOk();

        $ids = collect($res->json('data'))->pluck('id')->all();
        $this->assertContains($productA->id, $ids);
        $this->assertCount(1, $ids);
    }

    /** @test */
    public function an_authorization_header_never_influences_domain_resolution(): void
    {
        // لا مصادقة على مسار المتجر العام إطلاقاً؛ ترويسة Authorization بأي
        // محتوى (حتى عشوائي) يجب ألا يُقرأ كسلطة مستأجر بأي شكل — القناة/
        // المتجر المحلولان يبقيان كما حسمهما الـ Host فقط.
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('auth-inert.example.com');
        $product = $this->publishedProduct($tenant, $channel);

        $res = $this->withHeaders(['Authorization' => 'Bearer '.Str::random(40)])
            ->getJson($this->url('auth-inert.example.com', 'products'))
            ->assertOk();

        $this->assertContains($product->id, collect($res->json('data'))->pluck('id')->all());
    }

    // ── 14. Locale never changes identity ────────────────────────────────

    /** @test */
    public function locale_switching_never_changes_the_resolved_tenant_storefront_or_channel(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('i.example.com');
        $productA = $this->publishedProduct($tenantA, $channelA, ['name' => 'منتج i']);

        $resAr = $this->withHeaders(['Accept-Language' => 'ar'])
            ->getJson($this->url('i.example.com', 'products?locale=ar'))
            ->assertOk();
        $resEn = $this->withHeaders(['Accept-Language' => 'en'])
            ->getJson($this->url('i.example.com', 'products?locale=en'))
            ->assertOk();

        $idsAr = collect($resAr->json('data'))->pluck('id')->all();
        $idsEn = collect($resEn->json('data'))->pluck('id')->all();

        $this->assertEquals($idsAr, $idsEn);
        $this->assertContains($productA->id, $idsAr);
    }

    // ── 15. No hostname-based cross-tenant catalog access ────────────────

    /** @test */
    public function direct_product_access_cannot_cross_tenant_through_hostname_manipulation(): void
    {
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('j.example.com');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedDomainStore('k.example.com');

        $productA = $this->publishedProduct($tenantA, $channelA);
        $productB = $this->publishedProduct($tenantB, $channelB);

        // كل مضيف يعيد فقط منتجه — لا معرّف صحيح لمنتج المستأجر الآخر يُقبل
        // بتغيير الـ Host وحده.
        $this->getJson($this->url('j.example.com', "products/{$productA->id}"))->assertOk();
        $this->getJson($this->url('j.example.com', "products/{$productB->id}"))->assertStatus(404);
        $this->getJson($this->url('k.example.com', "products/{$productB->id}"))->assertOk();
        $this->getJson($this->url('k.example.com', "products/{$productA->id}"))->assertStatus(404);
    }

    // ── 17. Primary-domain invariant ─────────────────────────────────────
    // مغطّاة في StorefrontModelTest::at_most_one_active_primary_domain_exists_per_storefront.

    // ── Non-primary but verified/active domain still resolves ───────────

    /** @test */
    public function a_non_primary_verified_active_domain_still_establishes_authority(): void
    {
        ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront] =
            $this->seedDomainStore('primary.example.com', ['is_primary' => true]);
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => 'secondary.example.com',
            'type' => StorefrontDomain::TYPE_AWJ_SUBDOMAIN,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);
        app(TenantContext::class)->forget();

        $res = $this->getJson($this->url('secondary.example.com', 'products'))->assertOk();
        $this->assertContains($product->id, collect($res->json('data'))->pluck('id')->all());
    }

    // ── Categories also isolated through the trusted host path ──────────

    /** @test */
    public function category_tree_is_tenant_isolated_through_the_host_resolved_path(): void
    {
        ['tenant' => $tenantA] = $this->seedDomainStore('l.example.com');
        ['tenant' => $tenantB] = $this->seedDomainStore('m.example.com');

        app(TenantContext::class)->set($tenantA->id);
        $active = \App\Models\ProductCategory::create(['name' => 'فئة أ', 'is_active' => true]);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($tenantB->id);
        \App\Models\ProductCategory::create(['name' => 'فئة ب', 'is_active' => true]);
        app(TenantContext::class)->forget();

        $res = $this->getJson($this->url('l.example.com', 'categories'))->assertOk();
        $names = collect($res->json('data'))->pluck('name')->all();

        $this->assertContains($active->name, $names);
        $this->assertNotContains('فئة ب', $names);
    }
}

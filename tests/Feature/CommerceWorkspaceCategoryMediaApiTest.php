<?php

namespace Tests\Feature;

use App\Models\CommerceCategoryListing;
use App\Models\ProductCategory;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Mockery;
use Tests\TestCase;

/**
 * AWJ-STORE-CAT-DESIGN-01 — صور التصنيفات لمعاينة Canvas: رابطٌ موقَّعٌ قصير الأجل يخدم بايتات تصنيفٍ **فعّالٍ ومنشورٍ على
 * قناة هذا المتجر ولمستأجره فقط**. يُثبت:
 *
 *  1. قائمة التصنيفات في مساحة العمل تُصدر `image_url` موقَّعاً (للتصنيف ذي الصورة فقط) و`color`، ولا تكشف مسار التخزين.
 *  2. المسار يخدم البايتات بلا ترويسة Authorization (طلب `<img src>` عادي) — وبلا أي تغيير في مسار المتجر العام.
 *  3. العزل: توقيعٌ صالحٌ لا يكفي لتصنيف مستأجرٍ آخر، ولا لتصنيفٍ غير منشور على قناة هذا المتجر، ولا لتصنيفٍ معطَّل.
 *  4. توقيعٌ مُزوَّر أو منتهٍ أو غائبٌ يُرفض؛ ومصادقة القائمة وعزل المتجر محفوظان.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceCategoryMediaApiTest
 */
class CommerceWorkspaceCategoryMediaApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
    }

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId, string $channelSlug = 'web'): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => $channelSlug, 'name' => 'ويب '.$channelSlug, 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'store-'.$channelSlug, 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function seedCategory(string $tenantId, SalesChannel $channel, array $attrs = [], bool $published = true): ProductCategory
    {
        app(TenantContext::class)->set($tenantId);

        $path = $attrs['image_path'] ?? null;
        $category = ProductCategory::create(array_merge([
            'name' => 'إلكترونيات', 'color' => '#12372a', 'is_active' => true,
            'image_path' => $path,
            'image_original_name' => $path ? 'electronics.webp' : null,
            'image_mime_type' => $path ? 'image/webp' : null,
            'image_size' => $path ? 11 : null,
        ], $attrs));
        if ($path) {
            Storage::disk('local')->put($path, 'image-bytes');
        }
        if ($published) {
            CommerceCategoryListing::create([
                'tenant_id' => $tenantId, 'category_id' => $category->id,
                'sales_channel_id' => $channel->id, 'is_published' => true,
            ]);
        }

        app(TenantContext::class)->forget();

        return $category;
    }

    private function signed(string $storefrontId, string $categoryId, int $minutes = 20): string
    {
        return URL::temporarySignedRoute(
            'commerce.workspace.category-media.show',
            now()->addMinutes($minutes),
            ['id' => $storefrontId, 'category' => $categoryId],
        );
    }

    private function categoriesPath(string $storefrontId): string
    {
        return '/api/commerce/workspace/storefronts/'.$storefrontId.'/categories';
    }

    // ── 1. القائمة تُصدر رابطاً موقَّعاً ولوناً، ولا تكشف مسار التخزين ─────

    /** @test */
    public function the_workspace_category_list_carries_a_signed_image_url_and_the_colour_but_never_the_storage_path(): void
    {
        $auth = $this->registerTenant('cat-media-list', 'owner@cat-media-list.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $withImage = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'أ مع صورة', 'image_path' => 'product-category-media/a.webp']);
        $bare = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'ب بلا صورة', 'color' => null]);

        $res = $this->withToken($auth['token'])
            ->getJson($this->categoriesPath($seeded['storefront']->id).'?root_only=true&with_media=true')
            ->assertOk();

        $rows = collect($res->json('data'))->keyBy('id');
        $this->assertSame('#12372a', $rows[$withImage->id]['color']);
        $this->assertNull($rows[$bare->id]['image_url']);
        $this->assertNull($rows[$bare->id]['color']);

        $url = $rows[$withImage->id]['image_url'];
        $this->assertSame(
            "/api/commerce/workspace/storefronts/{$seeded['storefront']->id}/category-media/{$withImage->id}",
            parse_url($url, PHP_URL_PATH),
        );
        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $this->assertArrayHasKey('signature', $query);
        $this->assertArrayHasKey('expires', $query);

        foreach ($res->json('data') as $row) {
            $this->assertArrayNotHasKey('image_path', $row);
            $this->assertArrayNotHasKey('tenant_id', $row);
        }
        $this->assertStringNotContainsString('product-category-media', json_encode($res->json()));
    }

    /** @test */
    public function without_with_media_the_payload_is_the_unchanged_minimal_shape_and_mints_no_signed_url(): void
    {
        $auth = $this->registerTenant('cat-media-min', 'owner@cat-media-min.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/min.webp']);

        $res = $this->withToken($auth['token'])
            ->getJson($this->categoriesPath($seeded['storefront']->id))
            ->assertOk();

        $this->assertEqualsCanonicalizing(['id', 'name', 'parent_id', 'parent_name'], array_keys($res->json('data.0')));
        $this->assertStringNotContainsString('signature', json_encode($res->json()));
    }

    /** @test */
    public function the_signed_url_expires_within_minutes(): void
    {
        $auth = $this->registerTenant('cat-media-ttl', 'owner@cat-media-ttl.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/ttl.webp']);

        $url = $this->withToken($auth['token'])
            ->getJson($this->categoriesPath($seeded['storefront']->id).'?with_media=true')
            ->assertOk()->json('data.0.image_url');

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        $lifetime = (int) $query['expires'] - now()->timestamp;
        $this->assertGreaterThan(60, $lifetime);
        $this->assertLessThanOrEqual(21 * 60, $lifetime);
        $this->assertNotNull($category->id);
    }

    // ── 2. البايتات بلا Authorization ────────────────────────────────────

    /** @test */
    public function a_valid_signed_url_serves_the_bytes_with_no_authorization_header(): void
    {
        $auth = $this->registerTenant('cat-media-ok', 'owner@cat-media-ok.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/ok.webp']);

        $url = $this->withToken($auth['token'])
            ->getJson($this->categoriesPath($seeded['storefront']->id).'?with_media=true')
            ->assertOk()->json('data.0.image_url');

        $this->flushHeaders()
            ->get($url)
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp')
            ->assertHeader('X-Content-Type-Options', 'nosniff');
        $cache = (string) $this->flushHeaders()->get($url)->headers->get('Cache-Control');
        $this->assertStringContainsString('private', $cache); // a signed, per-merchant URL is never shared-cacheable
        $this->assertStringContainsString('max-age=600', $cache);
        $this->assertStringNotContainsString('public', $cache);
        $this->assertNotNull($category->id);
    }

    /** @test */
    public function the_public_storefront_category_image_route_is_unchanged(): void
    {
        // (محروسٌ تفصيلاً بـStorefrontCategoryMediaTest الذي لم يُعدَّل؛ هنا فقط أن الاستخراج إلى trait لم يغيّر العقد.)
        $this->assertTrue(trait_exists(\App\Http\Controllers\Api\ServesCategoryImageBytes::class));
        $this->assertContains(
            \App\Http\Controllers\Api\ServesCategoryImageBytes::class,
            class_uses(\App\Http\Controllers\Api\StorefrontMediaController::class),
        );
    }

    // ── 3. العزل ─────────────────────────────────────────────────────────

    /** @test */
    public function another_tenants_category_is_never_served_even_under_a_valid_signature_for_this_storefront(): void
    {
        $a = $this->registerTenant('cat-media-iso-a', 'owner@cat-media-iso-a.test');
        $b = $this->registerTenant('cat-media-iso-b', 'owner@cat-media-iso-b.test');
        $storeA = $this->seedWebStorefront($a['tenant_id']);
        $storeB = $this->seedWebStorefront($b['tenant_id']);
        $foreign = $this->seedCategory($b['tenant_id'], $storeB['channel'], ['image_path' => 'product-category-media/foreign.webp']);

        $this->flushHeaders()->get($this->signed($storeA['storefront']->id, $foreign->id))->assertNotFound();
        // …ولا عبر متجر صاحبه أيضاً بمعرّف متجرٍ غير مطابق لتصنيفه.
        $mine = $this->seedCategory($a['tenant_id'], $storeA['channel'], ['image_path' => 'product-category-media/mine.webp']);
        $this->flushHeaders()->get($this->signed($storeB['storefront']->id, $mine->id))->assertNotFound();
        $this->flushHeaders()->get($this->signed($storeA['storefront']->id, $mine->id))->assertOk();
    }

    /** @test */
    public function a_category_not_published_on_this_storefronts_channel_is_not_served(): void
    {
        $auth = $this->registerTenant('cat-media-chan', 'owner@cat-media-chan.test');
        $web = $this->seedWebStorefront($auth['tenant_id'], 'web');
        $other = $this->seedWebStorefront($auth['tenant_id'], 'wholesale');

        $unpublished = $this->seedCategory($auth['tenant_id'], $web['channel'], ['image_path' => 'product-category-media/u.webp'], published: false);
        $onlyOther = $this->seedCategory($auth['tenant_id'], $other['channel'], ['image_path' => 'product-category-media/o.webp']);

        $this->flushHeaders()->get($this->signed($web['storefront']->id, $unpublished->id))->assertNotFound();
        // منشورٌ على القناة الشقيقة لنفس المستأجر لا يُخدَم من متجر القناة الأخرى.
        $this->flushHeaders()->get($this->signed($web['storefront']->id, $onlyOther->id))->assertNotFound();
        $this->flushHeaders()->get($this->signed($other['storefront']->id, $onlyOther->id))->assertOk();
    }

    /** @test */
    public function an_inactive_category_or_one_without_an_image_or_unknown_ids_are_a_uniform_404(): void
    {
        $auth = $this->registerTenant('cat-media-404', 'owner@cat-media-404.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $inactive = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/i.webp', 'is_active' => false]);
        $noImage = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'بلا صورة']);

        $this->flushHeaders()->get($this->signed($seeded['storefront']->id, $inactive->id))->assertNotFound();
        $this->flushHeaders()->get($this->signed($seeded['storefront']->id, $noImage->id))->assertNotFound();
        $this->flushHeaders()->get($this->signed($seeded['storefront']->id, '11111111-1111-4111-8111-111111111111'))->assertNotFound();
        $this->flushHeaders()->get($this->signed('22222222-2222-4222-8222-222222222222', $noImage->id))->assertNotFound();
    }

    // ── 4. التوقيع ───────────────────────────────────────────────────────

    /** @test */
    public function an_unsigned_tampered_or_expired_url_is_rejected(): void
    {
        $auth = $this->registerTenant('cat-media-sig', 'owner@cat-media-sig.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/sig.webp']);
        $other = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'آخر', 'image_path' => 'product-category-media/sig2.webp']);

        $plain = "/api/commerce/workspace/storefronts/{$seeded['storefront']->id}/category-media/{$category->id}";
        $this->flushHeaders()->get($plain)->assertForbidden();

        $signed = $this->signed($seeded['storefront']->id, $category->id);
        // تبديل المعرّف مع إبقاء التوقيع القديم.
        $swapped = str_replace($category->id, $other->id, $signed);
        $this->flushHeaders()->get($swapped)->assertForbidden();

        // انتهاء الصلاحية.
        $expired = $this->signed($seeded['storefront']->id, $category->id, minutes: -5);
        $this->flushHeaders()->get($expired)->assertForbidden();

        $this->flushHeaders()->get($signed)->assertOk();
    }

    // ── 5. المصادقة وعزل المتجر على القائمة ─────────────────────────────

    /** @test */
    public function the_list_still_needs_authentication_and_the_right_storefront(): void
    {
        $a = $this->registerTenant('cat-media-auth-a', 'owner@cat-media-auth-a.test');
        $b = $this->registerTenant('cat-media-auth-b', 'owner@cat-media-auth-b.test');
        $storeA = $this->seedWebStorefront($a['tenant_id']);
        $this->seedCategory($a['tenant_id'], $storeA['channel'], ['image_path' => 'product-category-media/auth.webp']);

        $this->flushHeaders()->getJson($this->categoriesPath($storeA['storefront']->id))->assertUnauthorized();
        $this->withToken($b['token'])->getJson($this->categoriesPath($storeA['storefront']->id))->assertNotFound();
    }

    // ── 5b. سلبيات أمنية (قرار المالك: تحقّق من العزل والتوقيع والصلاحية ومنع غير المصرَّح) ─────────

    /** @test */
    public function minting_signed_urls_needs_commerce_manage_and_a_live_subscription(): void
    {
        $auth = $this->registerTenant('cat-media-perm', 'owner@cat-media-perm.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/perm.webp']);
        $path = $this->categoriesPath($seeded['storefront']->id).'?with_media=true';

        foreach (['self_service', 'staff'] as $role) {
            $token = $this->tokenForRole($auth['tenant_id'], $role, "{$role}@cat-media-perm.test");
            $res = $this->flushHeaders()->withToken($token)->getJson($path)->assertForbidden();
            $this->assertStringNotContainsString('signature', $res->getContent(), "{$role} must never receive a signed URL");
        }

        \App\Models\Tenant::query()->where('id', $auth['tenant_id'])->update(['trial_ends_at' => now()->subDay()]);
        $res = $this->flushHeaders()->withToken($auth['token'])->getJson($path)->assertStatus(403);
        $this->assertStringNotContainsString('signature', $res->getContent());
    }

    /** @test */
    public function the_preview_list_never_exposes_a_category_the_storefront_may_not_show_nor_its_picture_url(): void
    {
        $a = $this->registerTenant('cat-media-leak-a', 'owner@cat-media-leak-a.test');
        $b = $this->registerTenant('cat-media-leak-b', 'owner@cat-media-leak-b.test');
        $web = $this->seedWebStorefront($a['tenant_id'], 'web');
        $other = $this->seedWebStorefront($a['tenant_id'], 'wholesale');
        $storeB = $this->seedWebStorefront($b['tenant_id']);

        $visible = $this->seedCategory($a['tenant_id'], $web['channel'], ['name' => 'ظاهر', 'image_path' => 'product-category-media/v.webp']);
        $this->seedCategory($a['tenant_id'], $web['channel'], ['name' => 'غير منشور', 'image_path' => 'product-category-media/u.webp'], published: false);
        $this->seedCategory($a['tenant_id'], $web['channel'], ['name' => 'معطّل', 'image_path' => 'product-category-media/i.webp', 'is_active' => false]);
        $this->seedCategory($a['tenant_id'], $other['channel'], ['name' => 'قناة أخرى', 'image_path' => 'product-category-media/o.webp']);
        $this->seedCategory($b['tenant_id'], $storeB['channel'], ['name' => 'مستأجر آخر', 'image_path' => 'product-category-media/b.webp']);

        $res = $this->withToken($a['token'])
            ->getJson($this->categoriesPath($web['storefront']->id).'?with_media=true&per_page=50')
            ->assertOk();

        $this->assertSame([$visible->id], collect($res->json('data'))->pluck('id')->all());
        $this->assertSame(1, substr_count(json_encode($res->json('data'), JSON_UNESCAPED_SLASHES), 'category-media/'));
        foreach (['غير منشور', 'معطّل', 'قناة أخرى', 'مستأجر آخر'] as $hidden) {
            $this->assertStringNotContainsString($hidden, $res->getContent());
        }
    }

    /** @test */
    public function a_signed_url_cannot_be_repurposed_for_another_storefront_category_or_parameter(): void
    {
        $auth = $this->registerTenant('cat-media-repurpose', 'owner@cat-media-repurpose.test');
        $web = $this->seedWebStorefront($auth['tenant_id'], 'web');
        $other = $this->seedWebStorefront($auth['tenant_id'], 'wholesale');
        $category = $this->seedCategory($auth['tenant_id'], $web['channel'], ['image_path' => 'product-category-media/r1.webp']);
        $sibling = $this->seedCategory($auth['tenant_id'], $web['channel'], ['name' => 'شقيق', 'image_path' => 'product-category-media/r2.webp']);

        $signed = $this->signed($web['storefront']->id, $category->id);

        // another storefront id in the path, same signature
        $this->flushHeaders()->get(str_replace($web['storefront']->id, $other['storefront']->id, $signed))->assertForbidden();
        // another category id in the path, same signature
        $this->flushHeaders()->get(str_replace($category->id, $sibling->id, $signed))->assertForbidden();
        // an extra query parameter, same signature
        $this->flushHeaders()->get($signed.'&path=../../etc/passwd')->assertForbidden();
        $this->flushHeaders()->get($signed.'&disk=local')->assertForbidden();
        // a longer expiry than was signed
        $this->flushHeaders()->get(preg_replace('/expires=\d+/', 'expires='.(now()->addDays(30)->timestamp), $signed))->assertForbidden();
        // the genuine URL still works, and nothing a client sends changes what is read
        $this->flushHeaders()->get($signed)->assertOk();
    }

    /** @test */
    public function a_valid_signature_is_not_a_standing_grant_it_dies_when_the_category_is_unpublished_or_deactivated(): void
    {
        $auth = $this->registerTenant('cat-media-revoke', 'owner@cat-media-revoke.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['image_path' => 'product-category-media/rv.webp']);
        $url = $this->signed($seeded['storefront']->id, $category->id);

        $this->flushHeaders()->get($url)->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        CommerceCategoryListing::query()->where('category_id', $category->id)->update(['is_published' => false]);
        app(TenantContext::class)->forget();
        $this->flushHeaders()->get($url)->assertNotFound();

        app(TenantContext::class)->set($auth['tenant_id']);
        CommerceCategoryListing::query()->where('category_id', $category->id)->update(['is_published' => true]);
        ProductCategory::query()->where('id', $category->id)->update(['is_active' => false]);
        app(TenantContext::class)->forget();
        $this->flushHeaders()->get($url)->assertNotFound();
    }

    /** @test */
    public function only_get_is_accepted_ids_must_be_uuids_and_failures_reveal_nothing_about_existence(): void
    {
        $a = $this->registerTenant('cat-media-neg-a', 'owner@cat-media-neg-a.test');
        $b = $this->registerTenant('cat-media-neg-b', 'owner@cat-media-neg-b.test');
        $storeA = $this->seedWebStorefront($a['tenant_id']);
        $storeB = $this->seedWebStorefront($b['tenant_id']);
        $mine = $this->seedCategory($a['tenant_id'], $storeA['channel'], ['image_path' => 'product-category-media/n1.webp']);
        $foreign = $this->seedCategory($b['tenant_id'], $storeB['channel'], ['image_path' => 'product-category-media/n2.webp']);

        $signed = $this->signed($storeA['storefront']->id, $mine->id);
        foreach (['post', 'put', 'patch', 'delete'] as $method) {
            $this->flushHeaders()->call($method, $signed)->assertStatus(405);
        }

        // non-UUID ids never reach the controller, even under a valid signature
        $this->flushHeaders()->get($this->signed($storeA['storefront']->id, '../../etc/passwd'))->assertNotFound();
        $this->flushHeaders()->get($this->signed('not-a-uuid', $mine->id))->assertNotFound();

        // a foreign category and a non-existent one are indistinguishable
        $foreignRes = $this->flushHeaders()->get($this->signed($storeA['storefront']->id, $foreign->id));
        $unknownRes = $this->flushHeaders()->get($this->signed($storeA['storefront']->id, '33333333-3333-4333-8333-333333333333'));
        $this->assertSame($unknownRes->getStatusCode(), $foreignRes->getStatusCode());
        // (compare the message, not the body: debug builds append a stack trace that differs by call site)
        $this->assertSame($unknownRes->json('message'), $foreignRes->json('message'));

        // success carries no cookie and is not shared-cacheable
        $ok = $this->flushHeaders()->get($signed)->assertOk();
        $this->assertCount(0, $ok->headers->getCookies());
        $this->assertStringNotContainsString('public', (string) $ok->headers->get('Cache-Control'));
    }

    // ── 6. R2 ────────────────────────────────────────────────────────────

    /** @test */
    public function an_r2_category_image_is_read_under_the_storefronts_own_tenant(): void
    {
        $auth = $this->registerTenant('cat-media-r2', 'owner@cat-media-r2.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);
        $category = $this->seedCategory($auth['tenant_id'], $seeded['channel'], ['name' => 'R2']);
        $category->withoutGlobalScopes()->where('id', $category->id)->update([
            'image_path' => "tenant/{$auth['tenant_id']}/product-category-media/{$category->id}/category.webp",
            'image_original_name' => 'category.webp',
            'image_mime_type' => 'image/webp',
            'image_size' => 7,
        ]);

        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key', 'secret' => 'placeholder-secret', 'bucket' => 'awj-category-media-test',
            'endpoint' => 'https://placeholder.r2.cloudflarestorage.com', 'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);
        $client = Mockery::mock(S3ClientInterface::class);
        $client->shouldReceive('getObject')->once()->with(Mockery::on(
            fn (array $args): bool => $args['Bucket'] === 'awj-category-media-test'
                && $args['Key'] === "tenant/{$auth['tenant_id']}/product-category-media/{$category->id}/category.webp",
        ))->andReturn(['Body' => 'r2-data']);
        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        $this->flushHeaders()
            ->get($this->signed($seeded['storefront']->id, $category->id))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');

        // وسياق المستأجر لم يتسرّب خارج الطلب.
        $this->assertFalse(app(TenantContext::class)->has());
    }
}

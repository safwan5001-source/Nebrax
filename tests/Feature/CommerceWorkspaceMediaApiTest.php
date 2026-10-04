<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * CUST-H4-8b — وسائط مساحة عمل Commerce الموقَّعة لـ Canvas (وصل حديثاً/
 * مميّزة/عروض). يثبت:
 *
 *  1. حمولتا `CommerceWorkspaceStorefrontProductController::index()` و
 *     `StorefrontOfferResource::workspace()` تُشيران إلى المسار الجديد
 *     الموقَّع، لا `/commerce/v1/media` المحروس بـBearer.
 *  2. المسار نفسه يخدم البايتات **بلا أي ترويسة Authorization** — يحاكي
 *     طلب `<img src>` عادياً من متصفّح التاجر.
 *  3. عزل المستأجر/المتجر/النشر محفوظٌ حتى مع توقيعٍ صالحٍ لزوج معرّفاتٍ
 *     غير متطابقٍ فعلياً (دفاعٌ في العمق مستقلٌ عن مصدر الرابط).
 *  4. توقيعٌ منتهي الصلاحية أو مُزوَّر يُرفض.
 *
 * تشغيل: php artisan test --filter=CommerceWorkspaceMediaApiTest
 */
class CommerceWorkspaceMediaApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array{channel: SalesChannel, storefront: Storefront} */
    private function seedWebStorefront(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        app(TenantContext::class)->forget();

        return compact('channel', 'storefront');
    }

    private function seedPublishedProduct(SalesChannel $channel, array $attrs = []): Product
    {
        $product = Product::create(array_merge([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج', 'name_en' => 'Product',
            'type' => 'good', 'unit' => 'piece', 'sale_price' => 25000, 'tax_rate' => 15, 'is_active' => true,
        ], $attrs));

        CommerceListing::create([
            'product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true,
        ]);

        return $product->fresh();
    }

    private function attachMedia(Product $product, string $filename = 'pineapple.webp'): ProductMedia
    {
        Storage::disk('local')->put("products/{$filename}", 'image-bytes');

        return ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'local',
            'path' => "products/{$filename}",
            'original_name' => 'IMG_0363.webp',
            'mime_type' => 'image/webp',
            'size' => 11,
            'sort_order' => 0,
        ]);
    }

    private function signedWorkspaceMediaUrl(string $storefrontId, string $mediaId, int $minutes = 20): string
    {
        return URL::temporarySignedRoute(
            'commerce.workspace.media.show',
            now()->addMinutes($minutes),
            ['id' => $storefrontId, 'media' => $mediaId],
        );
    }

    // ── 1. الحمولة تُشير إلى المسار الموقَّع، لا /commerce/v1/media ────────

    /** @test */
    public function the_workspace_product_list_thumbnail_points_to_the_signed_workspace_media_route_not_commerce_v1(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-list', 'owner@ws-media-list.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $res = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/products')
            ->assertOk();

        $row = collect($res->json('data'))->firstWhere('id', $product->id);
        $this->assertNotNull($row['thumbnail_url']);
        $path = parse_url($row['thumbnail_url'], PHP_URL_PATH);
        $this->assertSame(
            "/api/commerce/workspace/storefronts/{$seeded['storefront']->id}/media/{$media->id}",
            $path,
        );
        $this->assertStringNotContainsString('/commerce/v1/media', $row['thumbnail_url']);
        parse_str((string) parse_url($row['thumbnail_url'], PHP_URL_QUERY), $query);
        $this->assertArrayHasKey('signature', $query);
        $this->assertArrayHasKey('expires', $query);
    }

    /** @test */
    public function the_workspace_offer_thumbnail_uses_the_same_signed_contract(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-offer', 'owner@ws-media-offer.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $this->withToken($auth['token'])
            ->postJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/offers', [
                'product_id' => $product->id,
            ])->assertCreated();

        $res = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/offers')
            ->assertOk();

        $thumbnailUrl = $res->json('data.0.product.thumbnail_url');
        $this->assertNotNull($thumbnailUrl);
        $this->assertSame(
            "/api/commerce/workspace/storefronts/{$seeded['storefront']->id}/media/{$media->id}",
            parse_url($thumbnailUrl, PHP_URL_PATH),
        );
    }

    // ── 2. تُخدَّم البايتات بلا أي ترويسة Authorization ────────────────────

    /** @test */
    public function the_signed_url_serves_bytes_with_no_authorization_header_at_all_like_a_plain_img_tag(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-bytes', 'owner@ws-media-bytes.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $url = $this->signedWorkspaceMediaUrl($seeded['storefront']->id, $media->id);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        // عمداً بلا Authorization — هذا هو الفرق الجوهري عن /commerce/v1/media.
        $this->get($path)
            ->assertOk()
            ->assertHeader('Content-Type', 'image/webp');
    }

    /** @test */
    public function the_response_is_marked_private_not_shareable_by_a_proxy_or_cdn(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-cache', 'owner@ws-media-cache.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $url = $this->signedWorkspaceMediaUrl($seeded['storefront']->id, $media->id);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertOk()->assertHeader('Cache-Control', 'max-age=600, private');
    }

    // ── 3. دفاعٌ في العمق: عزل المستأجر/المتجر/النشر مستقلٌّ عن مصدر الرابط ──

    /** @test */
    public function a_validly_signed_url_for_a_foreign_tenants_media_is_still_rejected(): void
    {
        Storage::fake('local');
        $a = $this->registerTenant('ws-media-foreign-a', 'owner@ws-media-foreign-a.test');
        $b = $this->registerTenant('ws-media-foreign-b', 'owner@ws-media-foreign-b.test');

        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($b['tenant_id']);
        $productB = $this->seedPublishedProduct($seededB['channel']);
        $mediaB = $this->attachMedia($productB);
        app(TenantContext::class)->forget();

        // توقيعٌ صالحٌ رياضياً لزوج (متجر أ، وسائط ب) — لا يمكن إنتاجه عبر
        // التدفّق الطبيعي، لكن يثبت أن المتحكّم نفسه يفحص تطابق المستأجر لا
        // التوقيع وحده.
        $url = $this->signedWorkspaceMediaUrl($seededA['storefront']->id, $mediaB->id);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertStatus(404);
    }

    /** @test */
    public function media_of_a_product_unpublished_on_that_storefronts_channel_is_not_served(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-unpub', 'owner@ws-media-unpub.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'is_active' => true,
        ]);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $url = $this->signedWorkspaceMediaUrl($seeded['storefront']->id, $media->id);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertStatus(404);
    }

    /** @test */
    public function media_published_only_on_a_sibling_storefronts_channel_is_not_served_via_this_storefront(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-sibling', 'owner@ws-media-sibling.test');
        $seededA = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $channelB = SalesChannel::create([
            'slug' => 'web2', 'name' => 'ويب ٢', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefrontB = Storefront::create([
            'slug' => 'second', 'name' => 'متجر ثانٍ', 'sales_channel_id' => $channelB->id, 'is_active' => true,
        ]);
        // منشورٌ على قناة المتجر الثاني فقط، لا الأول.
        $product = $this->seedPublishedProduct($channelB);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $urlViaA = $this->signedWorkspaceMediaUrl($seededA['storefront']->id, $media->id);
        $pathViaA = parse_url($urlViaA, PHP_URL_PATH).'?'.parse_url($urlViaA, PHP_URL_QUERY);
        $this->get($pathViaA)->assertStatus(404);

        $urlViaB = $this->signedWorkspaceMediaUrl($storefrontB->id, $media->id);
        $pathViaB = parse_url($urlViaB, PHP_URL_PATH).'?'.parse_url($urlViaB, PHP_URL_QUERY);
        $this->get($pathViaB)->assertOk();
    }

    /** @test */
    public function a_nonexistent_media_id_returns_a_non_revealing_404(): void
    {
        $auth = $this->registerTenant('ws-media-missing', 'owner@ws-media-missing.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $url = $this->signedWorkspaceMediaUrl($seeded['storefront']->id, (string) Str::uuid());
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertStatus(404);
    }

    /** @test */
    public function a_nonexistent_storefront_id_returns_a_non_revealing_404(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-missing-sf', 'owner@ws-media-missing-sf.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $url = $this->signedWorkspaceMediaUrl((string) Str::uuid(), $media->id);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertStatus(404);
    }

    // ── 4. سلامة التوقيع ─────────────────────────────────────────────────

    /** @test */
    public function an_expired_signed_url_is_rejected(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-expired', 'owner@ws-media-expired.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $media = $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $url = $this->signedWorkspaceMediaUrl($seeded['storefront']->id, $media->id, -1);
        $path = parse_url($url, PHP_URL_PATH).'?'.parse_url($url, PHP_URL_QUERY);

        $this->get($path)->assertStatus(403);
    }

    /** @test */
    public function a_tampered_media_id_with_a_reused_signature_is_rejected(): void
    {
        Storage::fake('local');
        $a = $this->registerTenant('ws-media-tamper-a', 'owner@ws-media-tamper-a.test');
        $b = $this->registerTenant('ws-media-tamper-b', 'owner@ws-media-tamper-b.test');
        $seededA = $this->seedWebStorefront($a['tenant_id']);
        $seededB = $this->seedWebStorefront($b['tenant_id']);

        app(TenantContext::class)->set($a['tenant_id']);
        $productA = $this->seedPublishedProduct($seededA['channel']);
        $mediaA = $this->attachMedia($productA);
        app(TenantContext::class)->forget();

        app(TenantContext::class)->set($b['tenant_id']);
        $productB = $this->seedPublishedProduct($seededB['channel']);
        $mediaB = $this->attachMedia($productB, 'mango.webp');
        app(TenantContext::class)->forget();

        $validUrl = $this->signedWorkspaceMediaUrl($seededA['storefront']->id, $mediaA->id);
        $tamperedUrl = str_replace($mediaA->id, $mediaB->id, $validUrl);
        $this->assertNotSame($validUrl, $tamperedUrl);

        $path = parse_url($tamperedUrl, PHP_URL_PATH).'?'.parse_url($tamperedUrl, PHP_URL_QUERY);
        $this->get($path)->assertStatus(403);
    }

    /** @test */
    public function a_malformed_non_uuid_media_id_is_rejected_regardless_of_signature(): void
    {
        $auth = $this->registerTenant('ws-media-malformed', 'owner@ws-media-malformed.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        $this->get('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/media/not-a-uuid')
            ->assertStatus(404);
    }

    /** @test */
    public function no_sensitive_storage_path_or_disk_leaks_in_the_workspace_product_payload(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('ws-media-no-leak', 'owner@ws-media-no-leak.test');
        $seeded = $this->seedWebStorefront($auth['tenant_id']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $product = $this->seedPublishedProduct($seeded['channel']);
        $this->attachMedia($product);
        app(TenantContext::class)->forget();

        $body = $this->withToken($auth['token'])
            ->getJson('/api/commerce/workspace/storefronts/'.$seeded['storefront']->id.'/products/'.$product->id)
            ->assertOk()
            ->json('data');

        $encoded = json_encode($body);
        $this->assertStringNotContainsString('products/pineapple.webp', $encoded);
        $this->assertStringNotContainsString('"disk"', $encoded);
        $this->assertStringNotContainsString('"path"', $encoded);
    }
}

<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontDomain;
use App\Models\Tenant;
use App\Services\R2StorageService;
use App\Services\ProductMediaService;
use App\Tenancy\TenantContext;
use Aws\S3\S3ClientInterface;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Mockery;
use Mockery\MockInterface;
use Tests\TestCase;

/**
 * AWJ-R2-5 — Storefront product image visibility, trusted host-resolution
 * path (`ResolveStorefrontDomain`, production authority, COM-7-P2A).
 *
 * قبل هذا الاختبار، كل تغطية `thumbnail_url`/`media[].url` القائمة
 * (`StorefrontCatalogApiTest`) كانت تمرّ حصراً عبر المسار المتوارَث
 * `{tenantSlug}` — تطويري/اختباري محضٌ، **لا يُسجَّل في `production` أصلاً**
 * (`routes/api_storefront.php`). لا اختبار كان يثبت شكل الرابط الذي يولّده
 * `StorefrontProductResource::buildMediaUrl()` على مسار الإنتاج الفعلي
 * (Host مُحلَّل عبر `ResolveStorefrontDomain`، بلا `{tenantSlug}`).
 *
 * الدليل: `route()` غير المُقيَّد بـ`absolute: false` يبني الرابط من مضيف
 * الطلب الوارد فعلياً — وفي الإنتاج ذاك مضيف Laravel/الـ API نفسه (خادم
 * Next.js هو المستدعي الوحيد لـ`store/v1`)، لا نطاق متجر الزائر العام. هذا
 * الملف يثبّت أن الرابط الناتج **نسبيٌّ دوماً** (بلا مخطّط/مضيف) على هذا
 * المسار تحديداً، وأنه يخدم بايتات R2 فعلية، وأن حراسة النشر/العزل بين
 * المستأجرين تبقى قائمة — دون افتراض أي مضيفٍ بعينه.
 */
class StorefrontDomainMediaVisibilityTest extends TestCase
{
    use RefreshDatabase;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    private function mockR2(): MockInterface
    {
        config()->set('filesystems.disks.r2', [
            'key' => 'placeholder-key', 'secret' => 'placeholder-secret',
            'bucket' => 'awj-product-media-test', 'endpoint' => 'https://placeholder.r2.cloudflarestorage.com',
            'region' => 'auto', 'use_path_style_endpoint' => false,
        ]);

        $client = Mockery::mock(S3ClientInterface::class);
        $this->app->instance(R2StorageService::class, new R2StorageService(app(TenantContext::class), $client));

        return $client;
    }

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function seedDomainStore(string $hostname): array
    {
        $tenant = Tenant::create([
            'name' => "متجر {$hostname}", 'slug' => 'store-'.Str::random(8),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);

        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'المتجر الإلكتروني', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);

        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'المتجر الرئيسي', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        StorefrontDomain::create([
            'storefront_id' => $storefront->id,
            'hostname' => $hostname,
            'type' => StorefrontDomain::TYPE_CUSTOM,
            'is_active' => true,
            'verification_status' => StorefrontDomain::VERIFICATION_VERIFIED,
        ]);

        app(TenantContext::class)->forget();

        return compact('tenant', 'channel', 'storefront');
    }

    private function publishedProduct(Tenant $tenant, SalesChannel $channel): Product
    {
        app(TenantContext::class)->set($tenant->id);

        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج منشور', 'type' => 'good', 'unit' => 'piece',
            'sale_price' => 25000, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => true]);

        app(TenantContext::class)->forget();

        return $product->fresh();
    }

    private function attachR2Media(Product $product, MockInterface $client, string $bytes = 'r2-storefront-bytes'): ProductMedia
    {
        $key = "tenant/{$product->tenant_id}/product-media/{$product->id}/store.webp";
        $client->shouldReceive('getObject')->with(['Bucket' => 'awj-product-media-test', 'Key' => $key])
            ->andReturn(['Body' => $bytes]);

        app(TenantContext::class)->set($product->tenant_id);
        $media = ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'r2', 'path' => $key,
            'original_name' => 'store.webp', 'mime_type' => 'image/webp', 'size' => strlen($bytes), 'sort_order' => 0,
        ]);
        app(TenantContext::class)->forget();

        return $media;
    }

    /** @test */
    public function published_product_with_r2_media_returns_a_host_relative_storefront_thumbnail_url(): void
    {
        $client = $this->mockR2();
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('r2-store-1.example.com');
        $product = $this->publishedProduct($tenant, $channel);
        $media = $this->attachR2Media($product, $client);

        $list = $this->getJson('http://r2-store-1.example.com/store/v1/products')->assertOk();
        $item = collect($list->json('data'))->firstWhere('id', $product->id);

        // نسبيّ دوماً — بلا مخطّط ولا مضيف، بغضّ النظر عن مضيف الطلب الوارد
        // فعلياً (`ResolveStorefrontDomain` يحسم المستأجر من ترويسة موثوقة لا
        // من هذا المضيف، و`route()` كان سيلتقط مضيف الطلب هذا لو تُرك مطلقاً).
        $this->assertSame("/store/v1/media/{$media->id}", $item['thumbnail_url']);

        $bytes = $this->get($item['thumbnail_url'])
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('r2-storefront-bytes', $bytes->streamedContent());
    }

    /** @test */
    public function published_storefront_card_derivative_uses_the_existing_public_media_boundary(): void
    {
        Storage::fake('local');
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('derivative-store.example.com');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $media = ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'local',
            'path' => 'products/card-source.webp',
            'original_name' => 'card-source.webp',
            'mime_type' => 'image/webp',
            'size' => 14,
            'sort_order' => 0,
        ]);
        $cardPath = app(ProductMediaService::class)->derivativePath($media, 'card');
        Storage::disk('local')->put($media->path, 'original-bytes');
        Storage::disk('local')->put($cardPath, 'card-derivative-bytes');
        app(TenantContext::class)->forget();

        $item = collect($this->getJson('http://derivative-store.example.com/store/v1/products')->assertOk()->json('data'))
            ->firstWhere('id', $product->id);
        $cardUrl = "/store/v1/media/{$media->id}/derivatives/card";

        $this->assertSame($cardUrl, $item['card_url']);
        $this->assertSame($cardUrl, $this->getJson("http://derivative-store.example.com/store/v1/products/{$product->id}")
            ->json('data.media.0.card_url'));
        $this->assertSame('card-derivative-bytes', $this->get("http://derivative-store.example.com{$cardUrl}")
            ->assertOk()->assertHeader('Content-Type', 'image/webp')->streamedContent());
    }

    /** @test */
    public function legacy_storefront_media_card_url_falls_back_to_the_original_without_a_storage_probe_in_catalog_serialization(): void
    {
        Storage::fake('local');
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('legacy-derivative-store.example.com');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $media = ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'local',
            'path' => 'products/legacy-card.webp',
            'original_name' => 'legacy-card.webp',
            'mime_type' => 'image/webp',
            'size' => 13,
            'sort_order' => 0,
        ]);
        Storage::disk('local')->put($media->path, 'legacy-original-bytes');
        app(TenantContext::class)->forget();

        $cardUrl = "/store/v1/media/{$media->id}/derivatives/card";
        $item = collect($this->getJson('http://legacy-derivative-store.example.com/store/v1/products')->assertOk()->json('data'))
            ->firstWhere('id', $product->id);

        $this->assertSame($cardUrl, $item['card_url']);
        $this->assertSame('legacy-original-bytes', $this->get("http://legacy-derivative-store.example.com{$cardUrl}")
            ->assertOk()->assertHeader('Content-Type', 'image/webp')->streamedContent());
    }

    /** @test */
    public function storefront_product_detail_media_is_also_host_relative_and_serves_r2_bytes(): void
    {
        $client = $this->mockR2();
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('r2-store-2.example.com');
        $product = $this->publishedProduct($tenant, $channel);
        $media = $this->attachR2Media($product, $client);

        $show = $this->getJson("http://r2-store-2.example.com/store/v1/products/{$product->id}")->assertOk();

        $this->assertSame("/store/v1/media/{$media->id}", $show->json('data.thumbnail_url'));
        $this->assertSame($media->id, $show->json('data.media.0.id'));
        $this->assertSame("/store/v1/media/{$media->id}", $show->json('data.media.0.url'));

        $this->get($show->json('data.media.0.url'))
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
    }

    /** @test */
    public function unpublished_product_media_remains_inaccessible_through_the_trusted_domain_path(): void
    {
        $client = $this->mockR2();
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('r2-store-3.example.com');

        app(TenantContext::class)->set($tenant->id);
        $product = Product::create([
            'sku' => 'SKU-'.Str::random(6), 'name' => 'منتج غير منشور', 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 25000, 'is_active' => true,
        ]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $channel->id, 'is_published' => false]);
        app(TenantContext::class)->forget();

        $media = $this->attachR2Media($product, $client);

        // معرّفٌ صحيح لصورةٍ فعلية — لكن منتجها غير منشور على هذه القناة.
        $this->getJson("http://r2-store-3.example.com/store/v1/media/{$media->id}")->assertStatus(404);
        $this->getJson("http://r2-store-3.example.com/store/v1/media/{$media->id}/derivatives/card")->assertStatus(404);
    }

    /** @test */
    public function cross_tenant_media_access_remains_blocked_through_the_trusted_domain_path(): void
    {
        $client = $this->mockR2();
        ['tenant' => $tenantA, 'channel' => $channelA] = $this->seedDomainStore('r2-store-a.example.com');
        ['tenant' => $tenantB, 'channel' => $channelB] = $this->seedDomainStore('r2-store-b.example.com');

        $productB = $this->publishedProduct($tenantB, $channelB);
        $mediaB = $this->attachR2Media($productB, $client);

        // نطاق المستأجر أ يخدم بايتات وسائط منتجٍ منشورٍ فعلاً — لكن على قناة
        // مستأجرٍ آخر تماماً. حراسة `StorefrontMediaController::show()` تتحقق
        // من نشر المنتج على قناة النطاق المحلول لا من وجود الصفّ فقط.
        $this->getJson("http://r2-store-a.example.com/store/v1/media/{$mediaB->id}")->assertStatus(404);
        $this->getJson("http://r2-store-a.example.com/store/v1/media/{$mediaB->id}/derivatives/card")->assertStatus(404);

        // وعلى نطاقه الصحيح، يبقى متاحاً.
        $this->getJson("http://r2-store-b.example.com/store/v1/media/{$mediaB->id}")
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
    }

    /** @test */
    public function storefront_derivative_route_rejects_malformed_ids_and_never_accepts_a_storage_path_parameter(): void
    {
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('derivative-route-store.example.com');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        $media = ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'local',
            'path' => 'products/safe.webp',
            'original_name' => 'safe.webp',
            'mime_type' => 'image/webp',
            'size' => 4,
            'sort_order' => 0,
        ]);
        app(TenantContext::class)->forget();

        $this->getJson('http://derivative-route-store.example.com/store/v1/media/not-a-uuid/derivatives/card')->assertStatus(404);
        $this->getJson("http://derivative-route-store.example.com/store/v1/media/{$media->id}/derivatives/not-a-derivative")->assertStatus(404);
        $this->getJson("http://derivative-route-store.example.com/store/v1/media/{$media->id}/derivatives/card?path=/etc/passwd")->assertStatus(404);
    }

    /** @test */
    public function legacy_disk_backed_media_on_the_trusted_domain_path_is_also_host_relative(): void
    {
        // توافقٌ رجعي: سجلّ `disk = 'local'` قديم (قبل ترحيل R2) على مسار
        // الإنتاج نفسه — لا يتأثر بتغيير `buildMediaUrl()` إلى رابطٍ نسبي.
        Storage::fake('local');
        ['tenant' => $tenant, 'channel' => $channel] = $this->seedDomainStore('legacy-store.example.com');
        $product = $this->publishedProduct($tenant, $channel);

        app(TenantContext::class)->set($tenant->id);
        Storage::disk('local')->put('products/legacy.webp', 'legacy-bytes');
        $media = ProductMedia::create([
            'product_id' => $product->id, 'disk' => 'local', 'path' => 'products/legacy.webp',
            'original_name' => 'legacy.webp', 'mime_type' => 'image/webp', 'size' => 12, 'sort_order' => 0,
        ]);
        app(TenantContext::class)->forget();

        $list = $this->getJson('http://legacy-store.example.com/store/v1/products')->assertOk();
        $item = collect($list->json('data'))->firstWhere('id', $product->id);

        $this->assertSame("/store/v1/media/{$media->id}", $item['thumbnail_url']);
        $bytes = $this->get($item['thumbnail_url'])
            ->assertOk()->assertHeader('Content-Type', 'image/webp');
        $this->assertSame('legacy-bytes', $bytes->streamedContent());
    }
}

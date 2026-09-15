<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Services\ProductMediaService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  VAR-FU-5/GAP-06 — كتالوج POS يعرض غلاف الوسائط المحلول لكل متغيّر
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن `pos_variants[].image` (إضافيٌّ على `/api/pos/products`) يطابق
 *  `ProductMediaGalleryService` (VAR-MEDIA-1) حرفياً — لا سلطة موازية، ولا
 *  تخمين لمتغيّرٍ غير مُختار. تشغيل:
 *  php artisan test --filter=PosVariantMediaTest
 */
class PosVariantMediaTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    protected function setUp(): void
    {
        parent::setUp();
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');
    }

    private function image(string $name): UploadedFile
    {
        return UploadedFile::fake()->image($name);
    }

    /** @return array{0: Product, 1: \App\Models\ProductVariant, 2: \App\Models\ProductVariant} أسود/كبير، أبيض/صغير. */
    private function variantManagedProduct(string $tenantId, string $sku = 'SHIRT-1'): array
    {
        app(TenantContext::class)->set($tenantId);
        $product = Product::create(['name' => 'قميص', 'sku' => $sku, 'sale_price' => 20000]);
        $color = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $color->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);
        $size = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $large = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'كبير', 'value_key' => 'كبير', 'sort_order' => 0]);
        $small = $size->values()->create(['tenant_id' => $tenantId, 'value' => 'صغير', 'value_key' => 'صغير', 'sort_order' => 1]);

        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackL = $variants->createSingleVariant($product, [$black->id, $large->id], null)['variant'];
        $whiteS = $variants->createSingleVariant($product->fresh(), [$white->id, $small->id], null)['variant'];
        app(TenantContext::class)->forget();

        return [$product->fresh(), $blackL->fresh(), $whiteS->fresh()];
    }

    private function variantsOf(string $token, string $productId): array
    {
        $data = $this->withToken($token)->getJson('/api/pos/products')->assertOk()['data'];
        $product = collect($data)->firstWhere('id', $productId);
        $this->assertNotNull($product, 'المنتج غير ظاهرٍ في كتالوج POS.');

        return collect($product['pos_variants'])->keyBy('id')->all();
    }

    private function posImage(string $token, string $productId): ?array
    {
        $data = $this->withToken($token)->getJson('/api/pos/products')->assertOk()['data'];
        $product = collect($data)->firstWhere('id', $productId);

        return $product['pos_image'] ?? null;
    }

    // ═══════════════════ ١) منتجٌ بسيط — بلا تغيير ═══════════════════

    /** @test */
    public function simple_product_keeps_the_existing_pos_image_behavior(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'أسمنت', 'sale_price' => 3000]);
        $media = app(ProductMediaService::class)->attachToProduct($product, [$this->image('cement.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $image = $this->posImage($auth['token'], $product->id);
        $this->assertNotNull($image);
        $this->assertSame("/api/products/{$product->id}/media/{$media->id}/download", $image['download_url']);
    }

    // ═══════════════════ ٢-٤) الأولوية الثلاثية ═══════════════════

    /** @test */
    public function a_variant_with_exact_media_displays_its_resolved_exact_media(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $exact = app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black-l-exact.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertSame("/api/products/{$product->id}/media/{$exact->id}/download", $variants[$blackL->id]['image']['download_url']);
    }

    /** @test */
    public function a_variant_without_exact_media_inherits_the_visual_option_value_media(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $colorOption = $product->options()->where('name', 'اللون')->firstOrFail();
        $blackValue = $colorOption->values()->where('value', 'أسود')->firstOrFail();
        $optionMedia = app(ProductMediaService::class)->attachToOptionValue($product, $blackValue, [$this->image('black.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertSame("/api/products/{$product->id}/media/{$optionMedia->id}/download", $variants[$blackL->id]['image']['download_url']);
    }

    /** @test */
    public function a_variant_without_any_variant_or_option_media_falls_back_to_product_shared_media(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $shared = app(ProductMediaService::class)->attachToProduct($product, [$this->image('shirt.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertSame("/api/products/{$product->id}/media/{$shared->id}/download", $variants[$blackL->id]['image']['download_url']);
    }

    // ═══════════════════ ٥) لا وسائط — لا كسر ═══════════════════

    /** @test */
    public function no_media_anywhere_resolves_to_a_null_image_not_a_broken_link(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertNull($variants[$blackL->id]['image']);
    }

    // ═══════════════════ ٦-٧) الأشقاء ═══════════════════

    /** @test */
    public function two_sibling_variants_with_different_resolved_media_display_correctly(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL, $whiteS] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $blackMedia = app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null)[0];
        $whiteMedia = app(ProductMediaService::class)->attachToVariant($product, $whiteS, [$this->image('white.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertSame("/api/products/{$product->id}/media/{$blackMedia->id}/download", $variants[$blackL->id]['image']['download_url']);
        $this->assertSame("/api/products/{$product->id}/media/{$whiteMedia->id}/download", $variants[$whiteS->id]['image']['download_url']);
        $this->assertNotSame($variants[$blackL->id]['image']['download_url'], $variants[$whiteS->id]['image']['download_url']);
    }

    /** @test */
    public function two_sibling_variants_sharing_a_visual_option_value_share_the_same_media(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $product = Product::create(['name' => 'قميص', 'sale_price' => 20000]);
        $color = $product->options()->create(['tenant_id' => $auth['tenant_id'], 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $color->values()->create(['tenant_id' => $auth['tenant_id'], 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $size = $product->options()->create(['tenant_id' => $auth['tenant_id'], 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $small = $size->values()->create(['tenant_id' => $auth['tenant_id'], 'value' => 'S', 'value_key' => 's', 'sort_order' => 0]);
        $medium = $size->values()->create(['tenant_id' => $auth['tenant_id'], 'value' => 'M', 'value_key' => 'm', 'sort_order' => 1]);
        $variants = app(ProductVariantService::class);
        $variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackS = $variants->createSingleVariant($product, [$black->id, $small->id], null)['variant'];
        $blackM = $variants->createSingleVariant($product->fresh(), [$black->id, $medium->id], null)['variant'];
        $blackMedia = app(ProductMediaService::class)->attachToOptionValue($product, $black, [$this->image('black.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $posVariants = $this->variantsOf($auth['token'], $product->id);
        $this->assertSame($posVariants[$blackS->id]['image']['download_url'], $posVariants[$blackM->id]['image']['download_url']);
        $this->assertSame("/api/products/{$product->id}/media/{$blackMedia->id}/download", $posVariants[$blackS->id]['image']['download_url']);
    }

    // ═══════════════════ ٩) الباركود يطابق الاختيار اليدوي ═══════════════════

    /** @test */
    public function the_same_variant_object_carries_identical_media_regardless_of_how_it_was_matched(): void
    {
        // الباركود في الواجهة يُطابَق محلياً ضمن `pos_variants` المحمَّلة نفسها
        // (`matchPosBarcode`) — لا استدعاء خادميٍّ مستقلٍّ يعيد حلّاً موازياً.
        // هنا يُثبَت أن الخادم نفسه يُرجع بيانات متغيّرٍ واحدة كاملة (بما فيها
        // الصورة) في `pos_variants` بصرف النظر عن أي مسارٍ سيُطابقها لاحقاً —
        // فهويّة الصورة واحدة بالبناء لا بمصادفة تطابق مسارين.
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $exact = app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('x.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $first = $this->variantsOf($auth['token'], $product->id)[$blackL->id];
        $second = $this->variantsOf($auth['token'], $product->id)[$blackL->id];
        $this->assertSame($first['image']['download_url'], $second['image']['download_url']);
        $this->assertSame("/api/products/{$product->id}/media/{$exact->id}/download", $first['image']['download_url']);
    }

    // ═══════════════════ ١١) لا تسرّب لهويّة null ═══════════════════

    /** @test */
    public function a_simple_products_pos_image_never_receives_a_sibling_variants_media(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $simple = Product::create(['name' => 'خدمة بسيطة', 'sale_price' => 1000]);
        app(TenantContext::class)->forget();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null);
        app(TenantContext::class)->forget();

        $this->assertNull($this->posImage($auth['token'], $simple->id), 'منتجٌ بسيط بلا وسائط يبقى null — لا يرث صورة متغيّر منتجٍ آخر.');
    }

    // ═══════════════════ ١٢) متغيّرٌ معطَّل ═══════════════════

    /** @test */
    public function an_inactive_variant_never_appears_in_the_catalog_at_all(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null);
        $blackL->update(['is_active' => false]);
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $this->assertArrayNotHasKey($blackL->id, $variants, 'متغيّرٌ معطَّلٌ لا يظهر في pos_variants إطلاقاً — سلوكٌ قائمٌ من VAR-POS-1، غير متأثر بهذه المهمة.');
    }

    // ═══════════════════ ١٤-١٥) عزل المستأجر وأمان الرابط ═══════════════════

    /** @test */
    public function a_cross_tenant_download_url_fails_closed(): void
    {
        $first = $this->registerTenant('media-a', 'owner-a@var-fu5.test');
        [$product, $blackL] = $this->variantManagedProduct($first['tenant_id']);
        app(TenantContext::class)->set($first['tenant_id']);
        app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null);
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($first['token'], $product->id);
        $downloadUrl = str_replace('/api', '', $variants[$blackL->id]['image']['download_url']);

        $second = $this->registerTenant('media-b', 'owner-b@var-fu5.test');
        $this->withToken($second['token'])->get('/api'.$downloadUrl)->assertNotFound();
    }

    /** @test */
    public function the_download_url_stays_tenant_safe_with_no_internal_storage_path(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        app(TenantContext::class)->set($auth['tenant_id']);
        $exact = app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null)[0];
        app(TenantContext::class)->forget();

        $variants = $this->variantsOf($auth['token'], $product->id);
        $url = $variants[$blackL->id]['image']['download_url'];
        $this->assertSame("/api/products/{$product->id}/media/{$exact->id}/download", $url);
        $this->assertStringNotContainsString($exact->path ?? '', $url);
        $this->assertStringNotContainsString('storage/', $url);
        $this->assertStringNotContainsString($exact->disk ?? '', $url);
    }

    // ═══════════════════ ١٨) لا تغيير في السعر/الإتمام ═══════════════════

    /** @test */
    public function adding_variant_media_never_changes_the_variants_price_in_the_catalog(): void
    {
        $auth = $this->registerTenant();
        [$product, $blackL] = $this->variantManagedProduct($auth['tenant_id']);
        $before = $this->variantsOf($auth['token'], $product->id)[$blackL->id]['price'];

        app(TenantContext::class)->set($auth['tenant_id']);
        app(ProductMediaService::class)->attachToVariant($product, $blackL, [$this->image('black.jpg')], null);
        app(TenantContext::class)->forget();

        $after = $this->variantsOf($auth['token'], $product->id)[$blackL->id]['price'];
        $this->assertSame($before, $after, 'إضافة وسيطٍ لا تغيّر السعر المحسوم إطلاقاً.');
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductOption;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Models\Tenant;
use App\Services\ProductLifecycleService;
use App\Services\ProductMediaGalleryService;
use App\Services\ProductMediaService;
use App\Services\ProductVariantService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use RuntimeException;
use Tests\TestCase;

/**
 * VAR-MEDIA-1 — هرمية وسائط المنتج/قيمة الخيار/المتغيّر.
 *
 * يغطّي: المعرض المحلول وترتيبه/غلافه الحتمي، وراثة وسائط قيمة الخيار عبر
 * كل متغيّرٍ يختارها، وسائط المتغيّر الحصرية، عدم التكرار، عزل الهويّة
 * (منتج/قيمة/متغيّر/مستأجر)، ودورة الحياة (حذفٌ لا يُتيم وسيطاً).
 *
 * تشغيل: php artisan test --filter=ProductMediaGalleryTest
 */
class ProductMediaGalleryTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected ProductMediaService $media;

    protected ProductMediaGalleryService $gallery;

    protected ProductVariantService $variants;

    protected function setUp(): void
    {
        parent::setUp();

        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $this->media = app(ProductMediaService::class);
        $this->gallery = app(ProductMediaGalleryService::class);
        $this->variants = app(ProductVariantService::class);
    }

    private function product(array $overrides = []): Product
    {
        return Product::create(array_merge(['name' => 'منتج', 'sale_price' => 5000], $overrides));
    }

    private function image(string $name = 'img.jpg'): UploadedFile
    {
        return UploadedFile::fake()->image($name);
    }

    private function variantManagedProductWithColors(): array
    {
        $tenantId = app(TenantContext::class)->id();
        $product = $this->product();
        $option = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'اللون', 'name_key' => 'اللون', 'sort_order' => 0]);
        $black = $option->values()->create(['tenant_id' => $tenantId, 'value' => 'أسود', 'value_key' => 'أسود', 'sort_order' => 0]);
        $white = $option->values()->create(['tenant_id' => $tenantId, 'value' => 'أبيض', 'value_key' => 'أبيض', 'sort_order' => 1]);
        $sizeOption = $product->options()->create(['tenant_id' => $tenantId, 'name' => 'المقاس', 'name_key' => 'المقاس', 'sort_order' => 1]);
        $small = $sizeOption->values()->create(['tenant_id' => $tenantId, 'value' => 'S', 'value_key' => 's', 'sort_order' => 0]);
        $medium = $sizeOption->values()->create(['tenant_id' => $tenantId, 'value' => 'M', 'value_key' => 'm', 'sort_order' => 1]);

        $this->variants->enableVariantManagement($product, null);
        $product = $product->fresh();
        $blackS = $this->variants->createSingleVariant($product, [$black->id, $small->id], null)['variant'];
        $blackM = $this->variants->createSingleVariant($product->fresh(), [$black->id, $medium->id], null)['variant'];
        $whiteS = $this->variants->createSingleVariant($product->fresh(), [$white->id, $small->id], null)['variant'];

        return compact('product', 'option', 'black', 'white', 'sizeOption', 'small', 'medium', 'blackS', 'blackM', 'whiteS');
    }

    // ───────────────────────── معرض المنتج (توافق رجعي) ─────────────────────────

    /** @test */
    public function an_existing_product_only_gallery_resolves_unchanged(): void
    {
        $product = $this->product();
        $created = $this->attachProductLevel($product, [$this->image('a.jpg'), $this->image('b.jpg')]);

        $resolved = $this->gallery->resolveGallery($product);

        $this->assertCount(2, $resolved);
        $this->assertSame($created[0]->id, $resolved->first()->id, 'الغلاف = أوّل عنصرٍ بترتيب sort_order، كالسلوك القائم.');
    }

    /** @test */
    public function a_simple_product_gallery_equals_resolving_with_a_null_variant(): void
    {
        $product = $this->product();
        $this->attachProductLevel($product, [$this->image('a.jpg')]);

        $withNull = $this->gallery->resolveGallery($product, null);
        $withoutArg = $this->gallery->resolveGallery($product);

        $this->assertSame($withNull->pluck('id')->all(), $withoutArg->pluck('id')->all());
    }

    // ───────────────────────── وراثة وسائط قيمة الخيار ─────────────────────────

    /** @test */
    public function black_media_resolves_for_every_black_variant_without_duplication(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $this->media->attachToOptionValue($scene['product'], $scene['black'], [$this->image('black-front.jpg')], null);

        $forBlackS = $this->gallery->resolveGallery($scene['product'], $scene['blackS']);
        $forBlackM = $this->gallery->resolveGallery($scene['product'], $scene['blackM']);

        $this->assertCount(1, $forBlackS);
        $this->assertCount(1, $forBlackM);
        $this->assertSame($forBlackS->first()->id, $forBlackM->first()->id, 'صفٌّ واحدٌ يُخدَم لكل متغيّرات الأسود — لا نسخ.');
        $this->assertSame(1, ProductMedia::where('product_option_value_id', $scene['black']->id)->count(), 'لا تكرار صفوفٍ لأجل الوراثة.');
    }

    /** @test */
    public function a_sibling_value_never_inherits_another_values_media(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $this->media->attachToOptionValue($scene['product'], $scene['black'], [$this->image('black.jpg')], null);

        $forWhiteS = $this->gallery->resolveGallery($scene['product'], $scene['whiteS']);

        $this->assertCount(0, $forWhiteS, 'White/S يجب ألّا يرث وسائط Black.');
    }

    // ───────────────────────── وسائط المتغيّر الحصرية ─────────────────────────

    /** @test */
    public function exact_variant_media_is_visible_only_to_that_variant(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $this->media->attachToVariant($scene['product'], $scene['blackM'], [$this->image('black-m-packaging.jpg')], null);

        $forBlackM = $this->gallery->resolveGallery($scene['product'], $scene['blackM']);
        $forBlackS = $this->gallery->resolveGallery($scene['product'], $scene['blackS']);

        $this->assertCount(1, $forBlackM);
        $this->assertCount(0, $forBlackS, 'شقيقٌ آخر (Black/S) لا يرى وسيط Black/M الحصري.');
    }

    /** @test */
    public function product_option_value_and_exact_variant_media_coexist_and_combine(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $this->attachProductLevel($scene['product'], [$this->image('common.jpg')]);
        $this->media->attachToOptionValue($scene['product'], $scene['black'], [$this->image('black.jpg')], null);
        $this->media->attachToVariant($scene['product'], $scene['blackM'], [$this->image('black-m.jpg')], null);

        $resolved = $this->gallery->resolveGallery($scene['product'], $scene['blackM']);

        $this->assertCount(3, $resolved);
    }

    // ───────────────────────── الترتيب والغلاف الحتمي ─────────────────────────

    /** @test */
    public function resolved_order_is_product_then_option_values_in_product_option_order_then_variant(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $productMedia = $this->attachProductLevel($scene['product'], [$this->image('p.jpg')])[0];
        $colorMedia = $this->media->attachToOptionValue($scene['product'], $scene['black'], [$this->image('color.jpg')], null)[0];
        $sizeMedia = $this->media->attachToOptionValue($scene['product'], $scene['small'], [$this->image('size.jpg')], null)[0];
        $variantMedia = $this->media->attachToVariant($scene['product'], $scene['blackS'], [$this->image('v.jpg')], null)[0];

        $resolved = $this->gallery->resolveGallery($scene['product'], $scene['blackS']);

        // المنتج، ثم اللون (خيارٌ ترتيبه ٠)، ثم المقاس (خيارٌ ترتيبه ١)، ثم المتغيّر.
        $this->assertSame(
            [$productMedia->id, $colorMedia->id, $sizeMedia->id, $variantMedia->id],
            $resolved->pluck('id')->all()
        );
        $this->assertSame($productMedia->id, $resolved->first()->id, 'الغلاف = أوّل عنصرٍ في المعرض المحلول.');
    }

    /** @test */
    public function no_media_anywhere_resolves_to_an_empty_gallery_and_a_null_cover(): void
    {
        $product = $this->product();

        $this->assertCount(0, $this->gallery->resolveGallery($product));
        $this->assertNull($this->gallery->resolveCover($product));
    }

    // ───────────────────────── عزل الهويّة ─────────────────────────

    /** @test */
    public function an_option_value_from_a_different_product_is_rejected_fail_closed(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $otherProduct = $this->product();

        $this->expectException(RuntimeException::class);
        $this->media->attachToOptionValue($otherProduct, $scene['black'], [$this->image('x.jpg')], null);
    }

    /** @test */
    public function a_variant_from_a_different_product_is_rejected_fail_closed(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $otherProduct = $this->product();

        $this->expectException(RuntimeException::class);
        $this->media->attachToVariant($otherProduct, $scene['blackS'], [$this->image('x.jpg')], null);
    }

    /** @test */
    public function a_media_row_cannot_target_both_an_option_value_and_a_variant(): void
    {
        $scene = $this->variantManagedProductWithColors();

        $this->expectException(RuntimeException::class);
        ProductMedia::create([
            'tenant_id' => $this->tenant->id,
            'product_id' => $scene['product']->id,
            'product_option_value_id' => $scene['black']->id,
            'product_variant_id' => $scene['blackS']->id,
            'disk' => 'document', 'path' => 'x', 'original_name' => 'x.jpg', 'sort_order' => 0,
        ]);
    }

    /** @test */
    public function a_cross_tenant_option_value_cannot_be_attached(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other-media', 'vat_number' => '300000000000095', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        $foreignScene = $this->variantManagedProductWithColors();

        app(TenantContext::class)->set($this->tenant->id);
        $localProduct = $this->product();
        $rawValue = ProductOptionValue::withoutGlobalScopes()->findOrFail($foreignScene['black']->id);
        $countBefore = ProductMedia::count();

        try {
            $this->media->attachToOptionValue($localProduct, $rawValue, [$this->image('x.jpg')], null);
            $this->fail('كان يجب أن يُرفض قيمة خيارٍ من مستأجرٍ آخر.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame($countBefore, ProductMedia::count(), 'لا صفّ يُنشأ عند الرفض.');
    }

    /** @test */
    public function a_cross_tenant_variant_cannot_be_attached(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other-media-2', 'vat_number' => '300000000000094', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($otherTenant->id);
        $foreignScene = $this->variantManagedProductWithColors();

        app(TenantContext::class)->set($this->tenant->id);
        $localProduct = $this->product();
        $rawVariant = ProductVariant::withoutGlobalScopes()->findOrFail($foreignScene['blackS']->id);
        $countBefore = ProductMedia::count();

        try {
            $this->media->attachToVariant($localProduct, $rawVariant, [$this->image('x.jpg')], null);
            $this->fail('كان يجب أن يُرفض متغيّرٌ من مستأجرٍ آخر.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame($countBefore, ProductMedia::count());
    }

    // ───────────────────────── دورة الحياة ─────────────────────────

    /** @test */
    public function deleting_a_variant_cleans_up_its_exact_media_without_blocking(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $media = $this->media->attachToVariant($scene['product'], $scene['blackS'], [$this->image('x.jpg')], null)[0];
        $path = $media->path;
        Storage::disk('local')->assertExists($path);

        $this->variants->deleteVariant($scene['blackS'], null);

        $this->assertDatabaseMissing('product_media', ['id' => $media->id]);
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function deactivating_a_variant_preserves_its_media(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $media = $this->media->attachToVariant($scene['product'], $scene['blackS'], [$this->image('x.jpg')], null)[0];

        $this->variants->updateVariant($scene['blackS'], ['is_active' => false], null);

        $this->assertDatabaseHas('product_media', ['id' => $media->id]);
        $this->assertCount(1, $this->gallery->resolveGallery($scene['product'], $scene['blackS']->fresh()));
    }

    /** @test */
    public function deleting_an_option_value_cleans_up_its_media(): void
    {
        $product = $this->product();
        $option = $product->options()->create(['tenant_id' => $this->tenant->id, 'name' => 'المادة', 'name_key' => 'المادة']);
        $value = $option->values()->create(['tenant_id' => $this->tenant->id, 'value' => 'قطن', 'value_key' => 'قطن']);
        $media = $this->media->attachToOptionValue($product, $value, [$this->image('x.jpg')], null)[0];
        $path = $media->path;

        $this->variants->deleteOptionValue($value, null);

        $this->assertDatabaseMissing('product_media', ['id' => $media->id]);
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function deleting_an_option_cleans_up_all_its_values_media(): void
    {
        $product = $this->product();
        $option = $product->options()->create(['tenant_id' => $this->tenant->id, 'name' => 'المادة', 'name_key' => 'المادة']);
        $value = $option->values()->create(['tenant_id' => $this->tenant->id, 'value' => 'قطن', 'value_key' => 'قطن']);
        $media = $this->media->attachToOptionValue($product, $value, [$this->image('x.jpg')], null)[0];
        $path = $media->path;

        $this->variants->deleteOption($option, null);

        $this->assertDatabaseMissing('product_media', ['id' => $media->id]);
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function deleting_a_product_cleans_up_media_across_every_scope(): void
    {
        $product = $this->product();
        $option = $product->options()->create(['tenant_id' => $this->tenant->id, 'name' => 'المادة', 'name_key' => 'المادة']);
        $value = $option->values()->create(['tenant_id' => $this->tenant->id, 'value' => 'قطن', 'value_key' => 'قطن']);
        $productMedia = $this->attachProductLevel($product, [$this->image('p.jpg')])[0];
        $valueMedia = $this->media->attachToOptionValue($product, $value, [$this->image('v.jpg')], null)[0];

        app(ProductLifecycleService::class)->delete($product, null);

        $this->assertDatabaseMissing('product_media', ['id' => $productMedia->id]);
        $this->assertDatabaseMissing('product_media', ['id' => $valueMedia->id]);
        Storage::disk('local')->assertMissing($productMedia->path);
        Storage::disk('local')->assertMissing($valueMedia->path);
    }

    /** @test */
    public function deleting_a_variant_with_a_price_or_inventory_footprint_still_blocks_before_reaching_media_cleanup(): void
    {
        $scene = $this->variantManagedProductWithColors();
        $this->media->attachToVariant($scene['product'], $scene['blackS'], [$this->image('x.jpg')], null);
        app(\App\Services\ProductPricingService::class)->setPrice($scene['product'], $scene['blackS'], null, 1000);

        $this->expectException(RuntimeException::class);
        $this->variants->deleteVariant($scene['blackS'], null);
    }

    /**
     * @param  list<UploadedFile>  $files
     * @return list<ProductMedia>
     */
    private function attachProductLevel(Product $product, array $files): array
    {
        return $this->media->attachToProduct($product, $files, null);
    }
}

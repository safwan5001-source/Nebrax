<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Models\ProductOptionValue;
use App\Models\ProductVariant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * VAR-OPTION-VISUAL-2B — مسار HTTP لرفع صورة صريّة (swatch) لقيمة خيارٍ قائمة.
 *
 * يغطّي: نجاح الرفع ضمن المستأجر نفسه مع اعتماد `visual_type=image` و
 * `image_media_id` عبر سلطة الصريّة القائمة، نطاق الوسيط (مستأجر/منتج/قيمة)،
 * رفض العبور بين المستأجرين والمنتجات والقيم الشقيقة، رفض MIME/الحجم وفق
 * حدود الوسائط القائمة، التنظيف الحتمي عند الاستبدال أو الانتقال إلى
 * none/color، وثبات هوية المتغيّر (ID/SKU/تركيبة) عبر كل تعديلٍ بصري.
 *
 * تشغيل: php artisan test --filter=ProductOptionValueImageSwatchTest
 */
class ProductOptionValueImageSwatchTest extends TestCase
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

    private function createSimpleProduct(string $token, string $sku = 'FABRIC-001'): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'قماش', 'sku' => $sku, 'type' => 'good', 'sale_price' => 10000,
        ])->assertCreated()->json('data');
    }

    private function scene(string $token, string $productId, string $valueLabel = 'مخمل أزرق'): array
    {
        $this->withToken($token)->postJson("/api/products/{$productId}/variants/enable")->assertOk();
        $option = $this->withToken($token)->postJson("/api/products/{$productId}/options", ['name' => 'القماش'])
            ->assertCreated()->json('data');
        $value = $this->withToken($token)->postJson("/api/products/{$productId}/options/{$option['id']}/values", ['value' => $valueLabel])
            ->assertCreated()->json('data');

        return [$option, $value];
    }

    private function uploadSwatch(string $token, string $productId, string $optionId, string $valueId, UploadedFile $file): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->post(
            "/api/products/{$productId}/options/{$optionId}/values/{$valueId}/media",
            ['image' => $file]
        );
    }

    // ───────────────────────── 1–3: نجاح الرفع والنطاق ─────────────────────────

    /** @test */
    public function an_authorized_same_tenant_swatch_upload_succeeds_and_sets_the_image_visual(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $data = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet.jpg'))
            ->assertCreated()->json('data');

        $this->assertSame('image', $data['visual_type']);
        $this->assertNull($data['color_value']);
        $this->assertNotEmpty($data['image_media']['id']);
        $this->assertStringContainsString("/api/products/{$product['id']}/media/", $data['image_media']['download_url']);
    }

    /** @test */
    public function the_image_visual_persists_and_round_trips_through_the_options_read_endpoint(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $uploaded = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet.png'))
            ->assertCreated()->json('data');

        $raw = ProductOptionValue::findOrFail($value['id']);
        $this->assertSame('image', $raw->visual_type);
        $this->assertSame($uploaded['image_media']['id'], $raw->image_media_id);

        $options = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/options")
            ->assertOk()->json('data');
        $read = collect($options[0]['values'])->firstWhere('id', $value['id']);
        $this->assertSame('image', $read['visual_type']);
        $this->assertSame($uploaded['image_media']['id'], $read['image_media']['id']);
    }

    /** @test */
    public function the_uploaded_media_is_scoped_to_the_exact_tenant_product_and_option_value(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $uploaded = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet.jpg'))
            ->assertCreated()->json('data');

        $media = ProductMedia::findOrFail($uploaded['image_media']['id']);
        $this->assertSame($auth['tenant_id'], $media->tenant_id);
        $this->assertSame($product['id'], $media->product_id);
        $this->assertSame($value['id'], $media->product_option_value_id);
        $this->assertNull($media->product_variant_id);
        // مسار التخزين مولَّد خادماً داخل نطاق المستأجر/المنتج، ولا يظهر في الاستجابة أصلاً.
        $this->assertStringStartsWith("product-media/{$auth['tenant_id']}/{$product['id']}/", $media->path);
        $this->assertArrayNotHasKey('path', $uploaded['image_media']);
        Storage::disk('local')->assertExists($media->path);
    }

    // ───────────────────────── 4–6: العزل والملكية الهرمية ─────────────────────────

    /** @test */
    public function a_cross_tenant_upload_attempt_is_denied(): void
    {
        $ownerAuth = $this->registerTenant('swatch-owner', 'owner@swatch-owner.test');
        $ownerProduct = $this->createSimpleProduct($ownerAuth['token'], 'OWNER-SKU-1');
        [$ownerOption, $ownerValue] = $this->scene($ownerAuth['token'], $ownerProduct['id']);

        $attackerAuth = $this->registerTenant('swatch-attacker', 'owner@swatch-attacker.test');

        $this->uploadSwatch($attackerAuth['token'], $ownerProduct['id'], $ownerOption['id'], $ownerValue['id'],
            UploadedFile::fake()->image('stolen.jpg'))
            ->assertNotFound();

        $this->assertSame('none', ProductOptionValue::findOrFail($ownerValue['id'])->visual_type);
        $this->assertSame(0, ProductMedia::count());
    }

    /** @test */
    public function a_cross_product_option_value_upload_is_denied(): void
    {
        $auth = $this->registerTenant();
        $productA = $this->createSimpleProduct($auth['token'], 'SKU-A');
        $productB = $this->createSimpleProduct($auth['token'], 'SKU-B');
        [, $valueB] = $this->scene($auth['token'], $productB['id']);

        // قيمةٌ تخصّ المنتج B لا تُرفَع صورتها عبر مسار المنتج A.
        $optionOfB = $this->withToken($auth['token'])->getJson("/api/products/{$productB['id']}/options")
            ->assertOk()->json('data')[0];
        $this->uploadSwatch($auth['token'], $productA['id'], $optionOfB['id'], $valueB['id'],
            UploadedFile::fake()->image('wrong.jpg'))
            ->assertNotFound();

        $this->assertSame('none', ProductOptionValue::findOrFail($valueB['id'])->visual_type);
        $this->assertSame(0, ProductMedia::count());
    }

    /** @test */
    public function an_arbitrary_media_id_cannot_be_set_as_the_swatch_reference(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'image', 'image_media_id' => (string) Str::uuid()]
        )->assertStatus(422);

        // وسيط معرض المنتج المشترك (لا `product_option_value_id`) مرفوضٌ أيضاً كمرجع صريّة.
        $this->withToken($auth['token'])->post("/api/products/{$product['id']}/media", [
            'media' => [UploadedFile::fake()->image('gallery.jpg')],
        ])->assertCreated();
        $galleryMedia = ProductMedia::whereNull('product_option_value_id')->firstOrFail();

        $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'image', 'image_media_id' => $galleryMedia->id]
        )->assertStatus(422);

        $this->assertSame('none', ProductOptionValue::findOrFail($value['id'])->visual_type);
    }

    // ───────────────────────── 7–8: حدود الوسائط القائمة ─────────────────────────

    /** @test */
    public function a_non_image_mime_upload_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->create('pattern.pdf', 100, 'application/pdf'))
            ->assertStatus(422);

        $this->assertSame(0, ProductMedia::count());
        $this->assertSame('none', ProductOptionValue::findOrFail($value['id'])->visual_type);
    }

    /** @test */
    public function an_oversized_upload_is_rejected_by_the_existing_media_limit(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        // ٦ ميغا — فوق سقف ٥١٢٠ كيلوبايت القائم في وسائط المنتج.
        $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('huge.jpg')->size(6144))
            ->assertStatus(422);

        $this->assertSame(0, ProductMedia::count());
    }

    // ───────────────────────── 9–11: دلالات الاستبدال/الحذف ─────────────────────────

    /** @test */
    public function switching_image_to_none_clears_the_reference_and_cleans_the_media(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);
        $uploaded = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet.jpg'))
            ->assertCreated()->json('data');
        $mediaId = $uploaded['image_media']['id'];
        $path = ProductMedia::findOrFail($mediaId)->path;

        $updated = $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'none']
        )->assertOk()->json('data');

        $this->assertSame('none', $updated['visual_type']);
        $this->assertNull(ProductOptionValue::findOrFail($value['id'])->image_media_id);
        $this->assertNull(ProductMedia::find($mediaId), 'وسيط الصريّة المستبدَل يُحذف صفّاً.');
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function switching_image_to_color_replaces_the_reference_and_cleans_the_media(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);
        $uploaded = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet.jpg'))
            ->assertCreated()->json('data');
        $mediaId = $uploaded['image_media']['id'];

        $updated = $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'color', 'color_value' => '#1E3A8A']
        )->assertOk()->json('data');

        $this->assertSame('color', $updated['visual_type']);
        $this->assertSame('#1E3A8A', $updated['color_value']);
        $this->assertNull(ProductOptionValue::findOrFail($value['id'])->image_media_id);
        $this->assertNull(ProductMedia::find($mediaId));
    }

    /** @test */
    public function replacing_an_image_swatch_is_deterministic(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);

        $first = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet-a.jpg'))
            ->assertCreated()->json('data');
        $firstMediaId = $first['image_media']['id'];
        $firstPath = ProductMedia::findOrFail($firstMediaId)->path;

        $second = $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('velvet-b.jpg'))
            ->assertCreated()->json('data');

        $this->assertSame('image', $second['visual_type']);
        $this->assertNotSame($firstMediaId, $second['image_media']['id']);
        $this->assertSame($second['image_media']['id'], ProductOptionValue::findOrFail($value['id'])->image_media_id);
        // الوسيط الأول لم يعد مرجعاً — نُظّف حتمياً، ولم يبقَ سوى الوسيط الجديد.
        $this->assertNull(ProductMedia::find($firstMediaId));
        Storage::disk('local')->assertMissing($firstPath);
        $this->assertSame(1, ProductMedia::where('product_option_value_id', $value['id'])->count());
    }

    // ───────────────────────── 12–13: ثبات هوية المتغيّر ─────────────────────────

    /** @test */
    public function swatch_upload_and_visual_edits_never_recreate_the_variant_or_change_its_identity(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createSimpleProduct($auth['token']);
        [$option, $value] = $this->scene($auth['token'], $product['id']);
        $sizeOption = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/options", ['name' => 'المقاس'])
            ->assertCreated()->json('data');
        $sizeValue = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/options/{$sizeOption['id']}/values", ['value' => 'L'])
            ->assertCreated()->json('data');

        $created = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/variants", [
            'combinations' => [[$value['id'], $sizeValue['id']]],
        ])->assertCreated()->json();
        $variant = $created['created'][0];

        // رفع صورة ← استبدالها ← الانتقال إلى لون ← العودة إلى none.
        $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('a.jpg'))->assertCreated();
        $this->uploadSwatch($auth['token'], $product['id'], $option['id'], $value['id'],
            UploadedFile::fake()->image('b.jpg'))->assertCreated();
        $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'color', 'color_value' => '#1E3A8A']
        )->assertOk();
        $this->withToken($auth['token'])->putJson(
            "/api/products/{$product['id']}/options/{$option['id']}/values/{$value['id']}",
            ['visual_type' => 'none']
        )->assertOk();

        $variants = $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/variants")
            ->assertOk()->json('data');
        $this->assertCount(1, $variants);
        $this->assertSame($variant['id'], $variants[0]['id'], 'أي تعديلٍ بصري يجب ألّا يُعيد إنشاء المتغيّر.');
        $this->assertSame($variant['sku'], $variants[0]['sku'], 'SKU لا يتغيّر.');
        $this->assertSame($variant['combination_key'], $variants[0]['combination_key'], 'تركيبة الهوية لا تتغيّر.');
        $this->assertSame(1, ProductVariant::count());
        // بعد العودة إلى none: لا مرجع صورةٍ ولا وسيط متبقٍّ في نطاق القيمة.
        $this->assertNull(ProductOptionValue::findOrFail($value['id'])->image_media_id);
        $this->assertSame(0, ProductMedia::where('product_option_value_id', $value['id'])->count());
    }
}

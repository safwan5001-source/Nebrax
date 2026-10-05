<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use App\Services\ProductMediaDerivativeService;
use App\Services\ProductMediaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProductMediaDerivativeTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function fakeDocumentStorage(): void
    {
        config()->set('product_media.r2.enabled', false);
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');
    }

    private function product(string $token, string $sku): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج مشتقات الصور',
            'sku' => $sku,
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
        ])->assertCreated()['data'];
    }

    private function image(string $filename, string $format, int $width, int $height): UploadedFile
    {
        $canvas = imagecreatetruecolor($width, $height);
        $background = imagecolorallocate($canvas, 36, 99, 235);
        imagefill($canvas, 0, 0, $background);

        ob_start();
        match ($format) {
            'jpeg' => imagejpeg($canvas, null, 90),
            'png' => imagepng($canvas),
            'webp' => imagewebp($canvas, null, 90),
        };
        $bytes = ob_get_clean();
        imagedestroy($canvas);

        return UploadedFile::fake()->createWithContent($filename, $bytes);
    }

    /** @return array{0:int,1:int} */
    private function dimensions(string $path): array
    {
        $dimensions = getimagesizefromstring(Storage::disk('local')->get($path));
        $this->assertIsArray($dimensions);

        return [$dimensions[0], $dimensions[1]];
    }

    /** @test */
    public function a_new_jpeg_upload_keeps_its_original_and_creates_bounded_private_derivatives(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant('derivative-jpeg');
        $product = $this->product($auth['token'], 'DERIVATIVE-JPEG-001');

        $startedAt = hrtime(true);
        $response = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [$this->image('landscape.jpg', 'jpeg', 1600, 900)],
        ])->assertCreated();
        $elapsedNanoseconds = hrtime(true) - $startedAt;

        $media = ProductMedia::findOrFail($response->json('data.0.id'));
        $service = app(ProductMediaService::class);
        $thumbnailPath = $service->derivativePath($media, ProductMediaDerivativeService::THUMBNAIL);
        $cardPath = $service->derivativePath($media, ProductMediaDerivativeService::CARD);

        Storage::disk('local')->assertExists($media->path);
        Storage::disk('local')->assertExists($thumbnailPath);
        Storage::disk('local')->assertExists($cardPath);
        $this->assertStringContainsString("/derivatives/{$media->id}/thumbnail.jpg", $thumbnailPath);
        $this->assertStringContainsString("/derivatives/{$media->id}/card.jpg", $cardPath);
        $this->assertSame([200, 113], $this->dimensions($thumbnailPath));
        $this->assertSame([800, 450], $this->dimensions($cardPath));
        $this->assertGreaterThan(0, $elapsedNanoseconds, 'Focused test records synchronous derivative processing duration without asserting a production performance number.');

        $response->assertJsonPath('data.0.download_url', "/api/products/{$product['id']}/media/{$media->id}/download")
            ->assertJsonPath('data.0.thumbnail_url', "/api/products/{$product['id']}/media/{$media->id}/derivatives/thumbnail")
            ->assertJsonPath('data.0.card_url', "/api/products/{$product['id']}/media/{$media->id}/derivatives/card");

        $this->withToken($auth['token'])->get($response->json('data.0.thumbnail_url'))
            ->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    }

    /** @test */
    public function png_and_webp_uploads_keep_their_source_formats_for_derivatives(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant('derivative-formats');
        $product = $this->product($auth['token'], 'DERIVATIVE-FORMATS-001');
        $service = app(ProductMediaService::class);

        foreach ([
            ['portrait.png', 'png', 300, 900, [67, 200], [267, 800], 'image/png'],
            ['landscape.webp', 'webp', 1200, 600, [200, 100], [800, 400], 'image/webp'],
        ] as [$filename, $format, $width, $height, $thumbnailDimensions, $cardDimensions, $mimeType]) {
            $mediaId = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
                'media' => [$this->image($filename, $format, $width, $height)],
            ])->assertCreated()->json('data.0.id');

            $media = ProductMedia::findOrFail($mediaId);
            $thumbnail = $service->derivativePath($media, ProductMediaDerivativeService::THUMBNAIL);
            $card = $service->derivativePath($media, ProductMediaDerivativeService::CARD);
            $this->assertSame($thumbnailDimensions, $this->dimensions($thumbnail));
            $this->assertSame($cardDimensions, $this->dimensions($card));
            $this->assertSame($mimeType, $service->derivativeMimeType($media));
        }
    }

    /** @test */
    public function small_sources_are_not_upscaled_and_legacy_media_falls_back_to_its_original(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant('derivative-fallback');
        $productData = $this->product($auth['token'], 'DERIVATIVE-FALLBACK-001');
        $product = Product::findOrFail($productData['id']);
        $service = app(ProductMediaService::class);

        $smallId = $this->withToken($auth['token'])->postJson("/api/products/{$product->id}/media", [
            'media' => [$this->image('small.png', 'png', 80, 40)],
        ])->assertCreated()->json('data.0.id');
        $small = ProductMedia::findOrFail($smallId);
        $this->assertSame([80, 40], $this->dimensions($service->derivativePath($small, ProductMediaDerivativeService::THUMBNAIL)));
        $this->assertSame([80, 40], $this->dimensions($service->derivativePath($small, ProductMediaDerivativeService::CARD)));

        $legacyBytes = Storage::disk('local')->get($small->path);
        $legacyPath = "product-media/{$auth['tenant_id']}/{$product->id}/legacy.png";
        Storage::disk('local')->put($legacyPath, $legacyBytes);
        app(TenantContext::class)->set($auth['tenant_id']);
        $legacy = ProductMedia::create([
            'product_id' => $product->id,
            'disk' => 'document',
            'path' => $legacyPath,
            'original_name' => 'legacy.png',
            'mime_type' => 'image/png',
            'size' => strlen($legacyBytes),
            'sort_order' => 1,
        ]);
        app(TenantContext::class)->forget();

        Storage::disk('local')->assertMissing($service->derivativePath($legacy, ProductMediaDerivativeService::THUMBNAIL));
        $fallback = $this->withToken($auth['token'])
            ->get("/api/products/{$product->id}/media/{$legacy->id}/derivatives/thumbnail")
            ->assertOk()->assertHeader('Content-Type', 'image/png');
        $this->assertSame($legacyBytes, $fallback->streamedContent());
    }

    /** @test */
    public function deleting_media_cleans_the_original_and_both_derivatives_without_touching_another_tenant(): void
    {
        $this->fakeDocumentStorage();
        $owner = $this->registerTenant('derivative-owner', 'owner@derivative-owner.test');
        $attacker = $this->registerTenant('derivative-attacker', 'owner@derivative-attacker.test');
        $product = $this->product($owner['token'], 'DERIVATIVE-DELETE-001');
        $service = app(ProductMediaService::class);

        $mediaId = $this->withToken($owner['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [$this->image('delete.webp', 'webp', 900, 600)],
        ])->assertCreated()->json('data.0.id');
        app(TenantContext::class)->set($owner['tenant_id']);
        $media = ProductMedia::findOrFail($mediaId);
        app(TenantContext::class)->forget();
        $paths = [
            $media->path,
            $service->derivativePath($media, ProductMediaDerivativeService::THUMBNAIL),
            $service->derivativePath($media, ProductMediaDerivativeService::CARD),
        ];

        $this->withToken($attacker['token'])
            ->get("/api/products/{$product['id']}/media/{$media->id}/derivatives/thumbnail")
            ->assertStatus(404);
        $this->withToken($attacker['token'])
            ->deleteJson("/api/products/{$product['id']}/media/{$media->id}")
            ->assertStatus(404);

        $this->withToken($owner['token'])->deleteJson("/api/products/{$product['id']}/media/{$media->id}")
            ->assertOk();
        Storage::disk('local')->assertMissing($paths);
        $this->assertDatabaseMissing('product_media', ['id' => $media->id]);
    }

    /** @test */
    public function derivative_paths_are_tenant_scoped_and_cannot_collide_between_tenants(): void
    {
        $this->fakeDocumentStorage();
        $first = $this->registerTenant('derivative-path-a', 'path-a@derivative.test');
        $second = $this->registerTenant('derivative-path-b', 'path-b@derivative.test');
        $firstProduct = $this->product($first['token'], 'DERIVATIVE-PATH-A');
        $secondProduct = $this->product($second['token'], 'DERIVATIVE-PATH-B');

        $firstMediaId = $this->withToken($first['token'])->postJson("/api/products/{$firstProduct['id']}/media", [
            'media' => [$this->image('same-name.jpg', 'jpeg', 400, 300)],
        ])->assertCreated()->json('data.0.id');
        $secondMediaId = $this->withToken($second['token'])->postJson("/api/products/{$secondProduct['id']}/media", [
            'media' => [$this->image('same-name.jpg', 'jpeg', 400, 300)],
        ])->assertCreated()->json('data.0.id');

        $firstMedia = ProductMedia::withoutGlobalScopes()->findOrFail($firstMediaId);
        $secondMedia = ProductMedia::withoutGlobalScopes()->findOrFail($secondMediaId);
        $service = app(ProductMediaService::class);
        $firstPath = $service->derivativePath($firstMedia, ProductMediaDerivativeService::THUMBNAIL);
        $secondPath = $service->derivativePath($secondMedia, ProductMediaDerivativeService::THUMBNAIL);

        $this->assertStringStartsWith("product-media/{$first['tenant_id']}/{$firstProduct['id']}/", $firstPath);
        $this->assertStringStartsWith("product-media/{$second['tenant_id']}/{$secondProduct['id']}/", $secondPath);
        $this->assertNotSame($firstPath, $secondPath);
    }

    /** @test */
    public function derivative_urls_keep_the_existing_product_media_authorization_boundary(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant('derivative-authorized');
        $product = $this->product($auth['token'], 'DERIVATIVE-AUTH-001');
        $mediaId = $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/media", [
            'media' => [$this->image('private.jpg', 'jpeg', 500, 500)],
        ])->assertCreated()->json('data.0.id');
        $url = "/api/products/{$product['id']}/media/{$mediaId}/derivatives/card";

        $this->get($url)->assertUnauthorized();
        $selfServiceToken = $this->tokenForRole($auth['tenant_id'], 'self_service', 'self-service@derivative-authorized.test');
        $this->withToken($selfServiceToken)->get($url)->assertForbidden();
        $this->withToken($selfServiceToken)->postJson("/api/products/{$product['id']}/media", [
            'media' => [$this->image('blocked.jpg', 'jpeg', 100, 100)],
        ])->assertForbidden();
        $this->withToken($auth['token'])->get($url)->assertOk();
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductMedia;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class ProductBarcodeAndMediaTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function fakeDocumentStorage(): void
    {
        config()->set('document_center.storage.driver', 'local');
        config()->set('document_center.storage.disk', 'local');
        Storage::fake('local');
    }

    private function product(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج الباركود',
            'sku' => 'ALT-CODE-001',
            'type' => 'good',
            'unit' => 'piece',
            'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    /** @test */
    public function alternate_barcodes_are_unique_and_bound_to_a_real_product_unit(): void
    {
        $auth = $this->registerTenant();
        $product = $this->product($auth['token'], ['barcode' => 'PRIMARY-001']);

        $barcode = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", [
                'code' => 'ALT-001', 'unit_name' => 'piece', 'label' => 'عبوة مفردة',
            ])->assertCreated()['data'];

        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}/barcodes")
            ->assertOk()->assertJsonPath('data.0.id', $barcode['id'])
            ->assertJsonPath('data.0.unit_name', 'piece')
            ->assertJsonPath('data.0.default_quantity', 1);

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'PRIMARY-001'])
            ->assertStatus(422);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ALT-001'])
            ->assertStatus(422);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ALT-002', 'unit_name' => 'carton'])
            ->assertStatus(422);
        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'ALT-QTY-0', 'default_quantity' => 0])
            ->assertStatus(422);
    }

    /** @test */
    public function creating_a_product_with_multiple_alternate_barcodes_persists_all_of_them(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product with barcodes',
                'sku' => 'BARCODE-CREATE-001',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'ALT-CREATE-001', 'unit_name' => 'piece', 'default_quantity' => 1, 'label' => 'single'],
                    ['code' => 'ALT-CREATE-002', 'unit_name' => 'piece', 'default_quantity' => 2, 'label' => 'double'],
                    ['code' => 'ALT-CREATE-003', 'default_quantity' => 3],
                ],
            ])->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->getJson("/api/products/{$product['id']}/barcodes")
            ->assertOk()
            ->assertJsonCount(3, 'data')
            ->assertJsonPath('data.0.code', 'ALT-CREATE-003')
            ->assertJsonPath('data.1.code', 'ALT-CREATE-002')
            ->assertJsonPath('data.2.code', 'ALT-CREATE-001');

        $this->withToken($auth['token'])
            ->getJson("/api/products/{$product['id']}/barcodes")
            ->assertOk()
            ->assertJsonPath('data.0.default_quantity', 3)
            ->assertJsonPath('data.1.default_quantity', 2)
            ->assertJsonPath('data.2.default_quantity', 1);

        $this->withToken($auth['token'])
            ->getJson("/api/products/{$product['id']}/barcodes")
            ->assertOk()
            ->assertJsonPath('data.2.unit_name', 'piece')
            ->assertJsonPath('data.2.label', 'single');

        $this->assertDatabaseHas('product_barcodes', [
            'product_id' => $product['id'],
            'code' => 'ALT-CREATE-001',
            'default_quantity' => 1,
        ]);
        $this->assertDatabaseHas('product_barcodes', [
            'product_id' => $product['id'],
            'code' => 'ALT-CREATE-002',
            'default_quantity' => 2,
        ]);
        $this->assertDatabaseHas('product_barcodes', [
            'product_id' => $product['id'],
            'code' => 'ALT-CREATE-003',
            'default_quantity' => 3,
        ]);
    }

    /** @test */
    public function creating_a_product_with_an_empty_barcodes_array_creates_no_alternate_barcodes(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product without barcodes',
                'sku' => 'BARCODE-CREATE-EMPTY',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [],
            ])->assertCreated()['data'];

        $this->withToken($auth['token'])
            ->getJson("/api/products/{$product['id']}/barcodes")
            ->assertOk()
            ->assertJsonCount(0, 'data');
    }

    /** @test */
    public function creating_a_product_rejects_an_invalid_alternate_barcode_during_creation(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product invalid barcode',
                'sku' => 'BARCODE-CREATE-INVALID',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => ''],
                ],
            ])->assertStatus(422);

        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product duplicate barcode',
                'sku' => 'BARCODE-CREATE-DUP',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'DUP-CODE-001'],
                    ['code' => 'DUP-CODE-001'],
                ],
            ])->assertStatus(422);

        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product bad quantity',
                'sku' => 'BARCODE-CREATE-QTY',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'BAD-QTY-001', 'default_quantity' => 0],
                ],
            ])->assertStatus(422);
    }

    /** @test */
    public function creating_a_product_with_an_invalid_unit_for_an_alternate_barcode_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product bad unit',
                'sku' => 'BARCODE-CREATE-UNIT',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'BAD-UNIT-001', 'unit_name' => 'carton'],
                ],
            ])->assertStatus(422);
    }

    /** @test */
    public function creating_a_product_with_a_barcode_claims_the_barcode_registry_entry(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product registry claim',
                'sku' => 'BARCODE-CREATE-REG',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'REG-CREATE-001'],
                ],
            ])->assertCreated();

        $this->withToken($auth['token'])
            ->postJson('/api/products', [
                'name' => 'product second',
                'sku' => 'BARCODE-CREATE-REG-2',
                'type' => 'good',
                'unit' => 'piece',
                'sale_price' => 10000,
                'barcodes' => [
                    ['code' => 'REG-CREATE-001'],
                ],
            ])->assertStatus(422);
    }

    /** @test */
    public function product_images_are_private_and_individually_deletable(): void
    {
        $this->fakeDocumentStorage();
        $auth = $this->registerTenant();
        $product = $this->product($auth['token']);

        $response = $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/media", [
                'media' => [
                    UploadedFile::fake()->image('front.jpg'),
                    UploadedFile::fake()->image('side.png'),
                ],
            ])->assertCreated();

        $response->assertJsonCount(2, 'data');
        $media = $response['data'][0];
        $storedMedia = ProductMedia::findOrFail($media['id']);
        $storedProduct = Product::findOrFail($product['id']);
        $this->assertSame('document', $storedMedia->disk);
        $this->assertStringStartsWith("product-media/{$storedProduct->tenant_id}/{$product['id']}/", $storedMedia->path);
        $path = $storedMedia->path;
        Storage::disk('local')->assertExists($path);

        $this->withToken($auth['token'])
            ->get("/api/products/{$product['id']}/media/{$media['id']}/download")
            ->assertOk();

        $this->withToken($auth['token'])
            ->deleteJson("/api/products/{$product['id']}/media/{$media['id']}")
            ->assertOk();
        Storage::disk('local')->assertMissing($path);
    }

    /** @test */
    public function pos_catalog_exposes_the_first_product_image_through_an_authenticated_download_url(): void
    {
        Storage::fake('local');
        $auth = $this->registerTenant('pos-product-image', 'owner@pos-product-image.test');
        $withImage = $this->product($auth['token'], ['name' => 'منتج بصورة POS', 'sku' => 'POS-IMAGE-001']);
        $withoutImage = $this->product($auth['token'], ['name' => 'منتج بلا صورة POS', 'sku' => 'POS-IMAGE-002']);
        $media = $this->withToken($auth['token'])->postJson("/api/products/{$withImage['id']}/media", [
            'media' => [UploadedFile::fake()->image('pos-card.jpg', 640, 480)],
        ])->assertCreated()['data'][0];

        $catalog = $this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'];
        $imaged = collect($catalog)->firstWhere('id', $withImage['id']);
        $plain = collect($catalog)->firstWhere('id', $withoutImage['id']);
        $expectedUrl = "/api/products/{$withImage['id']}/media/{$media['id']}/download";

        $this->assertSame($expectedUrl, $imaged['pos_image']['download_url']);
        $this->assertNull($plain['pos_image']);
        $this->withToken($auth['token'])->get($expectedUrl)->assertOk();
    }

    /** @test */
    public function product_media_and_barcodes_are_isolated_and_files_are_cleaned_when_an_unused_product_is_deleted(): void
    {
        Storage::fake('local');
        $a = $this->registerTenant('alpha', 'alpha@product-media.test');
        $b = $this->registerTenant('beta', 'beta@product-media.test');
        $product = $this->product($b['token']);

        $this->withToken($b['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'TENANT-BARCODE'])
            ->assertCreated();
        $uploaded = $this->withToken($b['token'])
            ->postJson("/api/products/{$product['id']}/media", [
                'media' => [UploadedFile::fake()->image('private.webp')],
            ])->assertCreated()['data'][0];
        $path = ProductMedia::findOrFail($uploaded['id'])->path;

        $this->withToken($a['token'])->getJson("/api/products/{$product['id']}/media")
            ->assertStatus(404);
        $this->withToken($a['token'])->postJson("/api/products/{$product['id']}/barcodes", ['code' => 'FOREIGN'])
            ->assertStatus(404);

        $this->withToken($b['token'])->deleteJson("/api/products/{$product['id']}")->assertOk();
        Storage::disk('local')->assertMissing($path);
        $this->assertDatabaseMissing('product_barcodes', ['code' => 'TENANT-BARCODE']);
        $this->assertDatabaseMissing('product_media', ['id' => $uploaded['id']]);
    }
}

<?php

namespace Tests\Feature;

use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class ProductImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function headers(): string
    {
        return 'sku,name,name_en,type,unit,sale_price_sar,purchase_price_sar,tax_rate,track_inventory,reorder_level,category,brand,barcode,description,is_active';
    }

    private function csv(array $rows): UploadedFile
    {
        return UploadedFile::fake()->createWithContent(
            'products.csv',
            "\xEF\xBB\xBF".$this->headers()."\n".implode("\n", $rows)."\n"
        );
    }

    /** @test */
    public function it_downloads_a_utf8_products_template(): void
    {
        $auth = $this->registerTenant();

        $response = $this->withToken($auth['token'])->get('/api/products/import/template');

        $response->assertOk();
        $this->assertStringContainsString('sku,name,name_en,type', $response->streamedContent());
        $this->assertStringContainsString('قهوة عربية', $response->streamedContent());
    }

    /** @test */
    public function preview_reports_valid_rows_without_creating_products(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv([
            'SKU-1001,قهوة عربية,Arabic Coffee,good,قطعة,35.00,20.00,15,0,5,مشروبات,نبراكس,6281234567890,عبوة قهوة,1',
            'SVC-2001,صيانة دورية,Periodic Maintenance,service,خدمة,150.00,,15,0,,, ,6281234567906,زيارة صيانة,1',
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['mode' => 'create', 'file' => $file])
            ->assertOk()
            ->assertJsonPath('data.total_rows', 2)
            ->assertJsonPath('data.valid_rows', 2)
            ->assertJsonPath('data.invalid_rows', 0);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function it_creates_products_from_a_valid_csv_in_minor_units(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv([
            'SKU-1001,قهوة عربية,Arabic Coffee,good,قطعة,35.25,20.50,15,1,5,مشروبات,نبراكس,6281234567890,عبوة قهوة,1',
            'SVC-2001,صيانة دورية,Periodic Maintenance,service,خدمة,150.00,,15,0,,,,6281234567906,زيارة صيانة,1',
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['mode' => 'create', 'file' => $file])
            ->assertOk()
            ->assertJsonPath('data.created', 2)
            ->assertJsonPath('data.updated', 0);

        $good = Product::where('sku', 'SKU-1001')->firstOrFail();
        $service = Product::where('sku', 'SVC-2001')->firstOrFail();

        $this->assertSame(3525, $good->sale_price);
        $this->assertSame(2050, $good->purchase_price);
        $this->assertTrue($good->track_inventory);
        $this->assertSame(0, $good->quantity_on_hand, 'الاستيراد لا ينشئ رصيداً افتتاحياً.');
        $this->assertSame('service', $service->type);
        $this->assertFalse($service->track_inventory);
    }

    /** @test */
    public function it_rejects_invalid_rows_without_writing_any_product(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv([
            'SKU-1001,قهوة عربية,,good,قطعة,3.999,20.00,15,0,,,,6281234567890,,1',
            'SKU-1002,خدمة مخزنية,,service,خدمة,150.00,,15,1,,,,6281234567906,,1',
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['mode' => 'create', 'file' => $file])
            ->assertOk()
            ->assertJsonPath('data.invalid_rows', 2);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function update_mode_matches_by_sku_without_reclassifying_inventory_behavior(): void
    {
        $auth = $this->registerTenant();
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتج قائم', 'sku' => 'SKU-1001', 'type' => 'good',
            'sale_price' => 10000, 'track_inventory' => true,
        ])->assertCreated()['data'];

        $file = $this->csv([
            'SKU-1001,منتج محدّث,Updated Product,good,قطعة,125.00,60.00,15,1,3,,,6281234567890,وصف محدّث,0',
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['mode' => 'update', 'file' => $file])
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $updated = Product::findOrFail($product['id']);
        $this->assertSame('منتج محدّث', $updated->name);
        $this->assertSame(12500, $updated->sale_price);
        $this->assertTrue($updated->track_inventory);
        $this->assertFalse($updated->is_active);

        $bad = $this->csv([
            'SKU-1001,منتج محدّث,Updated Product,good,قطعة,125.00,60.00,15,0,3,,,,6281234567890,وصف محدّث,0',
        ]);
        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['mode' => 'update', 'file' => $bad])
            ->assertOk()
            ->assertJsonPath('data.invalid_rows', 1);

        $this->assertTrue(Product::findOrFail($product['id'])->track_inventory);
    }

    /** @test */
    public function manual_product_creation_rejects_a_duplicate_tenant_barcode(): void
    {
        $auth = $this->registerTenant();
        $payload = [
            'name' => 'منتج قائم', 'sku' => 'SKU-1001', 'type' => 'good',
            'sale_price' => 10000, 'barcode' => '6281234567890',
        ];

        $this->withToken($auth['token'])->postJson('/api/products', $payload)->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/products', [
            ...$payload, 'name' => 'منتج مكرر', 'sku' => 'SKU-1002',
        ])->assertUnprocessable()->assertJsonValidationErrors('barcode');
    }

    /** @test */
    public function barcode_must_be_unique_for_the_tenant_even_when_products_are_in_different_branches(): void
    {
        $auth = $this->registerTenant();
        $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'منتج قائم', 'sku' => 'SKU-1001', 'type' => 'good',
            'sale_price' => 10000, 'barcode' => '6281234567890',
        ])->assertCreated();

        $file = $this->csv([
            'SKU-1002,منتج جديد,,good,قطعة,125.00,60.00,15,0,,,,6281234567890,وصف,1',
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['mode' => 'create', 'file' => $file])
            ->assertOk()
            ->assertJsonPath('data.invalid_rows', 1);

        $this->assertSame(1, Product::count());
    }
}

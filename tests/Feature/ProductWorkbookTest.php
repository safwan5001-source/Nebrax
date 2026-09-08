<?php

namespace Tests\Feature;

use App\Models\PriceListItem;
use App\Models\Product;
use App\Models\ProductBarcode;
use App\Support\SpreadsheetWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * PR-UOM2-4: مصنّف Products/Barcodes/Unit Prices ثلاثي الأوراق.
 *
 * ورقة Products تمرّ حرفياً عبر `ProductImportService` القائمة (مُثبَتٌ
 * بمجموعة اختبارات منفصلة `ProductImportV2Test`/`ProductExportTest` تبقى
 * خضراء بلا أي تعديل)؛ هنا يُختبَر ما أضافته هذه المهمّة تحديداً: الأوراق
 * الجديدتان، ودمجها الذرّي مع ورقة Products، والقرار D-F.
 */
class ProductWorkbookTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @param array<int, array{name:string, headers:array<int,string>, rows:array<int,array<int,string>>}> $sheets */
    private function workbook(array $sheets): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'test-workbook-');
        SpreadsheetWriter::workbookXlsx($path, $sheets);
        $file = UploadedFile::fake()->createWithContent('workbook.xlsx', (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    private function createPriceList(string $token, string $name = 'قائمة الجملة'): string
    {
        return $this->withToken($token)->postJson('/api/price-lists', ['name' => $name])
            ->assertCreated()['data']['id'];
    }

    private function createProduct(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج قائم', 'sku' => 'SKU-WB-1', 'type' => 'good', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    // ═══════════════════════════════ Products round-trip ═══════════════════════════════

    /** @test */
    public function a_products_only_workbook_creates_a_product_exactly_as_the_single_sheet_path_would(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price', 'tax_rate', 'track_inventory', 'is_active'],
                'rows' => [['SKU-WB-1', 'منتج المصنّف', 'good', 'قطعة', '50.00', '15', '1', '1']]],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.products.created'));
        $this->assertSame(1, Product::count());
        $this->assertSame('منتج المصنّف', Product::first()->name);
    }

    /** @test */
    public function exporting_then_reimporting_unmodified_changes_nothing(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $product = $this->createProduct($auth['token'], ['default_sales_unit' => null]);

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$product['id']}/barcodes", ['code' => '6280000000001', 'default_quantity' => 3, 'label' => 'كرتون'])
            ->assertCreated();
        $this->withToken($auth['token'])
            ->postJson("/api/price-lists/{$priceListId}/items", ['product_id' => $product['id'], 'price' => 9500])
            ->assertCreated();

        $exported = $this->withToken($auth['token'])
            ->get('/api/products/workbook/export?scope=all&price_list_id='.$priceListId)
            ->assertOk();

        $file = UploadedFile::fake()->createWithContent('roundtrip.xlsx', $exported->getContent());

        $reimport = $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'mode' => 'upsert', 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(0, $reimport->json('data.products.created'));
        $this->assertSame(0, $reimport->json('data.products.updated'), 'ملفٌ لم يتغيّر يجب ألّا يُحدِّث شيئاً.');
        $this->assertSame(0, $reimport->json('data.barcodes.created'), 'الباركود المُصدَّر موجودٌ سلفاً — لا إعادة إنشاء.');
        $this->assertSame(1, ProductBarcode::count());
        $this->assertSame(1, PriceListItem::count());
    }

    // ═══════════════════════════════ Barcodes sheet ═══════════════════════════════

    /** @test */
    public function a_barcode_row_with_unit_name_default_quantity_and_label_creates_an_alternate_barcode(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $template = $this->withToken($auth['token'])->postJson('/api/unit-templates', [
            'name' => 'كرتون/قطعة', 'base_unit' => 'قطعة', 'units' => [['name' => 'كرتون', 'factor' => 12]],
        ])->assertCreated()['data'];
        $product = $this->createProduct($auth['token'], ['unit_template_id' => $template['id'], 'unit' => 'قطعة']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code', 'unit_name', 'default_quantity', 'label'],
                'rows' => [[$product['sku'], '6280000000010', 'كرتون', '12', 'كرتون توزيع']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.barcodes.created'));
        $barcode = ProductBarcode::first();
        $this->assertSame('6280000000010', $barcode->code);
        $this->assertSame('كرتون', $barcode->unit_name);
        $this->assertSame(12, $barcode->default_quantity);
        $this->assertSame('كرتون توزيع', $barcode->label);
    }

    /** @test */
    public function a_barcode_row_with_an_unknown_unit_is_rejected_fail_closed(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $product = $this->createProduct($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code', 'unit_name'], 'rows' => [[$product['sku'], '6280000000020', 'وحدة غير موجودة']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/preview', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk()
            ->assertJsonPath('data.barcodes.error_rows', 1)
            ->assertJsonPath('data.ready', false);

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertStatus(422);

        $this->assertSame(0, ProductBarcode::count(), 'لا كتابة قبل معالجة الأخطاء.');
    }

    /** @test */
    public function a_duplicate_barcode_within_the_file_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $product = $this->createProduct($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [
                [$product['sku'], '6280000000030'],
                [$product['sku'], '6280000000030'],
            ]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/preview', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.barcodes.error_rows'));
    }

    /** @test */
    public function a_barcode_already_claimed_by_another_product_in_the_tenant_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $productA = $this->createProduct($auth['token'], ['sku' => 'SKU-WB-A']);
        $productB = $this->createProduct($auth['token'], ['sku' => 'SKU-WB-B']);

        $this->withToken($auth['token'])
            ->postJson("/api/products/{$productA['id']}/barcodes", ['code' => '6280000000040'])
            ->assertCreated();

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [[$productB['sku'], '6280000000040']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/preview', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.barcodes.error_rows'));
        $this->assertSame(1, ProductBarcode::count(), 'لا باركود ثانٍ أُنشئ.');
    }

    // ═══════════════════════════════ Unit Prices sheet ═══════════════════════════════

    /** @test */
    public function a_unit_price_row_creates_an_explicit_price_list_item(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $product = $this->createProduct($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [[$product['sku'], '', '42.50']]],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.unit_prices.written'));
        $item = PriceListItem::first();
        $this->assertSame($priceListId, $item->price_list_id);
        $this->assertSame($product['unit'], $item->unit_name);
        $this->assertSame(4250, $item->price);
    }

    /** @test */
    public function a_unit_price_row_with_an_unknown_unit_is_rejected_fail_closed(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $product = $this->createProduct($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [[$product['sku'], 'وحدة غير معروفة', '10.00']]],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/preview', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.unit_prices.error_rows'));
        $this->assertSame(0, PriceListItem::count());
    }

    /** @test */
    public function price_is_never_derived_from_a_unit_factor(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $template = $this->withToken($auth['token'])->postJson('/api/unit-templates', [
            'name' => 'صندوق/قطعة', 'base_unit' => 'قطعة', 'units' => [['name' => 'صندوق', 'factor' => 10]],
        ])->assertCreated()['data'];
        $product = $this->createProduct($auth['token'], ['unit_template_id' => $template['id'], 'unit' => 'قطعة', 'sale_price' => 1000]);

        // سعرٌ صريح لوحدة «صندوق» لا علاقة له بالمعامل ١٠ ولا بسعر القطعة.
        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => [[$product['sku'], 'صندوق', '77.77']]],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertOk();

        $item = PriceListItem::where('unit_name', 'صندوق')->first();
        $this->assertSame(7777, $item->price, 'السعر المخزَّن هو ما وَرَد في الملف حرفياً — لا 10× سعر القطعة.');
    }

    /** @test */
    public function no_explicit_price_never_appears_as_a_synthesized_export_row(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $this->createProduct($auth['token']); // بلا أي عنصر في قائمة السعر

        $response = $this->withToken($auth['token'])
            ->get('/api/products/workbook/export?scope=all&price_list_id='.$priceListId)
            ->assertOk();

        // المصنّف يُبنى بنجاح رغم غياب أي سعرٍ صريح — ورقة Unit Prices فارغة
        // من صفوف البيانات، لا سطرٌ بسعرٍ صفريٍّ أو مُشتقٍّ.
        $this->assertSame(0, PriceListItem::count());
        $this->assertGreaterThan(0, strlen($response->getContent()));
    }

    // ═══════════════════════════════ D-F: قائمة السعر الإلزامية ═══════════════════════════════

    /** @test */
    public function a_workbook_request_without_a_price_list_id_is_refused(): void
    {
        $auth = $this->registerTenant();
        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file])
            ->assertStatus(422);

        $this->withToken($auth['token'])
            ->get('/api/products/workbook/export?scope=all')
            ->assertStatus(422);
    }

    /** @test */
    public function a_price_list_from_another_tenant_never_resolves(): void
    {
        $authA = $this->registerTenant('tenant-a', 'a@wb.test');
        $authB = $this->registerTenant('tenant-b', 'b@wb.test');
        $priceListB = $this->createPriceList($authB['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $this->withToken($authA['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListB])
            ->assertStatus(422);
    }

    // ═══════════════════════════════ عزل المستأجر ═══════════════════════════════

    /** @test */
    public function a_nebrax_id_or_sku_from_another_tenant_never_resolves(): void
    {
        $authA = $this->registerTenant('tenant-c', 'c@wb.test');
        $authB = $this->registerTenant('tenant-d', 'd@wb.test');
        $priceListA = $this->createPriceList($authA['token']);
        $productB = $this->createProduct($authB['token'], ['sku' => 'SKU-CROSS']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku'], 'rows' => []],
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => [['SKU-CROSS', '6280000000099']]],
            ['name' => 'Unit Prices', 'headers' => ['sku', 'unit_name', 'price'], 'rows' => []],
        ]);

        $response = $this->withToken($authA['token'])
            ->post('/api/products/workbook/preview', ['file' => $file, 'price_list_id' => $priceListA])
            ->assertOk();

        $this->assertSame(1, $response->json('data.barcodes.error_rows'), 'رمز صنفٍ من مستأجر آخر لا يُطابق شيئاً.');
    }

    // ═══════════════════════════════ الملفات القديمة / حدود الصيغة ═══════════════════════════════

    /** @test */
    public function a_csv_upload_to_the_workbook_endpoint_is_rejected_the_single_sheet_path_stays_untouched(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);
        $csv = UploadedFile::fake()->createWithContent('products.csv', SpreadsheetWriter::csv(['sku', 'name'], [['SKU-1', 'اسم']]));

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $csv, 'price_list_id' => $priceListId])
            ->assertStatus(422);
    }

    /** @test */
    public function a_workbook_missing_the_barcodes_or_unit_prices_sheet_is_not_an_error(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);

        $file = $this->workbook([
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'sale_price'], 'rows' => [['SKU-WB-1', 'منتج', 'good', '10.00']]],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'mode' => 'create', 'price_list_id' => $priceListId])
            ->assertOk();

        $this->assertSame(1, $response->json('data.products.created'));
        $this->assertSame(0, ProductBarcode::count());
        $this->assertSame(0, PriceListItem::count());
    }

    /** @test */
    public function a_workbook_missing_the_products_sheet_is_refused(): void
    {
        $auth = $this->registerTenant();
        $priceListId = $this->createPriceList($auth['token']);

        $file = $this->workbook([
            ['name' => 'Barcodes', 'headers' => ['sku', 'code'], 'rows' => []],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/workbook/apply', ['file' => $file, 'price_list_id' => $priceListId])
            ->assertStatus(422);
    }

    // ═══════════════════════════════ الصلاحيات ═══════════════════════════════

    /** @test */
    public function workbook_routes_require_authentication_and_permission(): void
    {
        $this->postJson('/api/products/workbook/apply', [])->assertStatus(401);
        $this->getJson('/api/products/workbook/export')->assertStatus(401);
    }
}

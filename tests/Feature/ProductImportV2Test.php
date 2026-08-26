<?php

namespace Tests\Feature;

use App\Models\Brand;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\StockMovement;
use App\Models\UnitTemplate;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Services\ProductImportService;
use App\Services\ProductLifecycleService;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * استيراد المنتجات V2: CSV/XLSX · إنشاء/تحديث/دمج · مطابقة أعمدة · سياسات.
 *
 * `ProductImportTest` يبقى قائماً يحرس عقد V1 (الترويسات الثابتة والوضعين
 * القديمين)؛ هنا ما أضافته V2 وما يجب ألّا تكسره.
 */
class ProductImportV2Test extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function csv(array $headers, array $rows, string $name = 'products.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($headers, $rows));
    }

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function xlsx(array $headers, array $rows, string $name = 'products.xlsx'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'test-xlsx-');
        SpreadsheetWriter::xlsx($path, $headers, $rows);
        $file = UploadedFile::fake()->createWithContent($name, (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    private function createProduct(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج قائم', 'sku' => 'SKU-1001', 'type' => 'good', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    // ═══════════════════════════════ الفحص والمطابقة ═══════════════════════════════

    /** @test */
    public function inspect_returns_columns_samples_and_a_suggested_mapping(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(
            ['Product Name', 'Code', 'Price', 'Tax', 'رقم غامض'],
            [['قهوة', 'SKU-1', '35.00', '15', 'x']]
        );

        $response = $this->withToken($auth['token'])
            ->post('/api/products/import/inspect', ['file' => $file])
            ->assertOk();

        $this->assertSame('name', $response->json('data.columns.0.suggested_field'));
        $this->assertSame('sku', $response->json('data.columns.1.suggested_field'));
        $this->assertSame('sale_price', $response->json('data.columns.2.suggested_field'));
        $this->assertSame('tax_rate', $response->json('data.columns.3.suggested_field'));
        $this->assertNull($response->json('data.columns.4.suggested_field'), 'العمود الغامض يبقى بلا اقتراح.');
        $this->assertSame('قهوة', $response->json('data.columns.0.samples.0'));
        $this->assertSame(1, $response->json('data.total_rows'));
        $this->assertSame(0, Product::count(), 'الفحص لا يكتب شيئاً.');
    }

    /** @test */
    public function arabic_headers_map_automatically(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(
            ['الاسم', 'رمز الصنف', 'النوع', 'سعر البيع', 'الفئة'],
            [['قهوة عربية', 'SKU-AR-1', 'سلعة', '٣٥٫٠٠', 'مشروبات']]
        );

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.created', 1);

        $product = Product::where('sku', 'SKU-AR-1')->firstOrFail();
        $this->assertSame('good', $product->type, 'المرادف العربي «سلعة» يُقرأ نوعاً صحيحاً.');
        $this->assertSame(3500, $product->sale_price, 'الأرقام العربية-الهندية والفاصلة العربية تُقرآن.');
    }

    /** @test */
    public function an_explicit_mapping_overrides_the_header_names(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['A', 'B', 'C', 'D'], [['SKU-MAP-1', 'منتج مطابق', '12.75', 'good']]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file,
            'mode' => 'create',
            'mapping' => [0 => 'sku', 1 => 'name', 2 => 'sale_price', 3 => 'type'],
        ])->assertOk()->assertJsonPath('data.created', 1);

        $product = Product::where('sku', 'SKU-MAP-1')->firstOrFail();
        $this->assertSame('منتج مطابق', $product->name);
        $this->assertSame(1275, $product->sale_price);
        $this->assertSame('good', $product->type);
    }

    /** @test */
    public function a_mapping_that_leaves_a_required_field_unmapped_is_refused_before_any_row(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['A', 'B', 'C'], [['SKU-MAP-2', 'بلا نوع', '12.75']]);

        // النوع مطلوب لإنشاء منتج تماماً كما في بطاقة المنتج؛ افتراضه صامتاً
        // كان سيُنشئ سلعاً متتبَّعة من ملفٍ كلّه خدمات.
        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $file,
            'mode' => 'create',
            'mapping' => [0 => 'sku', 1 => 'name', 2 => 'sale_price'],
        ])->assertStatus(422);
    }

    /** @test */
    public function two_columns_cannot_be_mapped_to_the_same_field(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['A', 'B'], [['x', 'y']]);

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create',
            'mapping' => [0 => 'name', 1 => 'name'],
        ])->assertStatus(422);
    }

    /** @test */
    public function an_unmapped_required_field_stops_the_run_before_any_row(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['رمز', 'باركود'], [['SKU-9', '6281234567890']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertStatus(422);
    }

    /** @test */
    public function update_without_an_identifier_column_is_refused(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['الاسم', 'سعر البيع'], [['منتج', '10.00']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertStatus(422);
    }

    // ═══════════════════════════════ الصيغ ═══════════════════════════════

    /** @test */
    public function it_creates_products_from_a_valid_xlsx(): void
    {
        $auth = $this->registerTenant();
        $file = $this->xlsx(
            ['sku', 'name', 'type', 'sale_price', 'barcode', 'track_inventory'],
            [
                ['SKU-X1', 'صنف من إكسل', 'good', '35.25', '06281234567890', '1'],
                ['SVC-X2', 'خدمة من إكسل', 'service', '150.00', '', '0'],
            ]
        );

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.created', 2);

        $good = Product::where('sku', 'SKU-X1')->firstOrFail();
        $this->assertSame(3525, $good->sale_price);
        $this->assertSame('06281234567890', $good->barcode, 'الصفر البادئ في الباركود لا يسقط عبر XLSX.');
        $this->assertSame('service', Product::where('sku', 'SVC-X2')->firstOrFail()->type);
    }

    /** @test */
    public function a_malformed_xlsx_is_refused_with_a_readable_message(): void
    {
        $auth = $this->registerTenant();
        $file = UploadedFile::fake()->createWithContent('broken.xlsx', 'this is not a zip archive at all');

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertStatus(422);
    }

    /** @test */
    public function an_unsupported_extension_is_refused_by_validation(): void
    {
        $auth = $this->registerTenant();
        $file = UploadedFile::fake()->createWithContent('catalog.pdf', '%PDF-1.4 fake');

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('file');
    }

    /** @test */
    public function a_file_beyond_the_row_limit_is_refused(): void
    {
        $auth = $this->registerTenant();
        $rows = [];
        for ($index = 0; $index <= ProductImportService::MAX_ROWS; $index++) {
            $rows[] = ['SKU-BIG-'.$index, 'منتج '.$index, 'good', '10.00'];
        }
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], $rows);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertStatus(422);

        $this->assertSame(0, Product::count());
    }

    // ═══════════════════════════════ الأوضاع ═══════════════════════════════

    /** @test */
    public function upsert_creates_what_is_missing_and_updates_what_exists(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'SKU-UP-1', 'name' => 'الاسم القديم']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [
            ['SKU-UP-1', 'الاسم الجديد', 'good', '120.00'],
            ['SKU-UP-2', 'منتج جديد', 'good', '80.50'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'upsert'])
            ->assertOk()
            ->assertJsonPath('data.created', 1)
            ->assertJsonPath('data.updated', 1);

        $this->assertSame('الاسم الجديد', Product::where('sku', 'SKU-UP-1')->firstOrFail()->name);
        $this->assertSame(8050, Product::where('sku', 'SKU-UP-2')->firstOrFail()->sale_price);
    }

    /** @test */
    public function create_mode_never_touches_an_existing_product(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'SKU-C-1', 'name' => 'الأصل']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-C-1', 'محاولة', 'good', '1.00']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);

        $this->assertSame('الأصل', Product::where('sku', 'SKU-C-1')->firstOrFail()->name);
    }

    /** @test */
    public function update_mode_never_creates_a_missing_product(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'sale_price'], [['SKU-MISSING', 'لا وجود له', '10.00']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertStatus(422);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function an_update_row_that_changes_nothing_is_reported_as_skipped(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'SKU-S-1', 'name' => 'كما هو']);

        $file = $this->csv(['sku', 'name'], [['SKU-S-1', 'كما هو']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.updated', 0)
            ->assertJsonPath('data.skipped', 1);
    }

    // ═══════════════════════════════ المعرّف وround-trip ═══════════════════════════════

    /** @test */
    public function nebrax_id_matches_ahead_of_sku_and_allows_renaming_the_sku(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'SKU-OLD', 'name' => 'قبل']);

        $file = $this->csv(['nebrax_id', 'sku', 'name'], [[$product['id'], 'SKU-NEW', 'بعد']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $fresh = Product::findOrFail($product['id']);
        $this->assertSame('SKU-NEW', $fresh->sku);
        $this->assertSame('بعد', $fresh->name);
        $this->assertSame(1, Product::count(), 'إعادة تسمية الرمز لا تنتج نسخة ثانية.');
    }

    /** @test */
    public function a_nebrax_id_from_another_tenant_never_resolves(): void
    {
        $first = $this->registerTenant('acme', 'owner@acme.test');
        $second = $this->registerTenant('other', 'owner@other.test');
        $foreign = $this->createProduct($second['token'], ['sku' => 'SKU-FOREIGN']);

        $file = $this->csv(['nebrax_id', 'name'], [[$foreign['id'], 'محاولة اختراق النطاق']]);

        $this->withToken($first['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);

        app(TenantContext::class)->set($second['tenant_id']);
        $this->assertSame('منتج قائم', Product::findOrFail($foreign['id'])->name);
    }

    /** @test */
    public function a_malformed_nebrax_id_is_an_error_not_a_silent_create(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['nebrax_id', 'sku', 'name'], [['not-a-uuid', 'SKU-Z', 'منتج']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);
    }

    /** @test */
    public function dropping_the_identifier_column_falls_back_to_sku_matching(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'SKU-RT-1']);

        $file = $this->csv(['sku', 'name'], [['SKU-RT-1', 'حُدّث بالرمز']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $this->assertSame('حُدّث بالرمز', Product::findOrFail($product['id'])->name);
    }

    // ═══════════════════════════════ التكرار والتعارض ═══════════════════════════════

    /** @test */
    public function duplicate_skus_and_barcodes_inside_the_file_are_flagged(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'barcode'], [
            ['SKU-D1', 'أول', 'good', '10.00', '6281234567890'],
            ['SKU-D1', 'مكرر الرمز', 'good', '10.00', '6281234567891'],
            ['SKU-D2', 'مكرر الباركود', 'good', '10.00', '6281234567890'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 2)
            ->assertJsonPath('data.total_rows', 3);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function an_existing_barcode_blocks_an_update_of_a_different_product(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'SKU-B1', 'barcode' => '6281234567890']);
        $this->createProduct($auth['token'], ['sku' => 'SKU-B2', 'name' => 'ثانٍ']);

        $file = $this->csv(['sku', 'barcode'], [['SKU-B2', '6281234567890']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);
    }

    /** @test */
    public function a_product_keeps_its_own_barcode_on_update(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'SKU-B3', 'barcode' => '6281234567890']);

        $file = $this->csv(['sku', 'barcode', 'name'], [['SKU-B3', '6281234567890', 'اسم جديد']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $this->assertSame('اسم جديد', Product::findOrFail($product['id'])->name);
    }

    // ═══════════════════════════════ سياسة الفراغ ═══════════════════════════════

    /** @test */
    public function a_blank_cell_leaves_the_stored_value_untouched_by_default(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], [
            'sku' => 'SKU-BL-1', 'name_en' => 'Original', 'description' => 'وصف قائم',
        ]);

        $file = $this->csv(['sku', 'name', 'name_en', 'description'], [['SKU-BL-1', 'اسم محدث', '', '']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'update'])
            ->assertOk()
            ->assertJsonPath('data.updated', 1);

        $fresh = Product::findOrFail($product['id']);
        $this->assertSame('اسم محدث', $fresh->name);
        $this->assertSame('Original', $fresh->name_en, 'الفراغ لا يمسح.');
        $this->assertSame('وصف قائم', $fresh->description);
    }

    /** @test */
    public function the_clear_policy_empties_clearable_fields_only(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], [
            'sku' => 'SKU-BL-2', 'name' => 'الاسم', 'name_en' => 'Original', 'sale_price' => 5000,
        ]);

        $file = $this->csv(['sku', 'name', 'name_en', 'sale_price'], [['SKU-BL-2', '', '', '']]);

        $response = $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'update', 'blank_policy' => 'clear',
        ])->assertOk();

        $fresh = Product::findOrFail($product['id']);
        $this->assertNull($fresh->name_en, 'الحقل القابل للمسح يُمسح.');
        $this->assertSame('الاسم', $fresh->name, 'الاسم لا يُمسح مهما كانت السياسة.');
        $this->assertSame(5000, $fresh->sale_price, 'سعر البيع لا يُمسح مهما كانت السياسة.');
        $this->assertNotEmpty($response->json('data.results.0.messages'), 'المسح المرفوض يُبلَّغ به لا يُبتلع.');
    }

    // ═══════════════════════════════ البيانات الأساسية ═══════════════════════════════

    /** @test */
    public function a_managed_category_and_brand_are_matched_by_name_into_their_ids(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::create(['name' => 'مشروبات']);
        $brand = Brand::create(['name' => 'نبراكس']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category', 'brand'], [
            ['SKU-M1', 'قهوة', 'good', '35.00', 'مشروبات', 'نبراكس'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.created', 1);

        $product = Product::where('sku', 'SKU-M1')->firstOrFail();
        $this->assertSame($category->id, $product->category_id);
        $this->assertSame($brand->id, $product->brand_id);
        $this->assertNull($product->category, 'المُعرّف يحلّ محلّ النصّ القديم فلا يبقى اسمان.');
    }

    /** @test */
    public function match_or_error_refuses_an_unknown_category(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category'], [
            ['SKU-M2', 'قهوة', 'good', '35.00', 'تصنيف غير موجود'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'match_or_error',
        ])->assertOk()->assertJsonPath('data.error_rows', 1);

        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function the_default_policy_keeps_free_text_working_with_a_warning(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category'], [
            ['SKU-M3', 'قهوة', 'good', '35.00', 'تصنيف حر'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 0)
            ->assertJsonPath('data.warning_rows', 1);
    }

    /** @test */
    public function create_missing_is_an_explicit_opt_in_that_creates_the_record(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category'], [
            ['SKU-M4', 'قهوة', 'good', '35.00', 'تصنيف جديد'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()->assertJsonPath('data.created', 1);

        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::where('name', 'تصنيف جديد')->firstOrFail();
        $this->assertSame($category->id, Product::where('sku', 'SKU-M4')->firstOrFail()->category_id);
    }

    // ══════════════ إنشاء البيانات الأساسية: متى يقع، وكم مرة ══════════════

    /**
     * @test
     *
     * المعاينة عقدها أنها **لا تغيّر البيانات**. وكان `create_missing` يكسر ذلك
     * العقد: مجرّد فتح المعاينة لتجريب السياسة كان يزرع تصنيفاً وعلامةً دائمين
     * لملفٍ قد لا يُطبَّق أصلاً.
     */
    public function preview_under_create_missing_creates_nothing_and_says_what_it_would_create(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category', 'brand'], [
            ['SKU-P1', 'قهوة', 'good', '35.00', 'تصنيف مؤجَّل', 'علامة مؤجَّلة'],
        ]);

        $response = $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()
            ->assertJsonPath('data.error_rows', 0)
            ->assertJsonPath('data.create_rows', 1);

        $messages = implode(' | ', $response->json('data.rows.0.messages'));
        $this->assertStringContainsString('سيُنشأ عند تنفيذ الاستيراد', $messages, 'المعاينة تقول ما ستفعله بدل أن تفعله.');

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, ProductCategory::count(), 'المعاينة لا تكتب تصنيفاً.');
        $this->assertSame(0, Brand::count(), 'المعاينة لا تكتب علامة تجارية.');
        $this->assertSame(0, Product::count());
    }

    /**
     * @test
     *
     * كل صفٍّ كان يُنشئ سجلّاً مستقلاً لأن الفهرس يُبنى مرة واحدة قبل الصفوف
     * فلا يرى ما أُنشئ أثناءها: ملفٌ فيه ٤ أسطر لـ«تصنيف مكرر» يخلّف ٤ تصنيفات
     * بالاسم نفسه، فتصير المطابقة بالاسم غامضةً في كل استيراد لاحق.
     */
    public function create_missing_creates_one_record_per_name_however_many_rows_repeat_it(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category', 'brand'], [
            ['SKU-D1', 'صنف ١', 'good', '10.00', 'تصنيف مكرر', 'علامة مكررة'],
            ['SKU-D2', 'صنف ٢', 'good', '10.00', 'تصنيف مكرر', 'علامة مكررة'],
            ['SKU-D3', 'صنف ٣', 'good', '10.00', '  تصنيف مكرر  ', 'علامة مكررة'],
            ['SKU-D4', 'صنف ٤', 'good', '10.00', 'تصنيف آخر', 'علامة مكررة'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()->assertJsonPath('data.created', 4);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(2, ProductCategory::count(), 'اسمان متمايزان = تصنيفان، مهما تكررت الأسطر.');
        $this->assertSame(1, Brand::count());

        $repeated = ProductCategory::where('name', 'تصنيف مكرر')->firstOrFail();
        foreach (['SKU-D1', 'SKU-D2', 'SKU-D3'] as $sku) {
            $product = Product::where('sku', $sku)->firstOrFail();
            $this->assertSame($repeated->id, $product->category_id, "الصفوف المتكررة تشير إلى السجلّ نفسه ({$sku}).");
            $this->assertNull($product->category, 'المُعرّف يحلّ محلّ النصّ القديم.');
        }
    }

    /**
     * @test
     *
     * الإنشاء كان يقع **قبل** المعاملة، فرجوعها لا يمسحه: استيرادٌ فشل يخلّف
     * تصنيفاً وعلامةً يتيمين لا منتج يشير إليهما.
     */
    public function a_rolled_back_apply_leaves_no_orphan_category_or_brand(): void
    {
        $auth = $this->registerTenant();

        // فشلٌ مصطنع **داخل** المعاملة: أقرب ما يحاكي عطلاً بعد كتابة أول صف.
        $this->app->bind(ProductLifecycleService::class, fn ($app) => new class($app->make(DocumentStorageService::class)) extends ProductLifecycleService
        {
            public function create(Product $product, ?string $userId): void
            {
                throw new \RuntimeException('عطل مصطنع أثناء الكتابة.');
            }
        });

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category', 'brand'], [
            ['SKU-R1', 'صنف', 'good', '10.00', 'تصنيف يتيم', 'علامة يتيمة'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertStatus(422);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, Product::count(), 'لا كتابة جزئية.');
        $this->assertSame(0, ProductCategory::count(), 'التصنيف يرجع مع المعاملة لأنه أُنشئ داخلها.');
        $this->assertSame(0, Brand::count());
    }

    /**
     * @test
     *
     * الاسم الذي أُنشئ بين المعاينة والتطبيق (طلبٌ متزامن) يُطابَق لا يُكرَّر.
     */
    public function create_missing_matches_a_name_that_appeared_between_preview_and_apply(): void
    {
        $auth = $this->registerTenant();
        $rows = [['SKU-C1', 'صنف', 'good', '10.00', 'تصنيف سابق']];
        $headers = ['sku', 'name', 'type', 'sale_price', 'category'];

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $this->csv($headers, $rows), 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()->assertJsonPath('data.error_rows', 0);

        app(TenantContext::class)->set($auth['tenant_id']);
        $existing = ProductCategory::create(['name' => 'تصنيف سابق']);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $this->csv($headers, $rows), 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()->assertJsonPath('data.created', 1);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(1, ProductCategory::count(), 'الاسم القائم يُطابَق ولا يُنسخ.');
        $this->assertSame($existing->id, Product::where('sku', 'SKU-C1')->firstOrFail()->category_id);
    }

    /**
     * @test
     *
     * تحديثٌ لا يغيّر إلا التصنيف الجديد كانت حمولته تبدو فارغة (المُعرّف لم
     * يُملأ بعد)، فيتحوّل الصف إلى «تخطٍّ» ولا يُربط بشيء.
     */
    public function a_row_whose_only_change_is_a_new_category_is_an_update_not_a_skip(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'SKU-N1', 'name' => 'صنف ثابت']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category'], [
            ['SKU-N1', 'صنف ثابت', 'good', '100.00', 'تصنيف طارئ'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'update', 'master_data_policy' => 'create_missing',
        ])->assertOk()
            ->assertJsonPath('data.updated', 1)
            ->assertJsonPath('data.skipped', 0);

        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::where('name', 'تصنيف طارئ')->firstOrFail();
        $this->assertSame($category->id, Product::findOrFail($product['id'])->category_id);
    }

    // ══════════════ النص الحر يفكّ المرجع المُدار لا يتعايش معه ══════════════

    /**
     * @test
     *
     * `ProductResource` والتصدير يقرآن `productCategory?->name ?? category`،
     * فالمُعرّف الباقي كان يطغى على النص الذي قال الاستيراد إنه حفظه: يقول
     * «سيُحفظ نصّاً حرّاً» ثم يعرض المستخدمُ الاسمَ المُدار القديم نفسه.
     */
    public function free_text_detaches_the_managed_category_and_brand_it_replaces(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::create(['name' => 'مشروبات']);
        $brand = Brand::create(['name' => 'نبراكس']);

        $product = $this->createProduct($auth['token'], [
            'sku' => 'SKU-F1', 'category_id' => $category->id, 'brand_id' => $brand->id,
        ]);
        $this->assertSame($category->id, $product['category_id'], 'المنتج يبدأ بمرجع مُدار فعلاً.');

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category', 'brand'], [
            ['SKU-F1', 'منتج قائم', 'good', '100.00', 'تصنيف حر', 'علامة حرة'],
        ]);

        $response = $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'update', 'master_data_policy' => 'match_or_text',
        ])->assertOk()->assertJsonPath('data.updated', 1);

        $messages = implode(' | ', $response->json('data.results.0.messages'));
        $this->assertStringContainsString('سيُفَكّ عن المنتج', $messages, 'فكّ ارتباطٍ قائم يُقال لا يُمرَّر صامتاً.');

        app(TenantContext::class)->set($auth['tenant_id']);
        $stored = Product::findOrFail($product['id']);
        $this->assertNull($stored->category_id, 'المُعرّف المُدار لا يبقى تحت نصّ حر.');
        $this->assertNull($stored->brand_id);
        $this->assertSame('تصنيف حر', $stored->category);
        $this->assertSame('علامة حرة', $stored->brand);

        // ما يراه المستخدم — لا الحمولة — هو محلّ العلّة.
        $this->withToken($auth['token'])->getJson("/api/products/{$product['id']}")
            ->assertOk()
            ->assertJsonPath('data.category', 'تصنيف حر')
            ->assertJsonPath('data.brand', 'علامة حرة')
            ->assertJsonPath('data.category_id', null)
            ->assertJsonPath('data.brand_id', null);

        $export = $this->withToken($auth['token'])->get('/api/products/export?scope=all&format=csv&template=round_trip');
        $export->assertOk();
        $body = $export->streamedContent();
        $this->assertStringContainsString('تصنيف حر', $body, 'التصدير يطابق ما قال الاستيراد إنه حفظه.');
        $this->assertStringNotContainsString('مشروبات', $body);
    }

    /**
     * @test
     *
     * ولا ينقلب الفكّ إلى أثرٍ جانبي: منتجٌ بلا مرجع مُدار أصلاً لا يستحق تنبيه فكّ.
     */
    public function free_text_on_a_product_without_a_managed_reference_warns_only_about_the_text(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'SKU-F2']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'category'], [
            ['SKU-F2', 'منتج قائم', 'good', '100.00', 'تصنيف حر'],
        ]);

        $response = $this->withToken($auth['token'])->post('/api/products/import/apply', [
            'file' => $file, 'mode' => 'update', 'master_data_policy' => 'match_or_text',
        ])->assertOk()->assertJsonPath('data.updated', 1);

        $messages = implode(' | ', $response->json('data.results.0.messages'));
        $this->assertStringContainsString('سيُحفظ نصّاً حرّاً فقط', $messages);
        $this->assertStringNotContainsString('سيُفَكّ عن المنتج', $messages);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame('تصنيف حر', Product::findOrFail($product['id'])->category);
    }

    /** @test */
    public function a_unit_template_is_matched_and_forces_its_base_unit(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $template = UnitTemplate::create(['name' => 'كرتون/حبة', 'base_unit' => 'حبة']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'unit', 'unit_template'], [
            ['SKU-U1', 'صنف', 'good', '10.00', 'وحدة مخالفة', 'كرتون/حبة'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk();

        $product = Product::where('sku', 'SKU-U1')->firstOrFail();
        $this->assertSame($template->id, $product->unit_template_id);
        $this->assertSame('حبة', $product->unit, 'وحدة الأساس تُفرض من القالب كما في بطاقة المنتج.');
    }

    /** @test */
    public function a_unit_template_is_never_created_from_free_text(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'unit_template'], [
            ['SKU-U2', 'صنف', 'good', '10.00', 'قالب مخترع'],
        ]);

        $this->withToken($auth['token'])->post('/api/products/import/preview', [
            'file' => $file, 'mode' => 'create', 'master_data_policy' => 'create_missing',
        ])->assertOk()->assertJsonPath('data.error_rows', 1);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, UnitTemplate::count());
    }

    // ═══════════════════════════════ سلامة القيم ═══════════════════════════════

    /** @test */
    public function invalid_money_and_tax_values_are_readable_row_errors(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'tax_rate'], [
            ['SKU-V1', 'ثلاث منازل', 'good', '3.999', '15'],
            ['SKU-V2', 'ضريبة خارج المدى', 'good', '10.00', '150'],
            ['SKU-V3', 'مبلغ سالب', 'good', '-5.00', '15'],
            ['SKU-V4', 'نوع مجهول', 'gadget', '10.00', '15'],
        ]);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 4);

        $this->assertStringContainsString('سعر البيع', implode(' ', $response->json('data.errors.0.messages')));
        $this->assertSame(0, Product::count());
    }

    /** @test */
    public function thousand_separators_and_currency_spacing_are_read_safely(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-V5', 'صنف', 'good', '1,250.50']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk();

        $this->assertSame(125050, Product::where('sku', 'SKU-V5')->firstOrFail()->sale_price);
    }

    /** @test */
    public function a_row_wider_than_the_header_row_is_refused(): void
    {
        $auth = $this->registerTenant();
        $file = UploadedFile::fake()->createWithContent(
            'ragged.csv',
            "\xEF\xBB\xBFsku,name,type,sale_price\r\nSKU-R1,صنف,good,10.00,قيمة زائدة\r\n"
        );

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);
    }

    /** @test */
    public function a_min_sale_price_above_the_sale_price_is_refused(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'min_sale_price'], [
            ['SKU-V6', 'صنف', 'good', '10.00', '20.00'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 1);
    }

    /** @test */
    public function a_blank_sku_is_filled_from_the_shared_numbering_counter(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['', 'بلا رمز', 'good', '10.00']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.created', 1);

        $product = Product::firstOrFail();
        $this->assertNotNull($product->sku);
        $this->assertStringStartsWith('SKU-', (string) $product->sku);
    }

    // ═══════════════════════════════ الأثر والعزل ═══════════════════════════════

    /** @test */
    public function import_creates_no_stock_movement_and_no_journal_entry(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price', 'track_inventory'], [
            ['SKU-I1', 'صنف متتبع', 'good', '35.00', '1'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk();

        $product = Product::where('sku', 'SKU-I1')->firstOrFail();
        $this->assertSame(0, $product->quantity_on_hand);
        $this->assertSame(0, $product->avg_cost);
        $this->assertSame(0, StockMovement::where('product_id', $product->id)->count());
        $this->assertSame(0, \App\Models\JournalEntry::count(), 'الاستيراد لا يولّد قيداً محاسبياً.');
    }

    /** @test */
    public function a_failure_mid_file_rolls_the_whole_run_back(): void
    {
        $auth = $this->registerTenant();
        // صفٌّ سليم يليه صفٌّ يعارض منتجاً قائماً — التطبيق يُرفض كاملاً.
        $this->createProduct($auth['token'], ['sku' => 'SKU-T2']);

        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [
            ['SKU-T1', 'سيُنشأ لولا الرفض', 'good', '10.00'],
            ['SKU-T2', 'يعارض قائماً', 'good', '10.00'],
        ]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertStatus(422);

        $this->assertNull(Product::where('sku', 'SKU-T1')->first(), 'لا كتابة جزئية.');
        $this->assertSame(1, Product::count());
    }

    /** @test */
    public function apply_revalidates_against_the_live_catalog_after_a_clean_preview(): void
    {
        $auth = $this->registerTenant();
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-RV', 'صنف', 'good', '10.00']]);

        $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.error_rows', 0);

        // يُنشئ مستخدم آخر المنتج نفسه بين المعاينة والتطبيق.
        $this->createProduct($auth['token'], ['sku' => 'SKU-RV', 'name' => 'سبق غيرك']);

        $second = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-RV', 'صنف', 'good', '10.00']]);
        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $second, 'mode' => 'create'])
            ->assertStatus(422);

        $this->assertSame('سبق غيرك', Product::where('sku', 'SKU-RV')->firstOrFail()->name);
    }

    /** @test */
    public function import_is_isolated_per_tenant(): void
    {
        $first = $this->registerTenant('acme', 'owner@acme.test');
        $second = $this->registerTenant('other', 'owner@other.test');
        $this->createProduct($second['token'], ['sku' => 'SKU-SAME']);

        // الرمز نفسه في مؤسسة أخرى لا يتعارض؛ كلٌّ في كتالوجه.
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-SAME', 'صنف مستقل', 'good', '10.00']]);

        $this->withToken($first['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.created', 1);

        app(TenantContext::class)->set($first['tenant_id']);
        $this->assertSame(1, Product::count());
        app(TenantContext::class)->set($second['tenant_id']);
        $this->assertSame(1, Product::count());
    }

    /** @test */
    public function import_routes_require_the_products_manage_permission(): void
    {
        $auth = $this->registerTenant();
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], [['SKU-P1', 'صنف', 'good', '10.00']]);

        $this->withToken($staff)->get('/api/products/import/template')->assertForbidden();
        $this->withToken($staff)->post('/api/products/import/inspect', ['file' => $file])->assertForbidden();
        $this->withToken($staff)
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertForbidden();
        $this->withToken($staff)
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'create'])
            ->assertForbidden();
    }

    /** @test */
    public function import_routes_reject_an_unauthenticated_caller(): void
    {
        $this->postJson('/api/products/import/preview', ['mode' => 'create'])->assertUnauthorized();
        $this->postJson('/api/products/import/apply', ['mode' => 'create'])->assertUnauthorized();
    }

    /** @test */
    public function preview_caps_the_row_detail_list_and_says_so(): void
    {
        $auth = $this->registerTenant();
        $rows = [];
        for ($index = 0; $index < 260; $index++) {
            $rows[] = ['SKU-CAP-'.$index, 'منتج '.$index, 'good', '10.00'];
        }
        $file = $this->csv(['sku', 'name', 'type', 'sale_price'], $rows);

        $response = $this->withToken($auth['token'])
            ->post('/api/products/import/preview', ['file' => $file, 'mode' => 'create'])
            ->assertOk()
            ->assertJsonPath('data.total_rows', 260)
            ->assertJsonPath('data.create_rows', 260)
            ->assertJsonPath('data.rows_truncated', true);

        $this->assertSame(200, $response->json('data.rows_shown'));
    }
}

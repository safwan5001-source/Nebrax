<?php

namespace Tests\Feature;

use App\Models\Product;
use App\Models\ProductCategory;
use App\Support\SpreadsheetReader;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * تصدير المنتجات V2 — خادميّ، بدلالة القائمة نفسها، وبملف round-trip.
 */
class ProductExportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createProduct(string $token, array $overrides = []): array
    {
        return $this->withToken($token)->postJson('/api/products', array_merge([
            'name' => 'منتج', 'type' => 'good', 'sale_price' => 10000,
        ], $overrides))->assertCreated()['data'];
    }

    /** @return array<int, array<int, string>> */
    private function readCsv(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'export-csv-');
        file_put_contents($path, $response->streamedContent());
        $rows = SpreadsheetReader::read($path, 'csv', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @return array<int, array<int, string>> */
    private function readXlsx(TestResponse $response): array
    {
        $path = tempnam(sys_get_temp_dir(), 'export-xlsx-');
        file_put_contents($path, $response->getContent());
        $rows = SpreadsheetReader::read($path, 'xlsx', 60000, 200);
        @unlink($path);

        return $rows;
    }

    /** @param array<int, array<int, string>> $rows @return array<int, string> */
    private function column(array $rows, string $header): array
    {
        $index = array_search($header, $rows[0], true);
        $this->assertNotFalse($index, "العمود «{$header}» غير موجود في الملف المصدَّر.");

        return array_map(static fn (array $row): string => (string) ($row[$index] ?? ''), array_slice($rows, 1));
    }

    // ═══════════════════════════════ النطاقات ═══════════════════════════════

    /** @test */
    public function all_scope_exports_the_whole_catalog_as_csv(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'SKU-1', 'name' => 'أول']);
        $this->createProduct($auth['token'], ['sku' => 'SKU-2', 'name' => 'ثانٍ', 'is_active' => false]);

        $response = $this->withToken($auth['token'])
            ->get('/api/products/export?scope=all&format=csv')
            ->assertOk();

        $this->assertStringContainsString('text/csv', $response->headers->get('Content-Type'));
        $rows = $this->readCsv($response);
        $this->assertCount(3, $rows, 'صف عناوين وصفّا بيانات.');
        $this->assertSame(['SKU-1', 'SKU-2'], array_values(array_filter($this->column($rows, 'sku'))));
    }

    /** @test */
    public function filtered_scope_returns_every_matching_row_not_just_one_page(): void
    {
        $auth = $this->registerTenant();
        for ($index = 1; $index <= 30; $index++) {
            $this->createProduct($auth['token'], [
                'sku' => sprintf('GOOD-%02d', $index), 'name' => 'سلعة '.$index, 'type' => 'good',
            ]);
        }
        $this->createProduct($auth['token'], ['sku' => 'SVC-1', 'name' => 'خدمة', 'type' => 'service']);

        // القائمة تعرض عشرة في الصفحة؛ التصدير المفلتر يتجاهل التقسيم كلياً.
        $listed = $this->withToken($auth['token'])
            ->getJson('/api/products?type=good&per_page=10&page=1')
            ->assertOk();
        $this->assertCount(10, $listed->json('data'));
        $this->assertSame(30, $listed->json('meta.total'));

        $rows = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=filtered&format=csv&type=good&per_page=10&page=1')
                ->assertOk()
        );

        $this->assertCount(31, $rows, 'ثلاثون سلعة وصف عناوين — لا صفحة من عشرة.');
        $this->assertNotContains('SVC-1', $this->column($rows, 'sku'), 'الخدمة خارج الفلتر فخارج الملف.');
    }

    /** @test */
    public function filtered_export_matches_the_list_query_semantics(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $category = ProductCategory::create(['name' => 'مشروبات']);

        $this->createProduct($auth['token'], ['sku' => 'HIT-1', 'name' => 'قهوة مطابقة', 'category_id' => $category->id, 'sale_price' => 5000]);
        $this->createProduct($auth['token'], ['sku' => 'HIT-2', 'name' => 'شاي مطابق', 'category_id' => $category->id, 'sale_price' => 9000]);
        $this->createProduct($auth['token'], ['sku' => 'MISS-1', 'name' => 'قهوة رخيصة', 'category_id' => $category->id, 'sale_price' => 1000]);
        $this->createProduct($auth['token'], ['sku' => 'MISS-2', 'name' => 'خارج التصنيف', 'sale_price' => 5000]);

        $query = 'category_id='.$category->id.'&sale_price_gte=20&is_active=1';

        $listed = $this->withToken($auth['token'])->getJson("/api/products?{$query}&per_page=100")->assertOk();
        $listedSkus = array_column($listed->json('data'), 'sku');
        sort($listedSkus);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])->get("/api/products/export?scope=filtered&format=csv&{$query}")->assertOk()
        );
        $exportedSkus = array_values(array_filter($this->column($rows, 'sku')));
        sort($exportedSkus);

        $this->assertSame(['HIT-1', 'HIT-2'], $listedSkus);
        $this->assertSame($listedSkus, $exportedSkus, 'القائمة والتصدير يشتقّان من عقد تصفية واحد.');
    }

    /** @test */
    public function selected_scope_exports_only_the_named_products(): void
    {
        $auth = $this->registerTenant();
        $first = $this->createProduct($auth['token'], ['sku' => 'SEL-1', 'name' => 'مختار']);
        $this->createProduct($auth['token'], ['sku' => 'SEL-2', 'name' => 'غير مختار']);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=selected&format=csv&ids[]='.$first['id'])
                ->assertOk()
        );

        $this->assertSame(['SEL-1'], array_values(array_filter($this->column($rows, 'sku'))));
    }

    /** @test */
    public function selected_scope_without_ids_is_refused(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])
            ->getJson('/api/products/export?scope=selected&format=csv')
            ->assertStatus(422);
    }

    /** @test */
    public function a_selected_id_from_another_tenant_exports_nothing(): void
    {
        $first = $this->registerTenant('acme', 'owner@acme.test');
        $second = $this->registerTenant('other', 'owner@other.test');
        $foreign = $this->createProduct($second['token'], ['sku' => 'FOREIGN-1']);
        $this->createProduct($first['token'], ['sku' => 'MINE-1']);

        $rows = $this->readCsv(
            $this->withToken($first['token'])
                ->get('/api/products/export?scope=selected&format=csv&ids[]='.$foreign['id'])
                ->assertOk()
        );

        $this->assertCount(1, $rows, 'العناوين فقط — لا صفّ من مؤسسة أخرى.');
    }

    /** @test */
    public function export_never_leaks_another_tenants_catalog(): void
    {
        $first = $this->registerTenant('acme', 'owner@acme.test');
        $second = $this->registerTenant('other', 'owner@other.test');
        $this->createProduct($second['token'], ['sku' => 'OTHER-1', 'name' => 'سرّ الغير']);
        $this->createProduct($first['token'], ['sku' => 'MINE-1', 'name' => 'ملكي']);

        $rows = $this->readCsv(
            $this->withToken($first['token'])->get('/api/products/export?scope=all&format=csv')->assertOk()
        );

        $this->assertSame(['MINE-1'], array_values(array_filter($this->column($rows, 'sku'))));
    }

    // ═══════════════════════════════ الصيغ والقوالب ═══════════════════════════════

    /** @test */
    public function xlsx_export_is_a_readable_workbook_with_typed_columns(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], [
            'sku' => 'XL-1', 'name' => 'صنف إكسل', 'barcode' => '06281234567890',
            'sale_price' => 3525, 'track_inventory' => true,
        ]);

        $response = $this->withToken($auth['token'])
            ->get('/api/products/export?scope=all&format=xlsx')
            ->assertOk();

        $this->assertStringContainsString('spreadsheetml.sheet', $response->headers->get('Content-Type'));
        $rows = $this->readXlsx($response);
        $this->assertSame(['XL-1'], $this->column($rows, 'sku'));
        $this->assertSame(['35.00'], $this->column($rows, 'sale_price'));
        $this->assertSame(['06281234567890'], $this->column($rows, 'barcode'), 'الباركود نصّ فلا يسقط صفره البادئ.');
    }

    /** @test */
    public function the_catalog_template_carries_read_only_stock_columns_and_no_identifier(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'CAT-1', 'track_inventory' => true]);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=all&format=csv&template=catalog')
                ->assertOk()
        );

        $this->assertContains('quantity_on_hand', $rows[0]);
        $this->assertContains('avg_cost', $rows[0]);
        $this->assertNotContains('nebrax_id', $rows[0], 'القالب البشري ليس ملف إعادة استيراد.');
        $this->assertNotContains('internal_notes', $rows[0]);
    }

    /** @test */
    public function the_round_trip_template_leads_with_the_identifier_and_omits_derived_stock(): void
    {
        $auth = $this->registerTenant();
        $product = $this->createProduct($auth['token'], ['sku' => 'RT-1', 'track_inventory' => true]);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=all&format=csv&template=round_trip')
                ->assertOk()
        );

        $this->assertSame('nebrax_id', $rows[0][0]);
        $this->assertNotContains('quantity_on_hand', $rows[0], 'الكمية لا تُستورَد فلا تُصدَّر في ملف إعادة الاستيراد.');
        $this->assertNotContains('avg_cost', $rows[0]);
        $this->assertSame([$product['id']], $this->column($rows, 'nebrax_id'));
    }

    // ═══════════════════════════════ الدورة الكاملة ═══════════════════════════════

    /** @test */
    public function a_round_trip_file_re_imports_as_updates_without_duplicating_anything(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'RT-A', 'name' => 'الأول', 'sale_price' => 5000]);
        $this->createProduct($auth['token'], ['sku' => 'RT-B', 'name' => 'الثاني', 'sale_price' => 7500]);

        $exported = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=all&format=csv&template=round_trip')
                ->assertOk()
        );

        // يعدّل المستخدم عمود الاسم في Excel ثم يعيد الملف كما هو.
        $nameIndex = array_search('name', $exported[0], true);
        foreach (array_slice(array_keys($exported), 1) as $rowIndex) {
            $exported[$rowIndex][$nameIndex] .= ' — معدّل';
        }

        $path = tempnam(sys_get_temp_dir(), 'round-trip-');
        file_put_contents($path, \App\Support\SpreadsheetWriter::csv($exported[0], array_slice($exported, 1)));
        $file = UploadedFile::fake()->createWithContent('round-trip.csv', (string) file_get_contents($path));
        @unlink($path);

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'upsert'])
            ->assertOk()
            ->assertJsonPath('data.created', 0)
            ->assertJsonPath('data.updated', 2);

        $this->assertSame(2, Product::count(), 'لا نسخ مكررة بعد دورة كاملة.');
        $this->assertSame('الأول — معدّل', Product::where('sku', 'RT-A')->firstOrFail()->name);
        $this->assertSame(5000, Product::where('sku', 'RT-A')->firstOrFail()->sale_price, 'المبالغ تعود كما هي بلا انحراف.');
    }

    /** @test */
    public function an_unmodified_round_trip_file_re_imports_as_a_full_skip(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'RT-N1', 'name' => 'بلا تعديل', 'barcode' => '6281234567890']);

        $response = $this->withToken($auth['token'])
            ->get('/api/products/export?scope=all&format=csv&template=round_trip')
            ->assertOk();
        $file = UploadedFile::fake()->createWithContent('round-trip.csv', $response->streamedContent());

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'upsert'])
            ->assertOk()
            ->assertJsonPath('data.created', 0)
            ->assertJsonPath('data.updated', 0)
            ->assertJsonPath('data.skipped', 1);
    }

    /** @test */
    public function an_xlsx_round_trip_survives_excel_typing(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], [
            'sku' => 'RTX-1', 'name' => 'صنف', 'sale_price' => 3525, 'barcode' => '06281234567890',
        ]);

        $response = $this->withToken($auth['token'])
            ->get('/api/products/export?scope=all&format=xlsx&template=round_trip')
            ->assertOk();
        $file = UploadedFile::fake()->createWithContent('round-trip.xlsx', $response->getContent());

        $this->withToken($auth['token'])
            ->post('/api/products/import/apply', ['file' => $file, 'mode' => 'upsert'])
            ->assertOk()
            ->assertJsonPath('data.skipped', 1);

        $product = Product::where('sku', 'RTX-1')->firstOrFail();
        $this->assertSame(3525, $product->sale_price);
        $this->assertSame('06281234567890', $product->barcode);
        $this->assertSame(1, Product::count());
    }

    // ═══════════════════════════════ الحراسة ═══════════════════════════════

    /** @test */
    public function export_requires_the_products_view_permission(): void
    {
        $auth = $this->registerTenant();
        $this->getJson('/api/products/export?scope=all')->assertUnauthorized();

        // `staff` يملك `products.view` فيرى التصدير؛ العزل يبقى قائماً فوقه.
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@acme.test');
        $this->withToken($staff)->get('/api/products/export?scope=all&format=csv')->assertOk();

        $selfService = $this->tokenForRole($auth['tenant_id'], 'self_service', 'me@acme.test');
        $this->withToken($selfService)->getJson('/api/products/export?scope=all')->assertForbidden();
    }

    /** @test */
    public function an_invalid_format_or_scope_is_refused(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->getJson('/api/products/export?format=pdf')->assertStatus(422);
        $this->withToken($auth['token'])->getJson('/api/products/export?scope=everything')->assertStatus(422);
        $this->withToken($auth['token'])->getJson('/api/products/export?template=whatever')->assertStatus(422);
        $this->withToken($auth['token'])
            ->getJson('/api/products/export?scope=selected&ids[]=not-a-uuid')
            ->assertStatus(422);
    }

    /** @test */
    public function export_honours_the_requested_sort(): void
    {
        $auth = $this->registerTenant();
        $this->createProduct($auth['token'], ['sku' => 'S-A', 'name' => 'ألف', 'sale_price' => 30000]);
        $this->createProduct($auth['token'], ['sku' => 'S-B', 'name' => 'باء', 'sale_price' => 10000]);
        $this->createProduct($auth['token'], ['sku' => 'S-C', 'name' => 'جيم', 'sale_price' => 20000]);

        $rows = $this->readCsv(
            $this->withToken($auth['token'])
                ->get('/api/products/export?scope=all&format=csv&sort=-sale_price')
                ->assertOk()
        );

        $this->assertSame(['S-A', 'S-C', 'S-B'], $this->column($rows, 'sku'));
    }
}

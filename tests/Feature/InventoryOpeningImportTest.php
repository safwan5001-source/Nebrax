<?php

namespace Tests\Feature;

use App\Models\InventoryOpening;
use App\Models\InventoryOpeningLine;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Support\InventoryOpeningFields;
use App\Support\ProductImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  استيراد الأرصدة الافتتاحية — الملف إلى مسودة
 * ═══════════════════════════════════════════════════════════════
 *  **الثابت الأول المحروس:** المعاينة لا تكتب حرفاً — لا سطراً ولا حركة ولا
 *  قيداً ولا بيانات أساسية. المستخدم يجرّب ملفه كما يشاء بلا أثر.
 *
 *  تشغيل: php artisan test --filter=InventoryOpeningImportTest
 */
class InventoryOpeningImportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function csv(array $headers, array $rows, string $name = 'openings.csv'): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, SpreadsheetWriter::csv($headers, $rows));
    }

    /** @param array<int, string> $headers @param array<int, array<int, string>> $rows */
    private function xlsx(array $headers, array $rows, string $name = 'openings.xlsx'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'opening-xlsx-');
        SpreadsheetWriter::xlsx($path, $headers, $rows);
        $file = UploadedFile::fake()->createWithContent($name, (string) file_get_contents($path));
        @unlink($path);

        return $file;
    }

    /** مؤسسة بمخزن ومنتج جاهزين. */
    private function scene(string $slug = 'acme', string $email = 'owner@acme.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        app(TenantContext::class)->set($auth['tenant_id']);

        // تسجيل المستأجر يُنشئ «المخزن الرئيسي» (كود 00001) تلقائياً. مخزنُ
        // المشهد يأخذ اسماً مغايراً عمداً كي تُختبَر المطابقة لا يُختبَر الالتباس.
        $warehouse = Warehouse::create(['name' => 'مستودع الرياض', 'code' => 'WH-1']);
        $product = Product::create([
            'name' => 'قهوة عربية', 'sku' => 'SKU-1001', 'barcode' => '6280000000001', 'type' => 'good',
            'sale_price' => 25000, 'purchase_price' => 15000, 'track_inventory' => true,
        ]);

        return $auth + ['warehouse' => $warehouse, 'product' => $product];
    }

    private function preview(string $token, UploadedFile $file, array $payload = []): array
    {
        return $this->withToken($token)->post('/api/inventory-openings/import/preview', array_merge([
            'file' => $file, 'opening_date' => '2026-01-01',
        ], $payload))->assertOk()->json('data');
    }

    /** أكواد كل المشاكل في صف بعينه — الاختبارات تؤكد على الرمز لا على نصّه. */
    private function codes(array $preview, int $row): array
    {
        foreach ($preview['rows'] as $entry) {
            if ($entry['row'] === $row) {
                return array_column($entry['issues'], 'code');
            }
        }

        return [];
    }

    // ═══════════════════════ قراءة الملف ═══════════════════════

    /** @test */
    public function a_csv_with_arabic_headers_is_auto_mapped_and_previewed(): void
    {
        $scene = $this->scene();

        $preview = $this->preview($scene['token'], $this->csv(
            ['رمز الصنف', 'المخزن', 'الكمية الافتتاحية', 'تكلفة الوحدة'],
            [['SKU-1001', 'مستودع الرياض', '120', '18.50']]
        ));

        $this->assertSame(1, $preview['counters']['valid_rows']);
        $this->assertSame(0, $preview['counters']['error_rows']);
        $this->assertSame(120, $preview['counters']['total_quantity']);
        $this->assertSame('2220.00', $preview['counters']['total_value'], '120 × 18.50 = 2220.00');
        $this->assertSame('valid', $preview['rows'][0]['status']);
    }

    /** @test */
    public function an_xlsx_file_reads_the_same_as_its_csv_twin(): void
    {
        $scene = $this->scene();
        $headers = ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'];
        $rows = [['SKU-1001', 'WH-1', '120', '18.50']];

        $fromCsv = $this->preview($scene['token'], $this->csv($headers, $rows));
        $fromXlsx = $this->preview($scene['token'], $this->xlsx($headers, $rows));

        $this->assertSame($fromCsv['counters'], $fromXlsx['counters']);
        $this->assertSame('1850', (string) 1850);
        $this->assertSame($fromCsv['rows'][0]['total_cost'], $fromXlsx['rows'][0]['total_cost']);
    }

    /**
     * @test
     *
     * الأصفار البادئة والباركود الطويل: XLSX يخزّن الأرقام كأعداد، فباركودٌ
     * من 13 خانة كان يعود `6.28E+12` ورمزٌ كـ`00123` يفقد أصفاره.
     */
    public function leading_zeros_and_long_barcodes_survive_the_xlsx_reader(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        Product::create([
            'name' => 'صنف', 'sku' => '00123', 'barcode' => '6280000000001', 'type' => 'good',
            'sale_price' => 1000, 'purchase_price' => 500, 'track_inventory' => true,
        ]);

        $preview = $this->preview($auth['token'], $this->xlsx(
            ['sku', 'barcode', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['00123', '6280000000001', 'WH-1', '5', '10.00']]
        ));

        $this->assertSame(1, $preview['counters']['valid_rows'], 'الرمز بأصفاره البادئة طابق منتجاً.');
        $this->assertSame('00123', $preview['rows'][0]['sku']);
        $this->assertSame('6280000000001', $preview['rows'][0]['barcode']);
    }

    /** @test */
    public function decimal_costs_become_exact_halalas_without_float_drift(): void
    {
        $scene = $this->scene();

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-1', '3', '0.10']]
        ));

        $this->assertSame('0.10', $preview['rows'][0]['unit_cost']);
        $this->assertSame('0.30', $preview['rows'][0]['total_cost'], '3 × 0.10 = 0.30 بلا انحراف.');
    }

    /** @test */
    public function blank_rows_are_skipped_and_never_counted(): void
    {
        $scene = $this->scene();

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['SKU-1001', 'WH-1', '10', '5.00'],
                ['', '', '', ''],
                ['', '', '', ''],
            ]
        ));

        $this->assertSame(1, $preview['counters']['total_rows']);
        $this->assertSame(1, $preview['counters']['valid_rows']);
    }

    /** @test */
    public function duplicate_headers_are_refused_before_any_row(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(
                ['sku', 'المخزن', 'المخزن', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', 'WH-1', '10', '5.00']]
            ),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422)->assertJsonPath('message', 'صف العناوين يحتوي أسماء أعمدة مكرّرة. وحّدها قبل الرفع.');
    }

    /** @test */
    public function two_columns_cannot_be_mapped_to_the_same_field(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['a', 'b', 'c', 'd'], [['SKU-1001', 'SKU-1001', '10', '5.00']]),
            'opening_date' => '2026-01-01',
            'mapping' => [0 => 'sku', 1 => 'sku', 2 => 'opening_quantity', 3 => 'opening_unit_cost'],
        ])->assertStatus(422)->assertJsonPath('message', 'لا يمكن ربط عمودين بالحقل نفسه. صحّح مطابقة الأعمدة.');
    }

    /** @test */
    public function a_file_without_a_warehouse_column_is_refused(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['sku', 'opening_quantity', 'opening_unit_cost'], [['SKU-1001', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'الملف يحتاج عمود المخزن: كود المخزن أو اسمه أو معرّفه.');
    }

    /** @test */
    public function a_file_without_a_product_identifier_column_is_refused(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['product_name', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['قهوة عربية', 'WH-1', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'الملف يحتاج عمود تعريف للصنف: رمز الصنف أو الباركود أو معرّف نبراكس.');
    }

    /** @test */
    public function an_unsupported_extension_is_refused_by_validation(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => UploadedFile::fake()->createWithContent('openings.pdf', '%PDF-1.4'),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422);
    }

    /** @test */
    public function a_file_beyond_the_row_limit_is_refused(): void
    {
        $scene = $this->scene();

        $rows = [];
        for ($i = 0; $i < 2001; $i++) {
            $rows[] = ['SKU-1001', 'WH-1', '1', '1.00'];
        }

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'], $rows),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422);
    }

    /** @test */
    public function the_opening_date_is_required_and_is_not_a_per_row_column(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '10', '5.00']]),
        ])->assertStatus(422)
            ->assertJsonPath('message', 'تاريخ الرصيد الافتتاحي مطلوب بصيغة YYYY-MM-DD.');

        $this->assertNull(InventoryOpeningFields::get('opening_date'), 'التاريخ ليس عموداً في عقد الملف.');
    }

    // ═══════════════════════ المعاينة: لا كتابة ═══════════════════════

    /**
     * @test
     *
     * العقد الأول للمعاينة. ملفٌ فيه صفٌّ صالح وصفٌّ فاسد معاً — لا يُكتب من
     * أيٍّ منهما شيء.
     */
    public function preview_writes_absolutely_nothing(): void
    {
        $scene = $this->scene();
        $before = [
            'openings'   => InventoryOpening::count(),
            'lines'      => InventoryOpeningLine::count(),
            'movements'  => StockMovement::count(),
            'entries'    => JournalEntry::count(),
            'stock'      => ProductWarehouseStock::count(),
            'products'   => Product::count(),
            'warehouses' => Warehouse::count(),
            'quantity'   => Product::where('sku', 'SKU-1001')->value('quantity_on_hand'),
        ];

        $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['SKU-1001', 'WH-1', '120', '18.50'],
                ['SKU-MISSING', 'مخزن غير موجود', 'كثير', '-5'],
            ]
        ));

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame($before['openings'], InventoryOpening::count());
        $this->assertSame($before['lines'], InventoryOpeningLine::count());
        $this->assertSame($before['movements'], StockMovement::count());
        $this->assertSame($before['entries'], JournalEntry::count());
        $this->assertSame($before['stock'], ProductWarehouseStock::count());
        $this->assertSame($before['products'], Product::count(), 'لا يُنشئ منتجاً ناقصاً.');
        $this->assertSame($before['warehouses'], Warehouse::count(), 'لا يُنشئ مخزناً ناقصاً.');
        $this->assertSame($before['quantity'], Product::where('sku', 'SKU-1001')->value('quantity_on_hand'));
    }

    /** @test */
    public function every_row_failure_has_a_stable_code_a_field_and_a_readable_reason(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        Product::create(['name' => 'خدمة', 'sku' => 'SRV-1', 'type' => 'service', 'sale_price' => 1000, 'purchase_price' => 0]);
        Product::create(['name' => 'غير متتبَّع', 'sku' => 'NT-1', 'type' => 'good', 'sale_price' => 1000, 'purchase_price' => 500, 'track_inventory' => false]);
        // أصنافٌ متمايزة للصفوف الثلاثة الأخيرة: تكرار الصنف نفسه في المخزن نفسه
        // يضيف `duplicate_row` بحقّ، فيشوّش على الخطأ المقصود قياسه.
        foreach (['Q-1', 'C-1', 'Z-1'] as $sku) {
            Product::create(['name' => "صنف {$sku}", 'sku' => $sku, 'type' => 'good',
                'sale_price' => 1000, 'purchase_price' => 500, 'track_inventory' => true]);
        }

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['SKU-NOPE', 'WH-1', '10', '5.00'],       // 2: صنف غير موجود
                ['SKU-1001', 'WH-NOPE', '10', '5.00'],    // 3: مخزن غير موجود
                ['SRV-1', 'WH-1', '10', '5.00'],          // 4: خدمة
                ['NT-1', 'WH-1', '10', '5.00'],           // 5: لا يتتبّع مخزوناً
                ['Q-1', 'WH-1', 'عشرة', '5.00'],          // 6: كمية غير صالحة
                ['C-1', 'WH-1', '10', 'مجاناً'],          // 7: تكلفة غير صالحة
                ['Z-1', 'WH-1', '0', '5.00'],             // 8: كمية غير موجبة
            ]
        ));

        $this->assertSame(['product_not_found'], $this->codes($preview, 2));
        $this->assertSame(['warehouse_not_found'], $this->codes($preview, 3));
        $this->assertSame(['service_item'], $this->codes($preview, 4));
        $this->assertSame(['product_not_tracked'], $this->codes($preview, 5));
        $this->assertSame(['invalid_quantity'], $this->codes($preview, 6));
        $this->assertSame(['invalid_unit_cost'], $this->codes($preview, 7));
        $this->assertSame(['non_positive_quantity'], $this->codes($preview, 8));

        $this->assertSame(7, $preview['counters']['error_rows']);
        $this->assertSame(0, $preview['counters']['valid_rows']);

        // كل مشكلة تحمل الحقل والقيمة ونصّاً يقول ما العمل — لا استثناء خام.
        foreach ($preview['rows'] as $row) {
            foreach ($row['issues'] as $issue) {
                $this->assertNotEmpty($issue['code']);
                $this->assertNotEmpty($issue['message']);
                $this->assertStringNotContainsString('Exception', $issue['message']);
            }
        }
    }

    /** @test */
    public function a_zero_unit_cost_is_refused_unless_explicitly_allowed(): void
    {
        $scene = $this->scene();
        $file = fn (): UploadedFile => $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-1', '10', '0']]
        );

        $blocked = $this->preview($scene['token'], $file());
        $this->assertSame(['zero_unit_cost'], $this->codes($blocked, 2));

        $allowed = $this->preview($scene['token'], $file(), ['allow_zero_cost' => '1']);
        $this->assertSame([], $this->codes($allowed, 2));
        $this->assertSame(1, $allowed['counters']['valid_rows']);
    }

    /** @test */
    public function the_same_product_twice_in_one_warehouse_is_a_duplicate_but_two_warehouses_are_valid(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        Warehouse::create(['name' => 'مخزن الدمام', 'code' => 'WH-2']);

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['SKU-1001', 'WH-1', '10', '5.00'],   // 2: صالح
                ['SKU-1001', 'WH-2', '20', '6.00'],   // 3: صالح — مخزن آخر
                ['SKU-1001', 'WH-1', '30', '7.00'],   // 4: مكرّر
            ]
        ));

        $this->assertSame([], $this->codes($preview, 2));
        $this->assertSame([], $this->codes($preview, 3));
        $this->assertSame(['duplicate_row'], $this->codes($preview, 4));
        $this->assertSame(1, $preview['counters']['duplicate_rows']);
        $this->assertSame(2, $preview['counters']['valid_rows']);
    }

    /** @test */
    public function a_product_with_a_prior_movement_is_flagged_in_the_preview(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        app(InventoryService::class)->receiveStock($scene['product'], 5, 1000, ['warehouse_id' => $scene['warehouse']->id]);

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-1', '10', '5.00']]
        ));

        $this->assertSame(['product_has_prior_movement'], $this->codes($preview, 2));
        $this->assertSame(1, $preview['counters']['products_with_movements']);
        $this->assertSame(0, $preview['counters']['valid_rows'], 'العدّاد يتراجع مع الصف الذي سقط.');
        $this->assertSame(0, $preview['counters']['total_quantity']);
        $this->assertSame('0.00', $preview['counters']['total_value']);
    }

    /** @test */
    public function an_ambiguous_barcode_stops_the_row_instead_of_guessing(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        Product::create([
            'name' => 'توأم الباركود', 'sku' => 'SKU-1002', 'barcode' => '6280000000001', 'type' => 'good',
            'sale_price' => 1000, 'purchase_price' => 500, 'track_inventory' => true,
        ]);

        $preview = $this->preview($scene['token'], $this->csv(
            ['barcode', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['6280000000001', 'WH-1', '10', '5.00']]
        ));

        $this->assertSame(['ambiguous_barcode'], $this->codes($preview, 2));
    }

    /** @test */
    public function an_ambiguous_warehouse_name_stops_the_row_but_its_code_resolves(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        Warehouse::create(['name' => 'مستودع الرياض', 'code' => 'WH-9']);

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [
                ['SKU-1001', 'مستودع الرياض', '10', '5.00'],   // 2: اسم ملتبس
                ['SKU-1001', 'WH-9', '10', '5.00'],            // 3: الكود يحسم
            ]
        ));

        $this->assertSame(['ambiguous_warehouse'], $this->codes($preview, 2));
        $this->assertSame([], $this->codes($preview, 3));
    }

    /** @test */
    public function an_inactive_warehouse_is_refused(): void
    {
        $scene = $this->scene();
        app(TenantContext::class)->set($scene['tenant_id']);
        Warehouse::create(['name' => 'مخزن موقوف', 'code' => 'WH-OFF', 'is_active' => false]);

        $preview = $this->preview($scene['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-OFF', '10', '5.00']]
        ));

        $this->assertSame(['warehouse_inactive'], $this->codes($preview, 2));
    }

    // ═══════════════════════ الفحص والقالب ═══════════════════════

    /** @test */
    public function inspect_returns_columns_samples_and_a_suggested_mapping(): void
    {
        $scene = $this->scene();

        $data = $this->withToken($scene['token'])->post('/api/inventory-openings/import/inspect', [
            'file' => $this->csv(
                ['رمز الصنف', 'المستودع', 'الكمية', 'سعر التكلفة', 'عمود غامض'],
                [['SKU-1001', 'WH-1', '10', '5.00', 'x']]
            ),
        ])->assertOk()->json('data');

        $this->assertSame(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost', null],
            array_column($data['columns'], 'suggested_field'));
        $this->assertSame(['SKU-1001'], $data['columns'][0]['samples']);
        $this->assertSame(1, $data['total_rows']);
        $this->assertNotEmpty($data['fields']);
    }

    /** @test */
    public function the_template_downloads_with_the_documented_headers(): void
    {
        $scene = $this->scene();

        $response = $this->withToken($scene['token'])->get('/api/inventory-openings/import/template')->assertOk();
        $body = $response->streamedContent();

        foreach (['رمز الصنف', 'المخزن', 'الكمية الافتتاحية', 'تكلفة الوحدة'] as $label) {
            $this->assertStringContainsString($label, $body);
        }
        $this->assertStringNotContainsString('تاريخ', $body, 'التاريخ ليس عموداً في الملف.');
    }

    // ═══════════════════════ التطبيق: مسودة لا ترحيل ═══════════════════════

    /** @test */
    public function apply_creates_a_draft_and_never_posts_it(): void
    {
        $scene = $this->scene();

        $document = $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(
                ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost', 'notes'],
                [['SKU-1001', 'WH-1', '120', '18.50', 'دفعة أولى']]
            ),
            'opening_date' => '2026-01-01',
            'notes' => 'افتتاح ٢٠٢٦',
        ])->assertCreated()->json('data');

        $this->assertSame('draft', $document['status']);
        $this->assertSame('2026-01-01', $document['opening_date']);
        $this->assertSame('2220.00', $document['total_value']);
        $this->assertSame(120, $document['total_quantity']);
        $this->assertSame('openings.csv', $document['source_filename']);
        $this->assertSame('دفعة أولى', $document['lines'][0]['notes']);
        $this->assertSame(1, $document['lines'][0]['position']);

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(0, StockMovement::count(), 'المسودة لا تحرّك مخزوناً.');
        $this->assertSame(0, JournalEntry::count(), 'المسودة لا تولّد قيداً.');
        $this->assertSame(0, Product::where('sku', 'SKU-1001')->value('quantity_on_hand'));
    }

    /** @test */
    public function apply_is_refused_while_any_blocking_error_remains(): void
    {
        $scene = $this->scene();

        $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(
                ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [
                    ['SKU-1001', 'WH-1', '10', '5.00'],
                    ['SKU-NOPE', 'WH-1', '10', '5.00'],
                ]
            ),
            'opening_date' => '2026-01-01',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'لا يمكن إنشاء المستند قبل معالجة الأخطاء الظاهرة في المعاينة.');

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(0, InventoryOpening::count(), 'ولا حتى السطر السليم يُكتب.');
    }

    /** @test */
    public function the_full_cycle_runs_from_file_to_posted_document(): void
    {
        $scene = $this->scene();

        $document = $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(
                ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '120', '18.50']]
            ),
            'opening_date' => '2026-01-01',
        ])->assertCreated()->json('data');

        $posted = $this->withToken($scene['token'])
            ->postJson("/api/inventory-openings/{$document['id']}/post")
            ->assertOk()->json('data');

        $this->assertSame('posted', $posted['status']);
        $this->assertNotNull($posted['journal_entry_id']);

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(120, Product::where('sku', 'SKU-1001')->value('quantity_on_hand'));
        $this->assertSame(1850, Product::where('sku', 'SKU-1001')->value('avg_cost'));
        $this->assertSame(1, StockMovement::count());
        $this->assertSame(1, JournalEntry::count());

        // الترحيل الثاني مرفوض عبر الـAPI أيضاً.
        $this->withToken($scene['token'])
            ->postJson("/api/inventory-openings/{$document['id']}/post")
            ->assertStatus(422);
        $this->assertSame(1, JournalEntry::count());

        // والمرحَّل لا يُحذف.
        $this->withToken($scene['token'])
            ->deleteJson("/api/inventory-openings/{$document['id']}")
            ->assertStatus(422);
        $this->assertSame(1, InventoryOpening::count());
    }

    // ═══════════ موافقة «تكلفة صفر» تُحفظ وتُعرض وتحكم الترحيل ═══════════

    /**
     * @test
     *
     * الموافقة **قرارٌ محفوظ على المستند** لا حالةُ طلب: تظهر في الإنشاء وفي
     * العرض وفي القائمة، فيراجعها المدقّق بعد شهر كما يراجعها اليوم.
     */
    public function the_stored_zero_cost_consent_is_visible_in_the_api_for_review(): void
    {
        $scene = $this->scene();
        $file = fn (): UploadedFile => $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-1', '10', '0']]
        );

        // بلا موافقة: المعاينة نفسها ترفض الصف، فلا مستند أصلاً.
        $this->assertSame(['zero_unit_cost'], $this->codes($this->preview($scene['token'], $file()), 2));

        $created = $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $file(), 'opening_date' => '2026-01-01', 'allow_zero_cost' => '1',
        ])->assertCreated()->json('data');

        $this->assertTrue($created['allow_zero_cost'], 'الإنشاء يعلن الموافقة.');

        $this->withToken($scene['token'])->getJson("/api/inventory-openings/{$created['id']}")
            ->assertOk()->assertJsonPath('data.allow_zero_cost', true);

        $this->withToken($scene['token'])->getJson('/api/inventory-openings')
            ->assertOk()->assertJsonPath('data.0.allow_zero_cost', true);

        // وتبقى مقروءة بعد الترحيل.
        $this->withToken($scene['token'])->postJson("/api/inventory-openings/{$created['id']}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.allow_zero_cost', true);
    }

    /** @test */
    public function a_document_created_without_consent_reports_it_as_false(): void
    {
        $scene = $this->scene();

        $created = $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertCreated()->json('data');

        $this->assertFalse($created['allow_zero_cost']);

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertFalse(InventoryOpening::findOrFail($created['id'])->allow_zero_cost);
    }

    /**
     * @test
     *
     * حتى لو صار للمسودة سطرٌ بتكلفة صفر بعد إنشائها بلا موافقة، الترحيل يرفض:
     * القرار يُقرأ من المستند لا من الطلب.
     */
    public function posting_is_refused_for_a_zero_cost_line_on_a_document_without_consent(): void
    {
        $scene = $this->scene();

        $created = $this->withToken($scene['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertCreated()->json('data');

        app(TenantContext::class)->set($scene['tenant_id']);
        InventoryOpeningLine::where('inventory_opening_id', $created['id'])
            ->update(['unit_cost' => 0, 'total_cost' => 0]);

        $this->withToken($scene['token'])->postJson("/api/inventory-openings/{$created['id']}/post")
            ->assertStatus(422)
            ->assertJsonPath('message', fn (string $message): bool => str_contains($message, 'لا يحمل موافقة'));

        app(TenantContext::class)->set($scene['tenant_id']);
        $this->assertSame(0, StockMovement::count());
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame('draft', InventoryOpening::findOrFail($created['id'])->status);
    }

    // ═══════════════════════ العزل بين المستأجرين ═══════════════════════

    /** @test */
    public function a_sku_from_another_tenant_never_resolves(): void
    {
        $first = $this->scene('acme', 'owner@acme.test');
        $second = $this->registerTenant('other', 'owner@other.test');
        app(TenantContext::class)->set($second['tenant_id']);
        Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-1', 'is_default' => true]);

        // نفس الرمز والباركود تماماً، مؤسسةٌ أخرى.
        $preview = $this->preview($second['token'], $this->csv(
            ['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
            [['SKU-1001', 'WH-1', '10', '5.00']]
        ));

        $this->assertSame(['product_not_found'], $this->codes($preview, 2),
            'رمزُ مؤسسةٍ أخرى لا يُطابَق ولا يُكشف وجوده.');
        $this->assertSame($first['product']->id, $first['product']->id);
    }

    /** @test */
    public function a_nebrax_id_and_a_warehouse_id_from_another_tenant_never_resolve(): void
    {
        $first = $this->scene('acme', 'owner@acme.test');
        $foreignProduct = $first['product']->id;
        $foreignWarehouse = $first['warehouse']->id;

        $second = $this->registerTenant('other', 'owner@other.test');
        app(TenantContext::class)->set($second['tenant_id']);
        Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-9', 'is_default' => true]);

        $preview = $this->preview($second['token'], $this->csv(
            ['nebrax_id', 'warehouse_id', 'opening_quantity', 'opening_unit_cost'],
            [[$foreignProduct, $foreignWarehouse, '10', '5.00']]
        ));

        $codes = $this->codes($preview, 2);
        $this->assertContains('product_not_found', $codes);
        $this->assertContains('warehouse_not_found', $codes);
    }

    /** @test */
    public function another_tenants_document_is_not_reachable(): void
    {
        $first = $this->scene('acme', 'owner@acme.test');
        $document = $this->withToken($first['token'])->post('/api/inventory-openings/import/apply', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertCreated()->json('data');

        $second = $this->registerTenant('other', 'owner@other.test');

        $this->withToken($second['token'])->getJson("/api/inventory-openings/{$document['id']}")->assertNotFound();
        $this->withToken($second['token'])->postJson("/api/inventory-openings/{$document['id']}/post")->assertNotFound();
        $this->withToken($second['token'])->getJson('/api/inventory-openings')->assertOk()->assertJsonCount(0, 'data');
    }

    // ═══════════════════════ الصلاحيات ═══════════════════════

    /** @test */
    public function the_routes_require_the_products_manage_permission(): void
    {
        $scene = $this->scene();
        $staff = $this->tokenForRole($scene['tenant_id'], 'staff', 'staff@acme.test');

        // القراءة مسموحة لـ`products.view`…
        $this->withToken($staff)->getJson('/api/inventory-openings')->assertOk();

        // …والكتابة والترحيل لا.
        $this->withToken($staff)->post('/api/inventory-openings/import/preview', [
            'file' => $this->csv(['sku', 'warehouse', 'opening_quantity', 'opening_unit_cost'],
                [['SKU-1001', 'WH-1', '10', '5.00']]),
            'opening_date' => '2026-01-01',
        ])->assertForbidden();

        $this->withToken($staff)->get('/api/inventory-openings/import/template')->assertForbidden();
    }

    /** @test */
    public function the_routes_reject_an_unauthenticated_caller(): void
    {
        $this->getJson('/api/inventory-openings')->assertUnauthorized();
        $this->postJson('/api/inventory-openings/import/preview')->assertUnauthorized();
    }

    // ═══════════════════════ الفصل عن استيراد المنتجات ═══════════════════════

    /**
     * @test
     *
     * حارسٌ معماري: كتالوج المنتجات لا يعرف الأرصدة الافتتاحية، والعكس.
     * تسرّبُ حقلٍ من أحدهما إلى الآخر يفتح باباً لاستيرادٍ يولّد قيداً من
     * حيث لا يتوقّع أحد.
     */
    public function the_product_catalog_import_contract_carries_no_opening_stock_fields(): void
    {
        $productKeys = ProductImportFields::keys();

        foreach (['opening_quantity', 'opening_unit_cost', 'opening_date', 'warehouse', 'warehouse_id'] as $forbidden) {
            $this->assertNotContains($forbidden, $productKeys,
                "«{$forbidden}» لا مكان له في عقد استيراد المنتجات.");
        }

        // ولا العكس: عقد الأرصدة لا يحمل حقول ضبط الكتالوج.
        $openingKeys = InventoryOpeningFields::keys();
        foreach (['sale_price', 'purchase_price', 'tax_rate', 'category', 'brand', 'track_inventory'] as $forbidden) {
            $this->assertNotContains($forbidden, $openingKeys);
        }
    }
}

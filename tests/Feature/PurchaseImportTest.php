<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Services\Accounting\PurchaseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Services\PurchaseImportService;
use App\Support\ImportPlanDriftException;
use App\Support\ImportUnitFailureException;
use App\Support\PurchaseImportFields;
use App\Support\SpreadsheetWriter;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H5-S3b — استيراد فواتير المشتريات مسوداتٍ (خدمة فقط): العقد، التجميع بـ(مورّد ‖ رقم فاتورته)، الاشتقاق ومطابقة إجمالي الملف، المراجع بمعرّفات موثوقة، منع التكرار،
 * نافذة الوحدات، وعدم أي أثر محاسبي أو مخزني. لا مجال مهمة ولا مسارات بعد (S4).
 *
 * تشغيل: php artisan test --filter=PurchaseImportTest
 */
class PurchaseImportTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private string $tenantId;

    private Partner $supplier;

    private Product $cement;

    private Product $sand;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->supplier = Partner::create(['name' => 'مورّد الإسمنت', 'type' => 'supplier', 'code' => 'S-001']);
        $this->cement = $this->product('إسمنت', 'CEM-50', '6281000000011');
        $this->sand = $this->product('رمل', 'SAND-1', '6281000000028');
    }

    private function product(string $name, string $sku, ?string $barcode = null, array $over = []): Product
    {
        return Product::create($over + ['name' => $name, 'sku' => $sku, 'barcode' => $barcode, 'type' => 'good', 'sale_price' => 5000, 'purchase_price' => 2500, 'track_inventory' => true]);
    }

    private function service(): PurchaseImportService
    {
        return app(PurchaseImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('purchases.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function row(array $over = []): array
    {
        return $over + ['supplier_code' => 'S-001', 'supplier_invoice_ref' => 'INV-1', 'purchase_date' => '2026-10-01', 'sku' => 'CEM-50', 'quantity' => '10', 'unit_price' => '25.00', 'tax_rate' => '15'];
    }

    /** @param list<array<string,string>> $rows */
    private function apply(array $rows, array $options = []): array
    {
        return $this->service()->apply($this->file($rows), $options);
    }

    /** @param list<array<string,string>> $rows */
    private function preview(array $rows, array $options = []): array
    {
        return $this->service()->preview($this->file($rows), $options);
    }

    private function messages(array $preview, int $index = 0): string
    {
        return implode(' | ', $preview['units'][$index]['messages']);
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_has_no_derived_posting_or_system_fields(): void
    {
        foreach (['subtotal', 'tax_amount', 'total', 'discount', 'shipping', 'adjustment', 'paid_on_post', 'status', 'journal_entry_id', 'number', 'tenant_id', 'branch_id', 'created_by', 'partner_id', 'warehouse_id'] as $forbidden) {
            $this->assertNotContains($forbidden, PurchaseImportFields::keys(), $forbidden);
        }
        $this->assertTrue(PurchaseImportFields::get('supplier_invoice_ref')['required']);
        // إجمالي الملف للمطابقة فقط: ليس حقل إلزامياً ولا يُكتب (يحرسه اختبار المطابقة أدناه)
        $this->assertFalse(PurchaseImportFields::get('invoice_total')['required']);
    }

    /** @test */
    public function the_template_headers_map_back_onto_every_field(): void
    {
        $mapping = PurchaseImportFields::autoMap(PurchaseImportFields::templateHeaders());
        $this->assertEqualsCanonicalizing(PurchaseImportFields::keys(), array_values(array_filter($mapping)));

        $csv = UploadedFile::fake()->createWithContent('t.csv', $this->service()->template());
        $preview = $this->service()->preview($csv, []);
        // القالب الجاهز مثالٌ صالح البنية: المورّدان S-001/S-002 ← الثاني غير موجود هنا فيظهر خطؤه بالاسم لا استثناءً
        $this->assertSame(2, $preview['total_units']);
        $this->assertStringContainsString('S-002', implode(' ', $preview['units'][1]['messages']));
    }

    /** @test */
    public function the_template_rows_are_valid_as_shipped_when_their_suppliers_and_products_exist_in_either_tax_mode(): void
    {
        Partner::create(['name' => 'مورّد ثانٍ', 'type' => 'supplier', 'code' => 'S-002']);
        // الصف الثالث في القالب يعرّف المنتج بالباركود 6281000000011 (= إسمنت في setUp)

        foreach ([false, true] as $inclusive) {
            $csv = UploadedFile::fake()->createWithContent('t.csv', $this->service()->template());
            $preview = $this->service()->preview($csv, ['tax_inclusive' => $inclusive]);
            $this->assertSame(0, $preview['error_units'], json_encode($preview['errors'], JSON_UNESCAPED_UNICODE)." inclusive={$inclusive}");
            $this->assertSame(2, $preview['create_units']);
        }
    }

    // ═══════════════════════════════ التجميع والاشتقاق ═══════════════════════════════

    /** @test */
    public function rows_of_one_supplier_invoice_become_one_draft_with_all_lines_and_derived_totals(): void
    {
        $result = $this->apply([
            $this->row(['quantity' => '10', 'unit_price' => '25.00']),
            $this->row(['sku' => 'SAND-1', 'quantity' => '4', 'unit_price' => '28.00', 'description' => 'رمل ناعم', 'purchase_date' => '', 'tax_rate' => '']),
            $this->row(['supplier_invoice_ref' => 'INV-2', 'barcode' => '6281000000028', 'sku' => '', 'quantity' => '2', 'unit_price' => '100.00']),
        ], ['default_tax_rate' => 15, 'tax_inclusive' => false]);

        $this->assertSame(2, $result['created']);
        $this->assertSame(3, $result['total_rows']);
        $this->assertSame(2, $result['total_units']);
        $this->assertSame(2, Purchase::query()->count());

        $one = Purchase::query()->where('supplier_invoice_no', 'INV-1')->firstOrFail();
        $this->assertSame('draft', $one->status);
        $this->assertCount(2, $one->lines);
        // 10×25.00 = 250.00 + 15% = 37.50 ؛ 4×28.00 = 112.00 + 15% = 16.80 ⇒ 416.30
        $this->assertSame(41630, (int) $one->total);
        $this->assertSame($this->supplier->id, $one->partner_id);
        $this->assertSame('رمل ناعم', $one->lines->firstWhere('product_id', $this->sand->id)->description);
        $this->assertSame('رمل', Purchase::query()->where('supplier_invoice_no', 'INV-2')->firstOrFail()->lines->first()->description);
    }

    /** @test */
    public function the_imported_total_equals_the_total_a_manual_creation_of_the_same_items_produces(): void
    {
        foreach ([false, true] as $inclusive) {
            $ref = 'PAR-'.(int) $inclusive;
            $this->apply([
                $this->row(['supplier_invoice_ref' => $ref, 'quantity' => '3', 'unit_price' => '33.33', 'tax_rate' => '15']),
                $this->row(['supplier_invoice_ref' => $ref, 'sku' => 'SAND-1', 'quantity' => '7', 'unit_price' => '0.99', 'tax_rate' => '5']),
            ], ['tax_inclusive' => $inclusive]);

            $manual = app(PurchaseService::class)->create(
                ['partner_id' => $this->supplier->id, 'number' => 'BILL-M-'.(int) $inclusive, 'tax_inclusive' => $inclusive],
                [
                    ['product_id' => $this->cement->id, 'quantity' => 3, 'unit_price' => 3333, 'tax_rate' => 15],
                    ['product_id' => $this->sand->id, 'quantity' => 7, 'unit_price' => 99, 'tax_rate' => 5],
                ],
            );
            $imported = Purchase::query()->where('supplier_invoice_no', $ref)->firstOrFail();
            $this->assertSame([(int) $manual->subtotal, (int) $manual->tax_amount, (int) $manual->total], [(int) $imported->subtotal, (int) $imported->tax_amount, (int) $imported->total], "inclusive={$inclusive}");
        }
    }

    /** @test */
    public function a_matching_file_total_passes_and_a_different_one_is_a_row_error_that_writes_nothing(): void
    {
        // 10×25.00 + 15% = 287.50
        $ok = $this->preview([$this->row(['invoice_total' => '287.50'])]);
        $this->assertSame(1, $ok['create_units']);
        $this->assertSame(28750, $ok['units'][0]['total_minor']);

        $bad = $this->preview([$this->row(['invoice_total' => '300.00'])]);
        $this->assertSame(1, $bad['error_units']);
        $this->assertStringContainsString('يخالف المشتق', $this->messages($bad));

        $e = $this->thrown(fn () => $this->apply([$this->row(['invoice_total' => '300.00'])]), '', ImportUnitFailureException::class);
        $this->assertSame(0, Purchase::query()->count());
        $this->assertSame(0, ImportDocumentReservation::query()->count());
        $this->assertSame('unit_invalid', $e->failures[0]['code']);
    }

    /** @test */
    public function a_missing_or_symbol_only_reference_is_an_error_and_is_never_grouped_under_a_null_key(): void
    {
        $preview = $this->preview([
            $this->row(['supplier_invoice_ref' => '']),
            $this->row(['supplier_invoice_ref' => '']),
            $this->row(['supplier_invoice_ref' => '---']),
            $this->row(['supplier_invoice_ref' => 'OK-1']),
        ]);

        $this->assertSame(4, $preview['total_units'], 'كل صف بلا رقم وحدة مستقلة معطوبة لا تُدمج');
        $this->assertSame(3, $preview['error_units']);
        $this->assertSame(1, $preview['create_units']);
        $this->assertStringContainsString('رقم فاتورة المورّد', $this->messages($preview));
    }

    /** @test */
    public function rows_of_one_invoice_must_agree_on_header_fields_and_a_blank_inherits(): void
    {
        $preview = $this->preview([
            $this->row(['due_date' => '2026-10-31', 'notes' => 'ملاحظة', 'payment_type' => 'credit']),
            $this->row(['sku' => 'SAND-1', 'purchase_date' => '', 'due_date' => '', 'notes' => '', 'payment_type' => '']),   // يرث
            $this->row(['sku' => 'CEM-50', 'purchase_date' => '2026-10-05']),   // يخالف
        ]);
        $this->assertSame(1, $preview['error_units']);
        $this->assertStringContainsString('يخالف قيمة الفاتورة', $this->messages($preview));

        $ok = $this->apply([
            $this->row(['due_date' => '2026-10-31', 'notes' => 'ملاحظة', 'payment_type' => 'نقد']),
            $this->row(['sku' => 'SAND-1', 'purchase_date' => '', 'due_date' => '', 'notes' => '', 'payment_type' => '']),
        ]);
        $this->assertSame(1, $ok['created']);
        $p = Purchase::query()->firstOrFail();
        $this->assertSame('cash', $p->payment_type);
        $this->assertSame('ملاحظة', $p->notes);
        $this->assertSame('2026-10-31', $p->due_date->toDateString());
        $this->assertCount(2, $p->lines);
    }

    /** @test */
    public function a_due_date_before_the_invoice_date_and_a_missing_date_are_errors(): void
    {
        $this->assertStringContainsString('الاستحقاق قبل', $this->messages($this->preview([$this->row(['due_date' => '2026-09-01'])])));
        $this->assertStringContainsString('تاريخ الفاتورة', $this->messages($this->preview([$this->row(['purchase_date' => ''])])));
    }

    /** @test */
    public function non_contiguous_rows_of_one_invoice_are_grouped_with_a_visible_warning(): void
    {
        $preview = $this->preview([
            $this->row(['sku' => 'CEM-50']),
            $this->row(['supplier_invoice_ref' => 'INV-2']),
            $this->row(['sku' => 'SAND-1']),
        ]);
        $this->assertSame(2, $preview['total_units']);
        $this->assertSame(2, $preview['create_units']);
        $this->assertSame(1, $preview['warning_units']);
        $this->assertSame([2, 4], $preview['units'][0]['rows']);
        $this->assertStringContainsString('غير متجاورة', implode(' ', $preview['units'][0]['warnings']));
    }

    /** @test */
    public function the_same_reference_for_different_suppliers_is_two_invoices(): void
    {
        Partner::create(['name' => 'مورّد آخر', 'type' => 'supplier', 'code' => 'S-002']);
        $r = $this->apply([$this->row(), $this->row(['supplier_code' => 'S-002'])]);
        $this->assertSame(2, $r['created']);
        $this->assertSame(2, ImportDocumentReservation::query()->count());
    }

    // ═══════════════════════════════ المراجع ═══════════════════════════════

    /** @test */
    public function suppliers_resolve_by_code_only_and_must_be_active_suppliers(): void
    {
        Partner::create(['name' => 'عميل', 'type' => 'customer', 'code' => 'C-1']);
        Partner::create(['name' => 'معطّل', 'type' => 'supplier', 'code' => 'S-OFF', 'is_active' => false]);

        $this->assertStringContainsString('غير موجود', $this->messages($this->preview([$this->row(['supplier_code' => 'مورّد الإسمنت'])])));   // الاسم ليس معرّفاً
        $this->assertStringContainsString('ليس مورّداً', $this->messages($this->preview([$this->row(['supplier_code' => 'C-1'])])));
        $this->assertStringContainsString('معطّل', $this->messages($this->preview([$this->row(['supplier_code' => 'S-OFF'])])));
    }

    /** @test */
    public function a_default_supplier_serves_a_file_without_a_supplier_column_and_a_bad_default_is_refused(): void
    {
        $rows = [$this->row(['supplier_code' => ''])];
        $this->assertSame(1, $this->preview(array_map(fn ($r) => array_diff_key($r, ['supplier_code' => 1]), $rows), ['default_supplier_id' => $this->supplier->id])['create_units']);

        $this->thrown(fn () => $this->preview($rows, ['default_supplier_id' => (string) \Illuminate\Support\Str::uuid()]), 'المورّد الافتراضي', RuntimeException::class);
        $this->thrown(fn () => $this->preview(array_map(fn ($r) => array_diff_key($r, ['supplier_code' => 1]), $rows)), 'كود المورّد', RuntimeException::class);
    }

    /** @test */
    public function products_resolve_by_id_sku_or_barcode_and_identifiers_must_agree(): void
    {
        $byId = $this->preview([$this->row(['sku' => '', 'product_id' => $this->cement->id])]);
        $this->assertSame(1, $byId['create_units']);
        $this->assertSame(1, $this->preview([$this->row(['sku' => '', 'barcode' => '6281000000011'])])['create_units']);
        $this->assertSame(1, $this->preview([$this->row(['sku' => 'CEM-50', 'barcode' => '6281000000011'])])['create_units']);

        $this->assertStringContainsString('متعارضة', $this->messages($this->preview([$this->row(['sku' => 'CEM-50', 'barcode' => '6281000000028'])])));
        $this->assertStringContainsString('الرمز «NOPE»', $this->messages($this->preview([$this->row(['sku' => 'NOPE'])])));
        // الاسم ليس معرّفاً: عمود اسم غير معروف يُهمل فيغيب التعريف
        $this->thrown(fn () => $this->preview([array_diff_key($this->row(), ['sku' => 1]) + ['اسم المنتج' => 'إسمنت']]), 'تعريف المنتج', RuntimeException::class);
    }

    /** @test */
    public function inactive_and_variant_managed_products_are_row_errors(): void
    {
        $this->product('معطّل', 'OFF-1', null, ['is_active' => false]);
        $this->product('متعدد', 'VAR-1')->forceFill(['variant_state' => 'variant_managed'])->save();

        $this->assertStringContainsString('معطّل', $this->messages($this->preview([$this->row(['sku' => 'OFF-1'])])));
        $this->assertStringContainsString('متعدد الخيارات', $this->messages($this->preview([$this->row(['sku' => 'VAR-1'])])));
    }

    /** @test */
    public function quantity_and_price_are_validated_per_row(): void
    {
        $this->assertStringContainsString('عدداً صحيحاً', $this->messages($this->preview([$this->row(['quantity' => '2.5'])])));
        $this->assertStringContainsString('خارج النطاق', $this->messages($this->preview([$this->row(['quantity' => '0'])])));
        $this->assertStringContainsString('بمنزلتين', $this->messages($this->preview([$this->row(['unit_price' => '25,50'])])));
        $this->assertStringContainsString('«الكمية» مطلوب', $this->messages($this->preview([$this->row(['quantity' => ''])])));
        $this->assertStringContainsString('«سعر الوحدة» مطلوب', $this->messages($this->preview([$this->row(['unit_price' => ''])])));
        // سعر صفر مسموح كما في POST /purchases (min:0)
        $this->assertSame(1, $this->preview([$this->row(['unit_price' => '0'])])['create_units']);
    }

    /** @test */
    public function the_warehouse_option_is_validated_and_stored(): void
    {
        $this->thrown(fn () => $this->preview([$this->row()], ['warehouse_id' => (string) \Illuminate\Support\Str::uuid()]), 'المستودع', RuntimeException::class);

        $warehouse = Warehouse::query()->where('is_active', true)->firstOrFail();
        $this->apply([$this->row()], ['warehouse_id' => $warehouse->id]);
        $this->assertSame($warehouse->id, Purchase::query()->firstOrFail()->warehouse_id);
    }

    /** @test */
    public function bad_options_are_refused_with_a_message(): void
    {
        $this->thrown(fn () => $this->preview([$this->row()], ['default_tax_rate' => 150]), 'نسبة الضريبة', RuntimeException::class);
        $this->thrown(fn () => $this->preview([$this->row()], ['default_payment_type' => 'bank']), 'نوع الدفع', RuntimeException::class);
        $this->thrown(fn () => $this->preview([$this->row()], ['tax_inclusive' => 'maybe']), 'شاملة الضريبة', RuntimeException::class);
        $this->thrown(fn () => $this->preview([$this->row()], ['mapping' => [0 => 'total']]), 'حقل غير معروف', RuntimeException::class);
    }

    // ═══════════════════════════════ التكرار ═══════════════════════════════

    /** @test */
    public function an_existing_or_reserved_supplier_invoice_is_refused_until_its_draft_is_deleted(): void
    {
        $this->apply([$this->row()]);

        $preview = $this->preview([$this->row(['supplier_invoice_ref' => 'inv 1'])]);   // التطبيع: حالة/فراغ/رموز
        $this->assertSame(1, $preview['error_units']);
        $this->assertTrue($preview['units'][0]['existing_purchase']);
        $this->assertStringContainsString('بالرقم نفسه', $this->messages($preview));

        $id = Purchase::query()->firstOrFail()->id;
        app(PurchaseService::class)->deleteDraft(Purchase::query()->findOrFail($id));
        $this->assertSame(0, ImportDocumentReservation::query()->count());
        $this->assertSame(1, $this->apply([$this->row()])['created']);
    }

    /** @test */
    public function a_manually_created_purchase_blocks_the_import_too(): void
    {
        app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'number' => 'BILL-MAN-1', 'supplier_invoice_no' => 'MAN-9'],
            [['product_id' => $this->cement->id, 'quantity' => 1, 'unit_price' => 100, 'tax_rate' => 0]],
        );
        $this->assertSame(1, $this->preview([$this->row(['supplier_invoice_ref' => 'man9'])])['error_units']);
        $this->assertSame(1, Purchase::query()->count());
    }

    // ═══════════════════════════════ النافذة والخطة ═══════════════════════════════

    /** @test */
    public function windows_count_invoices_not_rows_and_never_split_an_invoice(): void
    {
        $rows = [
            $this->row(['supplier_invoice_ref' => 'W-1']),
            $this->row(['supplier_invoice_ref' => 'W-1', 'sku' => 'SAND-1']),
            $this->row(['supplier_invoice_ref' => 'W-2']),
            $this->row(['supplier_invoice_ref' => 'W-1', 'sku' => 'SAND-1', 'quantity' => '3']),   // W-1 تمتد عبر حدّ النافذة الصفّي
        ];

        $first = $this->apply($rows, ['batch_offset' => 0, 'batch_size' => 1]);
        $this->assertSame(1, $first['created']);
        $this->assertSame(2, $first['total_units']);
        $this->assertSame(4, $first['total_rows']);
        $w1 = Purchase::query()->where('supplier_invoice_no', 'W-1')->firstOrFail();
        $this->assertCount(3, $w1->lines, 'الفاتورة كلها (3 صفوف) في نافذتها الواحدة');

        $second = $this->apply($rows, ['batch_offset' => 1, 'batch_size' => 1]);
        $this->assertSame(1, $second['created']);
        $this->assertSame(2, Purchase::query()->count());
        $this->assertCount(1, Purchase::query()->where('supplier_invoice_no', 'W-2')->firstOrFail()->lines);
    }

    /** @test */
    public function a_plan_from_the_preview_detects_drift_before_any_write(): void
    {
        $rows = [$this->row(['supplier_invoice_ref' => 'D-1']), $this->row(['supplier_invoice_ref' => 'D-2'])];
        $planned = $this->service()->previewWithPlan($this->file($rows), []);
        $this->assertSame([2 => 'c', 3 => 'c'], $planned['plan']);

        // بعد المعاينة أُنشئت D-2 من مسار آخر
        app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'number' => 'BILL-D', 'supplier_invoice_no' => 'D-2'],
            [['product_id' => $this->cement->id, 'quantity' => 1, 'unit_price' => 100, 'tax_rate' => 0]],
        );
        $e = $this->thrown(fn () => $this->service()->apply($this->file($rows), ['expected_plan' => $planned['plan']]), '', ImportPlanDriftException::class);
        $this->assertSame(3, $e->rowNumber);
        $this->assertSame(1, Purchase::query()->count(), 'لا كتابة قبل الانجراف');
    }

    /** @test */
    public function a_blank_supplier_cell_inherits_the_single_explicit_supplier_of_the_same_invoice(): void
    {
        $other = Partner::create(['name' => 'مورّد ثانٍ', 'type' => 'supplier', 'code' => 'S-002']);
        $rows = [
            $this->row(['supplier_code' => 'S-002', 'supplier_invoice_ref' => 'CONT-1']),
            $this->row(['supplier_code' => '', 'supplier_invoice_ref' => 'CONT-1', 'sku' => 'SAND-1', 'purchase_date' => '2026-10-01']),
        ];

        // بلا مورّد افتراضي: يرث بدل خطأ «المورّد مطلوب»
        $plain = $this->preview($rows);
        $this->assertSame(1, $plain['total_units']);
        $this->assertSame(1, $plain['create_units']);

        // ومع مورّد افتراضي مختلف: سطر المتابعة لا يشطر الفاتورة إلى مورّد الافتراضي
        $this->apply($rows, ['default_supplier_id' => $this->supplier->id]);
        $p = Purchase::query()->where('supplier_invoice_no', 'CONT-1')->firstOrFail();
        $this->assertSame($other->id, $p->partner_id);
        $this->assertCount(2, $p->lines);
        $this->assertSame(1, Purchase::query()->count());
    }

    /** @test */
    public function an_ambiguous_blank_supplier_is_never_guessed(): void
    {
        Partner::create(['name' => 'مورّد ثانٍ', 'type' => 'supplier', 'code' => 'S-002']);
        $rows = [
            $this->row(['supplier_code' => 'S-001', 'supplier_invoice_ref' => 'AMB-1']),
            $this->row(['supplier_code' => 'S-002', 'supplier_invoice_ref' => 'AMB-1']),
            $this->row(['supplier_code' => '', 'supplier_invoice_ref' => 'AMB-1', 'sku' => 'SAND-1']),
        ];

        // الرقم نفسه عند مورّدين صريحين ⇒ لا وراثة: بلا افتراضي خطأ «مطلوب»
        $plain = $this->preview($rows);
        $this->assertSame(3, $plain['total_units']);
        $this->assertSame(1, $plain['error_units']);
        $this->assertStringContainsString('«كود المورّد» مطلوب', $this->messages($plain, 2));
    }

    /** @test */
    public function an_invoice_total_beyond_the_safe_limit_is_a_row_error_not_a_server_error(): void
    {
        // كل سطر ضمن حدّ السطر لكن مجموع الفاتورة يفوق 50 مليون ريال (كانت تفيض ضريبة الخدمة int64 فتُرمى TypeError لا رسالة)
        $rows = array_map(fn (int $i) => $this->row(['quantity' => '1000', 'unit_price' => '500000.00', 'tax_rate' => '15']), range(1, 3));
        $preview = $this->preview($rows);
        $this->assertSame(1, $preview['error_units']);
        $this->assertStringContainsString('الحد الآمن', $this->messages($preview));
        $this->thrown(fn () => $this->apply($rows), '', ImportUnitFailureException::class);
        $this->assertSame(0, Purchase::query()->count());
    }

    /** @test */
    public function a_bare_total_column_is_not_auto_mapped_to_the_invoice_total(): void
    {
        $mapping = PurchaseImportFields::autoMap(['Total', 'Invoice Total', 'الإجمالي']);
        $this->assertNull($mapping[0] ?? null);
        $this->assertSame('invoice_total', $mapping[1] ?? null);
        $this->assertNull($mapping[2] ?? null);
    }

    /** @test */
    public function the_tenant_preferences_drive_the_derived_total_exactly_as_the_service_does(): void
    {
        \App\Support\Settings::put('purchases', ['default_tax_rate' => 5, 'default_tax_inclusive' => true]);
        $row = $this->row(['supplier_invoice_ref' => 'PREF-1', 'tax_rate' => '', 'quantity' => '3', 'unit_price' => '33.33']);
        $this->apply([$row]);   // لا خيارات تشغيلة: التفضيلان من المؤسسة

        $manual = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'number' => 'BILL-PREF'],   // لا tax_inclusive ولا tax_rate: الخدمة تقرأ التفضيلين
            [['product_id' => $this->cement->id, 'quantity' => 3, 'unit_price' => 3333]],
        );
        $imported = Purchase::query()->where('supplier_invoice_no', 'PREF-1')->firstOrFail();
        $this->assertSame([(int) $manual->subtotal, (int) $manual->tax_amount, (int) $manual->total], [(int) $imported->subtotal, (int) $imported->tax_amount, (int) $imported->total]);
    }

    /** @test */
    public function supplier_sku_and_warehouse_never_resolve_across_tenants(): void
    {
        $other = $this->registerTenant('other-co', 'owner@other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirWarehouse = Warehouse::query()->where('is_active', true)->firstOrFail();
        Partner::create(['name' => 'مورّدهم', 'type' => 'supplier', 'code' => 'S-THEIRS']);
        $this->product('صنفهم', 'THEIRS-1');
        app(TenantContext::class)->set($this->tenantId);

        $preview = $this->preview([$this->row(['supplier_code' => 'S-THEIRS', 'sku' => 'THEIRS-1'])]);
        $this->assertStringContainsString('غير موجود', $this->messages($preview));
        $this->assertStringContainsString('THEIRS-1', $this->messages($preview));
        $this->thrown(fn () => $this->preview([$this->row()], ['warehouse_id' => $theirWarehouse->id]), 'المستودع', RuntimeException::class);
    }

    /** @test */
    public function an_inactive_warehouse_a_wide_row_and_an_oversized_line_are_refused(): void
    {
        $warehouse = Warehouse::query()->where('is_active', true)->firstOrFail();
        $warehouse->forceFill(['is_active' => false])->save();
        $this->thrown(fn () => $this->preview([$this->row()], ['warehouse_id' => $warehouse->id]), 'المستودع', RuntimeException::class);

        $csv = "supplier_code,supplier_invoice_ref,purchase_date,sku,quantity,unit_price\nS-001,W-1,2026-10-01,CEM-50,1,10.00,EXTRA\n";
        $wide = $this->service()->preview(UploadedFile::fake()->createWithContent('w.csv', $csv), []);
        $this->assertStringContainsString('يتجاوز صف العناوين', $this->messages($wide));

        $big = $this->preview([$this->row(['quantity' => '1000000', 'unit_price' => '999999999.00'])]);
        $this->assertStringContainsString('النطاق المالي', $this->messages($big));
    }

    /** @test */
    public function a_file_total_mismatch_is_detected_on_a_multi_line_invoice_and_excel_serial_dates_parse(): void
    {
        // 10×25.00 + 4×28.00 = 362.00 + 15% = 416.30
        $rows = [
            $this->row(['invoice_total' => '416.30']),
            $this->row(['sku' => 'SAND-1', 'quantity' => '4', 'unit_price' => '28.00', 'purchase_date' => '', 'invoice_total' => '']),
        ];
        $this->assertSame(1, $this->preview($rows)['create_units']);
        $rows[1]['invoice_total'] = '999.00';
        $this->assertSame(1, $this->preview($rows)['error_units']);

        // 46296 = 2026-10-01 (أصل 1899-12-30)
        $this->assertSame('2026-10-01', $this->preview([$this->row(['purchase_date' => '46296'])])['units'][0]['date']);
    }

    // ═══════════════════════════════ الأثر ═══════════════════════════════

    /** @test */
    public function the_import_creates_drafts_and_reservations_only_no_journal_stock_or_payment(): void
    {
        $journals = JournalEntry::query()->count();
        $moves = StockMovement::query()->count();

        $this->apply([$this->row(), $this->row(['supplier_invoice_ref' => 'INV-2'])]);

        $this->assertSame($journals, JournalEntry::query()->count());
        $this->assertSame($moves, StockMovement::query()->count());
        $this->assertSame(2, ImportDocumentReservation::query()->count());
        $this->assertSame([Dup::SOURCE_STANDARD], ImportDocumentReservation::query()->pluck('source')->unique()->values()->all());
        $this->assertSame(['draft'], Purchase::query()->pluck('status')->unique()->values()->all());
    }

    /** @test */
    public function a_failed_apply_leaves_nothing_behind(): void
    {
        $this->thrown(fn () => $this->apply([$this->row(), $this->row(['supplier_invoice_ref' => 'BAD', 'sku' => 'NOPE'])]), '', ImportUnitFailureException::class);

        $this->assertSame(0, Purchase::query()->count());
        $this->assertSame(0, ImportDocumentReservation::query()->count());
    }

    /** @test */
    public function posting_an_imported_draft_yields_the_same_entry_shape_as_a_manual_one(): void
    {
        $this->apply([$this->row(['supplier_invoice_ref' => 'POST-1'])], ['default_payment_type' => 'credit']);
        $manual = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'number' => 'BILL-PM', 'supplier_invoice_no' => 'POST-2', 'payment_type' => 'credit', 'purchase_date' => '2026-10-01'],
            [['product_id' => $this->cement->id, 'quantity' => 10, 'unit_price' => 2500, 'tax_rate' => 15]],
        );
        $imported = Purchase::query()->where('supplier_invoice_no', 'POST-1')->firstOrFail();

        $service = app(PurchaseService::class);
        $service->post($imported);
        $service->post($manual);

        $shape = fn (Purchase $p) => $p->fresh()->journalEntry->lines->map(fn ($l) => [$l->account->code, (int) $l->debit, (int) $l->credit])->sortBy(0)->values()->all();
        $this->assertSame($shape($manual), $shape($imported));
    }
}

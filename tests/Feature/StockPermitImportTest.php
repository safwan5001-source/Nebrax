<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\UnitTemplate;
use App\Models\UnitTemplateUnit;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StockPermitService;
use App\Services\StockPermitImportAdapter;
use App\Services\StockPermitImportService;
use App\Support\ImportChunk;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use App\Support\StockPermitImportFields;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H7-S3 — استيراد بنود إذنٍ مخزني مسودة: العقد، التعريف بالمنتج، القيم، رأس الإذن المجمَّد، سياسة التكلفة الصفرية، الذرّية، الوصول، وعدم أي أثر مخزني/محاسبي عند الاستيراد
 * مع أن الترحيل اللاحق عبر المسار القائم يولّد القيد الصحيح. نقاط الإنهاء والمهام الدائمة في StockPermitImportEndpointsTest.
 *
 * تشغيل: php artisan test --filter=StockPermitImportTest
 */
class StockPermitImportTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private string $tenantId;

    private Warehouse $main;

    private Warehouse $branchB;

    /** @var array<string, Product> */
    private array $p = [];

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        $this->branchB = Warehouse::create(['name' => 'مخزن الفرع', 'code' => 'WH-2']);
        foreach (['a' => ['SKU-A', '6280000000001', 100], 'b' => ['SKU-B', '6280000000002', 50]] as $key => [$sku, $barcode, $qty]) {
            $this->p[$key] = Product::create(['name' => "صنف {$key}", 'sku' => $sku, 'barcode' => $barcode, 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($this->p[$key], $qty, 1000, ['warehouse_id' => $this->main->id]);
        }
    }

    private function service(): StockPermitImportService
    {
        return app(StockPermitImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('permit.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function opts(array $over = []): array
    {
        return $over + ['permit_type' => 'receipt', 'warehouse_id' => $this->main->id, 'permit_date' => '2026-03-10', 'reason' => 'اختبار'];
    }

    /** @return list<string> */
    private function messages(array $preview): array
    {
        return array_merge(...array_map(fn (array $row): array => $row['messages'], $preview['rows']));
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_has_no_header_totals_or_cost_for_issues_as_columns(): void
    {
        foreach (['warehouse', 'warehouse_id', 'target_warehouse_id', 'permit_type', 'type', 'permit_date', 'status', 'total_cost', 'line_cost', 'journal_entry_id', 'tenant_id', 'base_quantity'] as $forbidden) {
            $this->assertNotContains($forbidden, StockPermitImportFields::keys(), $forbidden);
        }
        $this->assertSame(['product_id', 'sku', 'barcode', 'quantity', 'unit', 'unit_cost'], StockPermitImportFields::keys());
        $this->assertSame('quantity', StockPermitImportFields::autoMap(['الكمية'])[0]);
        $this->assertSame('sku', StockPermitImportFields::autoMap(['رمز الصنف'])[0]);
        $this->assertSame('unit_cost', StockPermitImportFields::autoMap(['تكلفة الوحدة'])[0]);
    }

    /** @test */
    public function the_template_round_trips_through_inspect_with_every_column_recognised(): void
    {
        $insp = $this->service()->inspect(UploadedFile::fake()->createWithContent('t.csv', $this->service()->template()));

        $this->assertSame(2, $insp['total_rows']);
        $this->assertSame(['product_id', 'sku', 'barcode', 'quantity', 'unit', 'unit_cost'], array_column($insp['columns'], 'suggested_field'));
    }

    // ═══════════════════════════════ المعاينة بلا كتابة · الإنشاء ═══════════════════════════════

    /** @test */
    public function preview_writes_nothing(): void
    {
        $preview = $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => '12.50']]), $this->opts(), null);

        $this->assertSame(1, $preview['line_rows']);
        $this->assertSame(0, $preview['error_rows']);
        $this->assertSame(6250, $preview['total_cost']);   // 5 × 12.50 ريال = 6250 هللة
        $this->assertSame('المخزن الرئيسي', $preview['warehouse_name']);
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function a_receipt_file_creates_one_draft_permit_with_all_its_lines_and_no_stock_or_ledger_effect(): void
    {
        $movements = StockMovement::query()->count();
        $entries = JournalEntry::query()->count();

        $result = $this->service()->apply($this->file([
            ['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => '12.50'],
            ['barcode' => '6280000000002', 'quantity' => '3', 'unit_cost' => '8.00'],
        ]), $this->opts(['notes' => 'ملاحظة الاستيراد']), null);

        $permit = StockPermit::query()->with('lines')->findOrFail($result['permit_id']);
        $this->assertSame('receipt', $permit->type);
        $this->assertSame('draft', $permit->status);
        $this->assertSame('2026-03-10', $permit->permit_date->toDateString());
        $this->assertSame($this->main->id, $permit->warehouse_id);
        $this->assertSame('ملاحظة الاستيراد', $permit->notes);
        $this->assertSame(2, $permit->lines->count());
        $this->assertSame([1250, 800], $permit->lines->sortBy('quantity')->reverse()->pluck('unit_cost')->map(fn ($c) => (int) $c)->values()->all());
        $this->assertSame([6250, 2400], $permit->lines->sortBy('quantity')->reverse()->pluck('line_cost')->map(fn ($c) => (int) $c)->values()->all());
        // مسودة: لا حركة مخزون ولا قيد ولا تغيير رصيد
        $this->assertSame([$movements, $entries], [StockMovement::query()->count(), JournalEntry::query()->count()]);
        $this->assertSame(100, (int) $this->p['a']->fresh()->quantity_on_hand);
        $this->assertSame(1, $result['created']);
    }

    /** @test */
    public function posting_the_imported_draft_goes_through_the_existing_flow_and_books_the_expected_entry(): void
    {
        $result = $this->service()->apply($this->file([['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => '12.50']]), $this->opts(), null);

        $posted = app(StockPermitService::class)->post(StockPermit::query()->findOrFail($result['permit_id']));

        // إضافة: مدين 1140 (المخزون) ٦٢٫٥٠ ر.س / دائن 5180 (تسوية المخزون اليدوية) — بالتكلفة المُدخَلة
        $entry = JournalEntry::query()->with('lines.account')->findOrFail($posted->journal_entry_id);
        $lines = $entry->lines->mapWithKeys(fn ($l) => [$l->account->code => [(int) $l->debit, (int) $l->credit]]);
        $this->assertSame([6250, 0], $lines['1140']);
        $this->assertSame([0, 6250], $lines['5180']);
        $this->assertSame(105, (int) $this->p['a']->fresh()->quantity_on_hand);
        $this->assertSame(6250, (int) $posted->total_cost);
    }

    /** @test */
    public function issue_and_transfer_files_create_drafts_taking_cost_from_the_average_at_posting(): void
    {
        $issue = $this->service()->apply($this->file([['sku' => 'SKU-A', 'quantity' => '4']]), $this->opts(['permit_type' => 'issue']), null);
        $transfer = $this->service()->apply($this->file([['sku' => 'SKU-B', 'quantity' => '2']]), $this->opts(['permit_type' => 'transfer', 'target_warehouse_id' => $this->branchB->id]), null);

        $this->assertSame('issue', StockPermit::query()->findOrFail($issue['permit_id'])->type);
        $t = StockPermit::query()->findOrFail($transfer['permit_id']);
        $this->assertSame([$this->main->id, $this->branchB->id], [$t->warehouse_id, $t->target_warehouse_id]);
        $this->assertSame(0, (int) StockPermit::query()->findOrFail($issue['permit_id'])->lines->first()->unit_cost);
        $this->assertSame(0, StockMovement::query()->where('source_type', StockPermit::class)->count());
    }

    /** @test */
    public function a_commercial_unit_is_resolved_through_the_product_template_like_the_direct_api(): void
    {
        $template = UnitTemplate::create(['name' => 'قطعة وكرتون', 'base_unit' => 'قطعة']);
        UnitTemplateUnit::create(['unit_template_id' => $template->id, 'name' => 'كرتون', 'factor' => 12]);
        $this->p['a']->forceFill(['unit_template_id' => $template->id])->save();

        $result = $this->service()->apply($this->file([['sku' => 'SKU-A', 'quantity' => '2', 'unit' => 'كرتون', 'unit_cost' => '120.00']]), $this->opts(), null);

        $line = StockPermit::query()->findOrFail($result['permit_id'])->lines->first();
        $this->assertSame(['كرتون', 12, 24, 24000], [$line->unit_name, (int) $line->unit_factor, (int) $line->base_quantity, (int) $line->line_cost]);
    }

    // ═══════════════════════════════ رأس الإذن المجمَّد ═══════════════════════════════

    /** @test */
    public function the_permit_type_is_required_and_has_no_default(): void
    {
        $e = $this->thrown(fn () => $this->service()->options(['warehouse_id' => $this->main->id, 'permit_date' => '2026-03-10']), 'نوع الإذن', RuntimeException::class);
        $this->assertStringContainsString('نوع الإذن مطلوب', $e->getMessage());
    }

    /** @test */
    public function transfer_header_rules_match_the_direct_service(): void
    {
        $this->thrown(fn () => $this->service()->options($this->opts(['permit_type' => 'transfer'])), 'وجهة', RuntimeException::class);
        $this->thrown(fn () => $this->service()->options($this->opts(['permit_type' => 'transfer', 'target_warehouse_id' => $this->main->id])), 'نفسه', RuntimeException::class);
        $this->thrown(fn () => $this->service()->options($this->opts(['permit_type' => 'issue', 'target_warehouse_id' => $this->branchB->id])), 'التحويل وحده', RuntimeException::class);
        $this->thrown(fn () => $this->service()->options($this->opts(['permit_date' => '10/03/2026'])), 'تاريخ', RuntimeException::class);
    }

    /** @test */
    public function the_adapter_resolves_the_default_date_at_preview_so_it_freezes_with_the_fingerprint(): void
    {
        $canonical = app(StockPermitImportAdapter::class)->canonicalOptions(['permit_type' => 'issue', 'warehouse_id' => strtoupper($this->main->id)]);

        $this->assertSame(now()->toDateString(), $canonical['permit_date']);
        $this->assertSame($this->main->id, $canonical['warehouse_id']);
        $this->assertNull($canonical['target_warehouse_id']);
        $this->assertFalse($canonical['allow_zero_cost']);
    }

    // ═══════════════════════════════ سياسة التكلفة الصفرية ═══════════════════════════════

    /** @test */
    public function a_receipt_without_a_cost_column_is_refused_unless_zero_cost_is_allowed_explicitly(): void
    {
        $file = fn () => $this->file([['sku' => 'SKU-A', 'quantity' => '5']]);

        $this->thrown(fn () => $this->service()->preview($file(), $this->opts(), null), 'تكلفة', RuntimeException::class);

        $preview = $this->service()->preview($file(), $this->opts(['allow_zero_cost' => true]), null);
        $this->assertSame([1, 0, 0], [$preview['line_rows'], $preview['error_rows'], $preview['total_cost']]);
    }

    /** @test */
    public function a_blank_or_zero_cost_cell_is_a_row_error_by_default_and_accepted_when_allowed(): void
    {
        $rows = [['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => ''], ['sku' => 'SKU-B', 'quantity' => '5', 'unit_cost' => '0']];

        $refused = $this->service()->preview($this->file($rows), $this->opts(), null);
        $this->assertSame(2, $refused['error_rows']);

        $allowed = $this->service()->preview($this->file($rows), $this->opts(['allow_zero_cost' => true]), null);
        $this->assertSame([2, 0], [$allowed['line_rows'], $allowed['error_rows']]);
    }

    /** @test */
    public function a_cost_column_on_an_issue_or_transfer_is_a_setup_error_not_a_silently_ignored_value(): void
    {
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '5']]), $this->opts(['permit_type' => 'issue']), null), 'الإضافة وحده', RuntimeException::class);
    }

    // ═══════════════════════════════ أخطاء الصفوف والذرّية ═══════════════════════════════

    /** @test */
    public function row_errors_are_reported_per_row_and_block_the_whole_file_atomically(): void
    {
        $this->p['b']->forceFill(['is_active' => false])->save();
        $untracked = Product::create(['name' => 'خدمة', 'sku' => 'SKU-S', 'type' => 'service', 'sale_price' => 1, 'purchase_price' => 1, 'track_inventory' => false]);
        $rows = [
            ['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => '1'],          // سليم
            ['sku' => 'NOPE', 'quantity' => '5', 'unit_cost' => '1'],           // رمز مجهول
            ['sku' => 'SKU-A', 'barcode' => '6280000000002', 'quantity' => '5', 'unit_cost' => '1'],   // معرّفان متعارضان
            ['sku' => 'SKU-B', 'quantity' => '5', 'unit_cost' => '1'],          // معطّل
            ['sku' => $untracked->sku, 'quantity' => '5', 'unit_cost' => '1'],  // غير متابَع
            ['sku' => 'SKU-A', 'quantity' => '0', 'unit_cost' => '1'],          // كمية صفر
            ['sku' => 'SKU-A', 'quantity' => '1.5', 'unit_cost' => '1'],        // كسر
            ['sku' => 'SKU-A', 'quantity' => '2', 'unit' => 'كرتون', 'unit_cost' => '1'],   // وحدة بلا قالب
            ['quantity' => '2', 'unit_cost' => '1'],                            // بلا معرّف
        ];

        $preview = $this->service()->preview($this->file($rows), $this->opts(), null);
        $this->assertSame([1, 8], [$preview['line_rows'], $preview['error_rows']]);
        $this->assertSame([3, 4, 5, 6, 7, 8, 9, 10], array_column($preview['errors'], 'row'));

        $e = $this->thrown(fn () => $this->service()->apply($this->file($rows), $this->opts(), null), 'الأخطاء', ImportUnitFailureException::class);
        $this->assertCount(8, $e->failures);
        $this->assertSame(0, StockPermit::query()->count());
    }

    /** @test */
    public function a_repeated_product_and_unit_is_a_warning_not_an_error(): void
    {
        $preview = $this->service()->preview($this->file([
            ['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '1'],
            ['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '1'],
        ]), $this->opts(), null);

        $this->assertSame([2, 2, 0], [$preview['line_rows'], $preview['warning_rows'], $preview['error_rows']]);
        $this->assertSame('warning', $preview['rows'][0]['status']);
    }

    /** @test */
    public function a_percentage_in_the_quantity_column_is_a_row_error_not_a_quantity(): void
    {
        foreach (['25%', '25 %', '٢٥٪'] as $cell) {
            $preview = $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => $cell, 'unit_cost' => '1']]), $this->opts(), null);
            $this->assertSame([0, 1], [$preview['line_rows'], $preview['error_rows']], "«{$cell}» يجب أن تُرفض");
        }
        $ok = $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '25', 'unit_cost' => '1']]), $this->opts(), null);
        $this->assertSame(1, $ok['line_rows']);
    }

    /** @test */
    public function an_empty_data_set_and_a_missing_identifier_or_quantity_column_are_setup_errors(): void
    {
        $this->thrown(fn () => $this->service()->preview($this->file([['quantity' => '1', 'unit_cost' => '1']]), $this->opts(['mapping' => [0 => 'quantity', 1 => 'unit_cost']]), null), 'تعريف', RuntimeException::class);
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'unit_cost' => '1']]), $this->opts(), null), 'الكمية', RuntimeException::class);
        $this->thrown(fn () => $this->service()->apply(UploadedFile::fake()->createWithContent('e.csv', SpreadsheetWriter::csv(['sku', 'quantity', 'unit_cost'], [])), $this->opts(), null), 'صفوف', RuntimeException::class);
    }

    // ═══════════════════════════════ الوصول والعزل ═══════════════════════════════

    /** @test */
    public function a_user_without_access_to_the_warehouse_cannot_preview_or_apply(): void
    {
        $user = User::query()->where('tenant_id', $this->tenantId)->firstOrFail();
        $user->warehouses()->attach($this->branchB->id);
        $file = fn () => $this->file([['sku' => 'SKU-A', 'quantity' => '5', 'unit_cost' => '1']]);

        $this->thrown(fn () => $this->service()->preview($file(), $this->opts(), $user->id), 'خارج نطاق', RuntimeException::class);
        $this->thrown(fn () => $this->service()->apply($file(), $this->opts(), $user->id), 'خارج نطاق', RuntimeException::class);
        $this->assertSame(0, StockPermit::query()->count());

        // الوجهة أيضاً تُفحص: مخزن مسموح وحده لا يكفي لتحويلٍ إلى مخزن ممنوع
        $user->warehouses()->detach();
        $user->warehouses()->attach($this->main->id);
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '1']]), $this->opts(['permit_type' => 'transfer', 'target_warehouse_id' => $this->branchB->id]), $user->id), 'خارج نطاق', RuntimeException::class);

        $this->assertSame(1, $this->service()->apply($file(), $this->opts(), $user->id)['created']);
    }

    /** @test */
    public function an_inactive_warehouse_and_a_deleted_actor_are_refused(): void
    {
        $this->branchB->forceFill(['is_active' => false])->save();
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '1']]), $this->opts(['warehouse_id' => $this->branchB->id]), null), 'معطّل', RuntimeException::class);
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '1']]), $this->opts(), '00000000-0000-0000-0000-000000000000'), 'خارج نطاق', RuntimeException::class);
    }

    /** @test */
    public function another_tenants_warehouse_and_products_are_not_found(): void
    {
        $other = $this->registerTenant('other-permits', 'owner@other-permits.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $foreignWarehouse = Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-X', 'is_default' => true]);
        Product::create(['name' => 'صنف غريب', 'sku' => 'SKU-FOREIGN', 'type' => 'good', 'sale_price' => 1, 'purchase_price' => 1, 'track_inventory' => true]);
        app(TenantContext::class)->set($this->tenantId);

        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'quantity' => '1', 'unit_cost' => '1']]), $this->opts(['warehouse_id' => $foreignWarehouse->id]), null), 'خارج نطاق', RuntimeException::class);
        $preview = $this->service()->preview($this->file([['sku' => 'SKU-FOREIGN', 'quantity' => '1', 'unit_cost' => '1']]), $this->opts(), null);
        $this->assertSame(1, $preview['error_rows']);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_is_atomic_and_applies_the_whole_file_through_the_chunk_contract(): void
    {
        $adapter = app(StockPermitImportAdapter::class);
        $this->assertSame('file', $adapter->unit());
        $this->assertSame(StockPermitImportService::MAX_ROWS, $adapter->maxRows());

        $job = new ImportJob;
        $job->row_count = 2;
        $options = $adapter->canonicalOptions($this->opts());
        $chunk = new ImportChunk($job, $this->file([['sku' => 'SKU-A', 'quantity' => '2', 'unit_cost' => '3'], ['sku' => 'SKU-B', 'quantity' => '4', 'unit_cost' => '5']]), null, $options, 0, 100, null, true);

        $result = $adapter->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame(1, StockPermit::query()->count());
        $this->assertSame(2, StockPermit::query()->firstOrFail()->lines()->count());
    }
}

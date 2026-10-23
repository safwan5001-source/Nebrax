<?php

namespace Tests\Feature;

use App\Models\ImportJob;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Stocktake;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StocktakeService;
use App\Services\StocktakeCountImportAdapter;
use App\Services\StocktakeCountImportService;
use App\Support\ImportChunk;
use App\Support\ImportUnitFailureException;
use App\Support\SpreadsheetWriter;
use App\Support\StocktakeCountImportFields;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H7-S1 — استيراد ورقة عدّ إلى جردٍ مفتوح: العقد، التعريف بالصنف، القيم، سياسة العدّ القائم، الذرّية، الوصول، الحالة، وعدم أي أثر مخزني/محاسبي. المحوّل غير مسجَّل بعد.
 *
 * تشغيل: php artisan test --filter=StocktakeCountImportTest
 */
class StocktakeCountImportTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private string $tenantId;

    private Warehouse $warehouse;

    /** @var array<string, Product> */
    private array $p = [];

    private Stocktake $stocktake;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant();
        $this->tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);

        $this->warehouse = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);
        foreach (['a' => ['SKU-A', '6280000000001', 100], 'b' => ['SKU-B', '6280000000002', 50], 'c' => ['SKU-C', null, 10]] as $key => [$sku, $barcode, $qty]) {
            $this->p[$key] = Product::create(['name' => "صنف {$key}", 'sku' => $sku, 'barcode' => $barcode, 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true]);
            app(InventoryService::class)->receiveStock($this->p[$key], $qty, 1000, ['warehouse_id' => $this->warehouse->id]);
        }
        $this->stocktake = app(StocktakeService::class)->open(['warehouse_id' => $this->warehouse->id]);
    }

    private function service(): StocktakeCountImportService
    {
        return app(StocktakeCountImportService::class);
    }

    /** @param list<array<string,string>> $rows */
    private function file(array $rows): UploadedFile
    {
        $keys = array_values(array_unique(array_merge(...array_map('array_keys', $rows))));
        $table = array_map(fn (array $row): array => array_map(fn (string $key): string => $row[$key] ?? '', $keys), $rows);

        return UploadedFile::fake()->createWithContent('count.csv', SpreadsheetWriter::csv($keys, $table));
    }

    private function opts(array $over = []): array
    {
        return $over + ['stocktake_id' => $this->stocktake->id];
    }

    private function counted(string $key): ?int
    {
        return $this->stocktake->fresh('lines')->lines->firstWhere('product_id', $this->p[$key]->id)->counted_quantity;
    }

    /** @return list<string> */
    private function actions(array $preview): array
    {
        return array_map(fn (array $row): string => (string) $row['action'], $preview['rows']);
    }

    // ═══════════════════════════════ العقد ═══════════════════════════════

    /** @test */
    public function the_contract_has_no_warehouse_cost_or_system_quantity_fields(): void
    {
        foreach (['warehouse', 'warehouse_id', 'system_quantity', 'unit_cost', 'tenant_id', 'stocktake_id'] as $forbidden) {
            $this->assertNotContains($forbidden, StocktakeCountImportFields::keys(), $forbidden);
        }
        $this->assertSame(['sku', 'barcode', 'product_name', 'counted_quantity'], StocktakeCountImportFields::templateHeaders());
        $this->assertSame('counted_quantity', StocktakeCountImportFields::autoMap(['الكمية المعدودة'])[0]);
        $this->assertSame('sku', StocktakeCountImportFields::autoMap(['رمز الصنف'])[0]);
    }

    /** @test */
    public function the_template_is_a_blind_sheet_listing_every_stocktake_line_without_system_quantities(): void
    {
        $csv = $this->service()->template($this->stocktake->id);

        foreach (['SKU-A', 'SKU-B', 'SKU-C', 'صنف a'] as $needle) {
            $this->assertStringContainsString($needle, $csv);
        }
        $this->assertStringNotContainsString('100', $csv, 'الرصيد النظامي لا يظهر في ورقة العدّ الأعمى.');
        // والقالب نفسه قابل للاستيراد كما هو بعد ملء الكميات
        $insp = $this->service()->inspect(UploadedFile::fake()->createWithContent('t.csv', $csv));
        $this->assertSame(3, $insp['total_rows']);
        $this->assertSame(['sku', 'barcode', 'product_name', 'counted_quantity'], array_column($insp['columns'], 'suggested_field'));
    }

    /** @test */
    public function inspect_suggests_a_mapping_for_arabic_headers(): void
    {
        $insp = $this->service()->inspect($this->file([['الرمز' => 'SKU-A', 'العدد' => '5']]));
        $this->assertSame(['sku', 'counted_quantity'], array_column($insp['columns'], 'suggested_field'));
    }

    // ═══════════════════════════════ التطبيق ═══════════════════════════════

    /** @test */
    public function apply_writes_counts_by_sku_barcode_and_nebrax_id_and_leaves_unlisted_lines_uncounted(): void
    {
        $result = $this->service()->apply($this->file([
            ['sku' => 'SKU-A', 'counted_quantity' => '97'],
            ['barcode' => '6280000000002', 'counted_quantity' => '٥٠'],
        ]), $this->opts());

        $this->assertSame(2, $result['written']);
        $this->assertSame(1, $result['uncounted_after']);
        $this->assertSame(97, $this->counted('a'));
        $this->assertSame(50, $this->counted('b'));
        $this->assertNull($this->counted('c'), 'السطر غير المذكور لا يُصفَّر.');

        $this->service()->apply($this->file([['nebrax_id' => strtoupper($this->p['c']->id), 'counted_quantity' => '1,0']]), $this->opts());
        $this->assertSame(10, $this->counted('c'));
    }

    /** @test */
    public function a_zero_count_is_a_real_count_but_a_blank_cell_is_an_error(): void
    {
        $this->service()->apply($this->file([['sku' => 'SKU-A', 'counted_quantity' => '0']]), $this->opts());
        $this->assertSame(0, $this->counted('a'));

        $preview = $this->service()->preview($this->file([['sku' => 'SKU-B', 'counted_quantity' => '']]), $this->opts());
        $this->assertSame(1, $preview['error_rows']);
        $this->assertStringContainsString('فارغة', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function invalid_quantities_are_row_errors(): void
    {
        foreach (['-1', '2.5', '2,5x', 'abc', '100000001', '1e3'] as $bad) {
            $preview = $this->service()->preview($this->file([['sku' => 'SKU-A', 'counted_quantity' => $bad]]), $this->opts());
            $this->assertSame(1, $preview['error_rows'], "«{$bad}»");
        }
        $ok = $this->service()->preview($this->file([['sku' => 'SKU-A', 'counted_quantity' => '100000000']]), $this->opts());
        $this->assertSame(0, $ok['error_rows']);
    }

    /** @test */
    public function products_outside_the_sheet_or_unknown_never_get_added(): void
    {
        $other = Product::create(['name' => 'خارج الجرد', 'sku' => 'SKU-X', 'type' => 'good', 'sale_price' => 1, 'purchase_price' => 1, 'track_inventory' => true]);
        $preview = $this->service()->preview($this->file([
            ['sku' => 'SKU-X', 'counted_quantity' => '1'],
            ['sku' => 'NOPE', 'counted_quantity' => '1'],
            ['nebrax_id' => $other->id, 'counted_quantity' => '1'],
            ['nebrax_id' => 'not-a-uuid', 'counted_quantity' => '1'],
            ['product_name' => 'صنف a', 'counted_quantity' => '1'],
        ]), $this->opts());

        $this->assertSame([5, 0], [$preview['error_rows'], $preview['to_write']]);
        $this->assertSame(0, $this->stocktake->lines()->where('product_id', $other->id)->count());
    }

    /** @test */
    public function a_name_alone_never_identifies_a_product(): void
    {
        $e = $this->thrown(fn () => $this->service()->preview($this->file([['product_name' => 'صنف a', 'counted_quantity' => '5']]), $this->opts()), 'يلزم معرّف', RuntimeException::class);
        $this->assertStringContainsString('تعريف للصنف', $e->getMessage());
    }

    /** @test */
    public function the_same_product_twice_in_a_file_fails_both_rows(): void
    {
        $preview = $this->service()->preview($this->file([
            ['sku' => 'SKU-A', 'counted_quantity' => '5'],
            ['barcode' => '6280000000001', 'counted_quantity' => '6'],
        ]), $this->opts());
        $this->assertSame(2, $preview['error_rows']);
        $this->assertStringContainsString('مكرّر', $preview['errors'][0]['messages'][0]);
    }

    /** @test */
    public function a_barcode_shared_by_two_sheet_lines_is_ambiguous_not_guessed(): void
    {
        Product::query()->whereKey($this->p['b']->id)->update(['barcode' => '6280000000001']);
        $this->stocktake = app(StocktakeService::class)->open(['warehouse_id' => $this->warehouse->id]);

        $preview = $this->service()->preview($this->file([['barcode' => '6280000000001', 'counted_quantity' => '5']]), $this->opts());
        $this->assertSame(1, $preview['error_rows']);
        $this->assertStringContainsString('أكثر من صنف', $preview['errors'][0]['messages'][0]);
    }

    // ═══════════════════════════════ السياسة ═══════════════════════════════

    /** @test */
    public function the_default_policy_refuses_to_replace_an_existing_count_but_an_equal_value_is_unchanged(): void
    {
        app(StocktakeService::class)->count($this->stocktake, [$this->p['a']->id => 90, $this->p['b']->id => 50]);

        $preview = $this->service()->preview($this->file([
            ['sku' => 'SKU-A', 'counted_quantity' => '95'],
            ['sku' => 'SKU-B', 'counted_quantity' => '50'],
            ['sku' => 'SKU-C', 'counted_quantity' => '10'],
        ]), $this->opts());

        $this->assertSame(['error', 'unchanged', 'write'], $this->actions($preview));
        $this->assertSame(90, $this->counted('a'));
    }

    /** @test */
    public function overwrite_and_skip_policies_apply_per_run(): void
    {
        app(StocktakeService::class)->count($this->stocktake, [$this->p['a']->id => 90]);
        $rows = [['sku' => 'SKU-A', 'counted_quantity' => '95'], ['sku' => 'SKU-B', 'counted_quantity' => '7']];

        $skip = $this->service()->apply($this->file($rows), $this->opts(['existing_count_policy' => 'skip']));
        $this->assertSame([1, 1], [$skip['written'], $skip['skipped']]);
        $this->assertSame([90, 7], [$this->counted('a'), $this->counted('b')]);

        $over = $this->service()->apply($this->file($rows), $this->opts(['existing_count_policy' => 'overwrite']));
        $this->assertSame([1, 1, 1], [$over['written'], $over['overwritten'], $over['unchanged']]);
        $this->assertSame(95, $this->counted('a'));

        $this->thrown(fn () => $this->service()->options($this->opts(['existing_count_policy' => 'merge'])), 'سياسة', RuntimeException::class);
    }

    /** @test */
    public function re_importing_the_same_file_is_a_safe_no_op(): void
    {
        $rows = [['sku' => 'SKU-A', 'counted_quantity' => '95']];
        $this->service()->apply($this->file($rows), $this->opts());
        $again = $this->service()->apply($this->file($rows), $this->opts());

        $this->assertSame([0, 1], [$again['written'], $again['unchanged']]);
    }

    // ═══════════════════════════════ الذرّية ═══════════════════════════════

    /** @test */
    public function one_bad_row_blocks_the_whole_sheet_and_writes_nothing(): void
    {
        $e = $this->thrown(fn () => $this->service()->apply($this->file([
            ['sku' => 'SKU-A', 'counted_quantity' => '95'],
            ['sku' => 'SKU-B', 'counted_quantity' => 'x'],
        ]), $this->opts()), 'يجب أن يفشل', ImportUnitFailureException::class);

        $this->assertCount(1, $e->failures);
        $this->assertSame(1, $e->failures[0]['ordinal']);
        $this->assertNull($this->counted('a'));
    }

    /** @test */
    public function a_row_wider_than_the_header_is_an_error(): void
    {
        $file = UploadedFile::fake()->createWithContent('w.csv', "sku,counted_quantity\nSKU-A,5,extra\n");
        $this->assertSame(1, $this->service()->preview($file, $this->opts())['error_rows']);
    }

    /** @test */
    public function preview_writes_nothing(): void
    {
        $this->service()->preview($this->file([['sku' => 'SKU-A', 'counted_quantity' => '5']]), $this->opts());
        $this->assertNull($this->counted('a'));
    }

    // ═══════════════════════════════ الحالة والوصول ═══════════════════════════════

    /** @test */
    public function a_posted_stocktake_accepts_no_counts(): void
    {
        app(StocktakeService::class)->count($this->stocktake, [$this->p['a']->id => 100]);
        app(StocktakeService::class)->post($this->stocktake);

        $e = $this->thrown(fn () => $this->service()->apply($this->file([['sku' => 'SKU-B', 'counted_quantity' => '5']]), $this->opts()), 'مرحّل', RuntimeException::class);
        $this->assertStringContainsString('مرحَّل', $e->getMessage());
        $this->assertNull($this->counted('b'));
    }

    /** @test */
    public function an_unknown_or_foreign_stocktake_is_not_found(): void
    {
        $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'counted_quantity' => '5']]), ['stocktake_id' => '00000000-0000-4000-8000-000000000000']), 'غير موجود', RuntimeException::class);
        $this->thrown(fn () => $this->service()->options(['stocktake_id' => 'nope']), 'معرّف', RuntimeException::class);

        $foreign = $this->registerTenant('other-co', 'other@co.test');
        app(TenantContext::class)->set($foreign['tenant_id']);
        $e = $this->thrown(fn () => $this->service()->preview($this->file([['sku' => 'SKU-A', 'counted_quantity' => '5']]), $this->opts()), 'غير موجود', RuntimeException::class);
        $this->assertSame('الجرد غير موجود.', $e->getMessage());
    }

    /** @test */
    public function a_user_without_access_to_the_stocktake_warehouse_cannot_import(): void
    {
        $other = Warehouse::create(['name' => 'مخزن آخر', 'code' => 'WH-2']);
        $user = User::query()->where('tenant_id', $this->tenantId)->firstOrFail();
        $user->warehouses()->attach($other->id);

        $e = $this->thrown(fn () => $this->service()->apply($this->file([['sku' => 'SKU-A', 'counted_quantity' => '5']]), $this->opts(), $user->id), 'غير موجود', RuntimeException::class);
        $this->assertSame('الجرد غير موجود.', $e->getMessage());
        $this->thrown(fn () => $this->service()->template($this->stocktake->id, $user->id), 'غير موجود', RuntimeException::class);

        $user->warehouses()->detach();
        $user->warehouses()->attach($this->warehouse->id);
        $this->assertSame(1, $this->service()->apply($this->file([['sku' => 'SKU-A', 'counted_quantity' => '5']]), $this->opts(), $user->id)['written']);
    }

    // ═══════════════════════════════ لا أثر مخزني/محاسبي ═══════════════════════════════

    /** @test */
    public function importing_counts_creates_no_movement_and_no_journal_entry_and_posting_stays_the_existing_flow(): void
    {
        $movements = StockMovement::query()->count();
        $entries = JournalEntry::query()->count();

        $this->service()->apply($this->file([['sku' => 'SKU-A', 'counted_quantity' => '97'], ['sku' => 'SKU-B', 'counted_quantity' => '50']]), $this->opts());

        $this->assertSame([$movements, $entries], [StockMovement::query()->count(), JournalEntry::query()->count()]);
        $this->assertSame(100, (int) $this->p['a']->fresh()->quantity_on_hand);
        $this->assertSame('draft', $this->stocktake->fresh()->status);

        // الترحيل بعدها هو مسار الجرد القائم بلا تغيير: عجز 3 من الصنف A بقيمة 3×1000 هللة، وB بلا فرق.
        $posted = app(StocktakeService::class)->post($this->stocktake->fresh());
        $this->assertSame(-3000, (int) $posted->difference_value);
        $this->assertSame(97, (int) $this->p['a']->fresh()->quantity_on_hand);
    }

    // ═══════════════════════════════ المحوّل ═══════════════════════════════

    /** @test */
    public function the_adapter_is_file_atomic_and_canonicalises_options(): void
    {
        $adapter = app(StocktakeCountImportAdapter::class);

        $this->assertSame(['stocktake_count', 'file'], [$adapter->domain(), $adapter->unit()]);
        $this->assertSame(StocktakeCountImportService::MAX_ROWS, $adapter->maxRows());
        $this->assertSame(
            ['stocktake_id' => strtolower($this->stocktake->id), 'existing_count_policy' => 'overwrite', 'mapping' => ['0' => 'sku', '1' => 'counted_quantity']],
            $adapter->canonicalOptions(['stocktake_id' => strtoupper($this->stocktake->id), 'existing_count_policy' => 'overwrite', 'mapping' => [1 => 'counted_quantity', 0 => 'sku'], 'junk' => 1]),
        );
    }

    /** @test */
    public function the_adapter_chunk_counts_the_whole_sheet_and_reports_the_job_row_count(): void
    {
        $job = new ImportJob;
        $job->row_count = 2;
        $chunk = new ImportChunk($job, $this->file([['sku' => 'SKU-A', 'counted_quantity' => '9'], ['sku' => 'SKU-B', 'counted_quantity' => '8']]), null, $this->opts(['existing_count_policy' => 'error']), 0, 100, null, true);

        $result = app(StocktakeCountImportAdapter::class)->applyChunk($chunk);

        $this->assertSame(2, $result->processedUnits);
        $this->assertSame([9, 8], [$this->counted('a'), $this->counted('b')]);
    }

    /** @test */
    public function the_adapter_is_not_registered_anywhere_yet(): void
    {
        $root = dirname(__DIR__, 2);
        foreach (['app/Services/ImportDomainRegistry.php', 'app/Support/ImportJobDomain.php', 'routes/api.php'] as $file) {
            $this->assertStringNotContainsString('StocktakeCountImport', (string) file_get_contents($root.'/'.$file), $file);
        }
    }
}

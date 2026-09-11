<?php

namespace Tests\Feature;

use App\Services\ImportJobService;
use App\Services\InventoryOpeningImportService;
use App\Services\ProductImportService;
use App\Services\ProductWorkbookService;
use App\Support\ImportJobStatus;
use App\Support\SpreadsheetWriter;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

/**
 * PR-DUR-HARDEN-1 — يحرس التمييز الصريح بين سقوف الصفوف الثلاثة عبر
 * `ImportJobService::maxRowsFor()`: `product_catalog` مجزَّأٌ فعلياً فسقفه
 * `ProductImportService::DURABLE_MAX_ROWS` (٢٠٠٠٠، أعلى بعشر مرّات من السقف
 * القديم)، بينما `product_workbook`/`inventory_opening` ذرّيّان (تطبيقهما
 * كتلةٌ واحدة بلا تجزئة ممكنة أصلاً) فسقفهما يبقى ٢٠٠٠ كما كان — غير مرفوعٍ
 * سهواً عبر استعارة ثابتٍ مشترك. راجع `DURABLE-IMPORTS-DECOMPOSITION.md`
 * و`PR-DUR-HARDEN-1-IMPLEMENTATION-REPORT.md` للتفصيل الكامل.
 */
class ImportJobDomainRowLimitsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function the_three_domains_have_explicitly_distinct_row_ceilings(): void
    {
        $this->assertSame(20000, ProductImportService::DURABLE_MAX_ROWS);
        $this->assertSame(2000, ProductImportService::MAX_ROWS);

        // ذرّيّان: يبقيان على سقف الاستيراد المتزامن القديم، لا يرتفعان معه.
        $this->assertSame(2000, ProductWorkbookService::MAX_ROWS);
        $this->assertSame(2000, InventoryOpeningImportService::MAX_ROWS);

        $this->assertNotSame(
            ProductImportService::DURABLE_MAX_ROWS,
            ProductWorkbookService::MAX_ROWS,
            'رفع سقف الترحيل الدائم المجزَّأ لمصنّف المنتجات يجب ألا يمسّ مصنّف Products/Barcodes/Unit Prices الذرّي.'
        );
        $this->assertNotSame(
            ProductImportService::DURABLE_MAX_ROWS,
            InventoryOpeningImportService::MAX_ROWS,
            'رفع سقف الترحيل الدائم المجزَّأ لمصنّف المنتجات يجب ألا يمسّ الرصيد الافتتاحي الذرّي.'
        );
    }

    /** @test */
    public function a_product_workbook_upload_beyond_its_own_atomic_row_limit_still_fails_the_job_at_inspect(): void
    {
        $auth = $this->registerTenant();

        $rows = [];
        for ($i = 1; $i <= ProductWorkbookService::MAX_ROWS + 1; $i++) {
            $rows[] = ["SKU-WB-{$i}", "منتج {$i}", 'good', 'قطعة', '10.00'];
        }
        $path = tempnam(sys_get_temp_dir(), 'test-large-workbook-');
        SpreadsheetWriter::workbookXlsx($path, [
            ['name' => 'Products', 'headers' => ['sku', 'name', 'type', 'unit', 'sale_price'], 'rows' => $rows],
        ]);
        $file = UploadedFile::fake()->createWithContent('large-workbook.xlsx', (string) file_get_contents($path));
        @unlink($path);

        $response = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'product_workbook', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::FAILED);

        $this->assertNotEmpty($response->json('data.error_message'));
    }

    /** @test */
    public function an_inventory_opening_upload_beyond_its_own_atomic_row_limit_still_fails_the_job_at_inspect(): void
    {
        $auth = $this->registerTenant();

        $lines = ['sku,warehouse,opening_quantity,opening_unit_cost'];
        for ($i = 1; $i <= InventoryOpeningImportService::MAX_ROWS + 1; $i++) {
            $lines[] = "SKU-{$i},WH-1,10,5.00";
        }
        $file = UploadedFile::fake()->createWithContent('large-openings.csv', implode("\n", $lines)."\n");

        $response = $this->withToken($auth['token'])
            ->post('/api/import-jobs', ['domain' => 'inventory_opening', 'file' => $file])
            ->assertCreated()
            ->assertJsonPath('data.status', ImportJobStatus::FAILED);

        $this->assertNotEmpty($response->json('data.error_message'));
    }
}

<?php

namespace Tests\Feature;

use App\Contracts\ImportDomainAdapter;
use App\Services\ImportDomainRegistry;
use App\Services\InventoryOpeningImportService;
use App\Services\ProductImportService;
use App\Services\ProductWorkbookService;
use App\Support\ImportJobDomain;
use RuntimeException;
use Tests\TestCase;

/**
 * IMP-H1-S2 — عقد `ImportDomainAdapter` والسجلّ. لا تغيير سلوك: السلوك الفعلي لكل مجال تحرسه اختبارات التشغيلات الدائمة
 * القائمة (`ImportJobTest`, `ImportJob*ApplyTest`, `ImportJobDomainRowLimitsTest`) دون أي تعديل عليها؛ هنا حرّاس البنية.
 */
class ImportDomainRegistryTest extends TestCase
{
    private function registry(): ImportDomainRegistry
    {
        return app(ImportDomainRegistry::class);
    }

    /** @test */
    public function every_registered_import_domain_has_exactly_one_adapter_and_no_adapter_is_unregistered(): void
    {
        $this->assertEqualsCanonicalizing(ImportJobDomain::values(), $this->registry()->domains());

        foreach (ImportJobDomain::values() as $domain) {
            // كل مجال مسجَّل يعلن بواباته (IMP-H1-S1): إضافة محوّل بلا بوابات تُفشل هنا لا في الإنتاج.
            $gates = ImportJobDomain::authorization($domain);
            $this->assertNotEmpty($gates['view']);
            $this->assertNotEmpty($gates['manage']);
            $this->assertArrayHasKey('app', $gates);

            $adapter = $this->registry()->for($domain);
            $this->assertInstanceOf(ImportDomainAdapter::class, $adapter);
            $this->assertSame($domain, $adapter->domain());
            $this->assertContains($adapter->unit(), [
                ImportDomainAdapter::UNIT_ROW,
                ImportDomainAdapter::UNIT_FILE,
                ImportDomainAdapter::UNIT_DOCUMENT,
            ]);
        }
    }

    /** @test */
    public function an_unregistered_domain_fails_closed_with_the_original_message(): void
    {
        $this->assertFalse($this->registry()->has('not_a_domain'));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('لا يوجد محرّك ترحيل مجزّأ لهذا المجال بعد.');
        $this->registry()->for('not_a_domain');
    }

    /** @test */
    public function units_and_row_ceilings_match_the_behavior_the_engine_had_before_the_adapters(): void
    {
        $catalog = $this->registry()->for(ImportJobDomain::PRODUCT_CATALOG);
        $workbook = $this->registry()->for(ImportJobDomain::PRODUCT_WORKBOOK);
        $opening = $this->registry()->for(ImportJobDomain::INVENTORY_OPENING);

        // الكتالوج مجزَّأ بالصفّ وسقفه الدائم؛ المصنّف والرصيد الافتتاحي ذرّيان (الملف كلّه) بسقف خدمتيهما.
        $this->assertSame(ImportDomainAdapter::UNIT_ROW, $catalog->unit());
        $this->assertSame(ImportDomainAdapter::UNIT_FILE, $workbook->unit());
        $this->assertSame(ImportDomainAdapter::UNIT_FILE, $opening->unit());
        $this->assertSame(ProductImportService::DURABLE_MAX_ROWS, $catalog->maxRows());
        $this->assertSame(ProductWorkbookService::MAX_ROWS, $workbook->maxRows());
        $this->assertSame(InventoryOpeningImportService::MAX_ROWS, $opening->maxRows());
        $this->assertGreaterThan($opening->maxRows(), $catalog->maxRows(), 'سقف الكتالوج الدائم أعلى من الذرّيين.');
    }

    /** @test */
    public function the_spreadsheet_adapters_count_data_rows_and_columns_with_the_single_shared_definition(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'imp-s2-');
        file_put_contents($path, "sku,name,type,sale_price\nSKU-1,منتج 1,good,10.00\n,,,\nSKU-2,منتج 2,good,20.00\n,,,\n");

        try {
            foreach ([ImportJobDomain::PRODUCT_CATALOG, ImportJobDomain::INVENTORY_OPENING] as $domain) {
                $this->assertSame([2, 4], $this->registry()->for($domain)->inspect($path, 'csv'), $domain);
            }
        } finally {
            @unlink($path);
        }
    }

    /** @test */
    public function only_the_catalog_adapter_recounts_rows_on_first_apply(): void
    {
        $path = tempnam(sys_get_temp_dir(), 'imp-s2-');
        file_put_contents($path, "sku,name,type,sale_price\nSKU-1,منتج,good,10.00\n,,,\n");

        try {
            $this->assertSame(1, $this->registry()->for(ImportJobDomain::PRODUCT_CATALOG)->recountOnFirstApply($path, 'csv'));
            $this->assertNull($this->registry()->for(ImportJobDomain::PRODUCT_WORKBOOK)->recountOnFirstApply($path, 'csv'));
            $this->assertNull($this->registry()->for(ImportJobDomain::INVENTORY_OPENING)->recountOnFirstApply($path, 'csv'));
        } finally {
            @unlink($path);
        }
    }

    /** @test */
    public function the_job_engine_has_no_domain_specific_dispatch_left(): void
    {
        $source = (string) file_get_contents(base_path('app/Services/ImportJobService.php'));

        // الإرسال حسب المجال صار في المحوّلات. المرجع الوحيد الباقي لمجالٍ في المحرّك هو التحقق من أرشيف الصور
        // (`product_catalog` وحده يقبله) وسيُنقل إلى قدرة المحوّل في شريحة لاحقة.
        foreach (['PRODUCT_WORKBOOK', 'INVENTORY_OPENING', 'runProductCatalogChunk', 'runProductWorkbookChunk', 'runInventoryOpeningChunk', 'maxRowsFor'] as $needle) {
            $this->assertStringNotContainsString($needle, $source, "ImportJobService يجب ألا يعرف «{$needle}» بعد الآن.");
        }
    }

    /** @test */
    public function canonical_options_are_closed_typed_and_keep_absent_mapping_distinct_from_an_empty_one(): void
    {
        $catalog = $this->registry()->for('product_catalog');
        $absent = $catalog->canonicalOptions(['mode' => 'upsert', 'batch_size' => 50, 'foreign_key' => 'x']);
        $this->assertArrayNotHasKey('mapping', $absent, 'غياب المطابقة = مطابقة تلقائية، لا مصفوفة فارغة.');
        $this->assertArrayNotHasKey('batch_size', $absent);
        $this->assertArrayNotHasKey('foreign_key', $absent);
        $this->assertSame('upsert', $absent['mode']);
        $this->assertFalse($absent['apply_product_images']);

        $empty = $catalog->canonicalOptions(['mapping' => []]);
        $this->assertSame([], $empty['mapping']);

        $sorted = $catalog->canonicalOptions(['mapping' => ['10' => 'name', '2' => 'sku', '0' => null]]);
        $this->assertSame(['0', '2', '10'], array_map('strval', array_keys($sorted['mapping'])));
        $this->assertNull($sorted['mapping']['0']);

        $opening = $this->registry()->for('inventory_opening')->canonicalOptions(['opening_date' => '2026-01-01', 'allow_zero_cost' => '1', 'notes' => '']);
        $this->assertSame(['opening_date' => '2026-01-01', 'allow_zero_cost' => true, 'notes' => null], $opening);

        $workbook = $this->registry()->for('product_workbook')->canonicalOptions(['price_list_id' => '']);
        $this->assertNull($workbook['price_list_id']);
    }
}

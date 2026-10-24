<?php

namespace App\Services;

use App\Contracts\ImportDomainAdapter;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;
use App\Support\SpreadsheetReader;
use RuntimeException;

/**
 * محوّل `product_workbook` (كان `runProductWorkbookChunk` + فحص المصنّف في `ImportJobService`، نقلٌ حرفي — PR-DUR-3).
 *
 * المصنّف ثلاثي الأوراق (Products/Barcodes/Unit Prices) ذرّيٌّ بطبيعته: `ProductWorkbookService::apply()` يطبّق أوراقه
 * الثلاث داخل معاملةٍ واحدة بترتيبٍ مقصود (Products أولاً فيصبح مرئياً لبقية الأوراق داخل المعاملة) ولا يقبل
 * `batch_offset`/`batch_size`. وحدته **الملف كلّه**؛ تشغيلةٌ فشلت تصبح نهائية (`failed`) لأن معاملتها الداخلية تتراجع كلها.
 */
class ProductWorkbookImportAdapter implements ImportDomainAdapter
{
    use CanonicalizesImportOptions;

    public function domain(): string
    {
        return ImportJobDomain::PRODUCT_WORKBOOK;
    }

    public function unit(): string
    {
        return self::UNIT_FILE;
    }

    /** ذرّي (كتلة واحدة بلا تجزئة ممكنة)، فسقفه سقف خدمته نفسه غير مرفوع. */
    public function maxRows(): int
    {
        return ProductWorkbookService::MAX_ROWS;
    }

    public function inspect(string $tmpPath, string $extension): array
    {
        $sheets = SpreadsheetReader::readWorkbookXlsx($tmpPath, $this->maxRows(), ProductImportService::MAX_COLUMNS);
        if (! isset($sheets[ProductWorkbookService::SHEET_PRODUCTS])) {
            throw new RuntimeException(
                'المصنّف لا يحتوي ورقة «'.ProductWorkbookService::SHEET_PRODUCTS.'» — هي الورقة الإلزامية الوحيدة.'
            );
        }

        $rowCount = 0;
        $sheetNames = [
            ProductWorkbookService::SHEET_PRODUCTS,
            ProductWorkbookService::SHEET_BARCODES,
            ProductWorkbookService::SHEET_UNIT_PRICES,
        ];
        foreach ($sheetNames as $sheetName) {
            if (! isset($sheets[$sheetName])) {
                continue;
            }
            $dataRows = array_slice($sheets[$sheetName], 1);
            $rowCount += count(array_filter(
                $dataRows,
                static fn (array $row): bool => ! ProductImportService::isBlankRow($row)
            ));
        }

        $productsHeader = $sheets[ProductWorkbookService::SHEET_PRODUCTS][0] ?? [];

        return [$rowCount, count($productsHeader)];
    }

    public function canonicalOptions(array $raw): array
    {
        $priceList = $raw['price_list_id'] ?? null;

        $options = [
            'mode' => (string) ($raw['mode'] ?? ProductImportService::MODE_CREATE),
            'blank_policy' => (string) ($raw['blank_policy'] ?? ProductImportService::BLANK_IGNORE),
            'master_data_policy' => (string) ($raw['master_data_policy'] ?? ProductImportService::MASTER_DATA_TEXT),
            'price_list_id' => $priceList === null || $priceList === '' ? null : (string) $priceList,
        ];

        return $this->withMapping($options, $raw);
    }

    public function recountOnFirstApply(string $tmpPath, string $extension, array $frozenOptions = []): ?int
    {
        return null;
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $options = $chunk->options;
        $priceList = app(ProductWorkbookService::class)->resolveActivePriceList($options['price_list_id'] ?? null);
        $productOptions = array_intersect_key($options, array_flip(['mode', 'blank_policy', 'master_data_policy', 'mapping']));

        $result = app(ProductWorkbookService::class)->apply($chunk->file, $productOptions, $priceList, $chunk->userId, $chunk->costAuthorized);

        return new ImportChunkResult((int) $chunk->job->row_count, $result);
    }
}

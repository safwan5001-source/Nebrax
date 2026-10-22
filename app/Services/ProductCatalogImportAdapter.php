<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;
use App\Support\ProductImportFields;
use App\Support\SensitiveCostPolicy;
use App\Support\SpreadsheetReader;
use Illuminate\Http\UploadedFile;
use RuntimeException;

/**
 * محوّل `product_catalog` (كان `ImportJobService::runProductCatalogChunk`، نقلٌ حرفي بلا تغيير سلوك — PR-DUR-2):
 * يستهلك `ProductImportService::apply()` حصراً كحد الطفرة الوحيد، ومعاينة/تطبيق الصور عبر `ProductImportMediaService`.
 * وحدته الصفّ، فيُجزَّأ بدفعات `APPLY_BATCH_SIZE`.
 */
class ProductCatalogImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public function domain(): string
    {
        return ImportJobDomain::PRODUCT_CATALOG;
    }

    public function unit(): string
    {
        return self::UNIT_ROW;
    }

    /** مجزَّأ فعلياً فسقفه `DURABLE_MAX_ROWS` (أعلى بعشر مرّات من المتزامن، مبرَّرٌ بالقياس — PR-DUR-HARDEN-1). */
    public function maxRows(): int
    {
        return ProductImportService::DURABLE_MAX_ROWS;
    }

    /**
     * أعمدة التكلفة: (١) ما طابقته المطابقة المجمَّدة/التلقائية بسعر الشراء أو الهامش — نفس مصدر التصنيف الذي يحرس المعاينة والترحيل —
     * و(٢) أي عمودٍ **ترويسته تشبه التكلفة** حتى لو تُرك بلا مطابقة (مثل `avg_cost` في ملف تصدير): غير المطابَق لم يُستورَد لكنه يبقى في الملف
     * الأصلي، وقيمته قد تكون تكلفة. الحجب محافظٌ عمداً (قد يحجب عموداً بريئاً الاسم؛ وهو خطأٌ آمن).
     */
    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array
    {
        $mapping = [];
        if (isset($frozenOptions['mapping']) && is_array($frozenOptions['mapping'])) {
            foreach ($frozenOptions['mapping'] as $index => $key) {
                if (is_numeric($index) && is_string($key) && $key !== '') {
                    $mapping[(int) $index] = $key;
                }
            }
        } else {
            foreach (ProductImportFields::autoMap(array_values($headers)) as $index => $key) {
                if ($key !== null) {
                    $mapping[(int) $index] = $key;
                }
            }
        }

        $indexes = [];
        foreach ($mapping as $index => $key) {
            if (in_array($key, SensitiveCostPolicy::PRODUCT_WRITABLE_FIELDS, true)) {
                $indexes[$index] = true;
            }
        }
        foreach (array_values($headers) as $index => $header) {
            if (preg_match('/cost|purchase|buying|margin|profit|تكلف|شراء|هامش|ربح/iu', (string) $header) === 1) {
                $indexes[$index] = true;
            }
        }

        return array_keys($indexes);
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'mode' => (string) ($raw['mode'] ?? ProductImportService::MODE_CREATE),
            'blank_policy' => (string) ($raw['blank_policy'] ?? ProductImportService::BLANK_IGNORE),
            'master_data_policy' => (string) ($raw['master_data_policy'] ?? ProductImportService::MASTER_DATA_TEXT),
            'apply_product_images' => $this->canonicalBool($raw['apply_product_images'] ?? false),
            'approve_existing_media_updates' => $this->canonicalBool($raw['approve_existing_media_updates'] ?? false),
        ];

        return $this->withMapping($options, $raw);
    }

    /**
     * إعادة حساب `row_count` بتعريف صفوف البيانات دون الفيزيائي مرّة واحدة عند أول ترحيل — تصحيحٌ ذاتيٌّ لتشغيلات
     * `ready` أُنشئت بالحساب الفيزيائي القديم (قبل تصحيح المراجعة) قبل أن يعتمد عليها الاكتمال، بلا نقل بيانات منفصل.
     */
    public function recountOnFirstApply(string $tmpPath, string $extension): ?int
    {
        $rows = SpreadsheetReader::read($tmpPath, $extension, ProductImportService::DURABLE_MAX_ROWS, self::MAX_COLUMNS);

        return $this->countDataRows($rows);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $job = $chunk->job;
        $chunkOptions = array_merge($chunk->options, [
            'batch_offset' => $chunk->offset,
            'batch_size' => $chunk->batchSize,
        ]);
        // IMP-H1-S3c: تشغيلةٌ مربوطةٌ بمعاينةٍ تحمل خطّتها؛ كل قطعة تتحقق أن صفوف نافذتها ما زالت تفعل ما اعتُمد (plan_drift).
        $plan = ImportPreviewService::decodePlan(
            $job->preview_id === null ? null : ImportPreview::query()->whereKey($job->preview_id)->value('plan')
        );
        if ($plan !== null) {
            $chunkOptions['expected_plan'] = $plan;
        }

        $archive = $chunk->archiveTmpPath === null ? null : new UploadedFile(
            $chunk->archiveTmpPath,
            (string) $job->media_archive_original_filename,
            $job->media_archive_mime_type,
            null,
            true,
        );
        $approveExisting = (bool) ($chunkOptions['approve_existing_media_updates'] ?? false);
        $media = app(ProductImportMediaService::class)->preview(
            $chunk->file,
            $chunkOptions,
            $archive,
            ProductImportService::DURABLE_MAX_ROWS,
            $approveExisting,
        );
        if (($chunkOptions['apply_product_images'] ?? false) && ($media['error_rows'] > 0 || $media['needs_approval_rows'] > 0)) {
            throw new RuntimeException('معاينة صور المنتجات تحتوي أخطاء أو تحديثات قائمة لم تُعتمد صراحةً.');
        }

        $result = app(ProductImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, $chunk->costAuthorized, ProductImportService::DURABLE_MAX_ROWS);
        $result['media'] = ($chunkOptions['apply_product_images'] ?? false) && $chunk->userId !== null
            ? app(ProductImportMediaService::class)->apply(
                $chunk->file,
                $chunkOptions,
                $result['results'],
                $archive,
                $chunk->userId,
                ProductImportService::DURABLE_MAX_ROWS,
                $approveExisting,
            )
            : $media;

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}

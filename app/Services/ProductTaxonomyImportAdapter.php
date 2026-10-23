<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `product_taxonomy` (IMP-H4-S1): استيراد تصنيفات المنتجات/علاماتها بوحدة الصفّ عبر `ProductTaxonomyImportService` وحده. مسجَّل في `ImportDomainRegistry` و`ImportJobDomain` منذ IMP-H4-S5.
 *
 * لا أعمدة حسّاسة: عقد الحقول بلا تكلفة ولا أرصدة، فملف الصفوف الفاشلة يصدّر كاملاً لمن يملك صلاحية الإدارة.
 */
class ProductTaxonomyImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public function domain(): string
    {
        return ImportJobDomain::PRODUCT_TAXONOMY;
    }

    public function unit(): string
    {
        return self::UNIT_ROW;
    }

    public function maxRows(): int
    {
        return ProductTaxonomyImportService::DURABLE_MAX_ROWS;
    }

    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array
    {
        return [];
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'kind' => (string) ($raw['kind'] ?? ''),
            'mode' => (string) ($raw['mode'] ?? ProductTaxonomyImportService::MODE_CREATE),
            'blank_policy' => (string) ($raw['blank_policy'] ?? ProductTaxonomyImportService::BLANK_IGNORE),
            'parent_policy' => (string) ($raw['parent_policy'] ?? ProductTaxonomyImportService::PARENT_ERROR),
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $job = $chunk->job;
        $chunkOptions = array_merge($chunk->options, ['batch_offset' => $chunk->offset, 'batch_size' => $chunk->batchSize]);
        // تشغيلةٌ مربوطةٌ بمعاينة: كل قطعة تتحقق أن صفوف نافذتها ما زالت تفعل ما اعتُمد (plan_drift).
        $plan = ImportPreviewService::decodePlan(
            $job->preview_id === null ? null : ImportPreview::query()->whereKey($job->preview_id)->value('plan')
        );
        if ($plan !== null) {
            $chunkOptions['expected_plan'] = $plan;
        }

        // تشغيلة إصلاح فرعية: انتزاع معرّفات النافذة ذرّياً داخل معاملة القطعة (تتراجع معها).
        if ($job->parent_job_id !== null) {
            app(ImportRepairClaims::class)->claimWindow($job, (string) $chunk->file->getRealPath(), (string) $job->extension, $chunk->offset, $chunk->batchSize);
        }

        $result = app(ProductTaxonomyImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, ProductTaxonomyImportService::DURABLE_MAX_ROWS);

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}

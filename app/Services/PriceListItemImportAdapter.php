<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `price_list_items` (IMP-H4-S2): استيراد أسعار قائمة سعر بوحدة الصفّ عبر `PriceListItemImportService` وحده. **غير مسجَّل بعد** في
 * `ImportDomainRegistry` ولا في `ImportJobDomain` — التسجيل ونقاط النهاية في الشريحة التالية، فلا يصل إليه أي طلب قبلها. بوابة الكتابة المباشرة المقابلة
 * (`POST price-lists/{id}/items`) هي `company.manage`، وعلى المجال المسجَّل أن يعلنها حرفياً (اختبار الثبات).
 *
 * لا أعمدة حسّاسة: عقد الحقول بلا تكلفة ولا أرصدة (سعر البيع وحده)، فملف الصفوف الفاشلة يصدّر كاملاً لمن يملك صلاحية الإدارة.
 */
class PriceListItemImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public function domain(): string
    {
        return ImportJobDomain::PRICE_LIST_ITEMS;
    }

    public function unit(): string
    {
        return self::UNIT_ROW;
    }

    public function maxRows(): int
    {
        return PriceListItemImportService::DURABLE_MAX_ROWS;
    }

    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array
    {
        return [];
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'price_list_id' => isset($raw['price_list_id']) && $raw['price_list_id'] !== '' ? mb_strtolower((string) $raw['price_list_id'], 'UTF-8') : null,
            'mode' => (string) ($raw['mode'] ?? PriceListItemImportService::MODE_UPSERT),
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

        $result = app(PriceListItemImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, PriceListItemImportService::DURABLE_MAX_ROWS);

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}

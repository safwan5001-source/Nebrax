<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;

/**
 * محوّل `partner_master` (IMP-H3-S1): استيراد العملاء/الموردين بوحدة الصفّ عبر `PartnerImportService` وحده. **غير مسجَّل بعد** في
 * `ImportDomainRegistry` ولا في `ImportJobDomain` — التسجيل ونقاط النهاية في IMP-H3-S2، فلا يصل إليه أي طلب قبلها.
 *
 * لا أعمدة حسّاسة: عقد الحقول بلا تكلفة ولا رصيد افتتاحي (D-01)، فملف الصفوف الفاشلة يصدّر كاملاً لمن يملك صلاحية الإدارة.
 */
class PartnerImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public const DOMAIN = 'partner_master';

    public function domain(): string
    {
        return self::DOMAIN;
    }

    public function unit(): string
    {
        return self::UNIT_ROW;
    }

    public function maxRows(): int
    {
        return PartnerImportService::DURABLE_MAX_ROWS;
    }

    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array
    {
        return [];
    }

    public function canonicalOptions(array $raw): array
    {
        $options = [
            'type' => (string) ($raw['type'] ?? ''),
            'mode' => (string) ($raw['mode'] ?? PartnerImportService::MODE_CREATE),
            'blank_policy' => (string) ($raw['blank_policy'] ?? PartnerImportService::BLANK_IGNORE),
            'duplicate_signal_policy' => (string) ($raw['duplicate_signal_policy'] ?? PartnerImportService::SIGNAL_WARN),
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

        $result = app(PartnerImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, PartnerImportService::DURABLE_MAX_ROWS);

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}

<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;

/**
 * محوّل `expense_import` (IMP-H5-S1c): استيراد المصروفات مسوداتٍ بوحدة الصفّ عبر `ExpenseImportService` وحده. **غير مسجَّل بعد** في `ImportDomainRegistry`
 * ولا في `ImportJobDomain`، فلا يصل إليه أي طلب (تسجيله وبواباته في IMP-H5-S2). بوابة الكتابة المباشرة المقابلة (`POST /expenses`) هي `expenses.manage`
 * + `EnsureApplicationActive:finance.operations`، وتبقى هي المرجع عند التسجيل.
 *
 * لا أعمدة حسّاسة: عقد الحقول لا يحمل تكلفة ولا رصيداً، فملف الصفوف الفاشلة يصدّر كاملاً لمن يملك صلاحية الإدارة.
 */
class ExpenseImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public const DOMAIN = 'expense_import';

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
        return ExpenseImportService::DURABLE_MAX_ROWS;
    }

    public function sensitiveColumnIndexes(array $headers, array $frozenOptions): array
    {
        return [];
    }

    public function canonicalOptions(array $raw): array
    {
        $repeats = array_values(array_unique(array_map('intval', array_filter((array) ($raw['confirmed_repeat_rows'] ?? []), 'is_numeric'))));
        sort($repeats);

        $options = [
            'reference_policy' => (string) ($raw['reference_policy'] ?? ExpenseImportService::REFERENCE_OPTIONAL),
            'default_account_id' => strtolower(trim((string) ($raw['default_account_id'] ?? ''))),
            'default_payment_method' => (string) ($raw['default_payment_method'] ?? 'cash'),
            'default_tax_rate' => (int) ($raw['default_tax_rate'] ?? 15),
            'confirmed_repeat_rows' => $repeats,
        ];

        return $this->withMapping($options, $raw);
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $job = $chunk->job;
        // معرّف التمييز الحتمي للتكرار المؤكَّد يُشتقّ من المهمة نفسها: إعادة نافذةٍ لا تُنتج مصروفاً ثانياً، ومهمةٌ جديدة (إصلاح/إعادة رفع) لا تعيد استعمال معرّفات القديمة.
        $chunkOptions = array_merge($chunk->options, [
            'batch_offset' => $chunk->offset, 'batch_size' => $chunk->batchSize, 'occurrence_scope' => (string) $job->getKey(),
        ]);
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

        $result = app(ExpenseImportService::class)->apply($chunk->file, $chunkOptions, $chunk->userId, ExpenseImportService::DURABLE_MAX_ROWS);

        return new ImportChunkResult($result['created'] + $result['updated'] + $result['skipped'], $result);
    }
}

<?php

namespace App\Services;

use App\Contracts\ImportFailureExportAdapter;
use App\Models\ImportPreview;
use App\Support\ImportChunk;
use App\Support\ImportChunkResult;
use App\Support\ImportJobDomain;

/**
 * محوّل `expense_import` (IMP-H5-S1c): استيراد المصروفات مسوداتٍ بوحدة الصفّ عبر `ExpenseImportService` وحده. مسجَّل في `ImportDomainRegistry` و`ImportJobDomain`
 * منذ IMP-H5-S2 (مربوط بمعاينة وحده). بوابة الكتابة المباشرة المقابلة (`POST /expenses`) هي `expenses.manage` + `EnsureApplicationActive:finance.operations`.
 *
 * لا أعمدة حسّاسة: عقد الحقول لا يحمل تكلفة ولا رصيداً، فملف الصفوف الفاشلة يصدّر كاملاً لمن يملك صلاحية الإدارة.
 */
class ExpenseImportAdapter extends SpreadsheetImportAdapter implements ImportFailureExportAdapter
{
    public const DOMAIN = ImportJobDomain::EXPENSE_IMPORT;

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
        // لا تحويل مُسقِط للقيم الفاسدة: القيمة غير الصالحة تبقى كما وردت ليرفضها `ExpenseImportService::options()` (التحويل الصامت يجمّد خياراً مالياً خاطئاً على المهمة).
        $integer = static fn (mixed $value): mixed => match (true) {
            is_string($value) && preg_match('/^\d{1,12}$/', $value) === 1 => (int) $value,
            is_float($value) && floor($value) === $value && abs($value) < 1e12 => (int) $value,   // 5.0 المرسلة JSON تُقارَن بـ"5" المرسلة multipart
            default => $value,
        };
        $string = static fn (mixed $value, string $default): mixed => $value === null ? $default : (is_scalar($value) ? (string) $value : $value);
        $repeats = [];
        foreach ((array) ($raw['confirmed_repeat_rows'] ?? []) as $row) {
            $row = $integer($row);
            $repeats[is_scalar($row) ? gettype($row).':'.$row : serialize($row)] = $row;
        }
        ksort($repeats);

        $options = [
            'reference_policy' => $string($raw['reference_policy'] ?? null, ExpenseImportService::REFERENCE_OPTIONAL),
            'default_account_id' => is_scalar($raw['default_account_id'] ?? '') ? strtolower(trim((string) ($raw['default_account_id'] ?? ''))) : $raw['default_account_id'],
            'default_payment_method' => $string($raw['default_payment_method'] ?? null, 'cash'),
            'default_tax_rate' => $integer($raw['default_tax_rate'] ?? 15),
            'confirmed_repeat_rows' => array_values($repeats),
        ];

        return $this->withMapping($options, $raw);
    }

    /**
     * خيارات التنفيذ الفعلية. `confirmed_repeat_rows` أرقام صفوف **الملف الأصلي**؛ ملف الإصلاح يحمل الصفوف الفاشلة وحدها مُعاد ترقيمها من 2، فوراثتها
     * كانت ستُؤكِّد صفاً مختلفاً تماماً وتعطّل فحص التكرار عنه. تشغيلة الإصلاح الفرعية لا ترث تأكيداً: التكرار الحقيقي يُؤكَّد باستيرادٍ جديد بمعاينته.
     *
     * @param  array<string, mixed>  $options
     * @return array<string, mixed>
     */
    public static function effectiveOptions(bool $isRepairChild, array $options): array
    {
        if ($isRepairChild) {
            $options['confirmed_repeat_rows'] = [];
        }

        return $options;
    }

    public function applyChunk(ImportChunk $chunk): ImportChunkResult
    {
        $job = $chunk->job;
        // معرّف التمييز الحتمي للتكرار المؤكَّد يُشتقّ من المهمة نفسها: إعادة نافذةٍ لا تُنتج مصروفاً ثانياً، ومهمةٌ جديدة (إصلاح/إعادة رفع) لا تعيد استعمال معرّفات القديمة.
        $chunkOptions = array_merge(self::effectiveOptions($job->parent_job_id !== null, $chunk->options), [
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

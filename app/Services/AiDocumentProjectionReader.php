<?php

namespace App\Services;

use App\Models\DocumentBatch;
use App\Models\DocumentExtractionResult;
use App\Models\DocumentFile;
use App\Models\DocumentRetentionHold;
use App\Models\Tenant;
use App\Models\User;
use App\Services\DocumentCenter\DocumentRedactionProjector;
use App\Services\DocumentCenter\ReviewedDocumentProjector;
use App\Support\AiAssistantDenied;
use App\Support\ApplicationAccessLevel;
use App\Support\ApplicationOperationClass;
use App\Support\DocumentReviewFieldPresentation;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;
use App\Support\Money;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Throwable;

/**
 * القارئ الآمن لنصّ المستند المُسقَط للمساعد (AI-04) — **قراءة فقط** فوق نموذج القراءة القائم في مركز المستندات.
 *
 * لا مسار استخراج ولا تخزين موازٍ: يعيد استعمال `ReviewedDocumentProjector` (القيم بعد المراجعة البشرية)
 * ثم `DocumentRedactionProjector` (طبقات التنقيح المعتمدة) فوق `DocumentExtractionResult` المشفَّر في قاعدة
 * البيانات. لا يقرأ الملف الأصلي ولا مفتاح الكائن ولا أي رابط تخزين، ولا يستدعي شبكة.
 *
 * يفشل **إغلاقاً** عند أي حالة غير مؤكدة، وبهذا الترتيب (بعد نجاح فحوص النطاق وحدها حتى لا يُكشف وجود
 * مستند خارج نطاق المستخدم): حجر ← انتهاء احتفاظ/حذف/أرشفة ← حجز قانوني ← فحص أمان غير مكتمل ← غير
 * مراجَع ← إسقاط غير متاح. أي مستند خارج المستأجر/الفرع/الصلاحية يعيد الرمز الموحّد `document_unavailable`.
 *
 * المخرج **مصفوفة بيضاء** مغلقة بحدود (`ai_assistant.documents.*`)، تُعامَل كل نصوصه كبيانات غير موثوقة:
 * تُنظَّف من محارف التحكم واتجاه النص المخفي وتُقصّ، ولا تُفسَّر أبداً (لا Markdown ولا روابط).
 */
class AiDocumentProjectionReader
{
    /** حقول الرأس المسموحة بالترتيب. الأرقام الضريبية للأطراف مستبعدة عمداً (أقل ما يلزم). */
    private const HEADER_FIELDS = [
        'document_number' => 'text', 'document_date' => 'text', 'issuer_name' => 'text', 'recipient_name' => 'text',
        'currency' => 'text', 'external_reference' => 'text', 'purchase_order_number' => 'text',
        'price_includes_tax' => 'flag', 'subtotal_minor' => 'money', 'discount_minor' => 'money',
        'tax_amount_minor' => 'money', 'total_amount_minor' => 'money',
    ];

    /** حقول السطر المسموحة بالترتيب (بلا الباركود). */
    private const LINE_FIELDS = [
        'description' => 'text', 'sku' => 'text', 'unit' => 'text', 'quantity' => 'text',
        'unit_price_minor' => 'money', 'discount_minor' => 'money', 'tax_amount_minor' => 'money', 'total_minor' => 'money',
    ];

    /** حالات سير العمل التي اكتملت فيها المراجعة البشرية فعلاً (`DocumentReviewReadinessPolicy::completionTargetStatus`). */
    private const REVIEWED_STATUSES = [
        DocumentWorkflowStatus::REVIEWED,
        DocumentWorkflowStatus::READY_FOR_DRAFT,
        DocumentWorkflowStatus::CREATING_DRAFT,
        DocumentWorkflowStatus::DRAFT_CREATED,
    ];

    public function __construct(
        private readonly TenantContext $tenantContext,
        private readonly BranchContext $branchContext,
        private readonly ApplicationAccessDecision $access,
        private readonly ReviewedDocumentProjector $reviewed,
        private readonly DocumentRedactionProjector $redactions,
    ) {}

    /**
     * @param  array{mode:string, ids:list<string>}  $branchScope
     * @return array<string,mixed>
     * @throws AiAssistantDenied
     */
    public function read(User $actor, string $batchId, array $branchScope): array
    {
        $tenantId = $this->tenantContext->id();
        $tenant = $tenantId === null ? null : Tenant::query()->find($tenantId);
        if ($tenant === null || $actor->tenant_id !== $tenantId) {
            throw AiAssistantDenied::for('document_unavailable');
        }

        // القدرة التجارية لمركز المستندات (قراءة) كما تفعل مسارات المركز نفسها — لا يتجاوزها المساعد.
        $decision = $this->access->decide($tenant, 'document_center.core', ApplicationOperationClass::READ, $actor->hasPermission('documents.center.view'));
        if ($decision->level === ApplicationAccessLevel::DENIED) {
            throw AiAssistantDenied::for('tool_permission_denied');
        }

        // مقيَّد بالمستأجر والفرع النشط تلقائياً (TenantScope + BranchScope): مستند مستأجر آخر أو فرع آخر لا يُحلّ.
        $batch = DocumentBatch::query()->whereKey($batchId)->first();
        if ($batch === null
            || $batch->branch_id === null
            || $batch->branch_id !== $this->branchContext->id()
            || ! $actor->canAccessBranch($batch->branch_id)
            || ($branchScope['mode'] !== 'all' && ! in_array($batch->branch_id, $branchScope['ids'], true))) {
            throw AiAssistantDenied::for('document_unavailable');
        }

        $files = DocumentFile::query()->where('document_batch_id', $batch->id)->get();
        $this->assertDisclosable($batch, $files->all());

        $result = DocumentExtractionResult::query()->where('document_batch_id', $batch->id)->latest('extracted_at')->first();
        if ($result === null || ! $files->contains(fn (DocumentFile $file): bool => $file->id === $result->document_file_id)) {
            throw AiAssistantDenied::for('document_projection_unavailable');
        }

        try {
            $projection = $this->redactions->apply($result, $this->reviewed->project($result));
        } catch (Throwable) {
            // مرجع مراجعة لم يعد يطابق الدليل (إسقاط قديم) أو فشل فكّ التشفير: لا يُكشف شيء ولا يُسجَّل المحتوى.
            throw AiAssistantDenied::for('document_projection_unavailable');
        }

        return $this->shape($batch, $result, $projection, $files->all());
    }

    /**
     * @param  list<DocumentFile>  $files
     * @throws AiAssistantDenied
     */
    private function assertDisclosable(DocumentBatch $batch, array $files): void
    {
        if ($files === []) {
            throw AiAssistantDenied::for('document_projection_unavailable');
        }

        if ($batch->status === DocumentWorkflowStatus::QUARANTINED
            || collect($files)->contains(fn (DocumentFile $file): bool => $file->scan_status === DocumentScanStatus::INFECTED)) {
            throw AiAssistantDenied::for('document_quarantined');
        }

        $now = CarbonImmutable::now('UTC');
        if ($batch->status === DocumentWorkflowStatus::ARCHIVED
            || collect($files)->contains(fn (DocumentFile $file): bool => $file->purged_at !== null
                || $file->purge_pending_at !== null
                || ($file->retention_until !== null && $file->retention_until->lessThanOrEqualTo($now)))) {
            throw AiAssistantDenied::for('document_retention_ended');
        }

        // الحجز القانوني/التشغيلي النشط: الإفصاح للمساعد محجوب احتياطاً (قرار AI-04 المحافظ) حتى يُفرَج عنه.
        $fileIds = array_map(static fn (DocumentFile $file): string => $file->id, $files);
        $held = DocumentRetentionHold::query()->active()
            ->where(fn ($query) => $query->where('document_batch_id', $batch->id)->orWhereIn('document_file_id', $fileIds))
            ->exists();
        if ($held) {
            throw AiAssistantDenied::for('document_on_hold');
        }

        if (collect($files)->contains(fn (DocumentFile $file): bool => $file->scan_status !== DocumentScanStatus::CLEAN)) {
            throw AiAssistantDenied::for('document_scan_incomplete');
        }

        if (! in_array($batch->status, self::REVIEWED_STATUSES, true)) {
            throw AiAssistantDenied::for('document_not_reviewed');
        }
    }

    /**
     * @param  array<string,mixed>  $projection
     * @param  list<DocumentFile>  $files
     * @return array<string,mixed>
     */
    private function shape(DocumentBatch $batch, DocumentExtractionResult $result, array $projection, array $files): array
    {
        $maxFields = (int) config('ai_assistant.documents.max_fields', 24);
        $maxLines = (int) config('ai_assistant.documents.max_lines', 50);
        $maxWarnings = (int) config('ai_assistant.documents.max_warnings', 10);

        $rawFields = is_array($projection['fields'] ?? null) ? $projection['fields'] : [];
        $visibleHeader = DocumentReviewFieldPresentation::visibleHeaderFields((string) $batch->document_type);
        $redactions = 0;

        $fields = [];
        foreach (self::HEADER_FIELDS as $key => $type) {
            if ($visibleHeader !== null && ! in_array($key, $visibleHeader, true)) {
                continue;
            }
            if (! array_key_exists($key, $rawFields)) {
                continue;
            }
            $entry = $this->entry($key, $type, $rawFields[$key], $redactions);
            if ($entry !== null) {
                $fields[] = $entry;
            }
        }
        $fieldsTruncated = count($fields) > $maxFields;
        $fields = array_slice($fields, 0, $maxFields);

        $rawLines = is_array($projection['lines'] ?? null) ? array_values($projection['lines']) : [];
        $visibleLines = DocumentReviewFieldPresentation::visibleLineFields((string) $batch->document_type);
        $lines = [];
        foreach (array_slice($rawLines, 0, $maxLines) as $index => $line) {
            if (! is_array($line)) {
                continue;
            }
            $entries = [];
            foreach (self::LINE_FIELDS as $key => $type) {
                if ($visibleLines !== null && ! in_array($key, $visibleLines, true)) {
                    continue;
                }
                $entry = $this->entry($key, $type, $line[$key] ?? null, $redactions);
                if ($entry !== null) {
                    $entries[] = $entry;
                }
            }
            if ($entries !== []) {
                $lines[] = ['index' => $index, 'fields' => $entries];
            }
        }
        $linesTruncated = count($rawLines) > $maxLines;

        $rawWarnings = is_array($projection['warnings'] ?? null) ? $projection['warnings'] : [];
        $warnings = [];
        foreach ($rawWarnings as $warning) {
            $text = $this->text($warning);
            if ($text !== null) {
                $warnings[] = $text;
            }
        }
        $warningsTruncated = count($warnings) > $maxWarnings;
        $warnings = array_slice($warnings, 0, $maxWarnings);

        $tenantTimezone = (string) (Tenant::query()->whereKey($batch->tenant_id)->value('timezone') ?: 'Asia/Riyadh');

        return [
            'report' => 'document_projection',
            'schema_version' => 1,
            'document' => [
                'ref' => $batch->id,
                'document_type' => (string) $batch->document_type,
                'status' => $batch->status->value,
                'language' => $this->text($result->detected_language, 16),
                'extracted_at' => $result->extracted_at?->toIso8601String(),
                'page_count' => array_sum(array_map(static fn (DocumentFile $file): int => (int) $file->page_count, $files)),
            ],
            // أساس القيم وحدودها: لا شيء منها من توليد المساعد، وكلها بيانات غير موثوقة من وثيقة.
            'basis' => [
                'values' => 'human_reviewed_values',
                'redaction' => 'document_center_overlays_applied',
                'content_trust' => 'untrusted_document_data',
                'generated_by_model' => false,
                'redacted_values' => $redactions,
            ],
            'fields' => $fields,
            'lines' => $lines,
            'warnings' => $warnings,
            'truncated' => ['fields' => $fieldsTruncated, 'lines' => $linesTruncated, 'warnings' => $warningsTruncated],
            'timezone' => $tenantTimezone,
            'generated_at' => CarbonImmutable::now('UTC')->toIso8601String(),
            'sources' => [[
                'type' => 'document',
                'service' => 'DocumentCenter',
                'ui_path' => '/documents/' . $batch->id,
            ]],
        ];
    }

    /** @return array<string,mixed>|null */
    private function entry(string $key, string $type, mixed $value, int &$redactions): ?array
    {
        if ($value === DocumentRedactionProjector::MARKER) {
            $redactions++;

            return ['key' => $key, 'type' => $type, 'value' => null, 'redacted' => true];
        }
        if ($value === null) {
            return null;
        }

        return match ($type) {
            'money' => is_int($value)
                ? ['key' => $key, 'type' => 'money', 'value' => $value, 'decimal' => Money::toRiyal($value), 'redacted' => false]
                : null,
            'flag' => is_bool($value) ? ['key' => $key, 'type' => 'flag', 'value' => $value, 'redacted' => false] : null,
            default => ($text = $this->text($value)) === null ? null : ['key' => $key, 'type' => 'text', 'value' => $text, 'redacted' => false],
        };
    }

    /**
     * نصّ المستند بيانات غير موثوقة: يُنظَّف من محارف التحكم وعلامات الاتجاه/العرض الصفري (التي تخفي نصاً أو
     * تعكس عرضه) ويُقصّ. لا يُحلَّل ولا يُنفَّذ ولا يُحوَّل إلى رابط.
     */
    private function text(mixed $value, ?int $max = null): ?string
    {
        if (is_int($value)) {
            $value = (string) $value;
        }
        if (! is_string($value)) {
            return null;
        }
        $max ??= (int) config('ai_assistant.documents.max_text_chars', 200);
        $clean = preg_replace('/[\p{Cc}\x{200B}-\x{200F}\x{202A}-\x{202E}\x{2060}-\x{2069}\x{FEFF}]+/u', ' ', $value) ?? '';
        $clean = trim(preg_replace('/\s{2,}/u', ' ', $clean) ?? '');

        return $clean === '' ? null : mb_substr($clean, 0, $max);
    }
}

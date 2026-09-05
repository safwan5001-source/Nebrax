<?php

namespace App\Services\DocumentCenter;

use App\Models\DocumentBatch;
use App\Models\DocumentFile;
use App\Models\DocumentProcessingRun;
use App\Support\DocumentProcessingStatus;
use App\Support\DocumentScanStatus;
use App\Support\DocumentWorkflowStatus;

final class DocumentProcessingStatusProjector
{
    /** @param iterable<DocumentProcessingRun> $runs
     * @return array{key:string,tone:string,retry_available:bool,message:string}
     */
    public function project(DocumentBatch $batch, ?DocumentFile $file, iterable $runs, bool $extractionEnabled): array
    {
        if ($file?->purged_at !== null || $batch->status === DocumentWorkflowStatus::ARCHIVED) {
            return $this->state('archived_or_purged', 'neutral', false, 'تمت أرشفة المستند أو حذف محتواه وفق سياسة الاحتفاظ.');
        }
        if ($batch->status === DocumentWorkflowStatus::QUARANTINED || $file?->scan_status === DocumentScanStatus::INFECTED) {
            return $this->state('quarantined', 'danger', false, 'المستند في الحجر الأمني ويتطلب إجراءً إدارياً.');
        }
        if ($batch->status === DocumentWorkflowStatus::RECEIVING) {
            return $this->state('received', 'neutral', false, 'تم استلام المستند.');
        }
        // فحص الأمان PENDING هو العنوان فقط بينما المستند لا يزال قيد الاستقبال أو
        // الطابور أو المعالجة. بعد ذلك — مراجعة/جاهزية/مسودة/فشل — يفوز تقدّم
        // الحزمة الفعلي: ملفٌ استُقبل عبر استثناء فحص يبقى PENDING إلى الأبد
        // بالتصميم، فلا يجوز أن يُخفي نجاح الاستخراج والمراجعة خلف رسالة "لا يزال
        // ينتظر الفحص" الخاطئة. حالة الملف الأمنية (PENDING/CLEAN) تبقى منفصلة
        // تماماً وتُبلَّغ بمسارها الخاص (انظر DocumentReviewController).
        if ($file?->scan_status === DocumentScanStatus::PENDING
            && in_array($batch->status, [DocumentWorkflowStatus::RECEIVED, DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::PROCESSING], true)) {
            return $this->state('safety_check_pending', 'warning', false, 'فحص السلامة بانتظار المعالجة.');
        }
        if ($batch->status === DocumentWorkflowStatus::RECEIVED && ! $extractionEnabled) {
            return $this->state('extraction_unavailable', 'warning', false, 'استخراج البيانات غير مفعّل حالياً.');
        }
        if (in_array($batch->status, [DocumentWorkflowStatus::QUEUED, DocumentWorkflowStatus::PROCESSING], true)) {
            return $this->state('processing', 'info', false, 'المستند قيد المعالجة.');
        }
        if ($batch->status === DocumentWorkflowStatus::NEEDS_REVIEW) {
            return $this->state('needs_review', 'warning', false, 'المستند جاهز للمراجعة البشرية.');
        }
        if ($batch->status === DocumentWorkflowStatus::REVIEWED) {
            return $this->state('reviewed', 'success', false, 'تمت مراجعة المستند بنجاح.');
        }
        if ($batch->status === DocumentWorkflowStatus::READY_FOR_DRAFT) {
            return $this->state('ready_for_draft', 'success', false, 'المستند جاهز لإنشاء مسودة.');
        }
        if ($batch->status === DocumentWorkflowStatus::DRAFT_CREATED) {
            return $this->state('draft_created', 'success', false, 'تم إنشاء المسودة المرتبطة بالمستند.');
        }
        if ($batch->status === DocumentWorkflowStatus::FAILED) {
            $retry = collect($runs)->contains(fn (DocumentProcessingRun $run) => $run->status === DocumentProcessingStatus::FAILED
                && in_array($run->stage, [DocumentProcessingService::STAGE_SAFETY_SCAN, DocumentExtractionService::STAGE_EXTRACTION], true));

            return $retry
                ? $this->state('failed_retry_available', 'danger', true, 'فشلت المعالجة؛ قد تتاح إعادة المحاولة وفق إعدادات المنصة.')
                : $this->state('failed_action_required', 'danger', false, 'فشلت المعالجة وتتطلب إجراءً إدارياً.');
        }

        return $this->state('waiting_for_processing', 'neutral', false, 'المستند بانتظار المعالجة.');
    }

    /** @return array{key:string,tone:string,retry_available:bool,message:string} */
    private function state(string $key, string $tone, bool $retry, string $message): array
    {
        return ['key' => $key, 'tone' => $tone, 'retry_available' => $retry, 'message' => $message];
    }
}

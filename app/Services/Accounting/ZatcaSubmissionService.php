<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\ZatcaSubmissionAttempt;
use Illuminate\Support\Facades\DB;
use RuntimeException;

class ZatcaSubmissionService
{
    /**
     * يسجل طلب إرسال يدوي دون أي اتصال شبكي. تكرار مفتاح Idempotency يعيد
     * السجل نفسه، ومحاولة جديدة أثناء pending لا تنشئ إرسالاً موازياً.
     *
     * @return array{attempt: ZatcaSubmissionAttempt, created: bool}
     */
    public function requestManual(Invoice $invoice, string $idempotencyKey, ?string $requestedBy): array
    {
        $key = trim($idempotencyKey);
        if ($key === '' || mb_strlen($key) > 128) {
            throw new RuntimeException('مفتاح Idempotency مطلوب وبحد أقصى 128 حرفاً.');
        }

        return DB::transaction(function () use ($invoice, $key, $requestedBy): array {
            $locked = Invoice::whereKey($invoice->id)->lockForUpdate()->firstOrFail();

            if ($locked->status !== 'posted' || ! is_string($locked->zatca_xml) || $locked->zatca_xml === '') {
                throw new RuntimeException('لا يمكن إرسال الفاتورة قبل ترحيلها وتوليد مستند ZATCA.');
            }

            $submissionType = match ($locked->zatca_document_type) {
                'standard' => 'clearance',
                'simplified' => 'reporting',
                default => throw new RuntimeException('نوع مستند ZATCA غير مثبت على الفاتورة.'),
            };

            $keyHash = hash('sha256', $key);
            $sameRequest = ZatcaSubmissionAttempt::where('idempotency_key_hash', $keyHash)->first();
            if ($sameRequest) {
                if ($sameRequest->invoice_id !== $locked->id) {
                    abort(409, 'مفتاح Idempotency مستخدم لطلب آخر.');
                }

                return ['attempt' => $sameRequest, 'created' => false];
            }

            $latest = ZatcaSubmissionAttempt::where('invoice_id', $locked->id)
                ->orderByDesc('attempt_number')
                ->first();

            if ($latest?->status === 'accepted') {
                abort(409, 'الفاتورة مقبولة لدى ZATCA ولا تحتاج إعادة إرسال.');
            }

            if ($latest?->status === 'pending') {
                abort(409, 'توجد محاولة إرسال معلقة لهذه الفاتورة.');
            }

            $attempt = ZatcaSubmissionAttempt::create([
                'branch_id' => $locked->branch_id,
                'invoice_id' => $locked->id,
                'attempt_number' => ($latest?->attempt_number ?? 0) + 1,
                'submission_type' => $submissionType,
                'source' => 'manual',
                'status' => 'pending',
                'idempotency_key_hash' => $keyHash,
                'request_hash' => hash('sha256', $locked->zatca_xml),
                'requested_by' => $requestedBy,
                'requested_at' => now(),
            ]);

            return ['attempt' => $attempt, 'created' => true];
        });
    }

    /**
     * نقطة الانتقال الوحيدة التي سيستخدمها عميل ZATCA/الـJob لاحقاً.
     * لا يُسمح بتغيير نتيجة نهائية أو هوية محاولة سبق تسجيلها.
     */
    public function complete(
        ZatcaSubmissionAttempt $attempt,
        string $status,
        ?int $httpStatus = null,
        ?string $responseCode = null,
        ?string $responseMessage = null,
        ?array $responsePayload = null,
    ): ZatcaSubmissionAttempt {
        if (! in_array($status, ['accepted', 'rejected', 'failed'], true)) {
            throw new RuntimeException('حالة نتيجة ZATCA غير صالحة.');
        }

        return DB::transaction(function () use (
            $attempt,
            $status,
            $httpStatus,
            $responseCode,
            $responseMessage,
            $responsePayload,
        ): ZatcaSubmissionAttempt {
            $locked = ZatcaSubmissionAttempt::whereKey($attempt->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== 'pending') {
                throw new RuntimeException('لا يمكن تغيير محاولة ZATCA منتهية.');
            }

            $locked->update([
                'status' => $status,
                'completed_at' => now(),
                'response_http_status' => $httpStatus,
                'response_code' => $responseCode === null ? null : mb_substr($responseCode, 0, 120),
                'response_message' => $responseMessage === null
                    ? null
                    : mb_substr(trim(strip_tags($responseMessage)), 0, 2000),
                // يجب أن تمرر طبقة الاتصال لاحقاً حمولة منقحة بلا أسرار أو شهادات.
                'response_payload' => $responsePayload,
            ]);

            return $locked->refresh();
        });
    }
}

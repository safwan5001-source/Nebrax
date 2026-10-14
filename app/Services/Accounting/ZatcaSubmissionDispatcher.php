<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\ZatcaSubmissionAttempt;
use DOMDocument;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use PDOException;
use RuntimeException;
use Throwable;

/** يستهلك محاولة واحدة تحت قفل دائم ثم يثبت النتيجة في نفس المعاملة. */
final class ZatcaSubmissionDispatcher
{
    public function __construct(
        private readonly ZatcaTransportCredentialResolver $credentials,
        private readonly ZatcaHttpTransport $transport,
        private readonly ZatcaSubmissionService $submissions,
    ) {}

    public function dispatch(ZatcaSubmissionAttempt $attempt): ZatcaSubmissionAttempt
    {
        return DB::transaction(function () use ($attempt): ZatcaSubmissionAttempt {
            $locked = ZatcaSubmissionAttempt::query()->whereKey($attempt->id)->lockForUpdate()->firstOrFail();
            if ($locked->status !== 'pending') {
                return $locked;
            }

            // TAX-N01: المرحلة الجارية تُسجَّل لتصنيف السبب عند الفشل — لا تغيّر مسار التنفيذ.
            $stage = 'load';

            try {
                $invoice = Invoice::query()->whereKey($locked->invoice_id)->firstOrFail();
                $stage = 'snapshot';
                $this->assertSnapshot($locked, $invoice);
                $stage = 'credentials';
                $credential = $this->credentials->resolve();
                $stage = 'transport';
                $result = $this->transport->submit(
                    $credential,
                    $locked->submission_type,
                    (string) $invoice->zatca_hash,
                    (string) $invoice->zatca_xml,
                );

                $stage = 'completion';
                if ($result->status === 'accepted' && $locked->submission_type === 'clearance') {
                    $clearedXml = $this->clearedXml($result->clearedInvoice);
                    if ($clearedXml === null) {
                        $result = new ZatcaTransportResult(
                            'failed',
                            $result->httpStatus,
                            'invalid_clearance_response',
                            'استجابة Clearance المقبولة لم تتضمن XML صالحاً.',
                            $result->auditPayload,
                            true,
                        );
                    } else {
                        $invoice->update(['zatca_cleared_xml' => $clearedXml]);
                    }
                }

                return $this->submissions->complete(
                    $locked,
                    $result->status,
                    $result->httpStatus,
                    $result->responseCode,
                    $result->message,
                    [...$result->auditPayload, 'retryable' => $result->retryable],
                );
            } catch (Throwable $e) {
                // السبب يُسجَّل **قبل** التثبيت: على PostgreSQL قد تكون المعاملة المحيطة
                // مجهَضة بعد خطأ SQL فيفشل `complete()` أدناه (25P02) ويضيع السبب الأصلي.
                $this->logFailure($locked, $e, $this->classifyFailure($e, $stage));

                return $this->submissions->complete(
                    $locked,
                    'failed',
                    null,
                    'submission_preflight_failed',
                    'تعذر تجهيز محاولة ZATCA وفق الإعدادات أو اللقطة المسجلة.',
                    ['retryable' => false],
                );
            }
        }, 1);
    }

    /**
     * رمز سبب تشخيصي ثابت ومحدود (TAX-N01). لا يُشتق من نص الاستثناء ولا يحمل بيانات؛
     * يُستنتج من **صنف** الاستثناء ثم من مرحلة التنفيذ التي أُلقي فيها. وهو منفصل عمداً عن
     * `response_code` المحفوظ (`submission_preflight_failed`) الذي لا يتغيّر.
     */
    private function classifyFailure(Throwable $e, string $stage): string
    {
        if ($e instanceof PDOException) { // يشمل QueryException وفروعها
            return 'database_error';
        }
        if ($e instanceof DecryptException) {
            return 'credential_unreadable';
        }

        return match ($stage) {
            'load', 'snapshot' => 'snapshot_mismatch',
            'credentials' => 'credential_unusable',
            'transport' => 'transport_error',
            default => 'preflight_error',
        };
    }

    /**
     * سطر سجل مهيكل واحد لكل فشل: المعرّفات وصنف الاستثناء والسبب فقط. لا رسالة استثناء
     * ولا تتبّع مكدّس (قد يحملان SQL بقيمه أو مسارات) ولا XML ولا اعتماد ولا ردّ. وفشل
     * التسجيل نفسه لا يغيّر مسار الحالة.
     */
    private function logFailure(ZatcaSubmissionAttempt $attempt, Throwable $e, string $causeCode): void
    {
        try {
            Log::error('zatca_submission_dispatch_failed', [
                'attempt_id' => $attempt->id,
                'tenant_id' => $attempt->tenant_id,
                'exception_class' => $e::class,
                'cause_code' => $causeCode,
            ]);
        } catch (Throwable) {
            // التشخيص لا يُفشل الإرسال.
        }
    }

    private function assertSnapshot(ZatcaSubmissionAttempt $attempt, Invoice $invoice): void
    {
        if ($invoice->status !== 'posted'
            || ! is_string($invoice->zatca_xml)
            || $invoice->zatca_xml === ''
            || ! is_string($invoice->zatca_hash)
            || $invoice->zatca_hash === '') {
            throw new RuntimeException('لقطة فاتورة ZATCA غير مكتملة.');
        }
        if (! hash_equals($attempt->request_hash, hash('sha256', $invoice->zatca_xml))) {
            throw new RuntimeException('تغير XML بعد تسجيل محاولة الإرسال.');
        }

        $expectedType = match ($invoice->zatca_document_type) {
            'standard' => 'clearance',
            'simplified' => 'reporting',
            default => null,
        };
        if ($attempt->submission_type !== $expectedType) {
            throw new RuntimeException('نوع محاولة ZATCA لا يطابق لقطة الفاتورة.');
        }
    }

    private function clearedXml(?string $encoded): ?string
    {
        if ($encoded === null || strlen($encoded) > 14_000_000) {
            return null;
        }
        $xml = base64_decode($encoded, true);
        if ($xml === false || $xml === '' || strlen($xml) > 10_000_000) {
            return null;
        }

        $document = new DOMDocument();
        $previous = libxml_use_internal_errors(true);
        try {
            $loaded = $document->loadXML($xml, LIBXML_NONET | LIBXML_NOBLANKS | LIBXML_NOCDATA);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }

        return $loaded && $document->documentElement?->localName === 'Invoice' ? $xml : null;
    }
}

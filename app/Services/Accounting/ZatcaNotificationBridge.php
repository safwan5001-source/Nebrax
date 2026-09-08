<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\User;
use App\Models\ZatcaSubmissionAttempt;
use App\Services\NotificationService;
use App\Tenancy\TenantContext;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * ═══════════════════════════════════════════════════════════════
 *  جسر إشعارات ZATCA (PR-NOTIF-4) — ملاحظة فقط بعد الترحيل الفعلي
 * ═══════════════════════════════════════════════════════════════
 *  لا يعدّل `ZatcaSubmissionService`/`ZatcaSubmissionDispatcher` ولا منطق
 *  الإرسال أو إعادة المحاولة أو التوقيع أو بيانات الاعتماد إطلاقاً. يُستدعى
 *  من `ZatcaSubmissionService::complete()` بعد أن تُحفظ النتيجة النهائية
 *  فعلياً، ويُؤجَّل عبر `DB::afterCommit()` — معاملة قد تتراجع لا تُنشئ
 *  إشعاراً أبداً (نفس اصطلاح `InventoryAlertService::queueEvaluation`).
 *
 *  **لا حاجة لدورة/عدّاد تكرار هنا:** كل محاولة إرسال صفٌّ دائمٌ لا يُحذف ولا
 *  يتغيّر بعد انتقاله النهائي الوحيد (`ZatcaSubmissionAttempt::booted()`)،
 *  فمعرّف المحاولة وحده هوية تفرّد كافية ودائمة — إعادة إرسال فاشلة تُنشئ
 *  صفّاً جديداً بمعرّف جديد، لا تُعيد استخدام صفّها القديم.
 *
 *  **النجاح لا يُنبّه أبداً:** يُستدعى هذا الجسر فقط حين تكون الحالة النهائية
 *  `rejected` أو `failed` — استبعاد `accepted` صريح في نقطة الاستدعاء.
 */
class ZatcaNotificationBridge
{
    /** يؤجَّل التقييم إلى ما بعد نجاح المعاملة المحيطة (قد تكون معاملة `complete()` نفسها متداخلة داخل معاملة الإرسال الأكبر). */
    public function queueEvaluation(string $attemptId): void
    {
        $tenantId = app(TenantContext::class)->id();
        if ($tenantId === null) {
            return;
        }

        DB::afterCommit(function () use ($tenantId, $attemptId) {
            try {
                $this->notify($tenantId, $attemptId);
            } catch (Throwable $e) {
                // فشل الإشعار لا يمسّ نتيجة إرسال ZATCA المحفوظة فعلياً بأي حال.
                Log::error('zatca_submission_notification_failed', [
                    'tenant_id' => $tenantId,
                    'attempt_id' => $attemptId,
                    'message' => $e->getMessage(),
                ]);
            }
        });
    }

    private function notify(string $tenantId, string $attemptId): void
    {
        $attempt = ZatcaSubmissionAttempt::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->whereKey($attemptId)
            ->first();

        if (! $attempt || ! in_array($attempt->status, ['rejected', 'failed'], true)) {
            return;
        }

        $invoice = Invoice::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->find($attempt->invoice_id);

        if (! $invoice) {
            return;
        }

        $isClearance = $attempt->submission_type === 'clearance';
        $title = $isClearance
            ? "فشل اعتماد الفاتورة لدى ZATCA: {$invoice->number}"
            : "فشل إبلاغ الفاتورة لدى ZATCA: {$invoice->number}";
        $message = $attempt->status === 'rejected'
            ? 'رفضت منصة ZATCA هذه الفاتورة. راجع حالة الإرسال واتخذ الإجراء اللازم.'
            : 'تعذّر إرسال هذه الفاتورة إلى منصة ZATCA. راجع حالة الإرسال وأعد المحاولة عند الإمكان.';
        // response_code فقط: سلسلة تصنيف قصيرة مُقصّاة (≤120 حرفاً)، لا
        // response_message ولا response_payload — قد تحملان نصاً أطول من
        // استجابة خارجية لم تُراجَع لهذا الغرض تحديداً.
        if ($attempt->response_code) {
            $message .= " (الكود: {$attempt->response_code})";
        }

        $notifications = app(NotificationService::class);

        foreach ($this->resolveRecipients($tenantId, $attempt) as $recipient) {
            $notifications->deliver([
                'tenant_id' => $tenantId,
                'recipient_id' => $recipient->id,
                'category' => 'alert',
                'type' => "zatca.submission_{$attempt->status}",
                'severity' => 'critical',
                'title' => $title,
                'message' => $message,
                'source_type' => 'invoice',
                'source_id' => $invoice->id,
                'action' => 'view_zatca_submission',
                'data' => ['submission_type' => $attempt->submission_type],
                // معرّف المحاولة الدائم وحده كافٍ للتفرّد — لا دورة/عدّاد هنا.
                'dedupe_key' => "zatca.submission_{$attempt->status}:{$attempt->id}",
            ]);
        }
    }

    /**
     * مستلمون محافظون: من يملك `invoices.manage` فعلياً (نفس صلاحية إنشاء/إعادة
     * إرسال محاولة ZATCA على هذه الفاتورة بالذات)، مع احترام رؤية فرع المحاولة
     * (عمود مباشر على `zatca_submission_attempts`) — بلا فرع = مرئية للجميع.
     *
     * @return Collection<int, User>
     */
    private function resolveRecipients(string $tenantId, ZatcaSubmissionAttempt $attempt): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission('invoices.manage')
                && ($attempt->branch_id === null || $user->canAccessBranch($attempt->branch_id)))
            ->values();
    }
}

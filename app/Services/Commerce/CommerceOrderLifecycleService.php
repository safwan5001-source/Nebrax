<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderPosting;
use App\Models\CommercePaymentIntent;
use App\Models\PaymentAttempt;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * COMMERCE-ORDERS-O3a-2b — إلغاء طلب متجر بواسطة موظف مخوّل (ADR-28 §3–§4). **تنسّق الخدمات القائمة ولا تكرّرها**:
 * `CommercePaymentIntentService::cancelWithinTransaction` (انتقال النية فقط) و`CommerceOrderReservationService::releaseActive` (الحجز). لا تستدعي
 * أي خدمة محاسبية أو مخزنية: الإلغاء لا يكتب قيداً ولا فاتورة ولا إشعاراً دائناً ولا حركة مخزون (عقد Commerce #6، يحرسه اختبار ساكن).
 *
 * **المعاملة (قاعدة بيانات فقط — لا شبكة ولا قفل محاولة، ADR-28 P-2):** قفل النية ← قفل الطلب ← صفوف الحجز (يطابق الاتجاه القائم ولا يعكس أي مسار:
 * الترحيل/الالتقاط يأخذان المحاولة ← النية ← الطلب). تُقرأ المحاولات SELECT عادياً للفحص فقط ولا تُقفل. الفحوص بعد الأقفال بالترتيب:
 * مِرساة الترحيل ← `paid` ← `collected` ← `captured` ← `authorized`. ثم إلغاء النية + تحرير الحجز + كتابة حقائق الإلغاء — كلها ذرّية؛ أي فشل يتراجع كله.
 *
 * **بعد الالتزام النهائي فقط** (`DB::afterCommit` — يُهمَل عند التراجع ويؤجَّل لو عُشِّش الاستدعاء): تنظيف محاولات الدفع لدى المزوّد عبر
 * `OrderCancellationCleanup` (O3a-2a) — لا يرمي أبداً ويعيد المطابِق المجدول ما فشل. التقاط يصل لاحقاً على صفحة بقيت حيّة ⇒ `late_capture` (D-15)،
 * والطلب لا يعود (لا un-cancel) ولا يصير «ملغى ∧ مدفوعاً».
 *
 * **idempotent بالحالة:** طلب ملغى أصلاً ⇒ يُعاد كما هو بلا أي أثر ولا تغيير للسبب/الفاعل/الوقت الأصلية. لا تستعمل مسار إلغاء النية العام ذا التنظيف المدمج أبداً (P-6) — الانتقال الداخلي فقط.
 */
final class CommerceOrderLifecycleService
{
    public function __construct(
        private readonly CommercePaymentIntentService $intents,
        private readonly CommerceOnlinePaymentService $online,
        private readonly CommerceOrderReservationService $reservations,
        private readonly OrderCancellationCleanup $cleanup,
    ) {}

    /**
     * @throws CommerceOrderCancellationException رفض عمل برمز `reason`
     */
    public function cancel(CommerceOrder $order, User $actor, string $reason, ?string $note): CommerceOrder
    {
        $note = $note === null ? null : trim($note);
        $note = $note === '' ? null : $note;
        if (! in_array($reason, CommerceOrder::CANCELLATION_REASONS, true)) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::INVALID_REASON, 'سبب الإلغاء غير معتمد.', 422);
        }
        if ($reason === 'other' && $note === null) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::NOTE_REQUIRED, 'الملاحظة مطلوبة عند اختيار سبب «أخرى».', 422);
        }

        $cleanupIntent = null;

        $cancelled = DB::transaction(function () use ($order, $actor, $reason, $note, &$cleanupIntent): CommerceOrder {
            // 1) النية أولاً (المحور الذي يسلسل الالتقاط/الإلغاء/الترحيل) — نطاق المستأجر مطبَّق على الاستعلامين.
            $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            // 2) ثم الطلب.
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            // idempotent: لا أثر ولا تنظيف جديد ولا تغيير لحقائق الإلغاء الأصلية.
            if ($locked->isCancelled()) {
                return $locked;
            }
            if (! $locked->isConfirmed()) {
                throw new CommerceOrderCancellationException(CommerceOrderCancellationException::NOT_CONFIRMED, 'لا يمكن إلغاء طلب غير مؤكَّد.', 422);
            }

            $this->assertCancellable($locked, $intent);

            if ($intent !== null && ! $intent->isCancelled()) {
                // انتقال الحالة فقط (P-1). التقاط محاولة لا يأخذ قفل النية (يكتب صفّ المحاولة أولاً)، فقد يظهر بين فحصنا وفحص الانتقال
                // الداخلي (نفسه تحت القفل): يُحوَّل الرفض إلى رمز المصفوفة الصحيح (409) بدل خطأ عام، ويتراجع كل شيء.
                try {
                    $intent = $this->intents->cancelWithinTransaction($intent);
                } catch (CommerceOrderCancellationException $e) {
                    throw $e;
                } catch (RuntimeException $e) {
                    $this->assertCancellable($locked, $intent->fresh() ?? $intent);
                    throw new CommerceOrderCancellationException(CommerceOrderCancellationException::PAYMENT_CAPTURED, $e->getMessage());
                }
                $cleanupIntent = $intent->isOnline() ? $intent : null;
            }

            // 3) ثم صفوف الحجز (قاعدة بيانات فقط، idempotent: لا حجز نشط ⇒ لا شيء، فلا تحرير مزدوج).
            $this->reservations->releaseActive((string) $locked->id);

            // حقائق الإلغاء ليست في $fillable عمداً؛ تكتبها هذه الخدمة وحدها وتحرسها مُشغّلات القاعدة (سبب معتمد/جمود/لا مسودة).
            $locked->forceFill([
                'cancelled_at' => now('UTC'),
                'cancelled_by_user_id' => $actor->id,
                'cancellation_reason' => $reason,
                'cancellation_note' => $note,
            ])->save();

            return $locked->fresh();
        });

        if ($cleanupIntent !== null) {
            // بعد الالتزام النهائي للمعاملة الخارجية فقط (لا اتصال بالمزوّد تحت أقفال)؛ لا يرمي، والمطابِق يعيد ما فشل.
            DB::afterCommit(fn () => $this->cleanup->run($cleanupIntent));
        }

        return $cancelled;
    }

    /** مصفوفة ADR-28 §3 (الصفوف 2 و5–8). تُستدعى تحت قفل النية والطلب. */
    private function assertCancellable(CommerceOrder $order, ?CommercePaymentIntent $intent): void
    {
        if (CommerceOrderPosting::query()->where('commerce_order_id', $order->id)->exists()) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::ALREADY_POSTED, 'رُحِّل هذا الطلب محاسبياً؛ يُعالَج بمرتجع/إشعار دائن لا بإلغاء مباشر.');
        }
        if ($intent === null) {
            return; // طلب بلا نية: لا دفع يُفحص.
        }
        if (! $intent->isCancelled()) {
            if ($intent->isPaid()) {
                throw new CommerceOrderCancellationException(CommerceOrderCancellationException::PAYMENT_PAID, 'الطلب مدفوع؛ يُعالَج باسترداد لا بإلغاء مباشر.');
            }
            if ($intent->isCollected()) {
                throw new CommerceOrderCancellationException(CommerceOrderCancellationException::PAYMENT_COLLECTED, 'حُصِّل مبلغ هذا الطلب؛ يلزم مسار استرداد/مرتجع لا إلغاء مباشر.');
            }
        }
        if ($intent->isOnline()) {
            // يشمل النية الملغاة سابقاً (صف 9): الإقفال الإداري مسموح فقط حين لا التقاط — التقاط متأخر (`late_capture`) على نية ألغتها
            // المكنسة/المسار القديم يعني أن مالاً دخل فعلاً، فيُرفض بـ`payment_captured` لا يُغلق الطلب كأنه لم يُدفع شيء.
            if ($this->hasCaptureEvidence($intent)) {
                throw new CommerceOrderCancellationException(CommerceOrderCancellationException::PAYMENT_CAPTURED, 'التُقط مبلغ لهذا الطلب؛ لا يُلغى مباشرة.');
            }
            if (! $intent->isCancelled()) {
                $authorized = PaymentAttempt::query()->where('payable_key', $intent->payableKey())
                    ->where('capture_status', PaymentAttempt::STATUS_AUTHORIZED)->exists();
                if ($authorized) {
                    throw new CommerceOrderCancellationException(CommerceOrderCancellationException::PAYMENT_AUTHORIZED, 'يوجد مبلغ مصرَّح به لدى المزوّد؛ أعد المحاولة بعد انتهاء المحاولة أو إغلاقها.');
                }
            }
        }
    }

    /**
     * كل مؤشرات الالتقاط الفعلي لنية إلكترونية: محاولة `captured` (`hasCapture`، الحاجز نفسه تحت قفل النية)، أو أثر مبلغ ملتقَط
     * (`captured_minor > 0` / `captured_at`) أياً كانت حالتها اللاحقة، أو وسم `late_capture` للمراجعة. قراءة SELECT عادية بلا قفل محاولة.
     */
    private function hasCaptureEvidence(CommercePaymentIntent $intent): bool
    {
        if ($this->online->hasCapture($intent)) {
            return true;
        }
        $attempts = PaymentAttempt::query()->where('payable_key', $intent->payableKey())->get(['id', 'captured_minor', 'captured_at', 'review_reasons']);

        return $attempts->contains(fn (PaymentAttempt $a): bool => (int) $a->captured_minor > 0
            || $a->captured_at !== null
            || in_array(PaymentAttempt::REVIEW_LATE_CAPTURE, (array) $a->review_reasons, true));
    }
}

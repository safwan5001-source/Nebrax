<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderEvent;
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
        private readonly CommerceOrderEventRecorder $events,
    ) {}

    /**
     * @throws CommerceOrderCancellationException رفض عمل برمز `reason`
     */
    public function cancel(CommerceOrder $order, User $actor, string $reason, ?string $note): CommerceOrder
    {
        $note = $this->normalizeNote($note);
        // `merchant_rejected` ليس من أسباب الموظف هنا: الرفض له مساره وصلاحيته وبوابته ({@see self::reject}).
        if (! in_array($reason, CommerceOrder::CANCELLATION_REASONS, true)) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::INVALID_REASON, 'سبب الإلغاء غير معتمد.', 422);
        }
        if ($reason === 'other' && $note === null) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::NOTE_REQUIRED, 'الملاحظة مطلوبة عند اختيار سبب «أخرى».', 422);
        }

        return $this->performCancellation($order, $actor, $reason, $note, false);
    }

    /**
     * COPS-H1-4 (ADR-29 §2.2 R-3): **رفض التاجر = الإلغاء نفسه** بسبب `merchant_rejected` — الأقفال والمصفوفة (ADR-28 §3) والتحرير والتنظيف بعد
     * الالتزام والحدث (`order.cancelled` بـ`reason: merchant_rejected`) كلها مسار الإلغاء حرفياً؛ لا انتقال ثانٍ.
     *
     * إضافاته تحت الأقفال نفسها: لا رفض إلا لطلب لقطته `manual` لم يُقبل بعد (بعد القبول = إلغاء عادي بأسبابه؛ والقاعدة تحرس ذلك أيضاً).
     * idempotent: طلب مرفوض أصلاً ⇒ يُعاد كما هو؛ طلب ملغى بسبب آخر ⇒ 409 `already_cancelled` (لا يُعرض إلغاءٌ عادي كأنه رفض).
     * البوابتان (القبول والإلغاء) يفحصهما المتحكّم قبل الوصول هنا.
     *
     * @throws CommerceOrderCancellationException
     */
    public function reject(CommerceOrder $order, User $actor, ?string $note): CommerceOrder
    {
        return $this->performCancellation($order, $actor, CommerceOrder::REJECTION_REASON, $this->normalizeNote($note), true);
    }

    /**
     * COPS-H1-4 (ADR-29 §2.2): قبول التاجر اليدوي. **المعاملة:** قفل النية ← قفل الطلب (ترتيب المحور القائم ADR-28 §1.3 نفسه — لا يعكس الالتقاط
     * أو الترحيل أو الإلغاء أو المكنسة)، ثم الفحوص تحت الأقفال، ثم كتابة حقيقتي القبول، ثم الحدث `order.accepted` **آخر كتابة** (رأس التغذية آخر قفل).
     * لا أثر مالي أو مخزني إطلاقاً (لا حجز يتغيّر ولا قيد ولا فاتورة).
     *
     * idempotent بالحالة: طلب مقبول ⇒ يُعاد كما هو بلا حدث ولا تغيير للفاعل/الوقت.
     * الأهلية: مؤكَّد · غير ملغى · لقطته `manual` · **الدفع جاهز (R-5)**: نية COD/استلام (`awaiting_collection`/`collected`) أو إلكترونية `paid`.
     * البوابة (`commerce.order_acceptance_enabled`) يفحصها المتحكّم.
     *
     * @throws CommerceOrderAcceptanceException
     */
    public function accept(CommerceOrder $order, User $actor): CommerceOrder
    {
        return DB::transaction(function () use ($order, $actor): CommerceOrder {
            $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            if ($locked->isAccepted()) {
                return $locked;
            }
            $this->assertAcceptable($locked, $intent);

            // حقيقتا القبول ليستا في $fillable؛ تكتبهما هذه الخدمة وحدها وتحرسهما مُشغّلات القاعدة (يدوي/مؤكَّد/غير ملغى/بفاعل/جمود).
            $locked->forceFill(['accepted_at' => now('UTC'), 'accepted_by_user_id' => $actor->id])->save();

            // COPS-H1-1: آخر كتابة في المعاملة — رأس التغذية آخر قفل. الفرع idempotent أعلاه لا يصل هنا.
            $this->events->append($locked, CommerceOrderEvent::ORDER_ACCEPTED, CommerceOrderEvent::ACTOR_USER, (string) $actor->id);

            return $locked->fresh();
        });
    }

    /** المسار المشترك للإلغاء والرفض (انظر {@see self::cancel()} و{@see self::reject()}). */
    private function performCancellation(CommerceOrder $order, User $actor, string $reason, ?string $note, bool $rejection): CommerceOrder
    {
        $cleanupIntent = null;

        $cancelled = DB::transaction(function () use ($order, $actor, $reason, $note, $rejection, &$cleanupIntent): CommerceOrder {
            // 1) النية أولاً (المحور الذي يسلسل الالتقاط/الإلغاء/الترحيل) — نطاق المستأجر مطبَّق على الاستعلامين.
            $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->lockForUpdate()->first();
            // 2) ثم الطلب.
            $locked = CommerceOrder::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            // idempotent: لا أثر ولا تنظيف جديد ولا تغيير لحقائق الإلغاء الأصلية.
            if ($locked->isCancelled()) {
                if ($rejection && $locked->cancellation_reason !== CommerceOrder::REJECTION_REASON) {
                    throw new CommerceOrderCancellationException(CommerceOrderCancellationException::ALREADY_CANCELLED, 'أُلغي هذا الطلب مسبقاً.');
                }

                return $locked;
            }
            if (! $locked->isConfirmed()) {
                throw new CommerceOrderCancellationException(CommerceOrderCancellationException::NOT_CONFIRMED, 'لا يمكن إلغاء طلب غير مؤكَّد.', 422);
            }
            if ($rejection) {
                $this->assertRejectable($locked);
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

            // حقائق الإلغاء ليست في $fillable عمداً؛ تكتبها هذه الخدمة وحدها وتحرسها مُشغّلات القاعدة (سبب معتمد/جمود/لا مسودة/رفض قبل القبول).
            $locked->forceFill([
                'cancelled_at' => now('UTC'),
                'cancelled_by_user_id' => $actor->id,
                'cancellation_reason' => $reason,
                'cancellation_note' => $note,
            ])->save();

            // COPS-H1-1: آخر كتابة في المعاملة (بعد النية والطلب والحجز) — رأس التغذية آخر قفل. الفرع idempotent أعلاه لا يصل هنا.
            $this->events->append($locked, CommerceOrderEvent::ORDER_CANCELLED, CommerceOrderEvent::ACTOR_USER, (string) $actor->id, ['reason' => $reason]);

            return $locked->fresh();
        });

        if ($cleanupIntent !== null) {
            // بعد الالتزام النهائي للمعاملة الخارجية فقط (لا اتصال بالمزوّد تحت أقفال)؛ لا يرمي، والمطابِق يعيد ما فشل.
            DB::afterCommit(fn () => $this->cleanup->run($cleanupIntent));
        }

        return $cancelled;
    }

    private function normalizeNote(?string $note): ?string
    {
        $note = $note === null ? null : trim($note);

        return $note === '' ? null : $note;
    }

    /**
     * عقد قراءة واجهة الموظف (O3b): هل يُعرض إجراء «إلغاء الطلب» وهل هو متاح؟ **استرشادي فقط** — قراءة SELECT عادية بلا أقفال تعيد استعمال فحوص
     * المصفوفة نفسها (`assertCancellable`) دون نسخة ثانية للقواعد؛ القرار النهائي دائماً لـ`cancel()` تحت الأقفال (قد يتغيّر الوضع بين القراءة والنقر).
     *
     * `null` ⇒ الإجراء غير معروض أصلاً: البوابة مغلقة أو لا صلاحية `commerce.orders.cancel` — فلا يتسرّب إلى الواجهة أن بوابة نشر موجودة ولا حالتها.
     * وإلا `{available, blocked_reason}` حيث السبب رمز مصفوفة آمن (`already_cancelled`، `not_confirmed`، `already_posted`، `payment_*`) أو `null`.
     *
     * @return array{available: bool, blocked_reason: ?string}|null
     */
    public function cancelAction(CommerceOrder $order, User $actor): ?array
    {
        if (! (bool) config('commerce.order_cancellation_enabled') || ! $actor->hasPermission('commerce.orders.cancel')) {
            return null;
        }
        $blocker = $this->cancellationBlocker($order);

        return ['available' => $blocker === null, 'blocked_reason' => $blocker];
    }

    /** رمز المانع الأول للإلغاء أو `null` إن كان مؤهلاً (قراءة بلا أقفال؛ انظر {@see self::cancelAction}). */
    public function cancellationBlocker(CommerceOrder $order): ?string
    {
        if ($order->isCancelled()) {
            return CommerceOrderCancellationException::ALREADY_CANCELLED;
        }
        if (! $order->isConfirmed()) {
            return CommerceOrderCancellationException::NOT_CONFIRMED;
        }
        $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->first();
        try {
            $this->assertCancellable($order, $intent);
        } catch (CommerceOrderCancellationException $e) {
            return $e->reason;
        }

        return null;
    }

    /**
     * COPS-H1-4 — عقد قراءة إجراء «قبول الطلب» (مثل {@see self::cancelAction()}): `null` ⇒ غير معروض (البوابة مغلقة أو لا `commerce.orders.manage`،
     * فلا يتسرّب وجود البوابة). وإلا `{available, blocked_reason}` برمز آمن من {@see CommerceOrderAcceptanceException}. استرشادي؛ القرار لـ`accept()`.
     *
     * @return array{available: bool, blocked_reason: ?string}|null
     */
    public function acceptAction(CommerceOrder $order, User $actor): ?array
    {
        if (! (bool) config('commerce.order_acceptance_enabled') || ! $actor->hasPermission('commerce.orders.manage')) {
            return null;
        }
        $blocker = $this->acceptanceBlocker($order);

        return ['available' => $blocker === null, 'blocked_reason' => $blocker];
    }

    /**
     * COPS-H1-4 — عقد قراءة إجراء «رفض الطلب»: يُعرض فقط حين **البوابتان** (القبول والإلغاء) مفتوحتان **و**للمستخدم `commerce.orders.manage`
     * **و**`commerce.orders.cancel` (R-6)، وإلا `null`.
     *
     * @return array{available: bool, blocked_reason: ?string}|null
     */
    public function rejectAction(CommerceOrder $order, User $actor): ?array
    {
        if (! (bool) config('commerce.order_acceptance_enabled') || ! (bool) config('commerce.order_cancellation_enabled')
            || ! $actor->hasPermission('commerce.orders.manage') || ! $actor->hasPermission('commerce.orders.cancel')) {
            return null;
        }
        $blocker = $this->rejectionBlocker($order);

        return ['available' => $blocker === null, 'blocked_reason' => $blocker];
    }

    /** رمز المانع الأول للقبول أو `null` (قراءة بلا أقفال تعيد استعمال `assertAcceptable`). */
    public function acceptanceBlocker(CommerceOrder $order): ?string
    {
        if ($order->isAccepted()) {
            return CommerceOrderAcceptanceException::ALREADY_ACCEPTED;
        }
        $intent = CommercePaymentIntent::query()->where('commerce_order_id', $order->id)->first();
        try {
            $this->assertAcceptable($order, $intent);
        } catch (CommerceOrderAcceptanceException $e) {
            return $e->reason;
        }

        return null;
    }

    /** رمز المانع الأول للرفض أو `null` (قراءة بلا أقفال: قواعد الرفض ثم مصفوفة الإلغاء نفسها). */
    public function rejectionBlocker(CommerceOrder $order): ?string
    {
        if ($order->isCancelled()) {
            return CommerceOrderCancellationException::ALREADY_CANCELLED;
        }
        if (! $order->isConfirmed()) {
            return CommerceOrderCancellationException::NOT_CONFIRMED;
        }
        try {
            $this->assertRejectable($order);
        } catch (CommerceOrderCancellationException $e) {
            return $e->reason;
        }

        return $this->cancellationBlocker($order);
    }

    /** أهلية القبول (ADR-29 §2.2 + R-5). تُستدعى تحت قفل النية والطلب في `accept()`. */
    private function assertAcceptable(CommerceOrder $order, ?CommercePaymentIntent $intent): void
    {
        if ($order->isCancelled()) {
            throw new CommerceOrderAcceptanceException(CommerceOrderAcceptanceException::ALREADY_CANCELLED, 'أُلغي هذا الطلب؛ لا يمكن قبوله.');
        }
        if (! $order->isConfirmed()) {
            throw new CommerceOrderAcceptanceException(CommerceOrderAcceptanceException::NOT_CONFIRMED, 'لا يمكن قبول طلب غير مؤكَّد.', 422);
        }
        if ($order->effectiveAcceptanceMode() !== CommerceOrder::ACCEPTANCE_MANUAL) {
            throw new CommerceOrderAcceptanceException(CommerceOrderAcceptanceException::NOT_MANUAL, 'هذا الطلب مقبول تلقائياً؛ لا يحتاج قبولاً يدوياً.');
        }
        if ($intent === null || $intent->isCancelled()) {
            throw new CommerceOrderAcceptanceException(CommerceOrderAcceptanceException::PAYMENT_NOT_READY, 'لا توجد طريقة دفع قائمة لهذا الطلب؛ لا يمكن قبوله.');
        }
        if (! in_array($intent->status, CommerceOrderAttentionQuery::PAYMENT_READY, true)) {
            throw new CommerceOrderAcceptanceException(CommerceOrderAcceptanceException::PAYMENT_PENDING, 'لم يكتمل الدفع الإلكتروني لهذا الطلب بعد؛ يُقبل بعد تأكيد الدفع.');
        }
    }

    /** قواعد الرفض الخاصة (R-3): لقطة يدوية ولم يُقبل. تُستدعى تحت قفل الطلب في المسار المشترك. */
    private function assertRejectable(CommerceOrder $order): void
    {
        if (! $order->isManualAcceptance()) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::NOT_MANUAL, 'هذا الطلب مقبول تلقائياً؛ يُلغى بمسار الإلغاء لا بالرفض.');
        }
        if ($order->isAccepted()) {
            throw new CommerceOrderCancellationException(CommerceOrderCancellationException::ALREADY_ACCEPTED, 'قُبل هذا الطلب؛ يُلغى بمسار الإلغاء لا بالرفض.');
        }
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

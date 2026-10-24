<?php

namespace App\Listeners;

use App\Events\CommercePaymentAttemptCaptured;
use App\Models\PaymentAttempt;
use App\Services\Commerce\CommerceOnlinePaymentService;
use App\Services\PaymentAttemptPostingService;
use App\Tenancy\TenantContext;
use Throwable;

/**
 * يثبّت نية طلب المتجر مدفوعةً فور التزام التقاط مؤكَّد (PAY-H4-04a). الإخفاق لا يُرمى للمُطلِق (قد يكون مسار webhook يجب أن يُقرّ): يُبلَّغ عنه
 * وتبقى النية `pending` فيلتقطه `payments:complete-commerce-captures` الدوري. idempotent. (H4-03: يتبعه الترحيل المحاسبي إن فُعِّلت بوابته؛ شبكة أمانه `payments:post-captured`.)
 */
final class CompleteCommerceOnlinePayment
{
    public function __construct(
        private readonly CommerceOnlinePaymentService $online,
        private readonly PaymentAttemptPostingService $posting,
        private readonly TenantContext $tenant,
    ) {}

    public function handle(CommercePaymentAttemptCaptured $event): void
    {
        $owned = ! $this->tenant->has();
        if ($owned) {
            $this->tenant->set($event->tenantId);
        } elseif ((string) $this->tenant->id() !== $event->tenantId) {
            return; // سياق مستأجر مختلف: لا نخلطه، والأمر الدوري يتولى الأمر
        }

        try {
            $attempt = PaymentAttempt::query()->find($event->attemptId);
            if ($attempt !== null && $this->online->completeCaptured($attempt)) {
                // H4-03: بوابة الفاتورة عند الدفع مفعَّلة ⇒ الالتقاط `pending` فيُرحَّل الآن (فاتورة + سند)؛ مغلقة ⇒ `posting_status` فارغ فلا شيء.
                $fresh = PaymentAttempt::query()->find($attempt->getKey());
                if ($fresh !== null && $fresh->posting_status === PaymentAttempt::POSTING_PENDING) {
                    $this->posting->process($fresh);
                }
            }
        } catch (Throwable $e) {
            report($e);
        } finally {
            if ($owned) {
                $this->tenant->forget();
            }
        }
    }
}

<?php

namespace App\Listeners;

use App\Events\CommerceOrderDomainEvent;
use App\Events\CommerceOrderPaymentPaid;
use App\Events\CommerceOrderPlaced;
use App\Services\Commerce\CommerceOrderAlertNotifier;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * مستمع تنبيه التاجر (COPS-H3-1): يُطلَق بعد الالتزام (حدث النطاق) فيُنتج إشعار «طلب جديد» للمستلمين المؤهلين. **لا يرمي أبداً** (الطابور متزامن؛ فشل التنبيه لا يُفشل الإتمام
 * ولا التقاط الدفع)؛ الحقيقة تبقى في السجل والمصالحة (`attention`). الدالتان `onPlaced`/`onPaid` وليستا `handle` عمداً (انظر `PaymentPostingServiceProvider`).
 */
final class NotifyCommerceOrderAlert
{
    public function __construct(private readonly CommerceOrderAlertNotifier $notifier) {}

    public function onPlaced(CommerceOrderPlaced $event): void
    {
        $this->run($event);
    }

    public function onPaid(CommerceOrderPaymentPaid $event): void
    {
        $this->run($event);
    }

    private function run(CommerceOrderDomainEvent $event): void
    {
        if (! CommerceOrderAlertNotifier::enabled()) {
            return;
        }

        try {
            $this->notifier->notify($event->tenantId, $event->orderId);
        } catch (Throwable $e) {
            Log::warning('commerce.order_alert.failed', ['tenant_id' => $event->tenantId, 'order_id' => $event->orderId, 'event_id' => $event->eventId, 'exception' => $e::class]);
        }
    }
}

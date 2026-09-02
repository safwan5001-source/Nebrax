<?php

namespace App\Console\Commands;

use App\Models\WebhookDelivery;
use Illuminate\Console\Command;

/**
 * إعادة تشغيل تسليم Webhook فاشل يدويًا (استرداد تشغيليّ — §25). داخليّ/إداريّ لا
 * عام: لا يُعرَّض إعادة تشغيلٍ عامّة لأحداث مستأجرين آخرين.
 *
 * يعيد الصفّ إلى `pending` مستحقًّا فورًا بعدّاد محاولات جديد، **دون تغيير معرّف
 * الحدث ولا معرّف التسليم** — فيلتقطه المُشغّل التالي. يقبل معرّف تسليمٍ واحد، أو
 * `--event` لإعادة كلّ تسليمات حدثٍ الفاشلة. يتجاوز نطاق المستأجر (صيانة منصّة).
 */
class RetryWebhookDelivery extends Command
{
    protected $signature = 'webhooks:retry
        {delivery? : معرّف التسليم المراد إعادته}
        {--event= : أعد كلّ تسليمات هذا الحدث الفاشلة}';

    protected $description = 'يعيد جدولة تسليم(ات) Webhook فاشلة دون تغيير هويّة الحدث';

    public function handle(): int
    {
        $deliveryId = $this->argument('delivery');
        $eventId = $this->option('event');

        if ($deliveryId === null && $eventId === null) {
            $this->error('مرّر معرّف تسليم أو --event=<معرّف الحدث>.');

            return self::INVALID;
        }

        $query = WebhookDelivery::query()
            ->withoutGlobalScopes()
            ->where('status', WebhookDelivery::STATUS_FAILED);

        if ($eventId !== null) {
            $query->where('webhook_event_id', $eventId);
        } else {
            $query->whereKey($deliveryId);
        }

        $reset = $query->update([
            'status'          => WebhookDelivery::STATUS_PENDING,
            'attempts'        => 0,
            'next_attempt_at' => now(),
            'reserved_until'  => null,
            'failed_at'       => null,
            'last_error'      => null,
        ]);

        if ($reset === 0) {
            $this->warn('لا تسليم فاشل مطابق لإعادته.');

            return self::SUCCESS;
        }

        $this->line("أُعيدت جدولة تسليمات فاشلة: {$reset} (بلا تغيير هويّة الحدث).");

        return self::SUCCESS;
    }
}

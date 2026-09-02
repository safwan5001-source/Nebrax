<?php

namespace App\Console\Commands;

use App\Services\WebhookDeliveryProcessor;
use Illuminate\Console\Command;

/**
 * مُشغّل تسليم الـ Webhooks المستحقّة (PR-7) — **بلا عامل خلفي** (الإنتاج
 * `QUEUE_CONNECTION=sync`). أمر Artisan متزامن يُطالب دفعةً من المستحقّات ويسلّمها،
 * ثم يخرج — آمنٌ للتشغيل المتكرّر ولعدّة نسخ متزامنة (مطالبة ذرّية بإيجار).
 *
 * التفعيل التشغيليّ: يُستدعى عبر cron/Scheduler كلّ دقيقة (انظر routes/console.php).
 * حتى يُفعَّل جدولٌ في النشر، يُشغَّل يدويًا. المطالبة الذرّية تمنع الازدواج بين نسخ.
 */
class DeliverWebhooks extends Command
{
    protected $signature = 'webhooks:deliver
        {--limit= : حجم الدفعة (افتراضه من config webhooks.delivery.batch_size)}
        {--drain : تابع المطالبة حتى لا يبقى مستحقّ}';

    protected $description = 'يسلّم دفعة الـ Webhooks المستحقّة (مطالبة ذرّية + توقيع HMAC + تراجع محدود)';

    public function handle(WebhookDeliveryProcessor $processor): int
    {
        $limit = $this->option('limit') !== null ? max(1, (int) $this->option('limit')) : null;
        $drain = (bool) $this->option('drain');

        $totals = ['claimed' => 0, 'delivered' => 0, 'retried' => 0, 'failed' => 0];

        do {
            $summary = $processor->processDueBatch($limit);
            foreach ($summary as $key => $value) {
                $totals[$key] += $value;
            }
        } while ($drain && $summary['claimed'] > 0);

        $this->line(sprintf(
            'webhooks: claimed=%d delivered=%d retried=%d failed=%d',
            $totals['claimed'],
            $totals['delivered'],
            $totals['retried'],
            $totals['failed'],
        ));

        return self::SUCCESS;
    }
}

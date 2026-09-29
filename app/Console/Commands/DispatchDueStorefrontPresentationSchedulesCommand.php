<?php

namespace App\Console\Commands;

use App\Services\Commerce\ScheduledPresentationDispatcher;
use Illuminate\Console\Command;

/**
 * CUST-H1-4 — مُرسِل النشر المجدول المستحقّ لعروض المتاجر (نسخ CUST-H1).
 * نفس نمط `webhooks:deliver` (PR-7): أمرٌ متزامن آمن للتكرار، بلا عامل
 * خلفي — راجع `routes/console.php` لملاحظة التفعيل التشغيلي.
 */
class DispatchDueStorefrontPresentationSchedulesCommand extends Command
{
    protected $signature = 'storefront-presentations:dispatch-due
        {--limit= : حجم الدفعة (افتراضه ScheduledPresentationDispatcher::DEFAULT_BATCH_SIZE)}';

    protected $description = 'ينشر دفعة من نسخ عروض المتاجر المجدولة المستحقّة (كل عنصر معزول ذرّياً؛ فشل واحد لا يوقف الدفعة)';

    public function handle(ScheduledPresentationDispatcher $dispatcher): int
    {
        $limit = $this->option('limit') !== null ? max(1, (int) $this->option('limit')) : null;

        $summary = $dispatcher->dispatchDueBatch($limit);

        $this->line(sprintf(
            'storefront-presentations: due=%d published=%d skipped=%d failed=%d',
            $summary['due'],
            $summary['published'],
            $summary['skipped'],
            $summary['failed'],
        ));

        return self::SUCCESS;
    }
}

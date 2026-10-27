<?php

namespace App\Console\Commands;

use App\Services\Commerce\OrderCancellationCleanup;
use Illuminate\Console\Command;

/**
 * ADR-28 §4 — شبكة أمان لتنظيف محاولات الدفع بعد إلغاء النية: يغلق المحاولات الجارية لنوايا إلكترونية ملغاة (فشل المزوّد/انهيار العملية بعد
 * الالتزام). idempotent وآمن للتكرار والتزامن؛ لا أثر محاسبي ولا مخزني ولا تغيير لحالة طلب أو نية.
 */
class CloseCancelledOrderAttemptsCommand extends Command
{
    protected $signature = 'commerce:close-cancelled-order-attempts {--limit=100 : أقصى عدد نوايا في التشغيل}';

    protected $description = 'يغلق محاولات الدفع الجارية لنوايا طلبات المتجر الإلكترونية الملغاة (إعادة محاولة آمنة بعد فشل التنظيف)';

    public function handle(OrderCancellationCleanup $cleanup): int
    {
        $this->line(json_encode($cleanup->runPending(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

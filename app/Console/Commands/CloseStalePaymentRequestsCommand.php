<?php

namespace App\Console\Commands;

use App\Services\InvoicePaymentRequestService;
use Illuminate\Console\Command;

/** يغلق طلبات دفع الفواتير المفتوحة التي لم تعد قابلة للدفع (فاتورة مسدَّدة/مخفَّضة إلى صفر/منتهية الصلاحية). آمن للتكرار؛ لا أثر محاسبي. */
class CloseStalePaymentRequestsCommand extends Command
{
    protected $signature = 'payments:close-stale-requests {--limit=200 : أقصى عدد طلبات في التشغيل}';

    protected $description = 'يلغي/ينهي طلبات دفع الفواتير التي لم تعد قابلة للدفع';

    public function handle(InvoicePaymentRequestService $requests): int
    {
        $this->line(json_encode($requests->closeStale(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Services\PaymentRefundPostingService;
use Illuminate\Console\Command;

/** يرحّل استردادات البوابة المؤكَّدة المعلّقة عبر `LedgerService` (ADR-0007 A5). آمن للتكرار والتزامن. لا يعيد ترحيل المحجوبة بفترة مقفلة. */
class PostPaymentRefundsCommand extends Command
{
    protected $signature = 'payments:post-refunds {--limit=100 : أقصى عدد استردادات في التشغيل}';

    protected $description = 'يرحّل استردادات البوابة المؤكَّدة المعلّقة إلى الدفتر (مدين العملاء / دائن مقاصة البوابة)';

    public function handle(PaymentRefundPostingService $posting): int
    {
        $this->line(json_encode($posting->runPending(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

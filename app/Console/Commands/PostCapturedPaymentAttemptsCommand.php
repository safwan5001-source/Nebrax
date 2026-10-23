<?php

namespace App\Console\Commands;

use App\Services\PaymentAttemptPostingService;
use Illuminate\Console\Command;

/** يرحّل التقاطات الدفع الإلكتروني المعلّقة عبر `PaymentService` (ADR-0006). آمن للتكرار والتزامن. لا يعيد ترحيل المحجوبة بفترة مقفلة. */
class PostCapturedPaymentAttemptsCommand extends Command
{
    protected $signature = 'payments:post-captured {--limit=100 : أقصى عدد محاولات في التشغيل}';

    protected $description = 'يرحّل التقاطات الدفع الإلكتروني المعلّقة إلى سندات قبض (فاتورة)';

    public function handle(PaymentAttemptPostingService $posting): int
    {
        $this->line(json_encode($posting->runPending(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

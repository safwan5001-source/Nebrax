<?php

namespace App\Console\Commands;

use App\Services\Commerce\CommerceOnlinePaymentService;
use Illuminate\Console\Command;

/** يثبّت نوايا طلبات المتجر المدفوعة التي التُقطت لدى المزوّد ولم تُثبَّت بعد (شبكة أمان). آمن للتكرار والتزامن. لا أثر محاسبي. */
class CompleteCommerceCapturesCommand extends Command
{
    protected $signature = 'payments:complete-commerce-captures {--limit=100 : أقصى عدد محاولات في التشغيل}';

    protected $description = 'يثبّت نوايا دفع طلبات المتجر المدفوعة إلكترونياً بعد الالتقاط المؤكَّد';

    public function handle(CommerceOnlinePaymentService $online): int
    {
        $this->line(json_encode($online->runPending(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

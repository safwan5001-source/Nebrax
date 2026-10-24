<?php

namespace App\Console\Commands;

use App\Services\Commerce\CommerceUnpaidOrderSweeper;
use Illuminate\Console\Command;

/** يحرّر حجز مخزون الطلبات الإلكترونية غير المدفوعة بعد انتهاء مدتها وبعد التحقق من المزوّد (H4-02). آمن للتكرار والتزامن. لا أثر محاسبي. */
class ExpireUnpaidCommerceOrdersCommand extends Command
{
    protected $signature = 'commerce:expire-unpaid-orders {--limit=100 : أقصى عدد طلبات في التشغيل}';

    protected $description = 'يلغي نية الدفع ويحرّر حجز المخزون لطلبات المتجر الإلكترونية غير المدفوعة المنتهية (بعد التحقق من حالة الدفع)';

    public function handle(CommerceUnpaidOrderSweeper $sweeper): int
    {
        $this->line(json_encode($sweeper->run(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

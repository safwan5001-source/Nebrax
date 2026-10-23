<?php

namespace App\Console\Commands;

use App\Services\PosTerminalService;
use Illuminate\Console\Command;

/** يلغي موافقات أجهزة POS اليتيمة ويعالج الطلبات المعلّقة القديمة ويعيد محاولة التعويض الفاشل (PAY-H6-02). آمن للتكرار والتزامن (إيجار لكل طلب). */
class SweepPosTerminalsCommand extends Command
{
    protected $signature = 'pos:sweep-terminals {--limit=200 : أقصى عدد طلبات في التشغيل}';

    protected $description = 'يلغي موافقات أجهزة الدفع اليتيمة ويعالج الطلبات المعلّقة (لا ترحيل)';

    public function handle(PosTerminalService $terminals): int
    {
        $this->line(json_encode($terminals->sweep(max(1, (int) $this->option('limit'))), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Services\FuelShiftSettlementJobRunner;
use Illuminate\Console\Command;

/** يعالج مهام تسوية الورديات المستحقة (P1-3b-1). آمن للتكرار والتزامن (إيجار + حاجز). لا أثر محاسبي. لا يفعل شيئاً ما دامت بوابة التسوية مغلقة. */
class RunFuelSettlementJobsCommand extends Command
{
    protected $signature = 'fuel:settlement:run-jobs {--limit= : أقصى عدد مهام في التشغيل}';

    protected $description = 'يعالج مهام تسوية ورديات الوقود المسجَّلة (فحوص مسبقة فقط في هذه الشريحة؛ لا ترحيل)';

    public function handle(FuelShiftSettlementJobRunner $runner): int
    {
        $limit = $this->option('limit') !== null ? max(1, (int) $this->option('limit')) : null;
        $this->line(json_encode($runner->run($limit), JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

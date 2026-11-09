<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Communications\CommunicationDispatcher;
use App\Services\Communications\CommunicationProviderRegistry;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * AWJ-COMMS-03-A — تشغيل يدوي للموزّع (غير مجدول عمداً: لا Scheduler ولا عامل إنتاجي). سجل المزوّدين فارغ افتراضياً،
 * فالأمر لا يطالب بأي رسالة ولا يرسل شيئاً ما لم يُسجَّل مزوّد صراحةً في الشيفرة. الإخراج عدّادات فقط.
 */
class CommunicationsDispatchCommand extends Command
{
    protected $signature = 'communications:dispatch
        {--tenant= : مستأجر واحد بمعرّفه}
        {--limit=50 : أقصى عدد رسائل لكل مستأجر (1..500)}';

    protected $description = 'يوزّع رسائل الاتصالات المستحقة عبر المزوّدين المسجَّلين (يدوي، غير مجدول)';

    public function handle(CommunicationProviderRegistry $registry, TenantContext $context): int
    {
        if ($registry->isEmpty()) {
            $this->warn('لا يوجد مزوّد اتصالات مسجَّل: لم يُوزَّع شيء.');

            return self::SUCCESS;
        }

        $limit = (int) $this->option('limit');
        if ($limit < 1 || $limit > CommunicationDispatcher::MAX_BATCH) {
            $this->error('الحد يجب أن يكون بين 1 و'.CommunicationDispatcher::MAX_BATCH.'.');

            return self::INVALID;
        }

        $dispatcher = CommunicationDispatcher::make($registry);
        $tenants = $this->option('tenant') ? Tenant::whereKey($this->option('tenant'))->get() : Tenant::orderBy('id')->get();

        $total = [];
        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            foreach ($dispatcher->dispatchDue($tenant->id, $limit)->toArray() as $key => $count) {
                $total[$key] = ($total[$key] ?? 0) + $count;
            }
        }
        $context->forget();

        ksort($total);
        $this->line($total === [] ? 'لا رسائل مستحقة.' : 'اكتمل: '.json_encode($total));

        return self::SUCCESS;
    }
}

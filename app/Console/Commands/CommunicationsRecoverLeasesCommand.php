<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Communications\CommunicationDispatcher;
use App\Services\Communications\CommunicationProviderRegistry;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * AWJ-COMMS-03-A — استرجاع يدوي للإيجارات المنقضية (غير مجدول). لا يستدعي أي مزوّد: ينقل `sending` المنقضية إلى
 * إعادة جدولة آمنة (مزوّد يعلن منع التكرار) أو `unknown`، ويُسقط المحاولة الجارية كـ`abandoned`. الإخراج عدّادات فقط.
 */
class CommunicationsRecoverLeasesCommand extends Command
{
    protected $signature = 'communications:recover-leases
        {--tenant= : مستأجر واحد بمعرّفه}
        {--limit=50 : أقصى عدد إيجارات لكل مستأجر (1..500)}';

    protected $description = 'يسترجع إيجارات رسائل الاتصالات المنقضية (يدوي، غير مجدول)';

    public function handle(CommunicationProviderRegistry $registry, TenantContext $context): int
    {
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
            foreach ($dispatcher->recoverExpiredLeases($tenant->id, $limit)->toArray() as $key => $count) {
                $total[$key] = ($total[$key] ?? 0) + $count;
            }
        }
        $context->forget();

        ksort($total);
        $this->line($total === [] ? 'لا إيجارات منقضية.' : 'اكتمل: '.json_encode($total));

        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Accounting\InventoryAlertService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * مسح مخزون دوري احتياطي — ينشئ/يحلّ تنبيهات المخزون فقط، ولا يعدّل كمية
 * أو تقييماً أو قيداً. المسار الأساسي فوري عبر `InventoryService` عند كل
 * حركة مخزون؛ هذا الأمر يلتقط ما كان منخفضاً/نافداً قبل تفعيل الإعداد أو
 * قبل أي حركة تالية تُطلق التقييم الفوري.
 */
class ScanInventoryAlertsCommand extends Command
{
    protected $signature = 'inventory:scan-alerts {--tenant= : فحص مستأجر واحد بمعرّفه}';

    protected $description = 'يفحص أرصدة المنتجات المتتبَّعة وينشئ/يحلّ تنبيهات المخزون المنخفض والنافد فقط';

    public function handle(InventoryAlertService $alerts, TenantContext $context): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        if ($tenants->isEmpty()) {
            $this->warn('لا يوجد مستأجرون للفحص.');

            return self::SUCCESS;
        }

        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            $result = $alerts->scanTenant($tenant->id);

            if (! $result['enabled']) {
                $this->line("{$tenant->name}: تنبيهات المخزون غير مفعّلة.");
                continue;
            }

            $this->line("{$tenant->name}: {$result['scanned']} صنفاً متتبَّعاً تم فحصه.");
        }

        $context->forget();

        $this->newLine();
        $this->line('اكتمل فحص تنبيهات المخزون: لم تُعدَّل أي كمية أو قيمة أو قيد.');

        return self::SUCCESS;
    }
}

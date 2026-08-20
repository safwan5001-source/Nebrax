<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Accounting\FinancialControlService;
use App\Tenancy\TenantContext;
use Illuminate\Console\Command;

/**
 * فحص رقابة مالية دوري — يكتب تنبيهات وصفية فقط ولا يصلح أو يرحّل أي حركة مالية.
 */
class ScanFinancialControlsCommand extends Command
{
    protected $signature = 'finance:scan-controls {--tenant= : فحص مستأجر واحد بمعرّفه} {--force : فحص حتى لو كانت الرقابة معطلة في الإعدادات}';

    protected $description = 'يفحص اتزان القيود والتقارير والمستندات المرحّلة وينشئ تنبيهات رقابية داخلية فقط';

    public function handle(FinancialControlService $controls, TenantContext $context): int
    {
        $tenants = $this->option('tenant')
            ? Tenant::whereKey($this->option('tenant'))->get()
            : Tenant::orderBy('name')->get();

        if ($tenants->isEmpty()) {
            $this->warn('لا يوجد مستأجرون للفحص.');

            return self::SUCCESS;
        }

        $hasIssues = false;
        foreach ($tenants as $tenant) {
            $context->set($tenant->id);
            $result = $controls->scan((bool) $this->option('force'));
            if (! $result['enabled'] && ! $this->option('force')) {
                $this->line("{$tenant->name}: الرقابة المالية غير مفعّلة.");
                continue;
            }

            $hasIssues = $result['active'] > 0 || $hasIssues;
            $this->line("{$tenant->name}: {$result['detected']} فرق مكتشف، {$result['active']} تنبيه مفتوح، {$result['resolved']} تم إغلاقه.");
        }

        $context->forget();

        $this->newLine();
        $this->line($hasIssues
            ? 'اكتمل الفحص: وُجدت تنبيهات رقابية ولم يُعدّل أي مستند أو قيد.'
            : 'اكتمل الفحص: لا توجد تنبيهات رقابية مفتوحة.');

        // وجود فرق تجاري يحتاج مراجعة المحاسب، لا يعني فشل جدولة الأمر تقنياً.
        return self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Services\Commerce\FlatHostMigrationPlanner;
use Illuminate\Console\Command;

/**
 * تخطيط ترحيل مضيفات المتاجر إلى الخيار A — **Dry Run فقط**.
 * لا خيار تطبيق (`--apply`) موجود عمداً؛ التنفيذ الفعلي يحتاج موافقة وطلباً منفصلاً.
 */
class StorefrontFlatHostPlanCommand extends Command
{
    protected $signature = 'storefront:flat-host-plan {--json : مخرجات JSON}';

    protected $description = 'تقرير قراءة فقط: مضيفات المتاجر المتداخلة القديمة وأهدافها وتعارضاتها (لا يكتب في القاعدة)';

    public function handle(FlatHostMigrationPlanner $planner): int
    {
        $plan = $planner->plan();

        if ($this->option('json')) {
            $this->line(json_encode($plan, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
        } else {
            $this->info('DRY RUN — لا تغييرات. النطاق الأساسي: '.$plan['base_domain']);
            $this->table(
                ['host', 'status', 'target', 'conflicts'],
                array_map(fn ($r) => [$r['hostname'], $r['status'], $r['target'] ?? '-', implode(',', $r['conflicts']) ?: '-'], $plan['rows']),
            );
            foreach ($plan['summary'] as $k => $v) {
                $this->line("{$k}: {$v}");
            }
        }

        // رمز خروج غير صفري عند وجود تعارض حتى يتوقف أي أتمتة لاحقة.
        return $plan['summary']['conflicting'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}

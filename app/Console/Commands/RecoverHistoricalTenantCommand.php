<?php

namespace App\Console\Commands;

use App\Services\HistoricalTenantRecoveryService;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * استعادة مستأجر تاريخي واحد من قاعدة مصدر معزولة إلى قاعدة هدف مصرّح بها.
 *
 * الافتراضي: dry-run. لا كتابة على الإنتاج من هذا الأمر دون أعلام صريحة
 * ومطابقة اسم قاعدة الهدف. لا يُستدعى من المسارات العامة.
 */
class RecoverHistoricalTenantCommand extends Command
{
    protected $signature = 'awj:recover-historical-tenant
        {--tenant-id= : UUID المستأجر التاريخي}
        {--slug= : slug المتوقع (mart)}
        {--source-connection=recovery_source : اتصال المصدر}
        {--target-connection=recovery_target : اتصال الهدف}
        {--allow-target-database= : اسم قاعدة الهدف المصرّح بها (مطابقة حرفية)}
        {--include-platform-audit : انسخ platform_administrator_actions}
        {--include-access-tokens : انسخ personal_access_tokens}
        {--execute : تنفيذ الكتابة داخل معاملة (يتطلب التأكيدات)}
        {--confirm-tenant-id= : يجب أن يطابق --tenant-id عند --execute}
        {--confirm-slug= : يجب أن يطابق --slug عند --execute}';

    protected $description = 'Dry-run ثم استعادة مستأجر تاريخي واحد مع فحوصات عزل وسلامة. الافتراضي بلا كتابة.';

    public function __construct(private HistoricalTenantRecoveryService $recovery)
    {
        parent::__construct();
    }

    public function handle(): int
    {
        $tenantId = (string) $this->option('tenant-id');
        $slug = (string) $this->option('slug');
        $source = (string) $this->option('source-connection');
        $target = (string) $this->option('target-connection');
        $execute = (bool) $this->option('execute');

        if ($tenantId === '' || $slug === '') {
            $this->error('يجب تمرير --tenant-id و --slug. لم يُكتب شيء.');

            return self::FAILURE;
        }

        if (! $this->connectionConfigured($source)) {
            $this->error("اتصال المصدر «{$source}» غير مضبوط. لم يُكتب شيء.");

            return self::FAILURE;
        }
        if (! $this->connectionConfigured($target)) {
            $this->error("اتصال الهدف «{$target}» غير مضبوط. لم يُكتب شيء.");

            return self::FAILURE;
        }

        try {
            $plan = $this->recovery->plan([
                'tenant_id' => $tenantId,
                'slug' => $slug,
                'source' => $source,
                'target' => $target,
                'include_platform_audit' => (bool) $this->option('include-platform-audit'),
                'include_access_tokens' => (bool) $this->option('include-access-tokens'),
            ]);
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        $this->renderPlan($plan);

        if (! $execute) {
            $this->newLine();
            $this->info('Dry-run فقط. لا كتابة. أعد التشغيل مع --execute بعد موافقة صفوان ومطابقة --allow-target-database.');

            return ($plan['can_execute'] ?? false) ? self::SUCCESS : self::FAILURE;
        }

        if ((string) $this->option('confirm-tenant-id') !== $tenantId
            || (string) $this->option('confirm-slug') !== $slug) {
            $this->error('--execute يتطلب --confirm-tenant-id و --confirm-slug مطابقين. لم يُكتب شيء.');

            return self::FAILURE;
        }

        try {
            $this->recovery->assertAllowTargetDatabase($target, (string) $this->option('allow-target-database'));
        } catch (RuntimeException $e) {
            $this->error($e->getMessage());

            return self::FAILURE;
        }

        if (! ($plan['can_execute'] ?? false)) {
            $this->error('توجد أخطاء حاجبة. التنفيذ مرفوض.');

            return self::FAILURE;
        }

        try {
            $result = $this->recovery->execute($plan, [
                'source' => $source,
                'target' => $target,
                'tenant_id' => $tenantId,
            ]);
        } catch (RuntimeException $e) {
            $this->error('فشل التنفيذ وتُرجعت المعاملة: '.$e->getMessage());

            return self::FAILURE;
        }

        $this->newLine();
        $this->info('أُنجزت الاستعادة داخل معاملة.');
        $this->line('inserted_total='.$result['inserted_total']);
        foreach ($result['inserted'] as $table => $count) {
            $this->line("  + {$table}: {$count}");
        }

        return self::SUCCESS;
    }

    /** @param  array<string, mixed>  $plan */
    private function renderPlan(array $plan): void
    {
        $this->line('المصدر: '.($plan['source_database'] ?? '?'));
        $this->line('الهدف: '.($plan['target_database'] ?? '?'));
        $tenant = $plan['tenant'] ?? [];
        $this->line(sprintf(
            'المستأجر: %s / %s / %s (created_at=%s, legacy=%s)',
            $tenant['name'] ?? '?',
            $tenant['slug'] ?? '?',
            $tenant['id'] ?? '?',
            $tenant['created_at'] ?? '?',
            ! empty($tenant['is_legacy_cutover']) ? 'yes' : 'no',
        ));

        $this->newLine();
        $this->info('جداول مختارة: '.count($plan['tables_selected'] ?? []));
        $this->info('صفوف متوقعة: '.($plan['expected_insert_total'] ?? 0));

        $rows = [];
        foreach ($plan['expected_inserts'] ?? [] as $table => $count) {
            if ((int) $count === 0) {
                continue;
            }
            $rows[] = [$table, $plan['classifications'][$table]['class'] ?? '?', $count];
        }
        if ($rows !== []) {
            $this->table(['table', 'class', 'expected'], $rows);
        }

        if (! empty($plan['skipped_global_shared'])) {
            $this->newLine();
            $this->warn('متخطى (عالمي/مشترك/opt-in):');
            foreach ($plan['skipped_global_shared'] as $skip) {
                $this->line('  - '.$skip['table'].': '.$skip['reason']);
            }
        }

        if (! empty($plan['conflicts'])) {
            $this->newLine();
            $this->error('تعارضات:');
            foreach ($plan['conflicts'] as $conflict) {
                $this->line('  ['.$conflict['severity'].'] '.$conflict['type'].': '.$conflict['detail']);
            }
        }

        if (! empty($plan['integrity']['checks'])) {
            $this->newLine();
            $this->info('سلامة المصدر:');
            foreach ($plan['integrity']['checks'] as $key => $value) {
                $this->line("  {$key}: {$value}");
            }
        }

        if (! empty($plan['platform'])) {
            $this->newLine();
            $this->info('منصة الإدارة العليا:');
            foreach ($plan['platform'] as $key => $value) {
                $this->line('  '.$key.': '.(is_array($value) ? implode(',', $value) : $value));
            }
        }

        if (! empty($plan['blocking_errors'])) {
            $this->newLine();
            $this->error('أخطاء حاجبة — التنفيذ ممنوع:');
            foreach ($plan['blocking_errors'] as $error) {
                $this->line('  - '.($error['type'] ?? '?').': '.($error['detail'] ?? json_encode($error)));
            }
        }
    }

    private function connectionConfigured(string $name): bool
    {
        return isset(config('database.connections', [])[$name]);
    }
}

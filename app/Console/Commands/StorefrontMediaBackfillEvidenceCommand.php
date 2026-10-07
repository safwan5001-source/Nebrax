<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Commerce\StorefrontMediaEvidenceBackfiller;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * CUST-HV V6b-1 — يكمل دليل بكسل التباين للوسائط السابقة لهذه المرحلة. أداة تشغيلية يدوية ضمن مستأجرٍ
 * واحد معلَن (لا عبور مستأجرين)، محدودة الدفعة، idempotent — كأداة المصالِح؛ لا يُستدعى من مسارٍ حرج.
 */
final class StorefrontMediaBackfillEvidenceCommand extends Command
{
    private const MAX_LIMIT = 1000;

    protected $signature = 'storefront-media:backfill-evidence
        {--tenant= : Tenant UUID (required) — exact tenant scope, never crosses tenants}
        {--limit=200 : Rows examined per kind in this run (max 1000)}
        {--after-assets= : Continue after this asset id (the next cursor printed by the previous run)}
        {--after-derivatives= : Continue after this derivative id (the next cursor printed by the previous run)}
        {--dry-run : Report what would be measured; write nothing}';

    protected $description = 'إكمال دليل بكسل التباين (حدّا القنوات) لوسائط المُخصِّص ومشتقّاتها السابقة — يدوي، محصور بمستأجر، idempotent';

    public function handle(StorefrontMediaEvidenceBackfiller $backfiller): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || ! Str::isUuid($tenantId)) {
            $this->error('The --tenant option must be a UUID.');

            return self::INVALID;
        }
        if (Tenant::query()->find($tenantId) === null) {
            $this->error('Tenant not found.');

            return self::FAILURE;
        }

        $limit = (int) $this->option('limit');
        if ($limit < 1 || $limit > self::MAX_LIMIT) {
            $this->error('The --limit option must be between 1 and '.self::MAX_LIMIT.'.');

            return self::INVALID;
        }

        $after = [
            'assets' => is_string($this->option('after-assets')) && $this->option('after-assets') !== '' ? $this->option('after-assets') : null,
            'derivatives' => is_string($this->option('after-derivatives')) && $this->option('after-derivatives') !== '' ? $this->option('after-derivatives') : null,
        ];
        $stats = $backfiller->run($tenantId, $limit, (bool) $this->option('dry-run'), $after);
        foreach (['assets', 'derivatives', 'failed'] as $key) {
            $this->line($key.': '.$stats[$key]);
        }
        $this->line('dry_run: '.($stats['dry_run'] ? 'yes' : 'no'));
        foreach ($stats['next'] as $kind => $cursor) {
            if ($cursor !== null) {
                $this->line("more {$kind}: re-run with --after-{$kind}={$cursor}");
            }
        }

        return $stats['failed'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}

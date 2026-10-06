<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\Commerce\StorefrontMediaReconciler;
use Illuminate\Console\Command;
use Illuminate\Support\Str;

/**
 * CUST-HV V2c — مصالِح وسائط المُخصِّص (V0 §7.9). أداة تشغيلية يدوية ضمن مستأجرٍ
 * واحد معلَن (لا عبور مستأجرين)، محدودة الدفعة، idempotent. لا تُستدعى من أي
 * مسارٍ حرج (البيئة الإنتاجية بلا `schedule:run`) — انظر `StorefrontMediaReconciler`.
 */
final class StorefrontMediaReconcileCommand extends Command
{
    private const MAX_LIMIT = 1000;

    protected $signature = 'storefront-media:reconcile
        {--tenant= : Tenant UUID (required) — exact tenant scope, never crosses tenants}
        {--limit=200 : Bounded batch size for this run (max 1000)}
        {--dry-run : Report what would be removed; delete nothing}';

    protected $description = 'تطهير وسائط المُخصِّص المحذوفة بعد مهلتها وإزالة مشتقّاتٍ لم يعد يشير إليها شيء — يدوي، محصور بمستأجر، idempotent';

    public function handle(StorefrontMediaReconciler $reconciler): int
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

        $stats = $reconciler->run($tenantId, $limit, (bool) $this->option('dry-run'));

        foreach ($stats as $key => $value) {
            $this->line($key.': '.(is_bool($value) ? ($value ? 'yes' : 'no') : $value));
        }

        return $stats['failed_assets'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}

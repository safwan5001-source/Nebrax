<?php

namespace App\Console\Commands;

use App\Models\Tenant;
use App\Services\ProductMediaR2BackfillService;
use Illuminate\Console\Command;
use RuntimeException;

/**
 * أداة يدوية فقط (AWJ-R2-4C) — لا استدعاء آلي عبر boot/migrations/scheduler/queue.
 * لا تُشغَّل على الإنتاج ضمن هذه الحقبة. لا تحذف المصدر القديم أبداً.
 */
final class AwjProductMediaR2BackfillCommand extends Command
{
    private const MAX_LIMIT = 2000;

    protected $signature = 'awj:product-media-r2-backfill
        {--tenant= : Tenant UUID (required) — exact tenant scope, never crosses tenants}
        {--limit=200 : Bounded batch size for this run (max 2000)}
        {--dry-run : Preview only; no R2 writes and no ProductMedia row changes}';

    protected $description = 'ترحيل يدوي محصور لوسائط منتجٍ قديمة إلى R2 — لا يحذف المصدر، idempotent، آمن لإعادة المحاولة';

    public function handle(ProductMediaR2BackfillService $service): int
    {
        $tenantId = $this->option('tenant');
        if (! is_string($tenantId) || ! $this->isUuid($tenantId)) {
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

        $dryRun = (bool) $this->option('dry-run');

        try {
            $outcome = $service->run($tenantId, $limit, $dryRun);
        } catch (RuntimeException $exception) {
            $this->error('R2 backfill aborted before processing any rows: '.$exception->getMessage());

            return self::FAILURE;
        }

        if ($outcome['results'] !== []) {
            $this->table(
                ['media_id', 'product_id', 'source_disk', 'status'],
                array_map(fn (array $row) => [
                    $row['media_id'], $row['product_id'], $row['source_disk'], $row['status'],
                ], $outcome['results']),
            );
        }

        $this->line('mode: '.($dryRun ? 'dry-run' : 'apply'));
        $this->line('tenant: '.$tenantId);
        $this->line('rows processed: '.count($outcome['results']));
        foreach ($outcome['summary'] as $status => $count) {
            $this->line("{$status}: {$count}");
        }

        $failed = array_sum(array_filter(
            $outcome['summary'],
            fn (string $status) => str_starts_with($status, 'failed_'),
            ARRAY_FILTER_USE_KEY,
        ));

        return $failed > 0 ? self::FAILURE : self::SUCCESS;
    }

    private function isUuid(string $value): bool
    {
        return preg_match('/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i', $value) === 1;
    }
}

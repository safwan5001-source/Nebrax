<?php

namespace App\Console\Commands;

use App\Services\Commerce\FlatHostBackfillException;
use App\Services\Commerce\FlatHostBackfillService;
use Illuminate\Console\Command;

/**
 * Backfill مضيفات المتاجر (الخيار A) — إدراج فقط. يتطلب **بالضبط** واحداً من
 * `--dry-run` أو `--execute`؛ لا افتراضي. المضيفات القديمة تُمرَّر صراحةً بـ`--host`
 * (لا وضع «الكل»). لا يعدّل ولا يحذف أي صف قائم.
 */
class StorefrontFlatHostBackfillCommand extends Command
{
    protected $signature = 'storefront:flat-host-backfill
        {--host=* : مضيف قديم صريح (قابل للتكرار، حتى 10)}
        {--dry-run : عرض ما سيُدرَج دون أي كتابة}
        {--execute : تنفيذ الإدراج فعلياً (خيار صريح منفصل)}';

    protected $description = 'Backfill إدراجي (insert-only) لمضيفات المتاجر المتداخلة القديمة إلى صيغة الخيار A — dry-run أو execute صريح';

    public function handle(FlatHostBackfillService $service): int
    {
        $dry = (bool) $this->option('dry-run');
        $exec = (bool) $this->option('execute');
        if ($dry === $exec) {
            $this->error('حدّد بالضبط واحداً من --dry-run أو --execute.');

            return self::INVALID;
        }

        try {
            $out = $service->run((array) $this->option('host'), $exec);
        } catch (FlatHostBackfillException $e) {
            $this->error("[{$e->reason}] ".$e->getMessage().' — لم يُكتب شيء.');

            return self::FAILURE;
        }

        $this->info(($out['executed'] ? 'EXECUTED' : 'DRY RUN (no writes)').' — base: '.$out['base_domain']);
        $this->table(
            ['legacy', 'target', 'status', 'new_row_active', 'flag'],
            array_map(fn ($r) => [$r['legacy_host'], $r['target_host'], $r['status'], $r['new_row_active'] ? 'true' : 'false', $r['flag'] ?? '-'], $out['results']),
        );

        if ($out['has_drift']) {
            $this->warn('drift: صف هدف قائم بحالة تخالف المطلوب — لم يُعدَّل. يحتاج قراراً.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}

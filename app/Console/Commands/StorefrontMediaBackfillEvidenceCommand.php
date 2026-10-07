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

        // مؤشّرات المتابعة معرّفاتٌ UUID: تُتحقَّق قبل الاستعلام (على PostgreSQL قيمةٌ مثل `nope` في عمود uuid استثناءٌ لا خطأ مُدخَل).
        $after = [];
        foreach (['assets', 'derivatives'] as $kind) {
            $cursor = $this->option("after-{$kind}");
            if ($cursor === null || $cursor === '') {
                $after[$kind] = null;

                continue;
            }
            if (! is_string($cursor) || ! Str::isUuid($cursor)) {
                $this->error("The --after-{$kind} option must be a UUID.");

                return self::INVALID;
            }
            $after[$kind] = $cursor;
        }
        $stats = $backfiller->run($tenantId, $limit, (bool) $this->option('dry-run'), $after);
        foreach (['assets', 'derivatives', 'failed'] as $key) {
            $this->line($key.': '.$stats[$key]);
        }
        $this->line('dry_run: '.($stats['dry_run'] ? 'yes' : 'no'));
        // أمر متابعة واحد كامل بمؤشّري النوعين (النوع المكتمل يبقى بمؤشّره فلا يعود للبداية). وفي dry-run
        // لا يُقترح إلا dry-run: مؤشّر معاينةٍ لم تكتب شيئاً يتخطّى صفوفاً لم تُكتب إن اتُّبع في تشغيلٍ فعلي.
        if (! $stats['done']['assets'] || ! $stats['done']['derivatives']) {
            $parts = ["--tenant={$tenantId}", "--limit={$limit}"];
            if ($stats['dry_run']) {
                $parts[] = '--dry-run';
            }
            foreach (['assets', 'derivatives'] as $kind) {
                if ($stats['next'][$kind] !== null) {
                    $parts[] = "--after-{$kind}={$stats['next'][$kind]}";
                }
            }
            $this->line('more remain — continue with: php artisan storefront-media:backfill-evidence '.implode(' ', $parts));
            if ($stats['dry_run']) {
                $this->line('(dry-run cursors only skip rows that a dry-run examined; do not reuse them for a real run)');
            }
        }

        return $stats['failed'] > 0 ? self::FAILURE : self::SUCCESS;
    }
}

<?php

namespace App\Console\Commands;

use App\Models\PublicApiIdempotencyKey;
use App\Models\PublicApiRequestLog;
use App\Support\PublicApiIdempotency;
use Illuminate\Console\Command;
use Illuminate\Support\Carbon;

/**
 * تقليم سجلّات حماية الـ Public API (PR-4) — احتفاظٌ حتمي يمنع نمو الجدولين بلا
 * حدّ. **بلا اعتماد على طابور خلفي** (الإنتاج `QUEUE_CONNECTION=sync`): أمر
 * Artisan متزامن يُشغَّل يدويًا أو يُجدوَل لاحقًا (cron/‎Scheduler) دون تغيير بنية.
 *
 *  - مفاتيح idempotency: تُحذف المنتهية (`expires_at <= now`). الاحتفاظ الافتراضي
 *    عند الإنشاء = {RETENTION_HOURS}h، فالمنتهي لا قيمة تشغيلية له.
 *  - سجلّ التدقيق: يُحذف الأقدم من نافذة الاحتفاظ (`--audit-days`، افتراضي 90).
 *
 * يتجاوز نطاق المستأجر عمدًا (صيانة منصّة تشمل كل المستأجرين). حذفٌ مجمّع مفهرس
 * (expires_at / created_at) بلا N+1. `--dry-run` يَعُدّ دون حذف.
 */
class PrunePublicApiRecords extends Command
{
    protected $signature = 'public-api:prune
        {--audit-days=90 : نافذة الاحتفاظ بسجلّ التدقيق بالأيام}
        {--dry-run : عُدّ الصفوف المرشّحة للحذف دون حذفها}';

    protected $description = 'يقلّم مفاتيح idempotency المنتهية وسجلّات تدقيق الـ Public API الأقدم من نافذة الاحتفاظ';

    public function handle(): int
    {
        $now = now();
        $auditDays = max(1, (int) $this->option('audit-days'));
        $auditCutoff = $now->copy()->subDays($auditDays);
        $dryRun = (bool) $this->option('dry-run');

        // تجاوز نطاق المستأجر: صيانة منصّة عبر كل المستأجرين.
        $idempotencyQuery = PublicApiIdempotencyKey::query()
            ->withoutGlobalScopes()
            ->where('expires_at', '<=', $now);

        $auditQuery = PublicApiRequestLog::query()
            ->withoutGlobalScopes()
            ->where('created_at', '<', $auditCutoff);

        if ($dryRun) {
            $this->line('idempotency منتهية مرشّحة للحذف: ' . $idempotencyQuery->count());
            $this->line('سجلّات تدقيق أقدم من ' . $auditDays . ' يومًا: ' . $auditQuery->count());

            return self::SUCCESS;
        }

        $idempotencyDeleted = $idempotencyQuery->delete();
        $auditDeleted = $auditQuery->delete();

        $this->line('حُذفت مفاتيح idempotency منتهية: ' . $idempotencyDeleted);
        $this->line('حُذفت سجلّات تدقيق (> ' . $auditDays . ' يومًا): ' . $auditDeleted);
        $this->line('اكتمل التقليم عند ' . Carbon::instance($now)->toDateTimeString() . '.');

        return self::SUCCESS;
    }
}

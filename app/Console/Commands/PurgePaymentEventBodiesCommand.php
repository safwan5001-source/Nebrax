<?php

namespace App\Console\Commands;

use App\Models\PaymentProviderEvent;
use Illuminate\Console\Command;

/**
 * تصفير أجسام أحداث المزوّد الأقدم من نافذة الاحتفاظ (D-20: 180 يوماً ثم هاش فقط — PDPL، R-22).
 *
 * يُصفِّر عمود `body` المشفَّر **فقط**؛ يبقى `body_hash` والمعرّف والحالة والنتيجة (التدقيق ومنع التكرار والمطابقة لا يحتاجان الجسم).
 * لا حذف لأي حدث أبداً (النموذج يمنعه)، ولا مساس بأي مستند مالي. صيانة منصّة تتجاوز نطاق المستأجر عمداً كبقية أوامر التقليم.
 * آمن للتكرار والتزامن: يصفِّر دفعات بمعرّفاتها ويعيد العدّ؛ `--dry-run` يعدّ فقط.
 */
class PurgePaymentEventBodiesCommand extends Command
{
    protected $signature = 'payments:purge-event-bodies {--days= : نافذة الاحتفاظ بالأيام (الافتراضي من الإعداد، الأدنى 30)} {--dry-run : عُدّ المرشّح دون تصفير} {--batch=500 : حجم الدفعة}';

    protected $description = 'يصفّر أجسام أحداث المزوّد الأقدم من نافذة الاحتفاظ ويُبقي البصمة (D-20)';

    public function handle(): int
    {
        $days = $this->option('days') !== null ? (int) $this->option('days') : (int) config('payments.event_body_retention.days', 180);
        if ($days < 30) {
            $this->error('invalid_days: نافذة الاحتفاظ لا تقل عن 30 يوماً.');

            return self::INVALID;
        }
        $cutoff = now('UTC')->subDays($days);
        $batch = max(1, min(5000, (int) $this->option('batch')));
        $candidates = fn () => PaymentProviderEvent::query()->withoutGlobalScopes()->whereNotNull('body')->where('received_at', '<', $cutoff);

        if ($this->option('dry-run')) {
            $this->line(json_encode(['dry_run' => true, 'days' => $days, 'candidates' => $candidates()->count()], JSON_UNESCAPED_UNICODE));

            return self::SUCCESS;
        }

        $cleared = 0;
        do {
            $ids = $candidates()->orderBy('received_at')->limit($batch)->pluck('id')->all();
            if ($ids === []) {
                break;
            }
            // تحديث جماعي مباشر: التصفير هو الاستثناء الوحيد المسموح لتعديل الجسم (حارس النموذج يسمح به وحده)، ولا يغيّر أي حقل آخر.
            $cleared += PaymentProviderEvent::query()->withoutGlobalScopes()->whereIn('id', $ids)->whereNotNull('body')->update(['body' => null]);
        } while (count($ids) === $batch);

        $this->line(json_encode(['dry_run' => false, 'days' => $days, 'cleared' => $cleared], JSON_UNESCAPED_UNICODE));

        return self::SUCCESS;
    }
}

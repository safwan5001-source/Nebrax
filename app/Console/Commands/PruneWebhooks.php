<?php

namespace App\Console\Commands;

use App\Models\WebhookDelivery;
use App\Models\WebhookEvent;
use Illuminate\Console\Command;

/**
 * تقليم سجلّات الـ Webhooks (PR-7) — احتفاظٌ حتميّ يمنع نمو الجداول بلا حدّ. بلا
 * اعتماد على طابور خلفي (كـ`public-api:prune`): يُشغَّل يدويًا أو يُجدوَل.
 *
 *  - التسليمات المُنجَزة الأقدم من نافذة `retention.delivered_days`.
 *  - التسليمات النهائيّة الفاشلة الأقدم من `retention.terminal_days`.
 *  - أحداثٌ بلا أيّ تسليم متبقٍّ وأقدم من نافذة النهائيّة (بعد حذف تسليماتها).
 *
 * يتجاوز نطاق المستأجر عمدًا (صيانة منصّة). لا يمسّ اشتراكًا قائمًا. `--dry-run` يَعُدّ.
 */
class PruneWebhooks extends Command
{
    protected $signature = 'webhooks:prune {--dry-run : عُدّ المرشّح للحذف دون حذف}';

    protected $description = 'يقلّم تسليمات الـ Webhooks المُنجَزة/الفاشلة والأحداث اليتيمة الأقدم من نافذة الاحتفاظ';

    public function handle(): int
    {
        $now = now();
        $deliveredCutoff = $now->copy()->subDays((int) config('webhooks.retention.delivered_days', 30));
        $terminalCutoff = $now->copy()->subDays((int) config('webhooks.retention.terminal_days', 30));
        $dryRun = (bool) $this->option('dry-run');

        $deliveriesQuery = WebhookDelivery::query()
            ->withoutGlobalScopes()
            ->where(function ($q) use ($deliveredCutoff, $terminalCutoff) {
                $q->where(function ($d) use ($deliveredCutoff) {
                    $d->where('status', WebhookDelivery::STATUS_DELIVERED)->where('delivered_at', '<', $deliveredCutoff);
                })->orWhere(function ($f) use ($terminalCutoff) {
                    $f->where('status', WebhookDelivery::STATUS_FAILED)->where('failed_at', '<', $terminalCutoff);
                });
            });

        // أحداثٌ يتيمة (بلا تسليمات) وأقدم من نافذة النهائيّة.
        $orphanEventsQuery = fn () => WebhookEvent::query()
            ->withoutGlobalScopes()
            ->where('created_at', '<', $terminalCutoff)
            ->whereDoesntHave('deliveries');

        if ($dryRun) {
            $this->line('تسليمات مرشّحة للحذف: ' . $deliveriesQuery->count());
            $this->line('أحداث يتيمة مرشّحة للحذف: ' . $orphanEventsQuery()->count());

            return self::SUCCESS;
        }

        $deliveriesDeleted = $deliveriesQuery->delete();
        // بعد حذف التسليمات، احذف الأحداث التي لم يبقَ لها تسليم.
        $eventsDeleted = $orphanEventsQuery()->delete();

        $this->line('حُذفت تسليمات: ' . $deliveriesDeleted);
        $this->line('حُذفت أحداث يتيمة: ' . $eventsDeleted);
        $this->line('اكتمل تقليم الـ Webhooks عند ' . $now->toDateTimeString() . '.');

        return self::SUCCESS;
    }
}

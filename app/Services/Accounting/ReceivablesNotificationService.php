<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\User;
use App\Services\NotificationService;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/** Read-only projection of actionable sales receivable due states. */
class ReceivablesNotificationService
{
    private const DUE_SOON_DAYS = 3;

    /** @return array{scanned:int, notified:int} */
    public function scanTenant(string $tenantId, ?Carbon $today = null): array
    {
        $today ??= today();
        $invoices = Invoice::withoutGlobalScopes()
            ->where('tenant_id', $tenantId)
            ->where('type', 'sale')
            ->where('status', 'posted')
            ->whereNotNull('due_date')
            ->where('due_date', '<=', $today->copy()->addDays(self::DUE_SOON_DAYS)->toDateString())
            ->get()
            ->filter(fn (Invoice $invoice): bool => $invoice->remaining() > 0);

        $notified = 0;
        foreach ($invoices as $invoice) {
            $kind = $this->kind($invoice, $today);
            if ($kind !== null) {
                $notified += $this->notify($tenantId, $invoice, $kind, $today);
            }
        }

        return ['scanned' => $invoices->count(), 'notified' => $notified];
    }

    private function kind(Invoice $invoice, Carbon $today): ?string
    {
        $due = Carbon::parse($invoice->due_date)->startOfDay();
        $date = $today->copy()->startOfDay();
        if ($due->lt($date)) return 'overdue';
        if ($due->equalTo($date)) return 'due_today';
        if ($due->lte($date->copy()->addDays(self::DUE_SOON_DAYS))) return 'due_soon';
        return null;
    }

    private function notify(string $tenantId, Invoice $invoice, string $kind, Carbon $today): int
    {
        $labels = [
            'due_soon' => ['warning', 'فاتورة تقترب من الاستحقاق', 'توجد فاتورة مبيعات بمتبقي مستحق خلال الأيام الثلاثة القادمة.'],
            'due_today' => ['warning', 'فاتورة مستحقة اليوم', 'توجد فاتورة مبيعات بمتبقي مستحق اليوم.'],
            'overdue' => ['critical', 'فاتورة متأخرة السداد', 'توجد فاتورة مبيعات مرحلة تجاوزت تاريخ الاستحقاق وما زال عليها رصيد متبقٍ.'],
        ];
        [$severity, $title, $message] = $labels[$kind];
        $dueDate = $invoice->due_date?->toDateString();
        // due-soon/today are transition notifications; overdue is a deliberate daily reminder.
        $bucket = $kind === 'overdue' ? $today->toDateString() : $dueDate;
        $notifications = app(NotificationService::class);
        $count = 0;

        foreach ($this->recipients($tenantId, $invoice) as $recipient) {
            $notifications->deliver([
                'tenant_id' => $tenantId,
                'recipient_id' => $recipient->id,
                'category' => 'alert',
                'type' => "receivables.{$kind}",
                'severity' => $severity,
                'title' => $title,
                'message' => $message,
                'source_type' => 'invoice',
                'source_id' => $invoice->id,
                'action' => 'view_receivable_invoice',
                'data' => ['due_date' => $dueDate, 'remaining' => $invoice->remaining()],
                'dedupe_key' => "receivables.{$kind}:{$invoice->id}:{$bucket}",
            ]);
            $count++;
        }

        return $count;
    }

    /** @return Collection<int, User> */
    private function recipients(string $tenantId, Invoice $invoice): Collection
    {
        return User::query()
            ->where('tenant_id', $tenantId)
            ->where('is_active', true)
            ->get()
            ->filter(fn (User $user): bool => $user->hasPermission('invoices.manage')
                && ($invoice->branch_id === null || $user->canAccessBranch($invoice->branch_id)))
            ->values();
    }
}

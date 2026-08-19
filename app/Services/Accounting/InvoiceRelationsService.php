<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Support\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * علاقات فاتورة المبيعات للقراءة فقط.
 *
 * لا تنشئ هذه الخدمة دفعة أو قيداً ولا تعدّل حالة الفاتورة. وهي تفصل رقم
 * التخصيص الخاص بالفاتورة عن مبلغ سند القبض الكلي، لأن سنداً واحداً قد يغطي
 * أكثر من فاتورة.
 */
class InvoiceRelationsService
{
    /**
     * @return Collection<int, array{id:string,number:string,payment_date:?string,method:string,status:string,amount:string,allocated_amount:string}>
     */
    public function payments(Invoice $invoice, Builder $payments): Collection
    {
        return $payments
            ->where('direction', 'received')
            ->where(function (Builder $query) use ($invoice) {
                $query->where('invoice_id', $invoice->id)
                    ->orWhereHas('allocations', function (Builder $allocations) use ($invoice) {
                        $allocations
                            ->where('allocatable_type', Invoice::class)
                            ->where('allocatable_id', $invoice->id);
                    });
            })
            ->with([
                'allocations' => function ($allocations) use ($invoice) {
                    $allocations
                        ->where('allocatable_type', Invoice::class)
                        ->where('allocatable_id', $invoice->id);
                },
            ])
            ->orderByDesc('payment_date')
            ->orderByDesc('created_at')
            ->get()
            ->map(function (Payment $payment) use ($invoice): array {
                $allocation = $payment->allocations->first();
                // التخصيصات تُنشأ دائماً للسند الجديد. النسخ التاريخية التي تحمل
                // `invoice_id` فقط تعرض مبلغها الكامل بديلاً آمناً ومحدداً.
                $allocated = $allocation?->amount
                    ?? ($payment->invoice_id === $invoice->id ? $payment->amount : 0);

                return [
                    'id'               => $payment->id,
                    'number'           => $payment->number,
                    'payment_date'     => optional($payment->payment_date)->toDateString(),
                    'method'           => $payment->method,
                    'status'           => $payment->status,
                    'amount'           => Money::toRiyal($payment->amount),
                    'allocated_amount' => Money::toRiyal($allocated),
                ];
            })
            ->values();
    }

    /**
     * @return array{sales_entry:array<string,mixed>|null,cost_entry:array<string,mixed>|null}
     */
    public function accountingLinks(Invoice $invoice): array
    {
        $invoice->loadMissing([
            'journalEntry.lines.account',
            'cogsEntry.lines.account',
        ]);

        return [
            'sales_entry' => $this->entry($invoice->journalEntry),
            'cost_entry'  => $this->entry($invoice->cogsEntry),
        ];
    }

    /**
     * @return array{id:string,number:string,date:?string,status:string,description:?string,lines:array<int,array{account_id:string,account_code:?string,account_name:?string,description:?string,debit:string,credit:string}>}|null
     */
    private function entry(?JournalEntry $entry): ?array
    {
        if ($entry === null) {
            return null;
        }

        return [
            'id'          => $entry->id,
            'number'      => $entry->number,
            'date'        => optional($entry->entry_date)->toDateString(),
            'status'      => $entry->status,
            'description' => $entry->description,
            'lines'       => $entry->lines->map(fn ($line): array => [
                'account_id'   => $line->account_id,
                'account_code' => $line->account?->code,
                'account_name' => $line->account?->name,
                'description'  => $line->description,
                'debit'        => Money::toRiyal($line->debit),
                'credit'       => Money::toRiyal($line->credit),
            ])->values()->all(),
        ];
    }
}

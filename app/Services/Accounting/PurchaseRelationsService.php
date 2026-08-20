<?php

namespace App\Services\Accounting;

use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\Purchase;
use App\Support\Money;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * علاقات فاتورة الشراء للقراءة فقط.
 *
 * لا تنشئ هذه الخدمة سند صرف أو قيداً ولا تعدّل حالة الشراء. مبلغ التخصيص هو
 * الحقيقة المعروضة لأن سند الصرف الواحد قد يوزّع على أكثر من فاتورة شراء.
 */
class PurchaseRelationsService
{
    /**
     * @return Collection<int, array{id:string,number:string,payment_date:?string,method:string,status:string,amount:string,allocated_amount:string}>
     */
    public function payments(Purchase $purchase, Builder $payments): Collection
    {
        return $payments
            ->where('direction', 'paid')
            ->whereHas('allocations', function (Builder $allocations) use ($purchase) {
                $allocations
                    ->where('allocatable_type', Purchase::class)
                    ->where('allocatable_id', $purchase->id);
            })
            ->with([
                'allocations' => function ($allocations) use ($purchase) {
                    $allocations
                        ->where('allocatable_type', Purchase::class)
                        ->where('allocatable_id', $purchase->id);
                },
            ])
            ->orderByDesc('payment_date')
            ->orderByDesc('created_at')
            ->get()
            ->map(function (Payment $payment): array {
                $allocation = $payment->allocations->first();

                return [
                    'id'               => $payment->id,
                    'number'           => $payment->number,
                    'payment_date'     => optional($payment->payment_date)->toDateString(),
                    'method'           => $payment->method,
                    'status'           => $payment->status,
                    'amount'           => Money::toRiyal($payment->amount),
                    'allocated_amount' => Money::toRiyal($allocation?->amount ?? 0),
                ];
            })
            ->values();
    }

    /**
     * @return array{purchase_entry:array<string,mixed>|null}
     */
    public function accountingLinks(Purchase $purchase): array
    {
        $purchase->loadMissing('journalEntry.lines.account');

        return ['purchase_entry' => $this->entry($purchase->journalEntry)];
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

<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementItem;
use App\Models\Purchase;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يعكس سند قبض/صرف مرحّلاً دون تعديل القيد الأصلي أو حذف تخصيصاته التاريخية.
 *
 * مصدر حقيقة السداد بعد العكس هو مجموع تخصيصات السندات التي ما زالت posted،
 * لا طرح مبلغ السند المعكوس من paid_amount بصورة عمياء.
 *
 * PAY-V2-5: عكس السند لا يفترض استرداد رسوم المزوّد. إذا كان السند
 * جزءاً من تسوية بوابة مرحّلة يُرفض العكس حتى توجد سياسة رد مستقلة.
 */
class PaymentReversalService
{
    public function __construct(protected LedgerService $ledger) {}

    public function reverse(Payment $payment, ?string $date = null, ?string $reason = null): Payment
    {
        if (! $payment->isPosted()) {
            throw new RuntimeException('لا يمكن عكس سند غير مرحّل.');
        }

        return DB::transaction(function () use ($payment, $date, $reason) {
            // يمنع عكس السند نفسه مرتين بالتزامن؛ LedgerService يعيد قفل القيد أيضاً.
            $payment = Payment::lockForUpdate()->findOrFail($payment->id);
            if (! $payment->isPosted()) {
                throw new RuntimeException('لا يمكن عكس سند غير مرحّل.');
            }
            if (! $payment->journal_entry_id) {
                throw new RuntimeException('لا يمكن عكس سند بلا قيد أصلي.');
            }

            $settled = PaymentGatewaySettlementItem::query()
                ->where('payment_id', $payment->id)
                ->whereHas('settlement', fn ($query) => $query->where('status', PaymentGatewaySettlement::STATUS_POSTED))
                ->exists();
            if ($settled) {
                throw new RuntimeException(
                    'لا يمكن عكس سند مُسوّى عبر تسوية بوابة. التسوية حدث مالي مستقل ولا تُفترض قابلية استرداد رسوم المزوّد.'
                );
            }

            $entry = $payment->journalEntry()->first();
            if (! $entry) {
                throw new RuntimeException('القيد الأصلي للسند غير موجود.');
            }

            // ترتيب ثابت قبل الأقفال لتقليل احتمال deadlock عند تعدد المستندات.
            $allocations = $payment->allocations()
                ->orderBy('allocatable_type')
                ->orderBy('allocatable_id')
                ->get();

            /** @var array<string, Model> $targets */
            $targets = [];
            foreach ($allocations as $allocation) {
                $class = $allocation->allocatable_type;
                if (! in_array($class, [Invoice::class, Purchase::class], true)) {
                    throw new RuntimeException('نوع المستند المخصَّص غير مدعوم لعكس السند.');
                }

                $key = $class.'|'.$allocation->allocatable_id;
                if (! isset($targets[$key])) {
                    $target = $class::lockForUpdate()->find($allocation->allocatable_id);
                    if (! $target) {
                        throw new RuntimeException('المستند المخصَّص غير موجود.');
                    }
                    $targets[$key] = $target;
                }
            }

            // يعكس السطور الفعلية المخزنة في القيد الأصلي، ويحترم قفل الفترة
            // وتوارث فرع الأصل داخل LedgerService. لا إعادة حل لمسارات الحسابات.
            $reversal = $this->ledger->reverse(
                $entry,
                $date,
                $reason ?? "عكس سند {$payment->number}"
            );

            // غيّر الحالة قبل إعادة التجميع كي لا تدخل تخصيصات هذا السند في المجموع.
            $payment->update([
                'status' => 'reversed',
                'reversal_entry_id' => $reversal->id,
                'reversed_at' => now(),
            ]);

            foreach ($targets as $key => $target) {
                [$class, $id] = explode('|', $key, 2);
                $paid = (int) PaymentAllocation::query()
                    ->where('allocatable_type', $class)
                    ->where('allocatable_id', $id)
                    ->whereHas('payment', fn ($query) => $query->where('status', 'posted'))
                    ->sum('amount');

                $target->update([
                    'paid_amount' => $paid,
                    'payment_status' => $this->paymentStatus($paid, (int) $target->total),
                ]);
            }

            return $payment->fresh(['journalEntry', 'reversalEntry', 'allocations']);
        });
    }

    private function paymentStatus(int $paid, int $total): string
    {
        if ($paid <= 0) {
            return 'unpaid';
        }

        return $paid >= $total ? 'paid' : 'partial';
    }
}

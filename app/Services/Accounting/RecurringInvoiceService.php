<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\RecurringInvoice;
use App\Models\RecurringInvoiceLine;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  RecurringInvoiceService — الفواتير الدورية (قالب + جدولة)
 * ═══════════════════════════════════════════════════════════════
 *  - create():   ينشئ قالباً ويحسب إجمالياته من السطور.
 *  - generate(): يولّد فاتورة مبيعات draft من القالب عبر InvoiceService،
 *                ويقدّم تاريخ التشغيل التالي حسب التكرار.
 *
 *  القالب غير محاسبي. الفاتورة المولّدة draft (بلا قيد) حتى تُرحَّل.
 *  كل المبالغ بالهللات.
 */
class RecurringInvoiceService
{
    public function __construct(protected InvoiceService $invoices) {}

    /**
     * @param  array  $data   ['partner_id'=>uuid, 'title'=>?, 'payment_type'=>?, 'frequency'=>?, 'start_date'=>?, 'end_date'=>?, 'notes'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): RecurringInvoice
    {
        if (empty($items)) {
            throw new RuntimeException('الفاتورة الدورية يجب أن تحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $start = $data['start_date'] ?? now()->toDateString();

            $rec = RecurringInvoice::create([
                'title'         => $data['title'] ?? null,
                'partner_id'    => $data['partner_id'],
                'payment_type'  => $data['payment_type'] ?? 'credit',
                'frequency'     => $data['frequency'] ?? 'monthly',
                'start_date'    => $start,
                'next_run_date' => $start,
                'end_date'      => $data['end_date'] ?? null,
                'active'        => $data['active'] ?? true,
                'notes'         => $data['notes'] ?? null,
                'created_by'    => $data['created_by'] ?? null,
            ]);

            $subtotal = $taxTotal = 0;

            foreach ($items as $item) {
                $qty       = (int) ($item['quantity'] ?? 1);
                $unitPrice = (int) ($item['unit_price'] ?? 0);
                $rate      = (int) ($item['tax_rate'] ?? 15);

                if ($qty <= 0 || $unitPrice < 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
                }

                $lineSubtotal = $qty * $unitPrice;
                $lineTax      = $this->calcTax($lineSubtotal, $rate);

                RecurringInvoiceLine::create([
                    'recurring_invoice_id' => $rec->id,
                    'product_id'           => $item['product_id'] ?? null,
                    'description'          => $item['description'] ?? null,
                    'quantity'             => $qty,
                    'unit_price'           => $unitPrice,
                    'tax_rate'             => $rate,
                    'line_subtotal'        => $lineSubtotal,
                    'line_tax'             => $lineTax,
                    'line_total'           => $lineSubtotal + $lineTax,
                ]);

                $subtotal += $lineSubtotal;
                $taxTotal += $lineTax;
            }

            $rec->update([
                'subtotal'   => $subtotal,
                'tax_amount' => $taxTotal,
                'total'      => $subtotal + $taxTotal,
            ]);

            return $rec->load('lines');
        });
    }

    /**
     * توليد فاتورة مبيعات draft من القالب وتقديم موعد التشغيل التالي.
     */
    public function generate(RecurringInvoice $rec): Invoice
    {
        if (! $rec->active) {
            throw new RuntimeException('القالب غير نشِط.');
        }

        return DB::transaction(function () use ($rec) {
            $rec->loadMissing('lines');

            $items = $rec->lines->map(fn (RecurringInvoiceLine $l) => [
                'product_id'  => $l->product_id,
                'description' => $l->description,
                'quantity'    => $l->quantity,
                'unit_price'  => $l->unit_price,
                'tax_rate'    => $l->tax_rate,
            ])->all();

            $invoice = $this->invoices->create([
                'partner_id'   => $rec->partner_id,
                'payment_type' => $rec->payment_type,
                'invoice_date' => now()->toDateString(),
                'notes'        => $rec->title ? "فاتورة دورية: {$rec->title}" : 'فاتورة دورية',
                'created_by'   => $rec->created_by,
            ], $items);

            $next = $this->advance(Carbon::parse($rec->next_run_date), $rec->frequency);
            $stillActive = ! $rec->end_date || $next->lte(Carbon::parse($rec->end_date));

            $rec->update([
                'next_run_date'   => $next->toDateString(),
                'generated_count' => $rec->generated_count + 1,
                'active'          => $stillActive,
            ]);

            return $invoice;
        });
    }

    /** تقديم التاريخ حسب التكرار. */
    protected function advance(Carbon $date, string $frequency): Carbon
    {
        return match ($frequency) {
            'weekly'    => $date->copy()->addWeek(),
            'quarterly' => $date->copy()->addMonths(3),
            'yearly'    => $date->copy()->addYear(),
            default     => $date->copy()->addMonth(),
        };
    }

    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }
}

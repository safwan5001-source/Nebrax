<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Quote;
use App\Models\QuoteLine;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  QuoteService — عروض الأسعار (مستند غير محاسبي)
 * ═══════════════════════════════════════════════════════════════
 *  - create():  ينشئ عرض سعر ويحسب الإجماليات من السطور (مصدر الحقيقة).
 *  - convert(): يحوّل العرض إلى فاتورة مبيعات (draft) عبر InvoiceService.
 *
 *  عرض السعر لا يولّد أي قيد محاسبي. الأثر المحاسبي يبدأ فقط عند ترحيل
 *  الفاتورة الناتجة عبر InvoiceService::post (المحرك). كل المبالغ بالهللات.
 */
class QuoteService
{
    public function __construct(protected InvoiceService $invoices) {}

    /**
     * إنشاء عرض سعر بحالة draft مع احتساب الإجماليات من السطور.
     *
     * @param  array  $data   ['partner_id'=>uuid, 'quote_date'=>?, 'valid_until'=>?, 'notes'=>?, 'status'=>?, 'number'=>?]
     * @param  array  $items  [['product_id'=>?, 'description'=>?, 'quantity'=>int, 'unit_price'=>int, 'tax_rate'=>?int], ...]
     */
    public function create(array $data, array $items): Quote
    {
        if (empty($items)) {
            throw new RuntimeException('عرض السعر يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data, $items) {
            $date = $data['quote_date'] ?? now()->toDateString();

            $quote = Quote::create([
                'number'      => $data['number'] ?? $this->nextNumber($date),
                'partner_id'  => $data['partner_id'],
                'quote_date'  => $date,
                'valid_until' => $data['valid_until'] ?? null,
                'status'      => $data['status'] ?? 'draft',
                'notes'       => $data['notes'] ?? null,
                'created_by'  => $data['created_by'] ?? null,
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

                QuoteLine::create([
                    'quote_id'      => $quote->id,
                    'product_id'    => $item['product_id'] ?? null,
                    'description'   => $item['description'] ?? null,
                    'quantity'      => $qty,
                    'unit_price'    => $unitPrice,
                    'tax_rate'      => $rate,
                    'line_subtotal' => $lineSubtotal,
                    'line_tax'      => $lineTax,
                    'line_total'    => $lineSubtotal + $lineTax,
                ]);

                $subtotal += $lineSubtotal;
                $taxTotal += $lineTax;
            }

            $quote->update([
                'subtotal'   => $subtotal,
                'tax_amount' => $taxTotal,
                'total'      => $subtotal + $taxTotal,
            ]);

            return $quote->load('lines');
        });
    }

    /**
     * تحويل عرض السعر إلى فاتورة مبيعات (draft). لا ترحيل تلقائي —
     * يراجع المستخدم الفاتورة ثم يرحّلها (فيبدأ الأثر المحاسبي عبر المحرك).
     */
    public function convert(Quote $quote, string $paymentType = 'credit'): Invoice
    {
        if ($quote->isConverted()) {
            throw new RuntimeException('عرض السعر مُحوَّل بالفعل إلى فاتورة.');
        }

        return DB::transaction(function () use ($quote, $paymentType) {
            $quote->loadMissing('lines');

            $items = $quote->lines->map(fn (QuoteLine $l) => [
                'product_id'  => $l->product_id,
                'description' => $l->description,
                'quantity'    => $l->quantity,
                'unit_price'  => $l->unit_price,
                'tax_rate'    => $l->tax_rate,
            ])->all();

            $invoice = $this->invoices->create([
                'partner_id'   => $quote->partner_id,
                'payment_type' => $paymentType,
                'notes'        => "محوّل من عرض السعر {$quote->number}",
                'created_by'   => $quote->created_by,
            ], $items);

            $quote->update([
                'status'               => 'converted',
                'converted_invoice_id' => $invoice->id,
            ]);

            return $invoice;
        });
    }

    /**
     * تعديل عرض سعر: حقول الرأس، وإن مُرّرت سطور جديدة تُستبدل القديمة
     * وتُعاد الإجماليات من السطور. ممنوع تعديل عرض محوّل.
     */
    public function update(Quote $quote, array $data, ?array $items): Quote
    {
        if ($quote->isConverted()) {
            throw new RuntimeException('لا يمكن تعديل عرض سعر مُحوَّل إلى فاتورة.');
        }

        return DB::transaction(function () use ($quote, $data, $items) {
            $quote->update(array_filter([
                'partner_id'  => $data['partner_id'] ?? null,
                'quote_date'  => $data['quote_date'] ?? null,
                'valid_until' => $data['valid_until'] ?? null,
                'status'      => $data['status'] ?? null,
                'notes'       => $data['notes'] ?? null,
            ], fn ($v) => $v !== null));

            if ($items !== null) {
                if (empty($items)) {
                    throw new RuntimeException('عرض السعر يجب أن يحتوي على سطر واحد على الأقل.');
                }
                $quote->lines()->delete();

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

                    QuoteLine::create([
                        'quote_id'      => $quote->id,
                        'product_id'    => $item['product_id'] ?? null,
                        'description'   => $item['description'] ?? null,
                        'quantity'      => $qty,
                        'unit_price'    => $unitPrice,
                        'tax_rate'      => $rate,
                        'line_subtotal' => $lineSubtotal,
                        'line_tax'      => $lineTax,
                        'line_total'    => $lineSubtotal + $lineTax,
                    ]);

                    $subtotal += $lineSubtotal;
                    $taxTotal += $lineTax;
                }

                $quote->update([
                    'subtotal'   => $subtotal,
                    'tax_amount' => $taxTotal,
                    'total'      => $subtotal + $taxTotal,
                ]);
            }

            return $quote->fresh('lines');
        });
    }

    /** حساب الضريبة كعدد صحيح (تقريب نصفي لأعلى) — بلا float. */
    protected function calcTax(int $base, int $rate): int
    {
        return intdiv($base * $rate + 50, 100);
    }

    /** توليد رقم عرض تسلسلي: QUO-2025-00001 */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = Quote::whereYear('quote_date', $year)->count() + 1;

        return sprintf('QUO-%s-%05d', $year, $count);
    }
}

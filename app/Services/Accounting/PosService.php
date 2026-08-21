<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PosService — إتمام بيع نقطة البيع بوسائل دفع متعدّدة (ذرّياً)
 * ═══════════════════════════════════════════════════════════════
 *  البيع = فاتورة مبيعات **آجلة** (كامل المبلغ على الذمم 1130) تُرحَّل، ثم
 *  **سند قبض لكل وسيلة** يُسدّدها ويوجّهها لحسابها الصحيح:
 *    - نقد   → طريقة cash → مدين 1110 الصندوق / دائن 1130
 *    - بطاقة/تحويل → طريقة bank → مدين 1120 البنك / دائن 1130
 *    - آجل   → يبقى على 1130 (غير مسدَّد)
 *  الفكّة من النقد (لا تُسجَّل خصماً من الذمم). كلّه في معاملة واحدة.
 *
 *  يعيد استخدام المحرّكين المختبَرين (InvoiceService + PaymentService) — لا كتابة
 *  مباشرة في journal_lines.
 */
class PosService
{
    public function __construct(
        protected InvoiceService $invoices,
        protected PaymentService $payments,
    ) {}

    /**
     * @param  array  $data  ['partner_id'=>uuid, 'tax_inclusive'=>?bool, 'items'=>[...],
     *                        'tenders'=>['cash'=>int,'card'=>int,'transfer'=>int,'credit'=>int], 'created_by'=>?]
     */
    public function checkout(array $data): Invoice
    {
        if (empty($data['items'])) {
            throw new RuntimeException('البيع يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data) {
            // 1) فاتورة آجلة (كامل الإجمالي على الذمم) ثم ترحيلها.
            $invoice = $this->invoices->create([
                'partner_id'    => $data['partner_id'],
                'warehouse_id'  => $data['warehouse_id'] ?? null,
                'payment_type'  => 'credit',
                'tax_inclusive' => (bool) ($data['tax_inclusive'] ?? false),
                'notes'         => $data['notes'] ?? 'بيع نقطة بيع',
                'created_by'    => $data['created_by'] ?? null,
                'minimum_price_override_actor_id' => $data['minimum_price_override_actor_id'] ?? null,
            ], $data['items']);
            $invoice = $this->invoices->post($invoice);

            $total    = (int) $invoice->total;
            $tenders  = $data['tenders'] ?? [];
            $cash     = max(0, (int) ($tenders['cash'] ?? 0));
            $card     = max(0, (int) ($tenders['card'] ?? 0));
            $transfer = max(0, (int) ($tenders['transfer'] ?? 0));
            $credit   = max(0, (int) ($tenders['credit'] ?? 0));

            // المبالغ المطبَّقة على الفاتورة: الآجل يبقى، والباقي يُسدَّد؛ الفكّة من النقد.
            $creditApplied   = min($credit, $total);
            $owedNow         = $total - $creditApplied;
            $cardApplied     = min($card, $owedNow);
            $transferApplied = min($transfer, $owedNow - $cardApplied);
            $cashApplied     = $owedNow - $cardApplied - $transferApplied;

            if ($cashApplied < 0) {
                throw new RuntimeException('المبالغ المدفوعة لا تغطّي إجمالي البيع.');
            }

            $bankApplied = $cardApplied + $transferApplied;

            // 2) سند نقد (مدين 1110).
            if ($cashApplied > 0) {
                $this->payments->post($this->payments->create([
                    'partner_id' => $invoice->partner_id,
                    'invoice_id' => $invoice->id,
                    'direction'  => 'received',
                    'method'     => 'cash',
                    'amount'     => $cashApplied,
                    'notes'      => "نقد — بيع {$invoice->number}",
                    'created_by' => $data['created_by'] ?? null,
                ]));
            }

            // 3) سند بنكي للبطاقة/التحويل (مدين 1120).
            if ($bankApplied > 0) {
                $this->payments->post($this->payments->create([
                    'partner_id' => $invoice->partner_id,
                    'invoice_id' => $invoice->id,
                    'direction'  => 'received',
                    'method'     => 'bank',
                    'amount'     => $bankApplied,
                    'notes'      => "بطاقة/تحويل — بيع {$invoice->number}",
                    'created_by' => $data['created_by'] ?? null,
                ]));
            }

            return $invoice->fresh(['lines']);
        });
    }
}

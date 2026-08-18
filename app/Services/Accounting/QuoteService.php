<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Quote;
use App\Models\QuoteLine;
use App\Services\PrintTemplates\PrintTemplateService;
use App\Support\Settings;
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
    use ComputesLineTax;

    public function __construct(
        protected InvoiceService $invoices,
        protected PrintTemplateService $printTemplates,
    ) {}

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

            $inclusive = (bool) ($data['tax_inclusive'] ?? false);

            $quote = Quote::create([
                'number'        => $data['number'] ?? $this->nextNumber($date),
                'partner_id'    => $data['partner_id'],
                'quote_date'    => $date,
                // صلاحية افتراضية من إعدادات المبيعات حين لا يحدّدها المستخدم —
                // فيخرج العرض بتاريخ انتهاء بدل أن يبقى مفتوحاً إلى الأبد.
                'valid_until'   => $data['valid_until'] ?? $this->defaultValidUntil($date),
                'status'        => $data['status'] ?? 'draft',
                'tax_inclusive' => $inclusive,
                'notes'         => $data['notes'] ?? null,
                'revised_from_id' => $data['revised_from_id'] ?? null,
                'created_by'    => $data['created_by'] ?? null,
            ]);

            [$subtotal, $taxTotal] = $this->writeLines($quote, $items, $inclusive);

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
                'partner_id'    => $quote->partner_id,
                'payment_type'  => $paymentType,
                'tax_inclusive' => $quote->tax_inclusive, // يحافظ على وضع الضريبة عند التحويل
                'notes'         => "محوّل من عرض السعر {$quote->number}",
                'created_by'    => $quote->created_by,
            ], $items);

            $quote->update([
                'status'               => 'converted',
                'converted_invoice_id' => $invoice->id,
            ]);

            return $invoice;
        });
    }

    /**
     * يصدر عرض السعر للطباعة في لحظة صريحة. تثبت المراجع الثلاثة داخل المعاملة؛
     * والقيمة null تعني العارض الافتراضي الآمن وقت الإصدار، لا تعييناً حياً لاحقاً.
     */
    public function issueForPrint(Quote $quote): Quote
    {
        return DB::transaction(function () use ($quote) {
            $quote = Quote::lockForUpdate()->findOrFail($quote->id);

            if ($quote->isConverted()) {
                throw new RuntimeException('لا يمكن إصدار عرض سعر مُحوَّل إلى فاتورة.');
            }
            if ($quote->isPrintIssued()) {
                throw new RuntimeException('عرض السعر صادر للطباعة بالفعل. أنشئ نسخة عمل لإجراء تعديل.');
            }

            $quote->update([
                ...$this->printTemplates->resolveOutputRevisionIds('quotation', $quote->branch_id),
                'print_issued_at' => now(),
            ]);

            return $quote->fresh('lines');
        });
    }

    /**
     * ينشئ نسخة مسودة مستقلة من عرض صادر. تبقى اللقطة والمستند الأصلي ثابتين
     * ويبدأ التعديل اللاحق من رقم جديد قابل للإصدار بذاته.
     */
    public function createPrintRevision(Quote $quote): Quote
    {
        return DB::transaction(function () use ($quote) {
            $quote = Quote::with('lines')->lockForUpdate()->findOrFail($quote->id);

            if (! $quote->isPrintIssued()) {
                throw new RuntimeException('لا يمكن إنشاء نسخة عمل من عرض غير صادر للطباعة.');
            }

            return $this->create([
                'partner_id'      => $quote->partner_id,
                'quote_date'      => $quote->quote_date?->toDateString(),
                'valid_until'     => $quote->valid_until?->toDateString(),
                'tax_inclusive'   => $quote->tax_inclusive,
                'notes'           => $quote->notes,
                'revised_from_id' => $quote->id,
                'created_by'      => $quote->created_by,
            ], $this->itemsOf($quote));
        });
    }

    /**
     * تعديل عرض سعر: حقول الرأس، وإن مُرّرت سطور جديدة تُستبدل القديمة
     * وتُعاد الإجماليات من السطور. المستند الصادر أو المحوّل لا يُعدّل.
     */
    public function update(Quote $quote, array $data, ?array $items): Quote
    {
        if ($quote->isConverted()) {
            throw new RuntimeException('لا يمكن تعديل عرض سعر مُحوَّل إلى فاتورة.');
        }
        if ($quote->isPrintIssued()) {
            throw new RuntimeException('لا يمكن تعديل عرض سعر صادر للطباعة. أنشئ نسخة عمل أولاً.');
        }

        return DB::transaction(function () use ($quote, $data, $items) {
            $quote->update(array_filter([
                'partner_id'    => $data['partner_id'] ?? null,
                'quote_date'    => $data['quote_date'] ?? null,
                'valid_until'   => $data['valid_until'] ?? null,
                'status'        => $data['status'] ?? null,
                'tax_inclusive' => $data['tax_inclusive'] ?? null,
                'notes'         => $data['notes'] ?? null,
            ], fn ($v) => $v !== null));

            if ($items !== null) {
                if (empty($items)) {
                    throw new RuntimeException('عرض السعر يجب أن يحتوي على سطر واحد على الأقل.');
                }
                $quote->lines()->delete();

                // الوضع بعد التحديث (المُمرَّر إن وُجد، وإلا المخزَّن).
                [$subtotal, $taxTotal] = $this->writeLines($quote, $items, (bool) $quote->tax_inclusive);

                $quote->update([
                    'subtotal'   => $subtotal,
                    'tax_amount' => $taxTotal,
                    'total'      => $subtotal + $taxTotal,
                ]);
            }

            return $quote->fresh('lines');
        });
    }

    /** @return array<int, array{product_id: ?string, description: ?string, quantity: int, unit_price: int, tax_rate: int}> */
    protected function itemsOf(Quote $quote): array
    {
        $quote->loadMissing('lines');

        return $quote->lines->map(fn (QuoteLine $line) => [
            'product_id' => $line->product_id,
            'description' => $line->description,
            'quantity' => $line->quantity,
            'unit_price' => $line->unit_price,
            'tax_rate' => $line->tax_rate,
        ])->all();
    }

    /**
     * يكتب سطور العرض ويعيد [الإجمالي قبل الضريبة، إجمالي الضريبة] حسب الوضع:
     * متضمّن → تُستخرَج الضريبة من السعر؛ غير متضمّن → تُضاف فوقه.
     *
     * @return array{0:int,1:int}
     */
    protected function writeLines(Quote $quote, array $items, bool $inclusive): array
    {
        $subtotal = $taxTotal = 0;

        foreach ($items as $item) {
            $qty       = (int) ($item['quantity'] ?? 1);
            $unitPrice = (int) ($item['unit_price'] ?? 0);
            $rate      = (int) ($item['tax_rate'] ?? (int) Settings::get('sales', 'default_tax_rate'));

            if ($qty <= 0 || $unitPrice < 0) {
                throw new RuntimeException('الكمية يجب أن تكون موجبة والسعر غير سالب.');
            }

            $lineGross = $qty * $unitPrice;
            [$lineNet, $lineTax] = $this->splitLineTax($lineGross, $rate, $inclusive);

            QuoteLine::create([
                'quote_id'      => $quote->id,
                'product_id'    => $item['product_id'] ?? null,
                'description'   => $item['description'] ?? null,
                'quantity'      => $qty,
                'unit_price'    => $unitPrice,
                'tax_rate'      => $rate,
                'line_subtotal' => $lineNet,
                'line_tax'      => $lineTax,
                'line_total'    => $lineNet + $lineTax,
            ]);

            $subtotal += $lineNet;
            $taxTotal += $lineTax;
        }

        return [$subtotal, $taxTotal];
    }

    /**
     * تاريخ انتهاء الصلاحية من `sales.quote_validity_days`.
     * صفرٌ يعني «بلا انتهاء» — فيبقى الحقل فارغاً كما كان قبل الإعداد.
     */
    protected function defaultValidUntil(string $date): ?string
    {
        $days = (int) Settings::get('sales', 'quote_validity_days');

        return $days > 0 ? \Illuminate\Support\Carbon::parse($date)->addDays($days)->toDateString() : null;
    }

    /** توليد رقم عرض تسلسلي: QUO-2025-00001 */
    protected function nextNumber(string $date): string
    {
        return Quote::nextDocumentNumber('QUO', $date);
    }
}

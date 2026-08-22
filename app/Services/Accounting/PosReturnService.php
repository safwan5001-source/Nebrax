<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PosSession;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\User;
use App\Support\PosSettings;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * مرتجعات نقطة البيع.
 *
 * لا يملك هذا المسار منطق قيد أو مخزون مستقلاً: يبني لقطة سطور مرتجعة من
 * فاتورة POS المصدر، ثم يستدعي ReturnService ليُنشئ ويرحّل المستند عبر
 * LedgerService. وظيفته الخاصة هي صحة سياق الجلسة، سياسة رد النقد، وسجل التدقيق.
 */
class PosReturnService
{
    public function __construct(
        protected PosSessionService $sessions,
        protected ReturnService $returns,
    ) {}

    /**
     * @param array{pos_session_id:string,original_invoice_id:string,payment_type:string,items:array<int,array{source_line_id:string,quantity:int}>,restock?:bool,notes?:string} $data
     */
    /**
     * معاينة بلا كتابة: تعيد المصدر والسطور المشتقة وسقف رد النقد الفعلي لكي
     * تقول الواجهة الحقيقة قبل زر الاعتماد، لا بعد ظهور خطأ من الخادم.
     *
     * @return array{session:PosSession,invoice:Invoice,items:array,total:int,cash_block_reason:?string}
     */
    public function quote(array $data, User $actor): array
    {
        $session = $this->sessions->requireOpenForCheckout(
            $data['pos_session_id'],
            $actor->id,
            $actor,
        );
        $invoice = BranchScope::reference(Invoice::class)
            ->with('lines')
            ->findOrFail($data['original_invoice_id']);
        $this->assertSourceMatchesSession($invoice, $session);
        $items = $this->buildSourceItems($invoice, $data['items']);
        $total = $this->refundTotal($items);

        return [
            'session' => $session,
            'invoice' => $invoice,
            'items' => $items,
            'total' => $total,
            'cash_block_reason' => $this->cashRefundBlockReason($invoice, $session, $total),
        ];
    }

    public function create(array $data, User $actor): ReturnDocument
    {
        return DB::transaction(function () use ($data, $actor) {
            $quote = $this->quote($data, $actor);
            /** @var PosSession $session */
            $session = $quote['session'];
            /** @var Invoice $invoice */
            $invoice = $quote['invoice'];
            $items = $quote['items'];

            if ($data['payment_type'] === 'cash' && $quote['cash_block_reason'] !== null) {
                throw new RuntimeException($quote['cash_block_reason']);
            }

            $return = $this->returns->create([
                'type' => 'sales',
                'partner_id' => $invoice->partner_id,
                'warehouse_id' => $session->warehouse_id,
                'pos_session_id' => $session->id,
                'payment_type' => $data['payment_type'],
                'tax_inclusive' => $invoice->tax_inclusive,
                'return_date' => now()->toDateString(),
                'restock' => $data['restock'] ?? null,
                'notes' => $data['notes'] ?? null,
                'original_id' => $invoice->id,
                'original_type' => Invoice::class,
                'created_by' => $actor->id,
            ], $items);

            $posted = $this->returns->post($return);
            $this->sessions->recordReturn($session, $posted, $actor);

            return $posted;
        });
    }

    private function assertSourceMatchesSession(Invoice $invoice, PosSession $session): void
    {
        if (! $invoice->isPosted()) {
            throw new RuntimeException('لا يمكن إرجاع فاتورة POS غير مرحّلة.');
        }
        if ($invoice->pos_session_id === null) {
            throw new RuntimeException('الفاتورة المصدر ليست عملية نقطة بيع مرتبطة بجلسة.');
        }
        if ($invoice->pos_session_id !== $session->id) {
            throw new RuntimeException('يجب تنفيذ مرتجع POS في جلسة البيع الأصلية المفتوحة.');
        }
        if ($invoice->branch_id !== $session->branch_id) {
            throw new RuntimeException('فاتورة POS المصدر لا تخص فرع الجلسة النشطة.');
        }
        if ($invoice->warehouse_id !== $session->warehouse_id) {
            throw new RuntimeException('مخزن فاتورة POS المصدر لا يطابق مخزن جلسة الكاشير.');
        }
    }

    /**
     * يبني السطر من لقطة الفاتورة، لا من مدخلات الواجهة. التوزيع على الكميات
     * صحيح حتى آخر هللة: المرتجع النهائي يأخذ الباقي بعد ما رُدّ من السطر نفسه.
     *
     * @param array<int,array{source_line_id:string,quantity:int}> $requested
     * @return array<int,array<string,int|string|null>>
     */
    private function buildSourceItems(Invoice $invoice, array $requested): array
    {
        $sourceLines = $invoice->lines->keyBy('id');
        $returned = ReturnLine::query()
            ->whereIn('source_line_id', $sourceLines->keys())
            ->whereHas('return', fn ($query) => $query->where('status', 'posted'))
            ->selectRaw('source_line_id, SUM(quantity) as quantity, SUM(line_subtotal) as subtotal, SUM(line_discount) as discount, SUM(line_tax) as tax')
            ->groupBy('source_line_id')
            ->get()
            ->keyBy('source_line_id');

        $items = [];
        foreach ($requested as $item) {
            $line = $sourceLines->get($item['source_line_id']);
            if (! $line) {
                throw new RuntimeException('البند المطلوب إرجاعه لا يخص فاتورة POS المصدر.');
            }
            if (! $line->product_id) {
                throw new RuntimeException('لا يمكن إرجاع سطر POS بلا منتج مثبت.');
            }

            $quantity = (int) $item['quantity'];
            $sold = (int) $line->quantity;
            $previous = $returned->get($line->id);
            $returnedQuantity = (int) ($previous?->quantity ?? 0);
            $remainingQuantity = $sold - $returnedQuantity;
            if ($quantity > $remainingQuantity) {
                throw new RuntimeException("الكمية المردودة ({$quantity}) تتجاوز المتبقي ({$remainingQuantity}) في فاتورة POS المصدر.");
            }

            $isFinalPart = $quantity === $remainingQuantity;
            $subtotal = $this->allocate((int) $line->line_subtotal, $sold, $quantity, (int) ($previous?->subtotal ?? 0), $isFinalPart);
            $discount = $this->allocate((int) $line->line_discount, $sold, $quantity, (int) ($previous?->discount ?? 0), $isFinalPart);
            $tax = $this->allocate((int) $line->line_tax, $sold, $quantity, (int) ($previous?->tax ?? 0), $isFinalPart);

            $items[] = [
                'source_line_id' => $line->id,
                'product_id' => $line->product_id,
                'description' => $line->description ?? $line->product_name_snapshot,
                'quantity' => $quantity,
                // يبقى سعر المصدر لقيد «لا أعلى مما بيع» في ReturnService؛ أما
                // أساس السطر والخصم والضريبة فهي لقطة موزعة بدقة أدناه.
                'unit_price' => (int) $line->unit_price,
                'tax_rate' => (int) $line->tax_rate,
                'line_subtotal_override' => $subtotal,
                'line_discount' => $discount,
                'line_tax_override' => $tax,
            ];
        }

        return $items;
    }

    /** يوزع قيمة المصدر بالكمية؛ المرتجع الأخير يحمل بقايا هللات كل الأجزاء السابقة. */
    private function allocate(int $sourceAmount, int $sourceQuantity, int $quantity, int $alreadyAllocated, bool $isFinalPart): int
    {
        if ($isFinalPart) {
            return max(0, $sourceAmount - $alreadyAllocated);
        }

        return intdiv($sourceAmount * $quantity, $sourceQuantity);
    }

    /** @param array<int,array<string,int|string|null>> $items */
    private function refundTotal(array $items): int
    {
        return array_sum(array_map(
            fn (array $item) => ($item['line_subtotal_override'] - $item['line_discount']) + $item['line_tax_override'],
            $items,
        ));
    }

    private function cashRefundBlockReason(Invoice $invoice, PosSession $session, int $refundTotal): ?string
    {
        if ($refundTotal <= 0) {
            return 'مبلغ رد النقد يجب أن يكون موجباً.';
        }

        if (PosSettings::cashRefundPolicy() === PosSettings::CASH_REFUND_ORIGINAL_CASH_ONLY) {
            $cashReceived = (int) Payment::where('invoice_id', $invoice->id)
                ->where('status', 'posted')
                ->where('direction', 'received')
                ->where('method', 'cash')
                ->sum('amount');
            $cashRefunded = (int) ReturnDocument::where('type', 'sales')
                ->where('status', 'posted')
                ->where('payment_type', 'cash')
                ->where('original_type', Invoice::class)
                ->where('original_id', $invoice->id)
                ->sum('total');
            $available = $cashReceived - $cashRefunded;

            if ($refundTotal > $available) {
                return 'سياسة نقطة البيع تسمح برد النقد حتى المبلغ النقدي المقبوض على الفاتورة المصدر فقط.';
            }
        }

        $expected = $this->sessions->report($session)['expected'];
        if ($refundTotal > $expected) {
            return 'لا يمكن رد نقد يتجاوز الرصيد المتوقع داخل درج الجلسة.';
        }

        return null;
    }
}

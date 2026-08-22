<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\QuotePosExchangeRequest;
use App\Http\Requests\StorePosSaleRequest;
use App\Http\Requests\StorePosExchangeRequest;
use App\Http\Requests\StorePosReturnRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PosExchangeResource;
use App\Http\Resources\ReturnResource;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PosExchange;
use App\Models\Payment;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Support\Money;
use App\Support\PosSettings;
use App\Services\Accounting\PosService;
use App\Services\Accounting\PosExchangeService;
use App\Services\Accounting\PosReturnService;
use App\Services\Accounting\PosSessionService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosController extends ApiController
{
    public function __construct(
        protected PosService $pos,
        protected PosReturnService $returns,
        protected PosExchangeService $exchanges,
        protected PosSessionService $sessions,
    ) {}

    /**
     * إتمام بيع نقطة البيع بوسائل متعدّدة (ذرّياً): فاتورة آجلة مرحّلة + سندات قبض
     * (نقد→1110، بطاقة/تحويل→1120). يعيد الفاتورة الناتجة.
     */
    public function checkout(StorePosSaleRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['created_by'] = $request->user()?->id;
        $data['minimum_price_override_actor_id'] = $request->user()?->id;
        $data['actor'] = $request->user();

        // عزل: المراجع تخصّ المستأجر الحالي.
        Partner::findOrFail($data['partner_id']);
        $this->assertWarehouseAllowed($data['warehouse_id'] ?? null, $this->activeBranchId());
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');

        $invoice = $this->domain(fn () => $this->pos->checkout($data));

        return (new InvoiceResource($invoice->load('lines')))->response()->setStatusCode(201);
    }

    /**
     * فواتير الكاشير القابلة للمرتجع في جلسته المفتوحة فقط. لا تعرض الواجهة
     * فواتير فرع أو كاشير آخر، وتكشف سقف النقد المتبقي وفق السياسة قبل الإرسال.
     */
    public function returnableInvoices(Request $request): JsonResponse
    {
        $data = $request->validate(['pos_session_id' => ['required', 'uuid']]);
        $session = $this->domain(fn () => $this->sessions->requireOpenForCheckout(
            $data['pos_session_id'],
            $request->user()?->id,
            $request->user(),
        ));
        $policy = PosSettings::cashRefundPolicy();
        $invoices = Invoice::with('partner')
            ->where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->orderByDesc('invoice_date')
            ->orderByDesc('created_at')
            ->get();
        $refunds = ReturnDocument::where('type', 'sales')
            ->where('status', 'posted')
            ->where('payment_type', 'cash')
            ->where('original_type', Invoice::class)
            ->whereIn('original_id', $invoices->pluck('id'))
            ->groupBy('original_id')
            ->selectRaw('original_id, SUM(total) as amount')
            ->pluck('amount', 'original_id');
        $cashReceived = Payment::whereIn('invoice_id', $invoices->pluck('id'))
            ->where('status', 'posted')
            ->where('direction', 'received')
            ->where('method', 'cash')
            ->groupBy('invoice_id')
            ->selectRaw('invoice_id, SUM(amount) as amount')
            ->pluck('amount', 'invoice_id');
        $exchangeCash = PosExchange::whereIn('original_invoice_id', $invoices->pluck('id'))
            ->where('status', 'posted')
            ->groupBy('original_invoice_id')
            ->selectRaw('original_invoice_id, SUM(cash_refund_amount) as amount')
            ->pluck('amount', 'original_invoice_id');

        return response()->json(['data' => $invoices->map(function (Invoice $invoice) use ($policy, $refunds, $cashReceived, $exchangeCash) {
            $cashAvailable = max(0, (int) ($cashReceived[$invoice->id] ?? 0) - (int) ($refunds[$invoice->id] ?? 0) - (int) ($exchangeCash[$invoice->id] ?? 0));

            return [
                'id' => $invoice->id,
                'number' => $invoice->number,
                'invoice_date' => optional($invoice->invoice_date)->toDateString(),
                'customer_name' => $invoice->partner?->name,
                'total' => Money::toRiyal($invoice->total),
                'cash_refund_policy' => $policy,
                'cash_refund_available' => Money::toRiyal($cashAvailable),
            ];
        })->values()]);
    }

    /** بنود فاتورة POS القابلة للمرتجع في الجلسة المفتوحة، بكمية متبقية صادقة. */
    public function returnableInvoice(Request $request, string $id): JsonResponse
    {
        $data = $request->validate(['pos_session_id' => ['required', 'uuid']]);
        $session = $this->domain(fn () => $this->sessions->requireOpenForCheckout(
            $data['pos_session_id'],
            $request->user()?->id,
            $request->user(),
        ));
        $invoice = Invoice::with(['partner', 'lines.product'])
            ->where('pos_session_id', $session->id)
            ->where('status', 'posted')
            ->findOrFail($id);
        $returned = ReturnLine::whereIn('source_line_id', $invoice->lines->pluck('id'))
            ->whereHas('return', fn ($query) => $query->where('status', 'posted'))
            ->groupBy('source_line_id')
            ->selectRaw('source_line_id, SUM(quantity) as quantity, SUM(line_total) as total')
            ->get()
            ->keyBy('source_line_id');

        return response()->json(['data' => [
            'id' => $invoice->id,
            'number' => $invoice->number,
            'customer_name' => $invoice->partner?->name,
            'total' => Money::toRiyal($invoice->total),
            'lines' => $invoice->lines->map(function ($line) use ($returned) {
                $previous = $returned->get($line->id);
                $already = (int) ($previous?->quantity ?? 0);
                $returnedTotal = (int) ($previous?->total ?? 0);
                $lineTotal = (int) $line->line_total;

                return [
                    'source_line_id' => $line->id,
                    'description' => $line->product_name_snapshot ?? $line->product?->name ?? $line->description,
                    'quantity' => (int) $line->quantity,
                    'returned' => $already,
                    'remaining' => max(0, (int) $line->quantity - $already),
                    'line_total' => Money::toRiyal($lineTotal),
                    'returned_total' => Money::toRiyal($returnedTotal),
                    'remaining_total' => Money::toRiyal(max(0, $lineTotal - $returnedTotal)),
                ];
            })->values(),
        ]]);
    }

    /** معاينة مرتجع POS من دون إنشاء مستند أو أثر محاسبي. */
    public function quoteReturn(StorePosReturnRequest $request): JsonResponse
    {
        $data = $request->validated();
        $quote = $this->domain(fn () => $this->returns->quote($data, $request->user()));

        return response()->json(['data' => [
            'total' => Money::toRiyal($quote['total']),
            'cash_allowed' => $quote['cash_block_reason'] === null,
            'cash_block_reason' => $quote['cash_block_reason'],
        ]]);
    }

    /** معاينة الاستبدال قبل الترحيل؛ لا تنشئ مستنداً أو قيداً أو حركة مخزون. */
    public function quoteExchange(QuotePosExchangeRequest $request): JsonResponse
    {
        $quote = $this->domain(fn () => $this->exchanges->quote($request->validated(), $request->user()));

        return response()->json(['data' => [
            'return_total' => Money::toRiyal($quote['return_total']),
            'exchange_surplus_policy' => $quote['exchange_surplus_policy'],
            'cash_allowed' => $quote['cash_allowed'],
            'cash_block_reason' => $quote['cash_block_reason'],
        ]]);
    }

    /**
     * استبدال POS ذري: مرتجع مبيعات ائتماني + بيع بديل، وتبقى تسوية الفائض
     * رصيداً للعميل أو نقداً وفق إعدادات POS وسياسة الدرج الفعلية.
     */
    public function storeExchange(StorePosExchangeRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertTenantOwnedAll(Product::class, array_column($data['replacement']['items'], 'product_id'), 'المنتج');

        $result = $this->domain(fn () => $this->exchanges->create($data, $request->user()));
        $exchange = $result['exchange']->load(['originalInvoice', 'returnDocument', 'replacementInvoice']);

        return (new PosExchangeResource($exchange))->response()->setStatusCode(201);
    }

    /**
     * مرتجع POS ذري من فاتورة البيع المصدر: الجلسة والسعر والضريبة والعميل
     * تُحسم في الخدمة من المستند المرحّل، ثم يرحّل ReturnService القيد والمخزون.
     */
    public function storeReturn(StorePosReturnRequest $request): JsonResponse
    {
        $return = $this->domain(fn () => $this->returns->create($request->validated(), $request->user()));

        return (new ReturnResource($return->load('lines.product')))->response()->setStatusCode(201);
    }
}

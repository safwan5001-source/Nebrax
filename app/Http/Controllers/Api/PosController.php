<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\QuotePosExchangeRequest;
use App\Http\Requests\ResumePosHeldSaleRequest;
use App\Http\Requests\StorePosHeldSaleRequest;
use App\Http\Requests\StorePosSaleRequest;
use App\Http\Requests\StorePosExchangeRequest;
use App\Http\Requests\StorePosReturnRequest;
use App\Http\Resources\InvoiceResource;
use App\Http\Resources\PosExchangeResource;
use App\Http\Resources\PosHeldSaleResource;
use App\Http\Resources\ProductResource;
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
use App\Services\Accounting\PosCustomerPriceListResolver;
use App\Services\Accounting\PosHeldSaleService;
use App\Services\Accounting\PosReturnService;
use App\Services\Accounting\PosSessionService;
use App\Services\Pos\PosIdempotencyConflictException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PosController extends ApiController
{
    public function __construct(
        protected PosService $pos,
        protected PosReturnService $returns,
        protected PosExchangeService $exchanges,
        protected PosHeldSaleService $heldSales,
        protected PosSessionService $sessions,
        protected PosCustomerPriceListResolver $customerPriceLists,
    ) {}

    /**
     * كتالوج الكاشير التشغيلي: منتجات نشطة ضمن سياسة تصنيفات POS فقط. لا تعتمد
     * الواجهة على فلترة محلية لأن العقد نفسه يحرس الإتمام داخل PosService.
     */
    public function products(Request $request): JsonResponse
    {
        $data = $request->validate(['partner_id' => ['nullable', 'uuid']]);
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']);
        }
        $priceList = $this->customerPriceLists->forPartner($data['partner_id'] ?? null);

        $products = PosSettings::constrainProductsByCategory(
            Product::query()->where('is_active', true)
        )->with([
            'productCategory',
            'productBrand',
            'unitTemplate.units',
            'alternateBarcodes',
            // وسائط المنتج خاصة؛ نحمّلها فقط في كتالوج الكاشير لا في قوائم المنتجات العامة.
            'media' => fn ($query) => $query->orderBy('sort_order')->orderByDesc('created_at'),
        ])
            ->latest()
            ->get();
        $catalogUnits = $this->customerPriceLists->catalogUnitsFor($priceList, $products);

        $products->each(function (Product $product) use ($catalogUnits): void {
            // قيم عرض عابرة للكتالوج؛ لا تعدّل المنتج المخزن ولا تعيد تفسير
            // فاتورة تاريخية. الوحدة الأساسية متاحة دائماً، والبديلة لا تظهر
            // إلا بسعر صريح من قائمة العميل النشطة.
            $units = $catalogUnits[$product->id] ?? [];
            $allowedUnits = collect($units)->pluck('name')->all();
            $product->setAttribute('pos_units', $units);
            // لا يحمل الكاشير باركوداً لوحدة بديلة لا تظهر له أصلاً. الباركود
            // الأساسي التاريخي يبقى في حقل المنتج ويرتبط بوحدة الأساس.
            $product->setAttribute('pos_barcodes', $product->alternateBarcodes
                ->filter(fn ($barcode) => in_array($barcode->unit_name, $allowedUnits, true))
                ->map(fn ($barcode) => [
                    'code' => $barcode->code,
                    'unit_name' => $barcode->unit_name,
                    'default_quantity' => (int) $barcode->default_quantity,
                ])
                ->values()
                ->all());
            $product->setAttribute('sale_price', $units[0]['price'] ?? (int) $product->sale_price);
        });

        return ProductResource::collection($products)->response();
    }

    /**
     * إتمام بيع نقطة البيع بوسائل متعدّدة (ذرّياً): فاتورة آجلة مرحّلة + سندات قبض
     * (نقد→1110، بطاقة/تحويل→1120). يعيد الفاتورة الناتجة.
     * إعادة الإرسال بنفس `idempotency_key` وحمولة متطابقة تعيد الفاتورة الأصلية (200)
     * بلا بيع ثانٍ؛ حمولة مختلفة بنفس المفتاح → 409.
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

        try {
            $invoice = $this->domain(fn () => $this->pos->checkout($data));
        } catch (PosIdempotencyConflictException $exception) {
            return response()->json(['message' => $exception->getMessage()], 409);
        }

        $replayed = (bool) $invoice->getAttribute('idempotent_replay');

        // تُحمّل لقطة الإيصال الحراري المثبّتة مع فاتورة البيع الجديد، كي تعرض
        // واجهة POS المعاينة والطباعة من قرار المحرك وقت الترحيل لا من تعيين حي
        // قد يتغير بعد إتمام البيع.
        $response = (new InvoiceResource($invoice->load(['lines', 'thermalTemplateRevision'])))
            ->response()
            ->setStatusCode($replayed ? 200 : 201);
        $payload = $response->getData(true);
        if ($replayed) {
            $payload['idempotent_replay'] = true;
        }
        $drawerAction = $invoice->getAttribute('cash_drawer_action');
        if (is_array($drawerAction)) {
            $payload['cash_drawer_action'] = $drawerAction;
        }
        $response->setData($payload);

        return $response;
    }

    /**
     * آخر فواتير POS المرحّلة في نطاق الفرع النشط. لا يخلط الاستعلام الفواتير
     * العادية بفواتير الكاشير لأن `pos_session_id` شرط صريح، ولا يحمل السجل كاملاً
     * إلى المتصفح قبل تطبيق الحد والترتيب.
     */
    public function recentInvoices(Request $request): JsonResponse
    {
        $limit = (int) ($request->validate([
            'limit' => ['nullable', 'integer', 'min:1', 'max:50'],
        ])['limit'] ?? 20);

        $invoices = $this->scopeToActiveBranch(
            Invoice::query()
                ->with('partner:id,name')
                ->whereNotNull('pos_session_id')
                ->where('status', 'posted')
                ->orderByDesc('invoice_date')
                ->orderByDesc('created_at'),
            $request,
        )->limit($limit)->get();

        $paymentsByInvoice = Payment::query()
            ->whereIn('invoice_id', $invoices->pluck('id'))
            ->where('status', 'posted')
            ->where('direction', 'received')
            ->orderBy('created_at')
            ->get(['invoice_id', 'payment_method_name', 'method'])
            ->groupBy('invoice_id');

        return response()->json(['data' => $invoices->map(function (Invoice $invoice) use ($paymentsByInvoice) {
            $methods = ($paymentsByInvoice->get($invoice->id) ?? collect())
                ->map(fn (Payment $payment) => $payment->payment_method_name ?: $payment->method)
                ->filter()
                ->unique()
                ->values();

            return [
                'id' => $invoice->id,
                'number' => $invoice->number,
                'invoice_date' => optional($invoice->invoice_date)->toDateString(),
                'created_at' => optional($invoice->created_at)->toIso8601String(),
                'customer_name' => $invoice->partner?->name,
                'total' => Money::toRiyal((int) $invoice->total),
                'payment_status' => $invoice->payment_status,
                'payment_methods' => $methods,
                'status' => $invoice->status,
            ];
        })->values()]);
    }

    /** يعرض مسودات الكاشير القابلة للاستئناف في الجلسة والمخزن المطابقين فقط. */
    public function heldSales(Request $request): JsonResponse
    {
        $data = $request->validate(['pos_session_id' => ['required', 'uuid']]);
        $held = $this->domain(fn () => $this->heldSales->list($data['pos_session_id'], $request->user()));

        return PosHeldSaleResource::collection($held)->response();
    }

    /** يحفظ سلة POS تشغيلية فقط؛ لا ينشئ فاتورة أو قبضاً أو قيداً أو حركة مخزون. */
    public function storeHeldSale(StorePosHeldSaleRequest $request): JsonResponse
    {
        $data = $request->validated();
        if (! empty($data['customer_id'])) {
            Partner::findOrFail($data['customer_id']);
        }
        $this->assertTenantOwnedAll(Product::class, array_column($data['items'], 'product_id'), 'المنتج');
        $held = $this->domain(fn () => $this->heldSales->hold($data, $request->user()));

        return (new PosHeldSaleResource($held))->response()->setStatusCode(201);
    }

    /** يستأنف السلة مرة واحدة فقط؛ تعود لقطة السلة إلى الواجهة ولا تنشئ بيعاً. */
    public function resumeHeldSale(ResumePosHeldSaleRequest $request, string $id): JsonResponse
    {
        $held = $this->domain(fn () => $this->heldSales->resume($id, $request->validated()['pos_session_id'], $request->user()));

        return (new PosHeldSaleResource($held))->response();
    }

    /** يلغي مسودة غير مالية قابلة للاستئناف داخل سياق الجلسة والكاشير الصحيح. */
    public function discardHeldSale(ResumePosHeldSaleRequest $request, string $id): JsonResponse
    {
        $this->domain(fn () => $this->heldSales->discard($id, $request->validated()['pos_session_id'], $request->user()));

        return response()->json(['data' => null]);
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

<?php

namespace App\Services\Commerce;

use App\Models\CommerceOrder;
use App\Models\CommerceOrderPosting;
use App\Models\CommercePaymentIntent;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\PaymentAttemptPosting;
use App\Models\Product;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingPeriodLockedException;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Support\CommerceInvoiceOnPayment;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  جسر الطلب المدفوع ← الفاتورة والقيود — PAY-H4-03 (D-13 خيار A)
 * ═══════════════════════════════════════════════════════════════
 *  يُستدعى من `PaymentAttemptPostingService` **داخل معاملة ترحيل الالتقاط وتحت قفل المحاولة** (لا يعمل وحده). ينسّق فقط ولا يكتب في الأستاذ:
 *   1) فاتورة مبيعات `InvoiceService::create` + `post` (أسعار شاملة الضريبة، آجلة غير مسدَّدة، ZATCA مبسّطة): قيد الفاتورة (مدين العملاء 1130 /
 *      دائن الإيرادات والضريبة)، وإخراج المخزون وتكلفة البضاعة المباعة كما تفعل الفاتورة العادية — **الإخراج والـCOGS هنا فقط، لا عند الحجز**.
 *   2) استهلاك حجز المخزون (`consume`) لا يُنشئ حركة بذاته؛ الحركة من الفاتورة.
 *   3) سند قبض A1 مرتبط بالبوابة `PaymentService::create/post` (مدين 1170 تسوية البوابة / دائن 1130 العملاء) مخصَّص للفاتورة بمبلغ الالتقاط كاملاً.
 *   4) مِرساة `commerce_order_postings` (طلب ↔ فاتورة ↔ سند ↔ محاولة، كلٌّ فريد) + صف `payment_attempt_postings`.
 *  **المبدأ:** إجمالي الفاتورة يجب أن يساوي المبلغ المدفوع (= إجمالي الطلب) حرفياً، وإلا لا ترحيل (`not_postable` برمز) — لا تقريب صامت ولا فاتورة بمبلغ مختلف.
 *  الشحن: صافٍ + ضريبة 15% (ثابتة في `InvoiceService`) والفرق التقريبي بالهللة في `adjustment` فيبقى الإجمالي = ما دُفع.
 *  الفترة/السنة المقفلة: `AccountingPeriodLockedException` تخرج كما هي ⇒ تراجع كامل وتُسجَّل `blocked_period` في المنسّق (إعادة ترحيل صريحة بعد الفتح).
 *  أي رفض عمل (غير استثناء الفترة) يُرجع نتيجة `not_postable` برمز، والتراجع لما أنشأه الجسر بنقطة حفظ (savepoint) داخل المعاملة نفسها.
 */
final class CommerceOrderPostingService
{
    public const OUTCOME_POSTED = 'posted';

    public const OUTCOME_ALREADY_POSTED = 'already_posted';

    public const OUTCOME_SKIPPED = 'skipped';

    public const OUTCOME_NOT_POSTABLE = 'not_postable';

    private const VAT_RATE = 15;

    public function __construct(
        private readonly InvoiceService $invoices,
        private readonly PaymentService $payments,
        private readonly CommerceOrderReservationService $reservations,
        private readonly FulfillmentPolicyService $fulfillment,
    ) {}

    public static function handles(string $payableKey): bool
    {
        return str_starts_with($payableKey, CommercePaymentIntent::PAYABLE_TYPE.':');
    }

    /**
     * @param  PaymentAttempt  $attempt  مقفلة ومحمَّلة داخل معاملة المنسّق
     * @return array{0: string, 1: ?string} [النتيجة، رمز السبب عند not_postable]
     */
    public function post(PaymentAttempt $attempt, string $date): array
    {
        $intent = CommercePaymentIntent::query()->lockForUpdate()->find(substr((string) $attempt->payable_key, strlen(CommercePaymentIntent::PAYABLE_TYPE) + 1));
        if ($intent === null || ! $intent->isOnline()) {
            return [self::OUTCOME_NOT_POSTABLE, 'intent_missing'];
        }
        if ($intent->isCancelled()) {
            return [self::OUTCOME_NOT_POSTABLE, 'intent_cancelled']; // التقاط متأخر بعد الإلغاء: مراجعة بشرية (D-15)
        }
        if (! $intent->isPaid()) {
            return [self::OUTCOME_SKIPPED, null]; // لم تُثبَّت النية بعد؛ يعيد المستمع/المطابِق المحاولة
        }

        $order = CommerceOrder::query()->with('lines')->lockForUpdate()->find($intent->commerce_order_id);
        if ($order === null) {
            return [self::OUTCOME_NOT_POSTABLE, 'order_missing'];
        }
        if (CommerceOrderPosting::query()->where('commerce_order_id', $order->id)->orWhere('payment_attempt_id', $attempt->id)->exists()) {
            return [self::OUTCOME_ALREADY_POSTED, null];
        }
        if (! CommerceInvoiceOnPayment::active()) {
            return [self::OUTCOME_SKIPPED, null]; // أُغلقت البوابة/السياسة بعد الالتقاط: لا ترحيل رجعي تلقائي
        }
        if ($order->partner_id === null) {
            return [self::OUTCOME_SKIPPED, null]; // سياسة manual_link: ينتظر ربط موظف
        }
        $total = (int) $order->total;
        if ($total <= 0 || (int) $attempt->captured_minor !== $total || (int) $intent->amount_minor !== $total) {
            return [self::OUTCOME_NOT_POSTABLE, 'amount_mismatch'];
        }
        $partner = Partner::query()->withoutGlobalScope(\App\Tenancy\BranchScope::class)->find($order->partner_id);
        if ($partner === null || ! $partner->is_active || ! $partner->isCustomer()) {
            return [self::OUTCOME_NOT_POSTABLE, 'partner_unavailable'];
        }

        $products = Product::query()->withoutGlobalScope(\App\Tenancy\BranchScope::class)->whereIn('id', $order->lines->pluck('product_id')->all())->get()->keyBy('id');
        foreach ($order->lines as $line) {
            $product = $products->get($line->product_id);
            if ($product === null) {
                return [self::OUTCOME_NOT_POSTABLE, 'product_missing'];
            }
            // الأسعار شاملة 15% حصراً (المعدل الصفري/المخفّض/المعفى يحتاج تصنيفاً ضريبياً = EXT-05/REM-12) ⇒ لا ترحيل آلي.
            if ((int) $product->tax_rate !== self::VAT_RATE) {
                return [self::OUTCOME_NOT_POSTABLE, 'unsupported_tax_rate'];
            }
        }

        $warehouse = null;
        if ($products->contains(fn (Product $p): bool => (bool) $p->track_inventory)) {
            try {
                $warehouse = $this->fulfillment->resolveWarehouseFor($order->sales_channel_id);
            } catch (FulfillmentPolicyNotConfiguredException) {
                return [self::OUTCOME_NOT_POSTABLE, 'fulfillment_not_configured'];
            }
        }

        try {
            // نقطة حفظ: رفض عمل لاحق يتراجع عمّا أنشأه الجسر وحده، دون إسقاط معاملة المنسّق (تُسجَّل النتيجة فيها).
            return DB::transaction(fn (): array => $this->issue($attempt, $order, $partner, $warehouse, $date));
        } catch (AccountingPeriodLockedException $e) {
            throw $e;
        } catch (CommerceOrderPostingRejection $e) {
            return [self::OUTCOME_NOT_POSTABLE, $e->reason];
        } catch (RuntimeException $e) {
            report($e);

            return [self::OUTCOME_NOT_POSTABLE, 'invoice_post_failed'];
        }
    }

    /** @return array{0: string, 1: ?string} */
    private function issue(PaymentAttempt $attempt, CommerceOrder $order, Partner $partner, ?Warehouse $warehouse, string $date): array
    {
        $total = (int) $order->total;

        $delivery = max(0, (int) $order->delivery_amount_minor);
        // الشحن المدفوع شامل 15%: الصافي = round(D / 1.15)؛ الفرق التقريبي بالهللة تسوية غير خاضعة للضريبة تُبقي الإجمالي = ما دُفع.
        $shipNet = $delivery > 0 ? intdiv($delivery * 100 + 57, 115) : 0;
        $shipVat = $shipNet > 0 ? intdiv($shipNet * self::VAT_RATE + 50, 100) : 0;
        $adjustment = $delivery - ($shipNet + $shipVat);

        $items = [];
        foreach ($order->lines->sortBy(fn ($l) => $l->product_id.'|'.($l->product_variant_id ?? '').'|'.$l->id, SORT_STRING) as $line) {
            $item = [
                'product_id' => $line->product_id,
                'product_variant_id' => $line->product_variant_id,
                'description' => $line->product_name_snapshot,
                'quantity' => (int) $line->quantity,
                'unit_price' => (int) $line->unit_price,
                'tax_rate' => self::VAT_RATE,
            ];
            if ((int) $line->unit_factor > 1) {
                $item['unit'] = $line->unit_name; // وحدة بديلة: يتحقق منها قالب وحدات المنتج
            }
            $items[] = $item;
        }

        $invoice = $this->invoices->create([
            'partner_id' => $partner->id,
            'payment_type' => 'credit',
            'is_paid' => false,
            'invoice_date' => $date,
            'warehouse_id' => $warehouse?->id,
            'branch_id' => $warehouse?->branch_id,
            'tax_inclusive' => true,
            'zatca_document_type' => 'simplified',
            'shipping' => $shipNet,
            'adjustment' => $adjustment,
            'notes' => 'طلب متجر إلكتروني '.$order->number,
        ], $items);

        if ((int) $invoice->total !== $total) {
            throw new CommerceOrderPostingRejection('invoice_total_mismatch');
        }

        $this->reservations->consumeActive((string) $order->id);
        $invoice = $this->invoices->post($invoice);
        if ((int) $invoice->total !== $total) {
            throw new CommerceOrderPostingRejection('invoice_total_mismatch');
        }

        $payment = $this->voucher($attempt, $order, $invoice, $date, $total);
        PaymentAttemptPosting::create([
            'payment_attempt_id' => $attempt->id,
            'role' => PaymentAttemptPosting::ROLE_ALLOCATED,
            'payment_id' => $payment->id,
            'amount_minor' => $total,
        ]);
        CommerceOrderPosting::create([
            'commerce_order_id' => $order->id,
            'invoice_id' => $invoice->id,
            'payment_id' => $payment->id,
            'payment_attempt_id' => $attempt->id,
            'accounting_date' => $date,
            'amount_minor' => $total,
        ]);

        return [self::OUTCOME_POSTED, null];
    }

    /** سند قبض مرتبط بالبوابة (مدين 1170 / دائن 1130 + الطرف) مخصَّص للفاتورة بكامل الالتقاط. */
    private function voucher(PaymentAttempt $attempt, CommerceOrder $order, Invoice $invoice, string $date, int $amount): Payment
    {
        $data = [
            'partner_id' => $order->partner_id,
            'amount' => $amount,
            'direction' => 'received',
            'method' => 'bank',
            'payment_gateway_id' => $attempt->payment_gateway_id,
            'reference' => $attempt->provider_payment_id,
            'payment_date' => $date,
            'invoice_id' => $invoice->id,
            'payment_details' => json_encode([
                'payment_attempt_id' => $attempt->id,
                'provider' => $attempt->provider,
                'role' => PaymentAttemptPosting::ROLE_ALLOCATED,
                'commerce_order_id' => $order->id,
            ], JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
            'notes' => 'دفعة إلكترونية — طلب متجر '.$order->number,
            'created_by' => $attempt->created_by,
        ];
        $branchId = $attempt->branch_id ?? $invoice->branch_id;
        if ($branchId !== null) {
            $data['branch_id'] = $branchId;
        }

        $payment = $this->payments->create($data, [['invoice_id' => $invoice->id, 'amount' => $amount]]);

        return $this->payments->post($payment);
    }
}

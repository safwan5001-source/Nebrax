<?php

namespace App\Services\Accounting;

use App\Models\Invoice;
use App\Models\PaymentMethod;
use App\Models\PriceList;
use App\Models\Product;
use App\Support\PosSettings;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PosService — إتمام بيع نقطة البيع بوسائل دفع مهيأة (ذرّياً)
 * ═══════════════════════════════════════════════════════════════
 *  البيع = فاتورة مبيعات **آجلة** (كامل المبلغ على الذمم 1130) تُرحَّل، ثم
 *  **سند قبض لكل وسيلة دفع مهيأة** يُسدّدها ويوجّهها لحسابها الصحيح عبر
 *  PaymentService. الرصيد غير المسدد يبقى على 1130 فقط عند سماح سياسة POS.
 *
 *  كلّه في معاملة واحدة، ويعيد استخدام المحرّكات المختبرة (InvoiceService +
 *  PaymentService) — لا كتابة مباشرة في journal_lines.
 */
class PosService
{
    public function __construct(
        protected InvoiceService $invoices,
        protected PaymentService $payments,
        protected PosSessionService $sessions,
        protected CashBankAccountService $cashBankAccounts,
        protected PosCustomerPriceListResolver $customerPriceLists,
    ) {}

    /**
     * @param  array  $data  ['partner_id'=>uuid, 'tax_inclusive'=>?bool, 'items'=>[...],
     *                        'tenders'=>[['payment_method_id'=>uuid, 'amount'=>int], ...], 'created_by'=>?]
     */
    public function checkout(array $data): Invoice
    {
        if (empty($data['items'])) {
            throw new RuntimeException('البيع يجب أن يحتوي على سطر واحد على الأقل.');
        }

        return DB::transaction(function () use ($data) {
            // تُقفل الجلسة وتتحقق قبل إنشاء أي مستند: لا بيع يُلحق بورديّة مغلقة
            // أو بكاشير/فرع آخر، ويظل القفل قائماً حتى اكتمال الفاتورة وسنداتها.
            $session = $this->sessions->requireOpenForCheckout(
                $data['pos_session_id'],
                $data['created_by'] ?? null,
                $data['actor'] ?? null,
            );

            // سياسات الكتالوج وسعر الوحدة والخصم خادمية قبل أي فاتورة أو حركة
            // مخزون؛ لا يكفي إخفاؤها في الواجهة لأن التكامل أو الطلب اليدوي قد يتجاوزه.
            $priceList = $this->customerPriceLists->forPartner($data['partner_id']);
            $this->assertProductsAllowedForPos($data['items']);
            $this->assertUnitPricesAllowedForPos($data['items'], $priceList);
            $this->assertDiscountsAllowedForPos($data['items']);

            // تضمن تهيئة المؤسسة الجديدة كتالوجاً تشغيلياً واحداً فقط، ولا تعيد
            // أي وسيلة حذفها مالكها بعد وجود الكتالوج.
            $this->cashBankAccounts->bootstrapDefaults();
            $tenders = $this->normalizedTenders($data['tenders'] ?? []);
            $methods = $this->configuredPaymentMethods($tenders);

            // الجلسات الجديدة تلتقط مخزن الجهاز عند الافتتاح؛ لا يقبل البيع أن
            // يستبدله بطلب عميل. تبقى الجلسات التاريخية بلا مخزن على سلوكها السابق.
            $warehouseId = $session->warehouse_id;
            if ($warehouseId !== null
                && array_key_exists('warehouse_id', $data)
                && $data['warehouse_id'] !== null
                && $data['warehouse_id'] !== $warehouseId) {
                throw new RuntimeException('مخزن البيع يجب أن يطابق مخزن جهاز نقطة البيع في الجلسة.');
            }
            $warehouseId ??= $data['warehouse_id'] ?? null;

            // 1) فاتورة آجلة (كامل الإجمالي على الذمم) ثم ترحيلها.
            $invoice = $this->invoices->create([
                'partner_id'    => $data['partner_id'],
                'price_list_id' => $priceList?->id,
                'pos_session_id' => $session->id,
                'warehouse_id'  => $warehouseId,
                'payment_type'  => 'credit',
                'tax_inclusive' => (bool) ($data['tax_inclusive'] ?? false),
                'notes'         => $data['notes'] ?? 'بيع نقطة بيع',
                'created_by'    => $data['created_by'] ?? null,
                'minimum_price_override_actor_id' => $data['minimum_price_override_actor_id'] ?? null,
            ], $data['items']);
            $invoice = $this->invoices->post($invoice);

            $remaining = (int) $invoice->total;
            foreach ($tenders as $tender) {
                $method = $methods[$tender['payment_method_id']];
                $amount = $tender['amount'];

                // الفكّة لا تتولد إلا من النقد. لا نقبل تحصيلاً بنكياً أكبر من
                // المتبقي لأنه لا يقابل ذمة ولا يمثل مبلغاً محصلاً في POS.
                if ($method->settlement_type === 'bank' && $amount > $remaining) {
                    throw new RuntimeException('لا يمكن أن يتجاوز مبلغ وسيلة الدفع البنكية المتبقي من إجمالي البيع.');
                }

                $applied = min($amount, $remaining);
                if ($applied <= 0) {
                    continue;
                }

                // 2) سند قبض بالوسيلة المهيأة: PaymentService يلتقط الحساب
                // المقابل واسم الوسيلة ثم يرحّل القيد المتوازن عبر LedgerService.
                $this->payments->post($this->payments->create([
                    'partner_id'        => $invoice->partner_id,
                    'invoice_id'        => $invoice->id,
                    'pos_session_id'    => $session->id,
                    'direction'         => 'received',
                    'payment_method_id' => $method->id,
                    'amount'            => $applied,
                    'notes'             => "{$method->name} — بيع {$invoice->number}",
                    'created_by'        => $data['created_by'] ?? null,
                ]));

                $remaining -= $applied;
            }

            if ($remaining > 0 && ! PosSettings::allowsDeferredPayment()) {
                throw new RuntimeException('الدفع الآجل غير مفعّل في إعدادات نقطة البيع، ويجب سداد كامل الإجمالي.');
            }

            return $invoice->fresh(['lines']);
        });
    }

    /** يرفض المنتج المصنّف خارج سياسة POS، مع إبقاء السطر الوصفي بلا منتج مشروعاً. */
    private function assertProductsAllowedForPos(array $items): void
    {
        $ids = array_values(array_unique(array_filter(array_column($items, 'product_id'))));
        if ($ids === []) {
            return;
        }

        $products = Product::whereIn('id', $ids)->get(['id', 'category_id']);
        if ($products->count() !== count($ids)) {
            throw new RuntimeException('تتضمن عملية POS منتجاً غير موجود أو خارج النطاق.');
        }

        if ($products->contains(fn (Product $product) => ! PosSettings::allowsProductCategory($product->category_id))) {
            throw new RuntimeException('يتضمن البيع منتجاً من تصنيف غير مسموح به في إعدادات نقطة البيع.');
        }
    }

    /**
     * يمنع سعر وحدة مخصصاً للمنتج عند إيقاف السياسة، ويجعل قائمة سعر العميل
     * النشطة (إن اختيرت) السعر المرجعي قبل الفاتورة؛ السطر الوصفي مستثنى.
     */
    private function assertUnitPricesAllowedForPos(array $items, ?PriceList $priceList): void
    {
        if (PosSettings::allowsUnitPriceOverride()) {
            return;
        }

        $products = Product::whereIn('id', array_values(array_unique(array_filter(array_column($items, 'product_id')))))
            ->get()
            ->keyBy('id');
        foreach ($items as $item) {
            $productId = $item['product_id'] ?? null;
            if ($productId === null) {
                continue;
            }

            $product = $products->get($productId);
            $expected = $product ? $this->customerPriceLists->priceFor($priceList, $product) : -1;
            if ((int) ($item['unit_price'] ?? 0) !== $expected) {
                throw new RuntimeException('سعر المنتج لا يطابق قائمة السعر النشطة للعميل في نقطة البيع.');
            }
        }
    }

    /** يمنع خصم السطر عند إيقاف سياسة الخصم، قبل إنتاج مستند أو أثر محاسبي. */
    private function assertDiscountsAllowedForPos(array $items): void
    {
        if (PosSettings::allowsDiscount()) {
            return;
        }

        if (collect($items)->contains(fn (array $item) => (int) ($item['discount'] ?? 0) > 0)) {
            throw new RuntimeException('الخصم غير مفعّل في إعدادات نقطة البيع.');
        }
    }

    /** يحوّل عقد الواجهة إلى مبالغ هللية موجبة مع منع تكرار الوسيلة في السندات. */
    private function normalizedTenders(array $tenders): array
    {
        if (! array_is_list($tenders)) {
            return $this->legacyTenders($tenders);
        }

        $normalized = [];
        foreach ($tenders as $tender) {
            $id = $tender['payment_method_id'] ?? null;
            $amount = (int) ($tender['amount'] ?? 0);
            if (! is_string($id) || $id === '' || $amount <= 0) {
                throw new RuntimeException('كل وسيلة دفع تحتاج معرفاً ومبلغاً موجباً.');
            }
            if (array_key_exists($id, $normalized)) {
                throw new RuntimeException('لا يمكن تكرار وسيلة الدفع نفسها في عملية POS واحدة.');
            }
            $normalized[$id] = ['payment_method_id' => $id, 'amount' => $amount];
        }

        return array_values($normalized);
    }

    /**
     * يبقي محطات POS والتكاملات القائمة عاملة أثناء الانتقال من السلال الثابتة.
     * `credit` لا ينشئ سنداً؛ الرصيد المتبقي يظل على الذمم وفق سياسة البيع الآجل.
     */
    private function legacyTenders(array $tenders): array
    {
        $cash = max(0, (int) ($tenders['cash'] ?? 0));
        $bank = max(0, (int) ($tenders['card'] ?? 0)) + max(0, (int) ($tenders['transfer'] ?? 0));
        $normalized = [];

        if ($cash > 0) {
            $normalized[] = ['payment_method_id' => $this->legacyPaymentMethodId('cash'), 'amount' => $cash];
        }
        if ($bank > 0) {
            $normalized[] = ['payment_method_id' => $this->legacyPaymentMethodId('bank'), 'amount' => $bank];
        }

        return $normalized;
    }

    /** يختار أقدم وسيلة نشطة من نوع التسوية التاريخي، مع تفضيل الافتراضي إن وُجد. */
    private function legacyPaymentMethodId(string $settlementType): string
    {
        $method = PaymentMethod::where('settlement_type', $settlementType)
            ->where('is_active', true)
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->first();
        if (! $method) {
            throw new RuntimeException('لا توجد وسيلة دفع نشطة متوافقة مع محطة POS القديمة.');
        }

        return $method->id;
    }

    /** يفرض النشاط وإعداد POS قبل إصدار الفاتورة، فلا ينتج أي مستند عند مخالفة السياسة. */
    private function configuredPaymentMethods(array $tenders): array
    {
        $ids = array_column($tenders, 'payment_method_id');
        if ($ids === []) {
            return [];
        }

        $methods = PaymentMethod::whereIn('id', $ids)
            ->where('is_active', true)
            ->get()
            ->keyBy('id');
        if ($methods->count() !== count($ids)) {
            throw new RuntimeException('تتضمن عملية POS وسيلة دفع غير موجودة أو معطلة.');
        }

        foreach ($ids as $id) {
            if (! PosSettings::allowsPaymentMethod($id)) {
                throw new RuntimeException('وسيلة الدفع المختارة غير مفعلة في إعدادات نقطة البيع.');
            }
        }

        return $methods->all();
    }
}

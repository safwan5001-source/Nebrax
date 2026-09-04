<?php

namespace App\Services\Accounting;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\PaymentMethod;
use App\Models\PosCheckoutAttempt;
use App\Models\PriceList;
use App\Models\Product;
use App\Support\PosSettings;
use App\Support\Settings;
use App\Services\Pos\CashDrawerService;
use App\Services\Pos\PosAuditService;
use App\Services\Pos\PosIdempotencyConflictException;
use App\Tenancy\BranchContext;
use Illuminate\Database\QueryException;
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
        protected CashDrawerService $cashDrawer,
        protected PosAuditService $audit,
    ) {}

    /**
     * @param  array  $data  ['partner_id'=>uuid, 'idempotency_key'=>uuid, 'tax_inclusive'=>?bool, 'items'=>[...],
     *                        'tenders'=>[['payment_method_id'=>uuid, 'amount'=>int], ...], 'created_by'=>?]
     */
    public function checkout(array $data): Invoice
    {
        if (empty($data['items'])) {
            throw new RuntimeException('البيع يجب أن يحتوي على سطر واحد على الأقل.');
        }

        $idempotencyKey = $this->requireIdempotencyKey($data['idempotency_key'] ?? null);
        $checksum = $this->checkoutRequestChecksum($data);

        $drawerAttempt = null;
        $paymentIds = [];
        $cartId = $data['cart_id'] ?? null;
        $auditSession = null;

        try {
            // يبدأ هذا الحدث من نفس الخدمة التي تنفذ البيع، لا من واجهة العميل.
            // Peek بلا قفل كافٍ للتلميتر: المسار الآمن مالياً داخل المعاملة أدناه.
            $alreadyCompleted = PosCheckoutAttempt::query()
                ->where('idempotency_key', $idempotencyKey)
                ->exists();
            if (! $alreadyCompleted && is_string($cartId) && $cartId !== '') {
                $auditSession = $this->sessions->requireOpenForCheckout(
                    $data['pos_session_id'],
                    $data['created_by'] ?? null,
                    $data['actor'] ?? null,
                );
                $this->audit->recordCheckout($auditSession, $data['actor'] ?? null, $cartId, \App\Models\PosSessionEvent::TYPE_PAYMENT_STARTED, [
                    'status' => 'checkout_requested',
                    'idempotency_key' => $idempotencyKey,
                ]);
            }

            try {
                $invoice = DB::transaction(function () use ($data, &$drawerAttempt, &$paymentIds, $cartId, $idempotencyKey, $checksum) {
                    return $this->executeCheckoutWithinTransaction(
                        $data, $drawerAttempt, $paymentIds, $cartId, $idempotencyKey, $checksum
                    );
                });
            } catch (QueryException $exception) {
                // سباق متزامن على نفس المفتاح: القيد الفريد يمنع الصف المكرر؛
                // نعيد الفاتورة الفائزة بدل 500 كي تبقى إعادة المحاولة Idempotent.
                if ($this->isUniqueConstraintViolation($exception)) {
                    $existing = PosCheckoutAttempt::query()
                        ->where('idempotency_key', $idempotencyKey)
                        ->first();
                    if ($existing !== null) {
                        if (! hash_equals($existing->request_checksum, $checksum)) {
                            throw new PosIdempotencyConflictException('تم استخدام مفتاح إعادة الطلب مع محتوى مختلف.');
                        }

                        return $this->replayCheckoutAttempt($existing, $data, $cartId, $idempotencyKey);
                    }
                }
                throw $exception;
            }
        } catch (\Throwable $exception) {
            // الفشل مثبت بواسطة مسار checkout الخادمي، ولا تعتمد قيمته أو سببه
            // على client telemetry. لا يخفي تعثر كتابة الدليل سبب فشل العملية الأصلي.
            // تعارض idempotency ليس فشلاً مالياً — لا نُسجّل payment_failed.
            if ($exception instanceof PosIdempotencyConflictException) {
                throw $exception;
            }
            if ($auditSession !== null && is_string($cartId) && $cartId !== '') {
                try {
                    $this->audit->recordCheckout($auditSession, $data['actor'] ?? null, $cartId, \App\Models\PosSessionEvent::TYPE_PAYMENT_FAILED, [
                        'status' => 'checkout_failed',
                        'error_code' => $exception instanceof \Illuminate\Validation\ValidationException ? 'validation_failed' : 'checkout_failed',
                        'idempotency_key' => $idempotencyKey,
                    ]);
                } catch (\Throwable) {
                    // الدليل تكميلي في مسار الاستثناء ولا يجوز أن يطمس خطأ البيع.
                }
            }
            throw $exception;
        }

        if ($drawerAttempt !== null && ! $invoice->getAttribute('idempotent_replay')) {
            [$session, $actor, $drawerInvoice] = $drawerAttempt;
            // بعد commit فقط: يعود أمرٌ قصير العمر للواجهة لتنفيذه على localhost.
            // لا يرمى أي عطل إلى معاملة البيع، ولا تتغير الفاتورة أو سندات القبض.
            $invoice->setAttribute('cash_drawer_action', $this->cashDrawer->openAfterCashPayment($session, $actor, $drawerInvoice));
        }

        return $invoice;
    }

    /**
     * @param  array<string,mixed>  $data
     * @param  list<string>  $paymentIds
     */
    private function executeCheckoutWithinTransaction(
        array $data,
        ?array &$drawerAttempt,
        array &$paymentIds,
        mixed $cartId,
        string $idempotencyKey,
        string $checksum,
    ): Invoice {
        // مرساة ثابتة لكل فرع: تمنع سباق المفتاح نفسه حتى مع جلسات متوازية.
        $branchId = app(BranchContext::class)->id();
        if (! is_string($branchId) || $branchId === '') {
            throw new RuntimeException('فرع نقطة البيع غير محدد.');
        }
        Branch::query()->whereKey($branchId)->lockForUpdate()->firstOrFail();

        $existing = PosCheckoutAttempt::query()
            ->where('idempotency_key', $idempotencyKey)
            ->lockForUpdate()
            ->first();
        if ($existing !== null) {
            if (! hash_equals($existing->request_checksum, $checksum)) {
                throw new PosIdempotencyConflictException('تم استخدام مفتاح إعادة الطلب مع محتوى مختلف.');
            }

            return $this->replayCheckoutAttempt($existing, $data, $cartId, $idempotencyKey);
        }

        // تُقفل الجلسة وتتحقق قبل إنشاء أي مستند: لا بيع يُلحق بورديّة مغلقة
        // أو بكاشير/فرع آخر، ويظل القفل قائماً حتى اكتمال الفاتورة وسنداتها.
        $session = $this->sessions->requireOpenForCheckout(
            $data['pos_session_id'],
            $data['created_by'] ?? null,
            $data['actor'] ?? null,
        );

        // R6 — أهلية العميل خادمية قبل أي فاتورة: منتقي الواجهة ليس مصدر الثقة،
        // وطلبٌ مباشر بمعرّف مورّد أو عميل معطّل يجب أن يُرفض هنا، لا أن يُقبل
        // ثم يُفسَّر لاحقاً. الشرط نفسه المستعمل للعميل الافتراضي في إعدادات POS.
        $this->assertCustomerEligibleForPos($data['partner_id']);

        // سياسات الكتالوج وسعر الوحدة والخصم خادمية قبل أي فاتورة أو حركة
        // مخزون؛ لا يكفي إخفاؤها في الواجهة لأن التكامل أو الطلب اليدوي قد يتجاوزه.
        $priceList = $this->customerPriceLists->forPartner($data['partner_id']);
        $posProducts = $this->assertProductsAllowedForPos($data['items']);
        $this->assertUnitPricesAllowedForPos($data['items'], $priceList);
        $this->assertDiscountsAllowedForPos($data['items']);
        // نسبة الضريبة مصدرها كتالوج المنتج الخادمي حصراً — القيمة المرسلة من
        // العميل استرشادية فقط ولا تدخل الحساب المالي مهما طابقت أو خالفت.
        $data['items'] = $this->withAuthoritativeTaxRates($data['items'], $posProducts);

        // تضمن تهيئة المؤسسة الجديدة كتالوجاً تشغيلياً واحداً فقط، ولا تعيد
        // أي وسيلة حذفها مالكها بعد وجود الكتالوج.
        $this->cashBankAccounts->bootstrapDefaults();
        $this->assertPosPaymentMethodsAvailable();
        $tenders = $this->normalizedTenders($data['tenders'] ?? []);
        $methods = $this->configuredPaymentMethods($tenders);

        // بدء الإتمام دليل خادمي من داخل المعاملة الفعلية؛ لا يعتمد على
        // before/after أو مبلغ مرسل من العميل.
        if (is_string($cartId) && $cartId !== '') {
            $this->audit->recordCheckout($session, $data['actor'] ?? null, $cartId, \App\Models\PosSessionEvent::TYPE_CHECKOUT_STARTED, [
                'status' => 'validated_for_checkout',
                'idempotency_key' => $idempotencyKey,
            ]);
        }

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
            $payment = $this->payments->post($this->payments->create([
                'partner_id'        => $invoice->partner_id,
                'invoice_id'        => $invoice->id,
                'pos_session_id'    => $session->id,
                'direction'         => 'received',
                'payment_method_id' => $method->id,
                'amount'            => $applied,
                'notes'             => "{$method->name} — بيع {$invoice->number}",
                'created_by'        => $data['created_by'] ?? null,
            ]));
            $paymentIds[] = $payment->id;

            $remaining -= $applied;
        }

        if ($remaining > 0 && ! PosSettings::allowsDeferredPayment()) {
            throw new RuntimeException('الدفع الآجل غير مفعّل في إعدادات نقطة البيع، ويجب سداد كامل الإجمالي.');
        }

        // تجمع نية فتح الدرج فقط داخل المعاملة. التنفيذ الفعلي يقع بعد commit
        // كي لا يستطيع عطل موصل مادي عكس الفاتورة أو سندات القبض المكتملة.
        $drawer = PosSettings::group();
        $hasCashTender = collect($tenders)->contains(fn (array $tender) => ($methods[$tender['payment_method_id']]->settlement_type ?? null) === 'cash');
        if (($drawer['cash_drawer_enabled'] ?? false)
            && ($drawer['cash_drawer_auto_open_after_cash'] ?? false)
            && $hasCashTender) {
            $drawerAttempt = [$session, $data['actor'] ?? null, $invoice];
        }

        if (is_string($cartId) && $cartId !== '') {
            $this->audit->recordCheckout($session, $data['actor'] ?? null, $cartId, \App\Models\PosSessionEvent::TYPE_CHECKOUT_COMPLETED, [
                'invoice_id' => $invoice->id,
                'invoice_number' => $invoice->number,
                'payment_ids' => $paymentIds,
                'amount' => (int) $invoice->total,
                'idempotency_key' => $idempotencyKey,
            ]);
        }

        PosCheckoutAttempt::withWriting(fn () => PosCheckoutAttempt::create([
            'idempotency_key' => $idempotencyKey,
            'request_checksum' => $checksum,
            'invoice_id' => $invoice->id,
            'cart_id' => is_string($cartId) && $cartId !== '' ? $cartId : null,
            'pos_session_id' => $session->id,
            'created_by' => $data['created_by'] ?? null,
            'created_at' => now(),
        ]));

        return $invoice->fresh(['lines']);
    }

    /** @param  array<string,mixed>  $data */
    private function replayCheckoutAttempt(
        PosCheckoutAttempt $attempt,
        array $data,
        mixed $cartId,
        string $idempotencyKey,
    ): Invoice {
        $invoice = Invoice::query()->with('lines')->findOrFail($attempt->invoice_id);
        $invoice->setAttribute('idempotent_replay', true);

        if (is_string($cartId) && $cartId !== '') {
            $session = $this->sessions->requireOpenForCheckout(
                $data['pos_session_id'],
                $data['created_by'] ?? null,
                $data['actor'] ?? null,
            );
            $this->audit->recordCheckout($session, $data['actor'] ?? null, $cartId, \App\Models\PosSessionEvent::TYPE_CHECKOUT_IDEMPOTENT_REPLAY, [
                'invoice_id' => $invoice->id,
                'invoice_number' => $invoice->number,
                'amount' => (int) $invoice->total,
                'idempotency_key' => $idempotencyKey,
                'status' => 'idempotent_replay',
            ]);
        }

        return $invoice;
    }

    private function requireIdempotencyKey(mixed $key): string
    {
        if (! is_string($key) || $key === '' || ! preg_match('/^[0-9a-fA-F-]{36}$/', $key)) {
            throw new RuntimeException('مفتاح إعادة المحاولة مطلوب ويجب أن يكون UUID صالحاً.');
        }

        return $key;
    }

    /**
     * checksum دلالي مستقر لحمولة الإتمام — لا يشمل الفاعل أو مشتقات الإجمالي.
     *
     * @param  array<string,mixed>  $data
     */
    private function checkoutRequestChecksum(array $data): string
    {
        $items = [];
        foreach ($data['items'] ?? [] as $item) {
            if (! is_array($item)) {
                continue;
            }
            $items[] = [
                'product_id' => $item['product_id'] ?? null,
                'description' => $item['description'] ?? null,
                'quantity' => (int) ($item['quantity'] ?? 0),
                'unit' => $item['unit'] ?? null,
                'unit_price' => (int) ($item['unit_price'] ?? 0),
                'tax_rate' => (int) ($item['tax_rate'] ?? 0),
                'discount' => (int) ($item['discount'] ?? 0),
            ];
        }
        usort($items, fn (array $a, array $b) => strcmp(json_encode($a), json_encode($b)));

        $tenders = $data['tenders'] ?? [];
        if (array_is_list($tenders)) {
            $normalizedTenders = [];
            foreach ($tenders as $tender) {
                if (! is_array($tender)) {
                    continue;
                }
                $normalizedTenders[] = [
                    'payment_method_id' => $tender['payment_method_id'] ?? null,
                    'amount' => (int) ($tender['amount'] ?? 0),
                ];
            }
            usort($normalizedTenders, fn (array $a, array $b) => strcmp((string) $a['payment_method_id'], (string) $b['payment_method_id']));
        } else {
            $normalizedTenders = [
                'cash' => (int) ($tenders['cash'] ?? 0),
                'card' => (int) ($tenders['card'] ?? 0),
                'transfer' => (int) ($tenders['transfer'] ?? 0),
                'credit' => (int) ($tenders['credit'] ?? 0),
            ];
        }

        $payload = [
            'partner_id' => $data['partner_id'] ?? null,
            'pos_session_id' => $data['pos_session_id'] ?? null,
            'cart_id' => $data['cart_id'] ?? null,
            'warehouse_id' => $data['warehouse_id'] ?? null,
            'tax_inclusive' => (bool) ($data['tax_inclusive'] ?? false),
            'notes' => $data['notes'] ?? null,
            'items' => $items,
            'tenders' => $normalizedTenders,
        ];

        return hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE));
    }

    private function isUniqueConstraintViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        // PostgreSQL unique_violation = 23505 · SQLite constraint = 19
        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /**
     * R6 — يرفض عميلاً غير مؤهل لنقطة البيع: معطّل، أو مورّد صرف بلا صفة عميل.
     * `PosController::checkout()` يتحقق فقط من وجود الطرف ضمن المستأجر
     * (`Partner::findOrFail`) — لا من أهليته كعميل POS — فهذا التحقق الوحيد
     * لذلك الشرط، ويشترك في نفس القاعدة مع العميل الافتراضي
     * (`PosSettings::isEligibleCustomer`، المستعملة أيضاً في
     * `SalesConfigController::findEligiblePosCustomer`). يُنفَّذ قبل أي قائمة
     * سعر أو فاتورة، فلا يترك أثراً ماليّاً لطلبٍ بعميل غير صالح.
     */
    private function assertCustomerEligibleForPos(string $partnerId): void
    {
        $partner = Partner::find($partnerId);
        if ($partner === null || ! PosSettings::isEligibleCustomer($partner)) {
            throw new RuntimeException('العميل المحدد غير مؤهل للبيع في نقطة البيع.');
        }
    }

    /**
     * يرفض المنتج غير النشط أو المصنّف خارج سياسة POS، مع إبقاء السطر الوصفي بلا
     * منتج مشروعاً. يعيد المنتجات المتحقَّق منها كي تُستعمل لاحقاً كمرجع الضريبة
     * الخادمي دون استعلام ثانٍ — كتالوج الكاشير (`PosController::products`) يفلتر
     * على `is_active` أصلاً، فهذا يمنع تجاوزه بمعرّف صريح من سلة قديمة أو طلب مباشر.
     */
    private function assertProductsAllowedForPos(array $items): \Illuminate\Support\Collection
    {
        $ids = array_values(array_unique(array_filter(array_column($items, 'product_id'))));
        if ($ids === []) {
            return collect();
        }

        $products = Product::whereIn('id', $ids)->get(['id', 'category_id', 'is_active', 'tax_rate']);
        if ($products->count() !== count($ids)) {
            throw new RuntimeException('تتضمن عملية POS منتجاً غير موجود أو خارج النطاق.');
        }

        if ($products->contains(fn (Product $product) => ! $product->is_active)) {
            throw new RuntimeException('يتضمن البيع منتجاً غير نشط لا يمكن بيعه في نقطة البيع.');
        }

        if ($products->contains(fn (Product $product) => ! PosSettings::allowsProductCategory($product->category_id))) {
            throw new RuntimeException('يتضمن البيع منتجاً من تصنيف غير مسموح به في إعدادات نقطة البيع.');
        }

        return $products->keyBy('id');
    }

    /**
     * تستبدل نسبة الضريبة المرسلة من العميل بنسبة المنتج المخزَّنة خادمياً (أو
     * الافتراضية للمبيعات للسطر الوصفي بلا منتج)، قبل أي احتساب مالي. تمنع بذلك
     * تلاعب طلبٍ مباشر أو سلة قديمة بـ`tax_rate` لتقليل الضريبة المحتسبة على
     * الفاتورة، بلا تغيير في عقد `InvoiceService` أو الفواتير غير المتعلقة بـPOS.
     */
    private function withAuthoritativeTaxRates(array $items, \Illuminate\Support\Collection $products): array
    {
        $defaultRate = (int) Settings::get('sales', 'default_tax_rate');

        return array_map(function (array $item) use ($products, $defaultRate) {
            $productId = $item['product_id'] ?? null;
            $product = is_string($productId) ? $products->get($productId) : null;
            $item['tax_rate'] = $product ? (int) $product->tax_rate : $defaultRate;

            return $item;
        }, $items);
    }

    /**
     * يمنع سعر وحدة مخصصاً للمنتج عند إيقاف السياسة، ويجعل قائمة سعر العميل
     * النشطة (إن اختيرت) السعر المرجعي قبل الفاتورة. وحدة الأساس تستعمل
     * سعر المنتج عند غياب عنصر القائمة، أما البديلة فلا تُقبل بلا سعر صريح.
     * السطر الوصفي مستثنى.
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
            $expected = $product
                ? $this->customerPriceLists->posPriceFor($priceList, $product, $item['unit'] ?? null)
                : null;
            if ($expected === null) {
                throw new RuntimeException('وحدة البيع البديلة تحتاج سعراً صريحاً في قائمة السعر النشطة للعميل.');
            }
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
        $query = PaymentMethod::where('settlement_type', $settlementType)
            ->where('is_active', true);
        if (PosSettings::paymentMethodsMode() === PosSettings::PAYMENT_METHODS_ONLY) {
            $query->whereIn('id', PosSettings::enabledPaymentMethodIds());
        }
        $method = $query
            ->orderByDesc('is_default')
            ->orderBy('created_at')
            ->first();
        if (! $method) {
            throw new RuntimeException('لا توجد وسيلة دفع نشطة متوافقة مع محطة POS القديمة.');
        }

        return $method->id;
    }

    /** يرفض البيع قبل إنشاء الفاتورة إن أوقف المالك التحصيل أو لم يبقَ اختيار صالح. */
    private function assertPosPaymentMethodsAvailable(): void
    {
        $mode = PosSettings::paymentMethodsMode();
        if ($mode === PosSettings::PAYMENT_METHODS_NONE) {
            throw new RuntimeException('لا توجد طرق دفع مفعلة لنقطة البيع.');
        }

        $query = PaymentMethod::where('is_active', true);
        if ($mode === PosSettings::PAYMENT_METHODS_ONLY) {
            $query->whereIn('id', PosSettings::enabledPaymentMethodIds());
        }
        if (! $query->exists()) {
            throw new RuntimeException('لا توجد طرق دفع مفعلة لنقطة البيع.');
        }
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

<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\StockMovement;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * R2: كمية سطر مرتجع POS بوحدة المخزون يجب أن تعتمد على عامل التحويل
 * التاريخي **لسطر الفاتورة المصدر** (`unit_factor`)، لا على افتراض أن كمية
 * السطر المطلوب إرجاعها هي نفسها كمية المخزون. معيار النجاح:
 *
 *   الكمية المرتجعة بوحدة المخزون = الكمية المباعة بوحدة السطر × عامل التحويل التاريخي
 */
class PosReturnUomTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @return array{session_id:string,warehouse_id:string} */
    private function openSession(array $auth, int $openingBalance = 0): array
    {
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن وحدات {$n}", 'code' => "POS-U-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير وحدات {$n}", 'code' => "POS-U-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];

        return ['session_id' => $sessionId, 'warehouse_id' => $warehouseId];
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل وحدات POS', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /**
     * رصيد افتتاحي **بمخزن الجلسة تحديداً**: `assertStockAvailable` يفحص
     * `ProductWarehouseStock` لا `Product.quantity_on_hand` وحده متى عرف
     * المخزن (وهو معروف دوماً في فاتورة POS)، فبدون هذا الاستلام يُرفض أي
     * checkout بضاعة كافية إجمالاً لكن غير موسومة بمخزن الجلسة.
     */
    private function seedWarehouseStock(Product $product, string $warehouseId, int $quantity, int $unitCost = 5000): void
    {
        app(InventoryService::class)->applyReceipt($product, $quantity, $unitCost, ['warehouse_id' => $warehouseId]);
    }

    /**
     * منتج متتبَّع بمخزون افتتاحي كافٍ في مخزن الجلسة، ووحدة بديلة `carton` =
     * `$factor` قطعة أساس. وحدة السعر الأساسية `piece` بسعر 100.00.
     */
    private function boxedProduct(array $auth, string $warehouseId, int $openingQuantity = 100, int $factor = 12): Product
    {
        $n = ++$this->sequence;
        $template = $this->withToken($auth['token'])->postJson('/api/unit-templates', [
            'name' => "قالب صناديق {$n}", 'base_unit' => 'piece',
            'units' => [['name' => 'carton', 'factor' => $factor]],
        ])->assertCreated()['data'];

        $product = Product::create([
            'name' => "صنف صناديق {$n}",
            'sale_price' => 10000,
            'unit' => 'piece',
            'unit_template_id' => $template['id'],
            'track_inventory' => true,
            'quantity_on_hand' => 0,
            'avg_cost' => 0,
        ]);
        $this->seedWarehouseStock($product, $warehouseId, $openingQuantity);

        return $product->fresh();
    }

    /**
     * عميل بقائمة سعر تحدّد سعر `carton` الصريح — نقطة البيع لا تقبل سعراً
     * لوحدة بديلة بلا سعر صريح في قائمة سعر العميل النشطة (سياسة POS الافتراضية).
     */
    private function boxedCustomer(array $auth, Product $product, int $boxPrice): string
    {
        $n = ++$this->sequence;
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', [
            'name' => "قائمة صناديق {$n}",
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/price-lists/{$priceList['id']}/items", [
            'product_id' => $product->id, 'unit_name' => 'carton', 'price' => $boxPrice,
        ])->assertCreated();

        return $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => "عميل صناديق {$n}", 'type' => 'customer', 'default_price_list_id' => $priceList['id'],
        ])->assertCreated()['data']['id'];
    }

    private function checkoutBoxes(
        array $auth,
        string $partnerId,
        string $sessionId,
        Product $product,
        int $boxes,
        int $boxPrice,
        array $tenders,
    ): Invoice {
        $response = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => [[
                'product_id' => $product->id,
                'quantity' => $boxes,
                'unit' => 'carton',
                'unit_price' => $boxPrice,
                'tax_rate' => 15,
            ]],
            'tenders' => $tenders,
        ])->assertCreated();

        return Invoice::with('lines')->findOrFail($response['data']['id']);
    }

    private function returnBoxes(array $auth, string $sessionId, Invoice $invoice, int $boxes, string $paymentType = 'cash')
    {
        return $this->withToken($auth['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $invoice->id,
            'payment_type' => $paymentType,
            'items' => [[
                'source_line_id' => $invoice->lines->firstOrFail()->id,
                'quantity' => $boxes,
            ]],
        ]);
    }

    /** @test */
    public function unit_factor_one_partial_return_restocks_exactly_the_base_quantity_returned(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $product = Product::create([
            'name' => 'صنف قطعة مفردة', 'sale_price' => 10000,
            'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
        $this->seedWarehouseStock($product, $session['warehouse_id'], 50);

        $invoice = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $session['session_id'],
            'items' => [['product_id' => $product->id, 'quantity' => 4, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 46000],
        ])->assertCreated();
        $invoiceModel = Invoice::with('lines')->findOrFail($invoice['data']['id']);

        // بيع 4 قطع بمعامل 1 يُخرج 4 من المخزون؛ إرجاع 3 منها جزئياً يُعيد 3 بالضبط.
        $this->assertSame(46, $product->fresh()->quantity_on_hand);

        $return = $this->returnBoxes($auth, $session['session_id'], $invoiceModel, 3)->assertCreated();
        $returnDoc = ReturnDocument::findOrFail($return['data']['id']);

        $this->assertSame(49, $product->fresh()->quantity_on_hand);
        $movement = StockMovement::where('source_type', ReturnDocument::class)->where('source_id', $returnDoc->id)->sole();
        $this->assertSame('in', $movement->type);
        $this->assertSame(3, $movement->quantity);
    }

    /** @test */
    public function unit_factor_above_one_partial_return_restocks_the_full_base_quantity_not_the_sale_unit_count(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $product = $this->boxedProduct($auth, $session['warehouse_id'], openingQuantity: 100, factor: 12);
        $partnerId = $this->boxedCustomer($auth, $product, 12000);

        // بيع صندوقين (٢٤ قطعة أساس) بسعر ١٢٠.٠٠ للصندوق.
        $invoice = $this->checkoutBoxes($auth, $partnerId, $session['session_id'], $product, 2, 12000, ['cash' => 27600]);
        $this->assertSame(76, $product->fresh()->quantity_on_hand); // 100 - 24

        // R2: إرجاع صندوق واحد من الاثنين (جزئي) يجب أن يعيد ١٢ قطعة أساس، لا ١.
        $return = $this->returnBoxes($auth, $session['session_id'], $invoice, 1)->assertCreated();
        $returnDoc = ReturnDocument::findOrFail($return['data']['id']);

        $this->assertSame(88, $product->fresh()->quantity_on_hand); // 76 + 12
        $movement = StockMovement::where('source_type', ReturnDocument::class)->where('source_id', $returnDoc->id)->sole();
        $this->assertSame(12, $movement->quantity, 'كمية حركة المخزون يجب أن تكون بوحدة الأساس: صندوق واحد = 12 قطعة.');
    }

    /** @test */
    public function unit_factor_above_one_full_return_restocks_the_entire_sold_base_quantity(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $product = $this->boxedProduct($auth, $session['warehouse_id'], openingQuantity: 100, factor: 12);
        $partnerId = $this->boxedCustomer($auth, $product, 12000);

        $invoice = $this->checkoutBoxes($auth, $partnerId, $session['session_id'], $product, 3, 12000, ['cash' => 41400]);
        $this->assertSame(64, $product->fresh()->quantity_on_hand); // 100 - 36

        // إرجاع الكل (٣ صناديق) دفعة واحدة يعيد ٣٦ قطعة أساس بالضبط.
        $this->returnBoxes($auth, $session['session_id'], $invoice, 3)->assertCreated();

        $this->assertSame(100, $product->fresh()->quantity_on_hand);
    }

    /** @test */
    public function multiple_partial_returns_accumulate_to_the_full_base_quantity_and_reject_beyond_remaining(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $product = $this->boxedProduct($auth, $session['warehouse_id'], openingQuantity: 100, factor: 12);
        $partnerId = $this->boxedCustomer($auth, $product, 12000);

        // بيع 5 صناديق = 60 قطعة أساس.
        $invoice = $this->checkoutBoxes($auth, $partnerId, $session['session_id'], $product, 5, 12000, ['cash' => 69000]);
        $this->assertSame(40, $product->fresh()->quantity_on_hand); // 100 - 60

        // ثلاث مرتجعات جزئية: 2 + 2 + 1 = 5 صناديق = 60 قطعة أساس تراكمياً.
        $this->returnBoxes($auth, $session['session_id'], $invoice, 2)->assertCreated();
        $this->assertSame(64, $product->fresh()->quantity_on_hand); // 40 + 24

        $this->returnBoxes($auth, $session['session_id'], $invoice, 2)->assertCreated();
        $this->assertSame(88, $product->fresh()->quantity_on_hand); // 64 + 24

        $this->returnBoxes($auth, $session['session_id'], $invoice, 1)->assertCreated();
        $this->assertSame(100, $product->fresh()->quantity_on_hand); // 88 + 12 = الرصيد الأصلي بالضبط

        // تجاوز المتبقي (صفر الآن) يُرفض خادمياً بعد الحساب الصحيح، ولا يُنشئ مستنداً.
        $before = ReturnDocument::count();
        $this->returnBoxes($auth, $session['session_id'], $invoice, 1)->assertStatus(422);
        $this->assertSame($before, ReturnDocument::count());
        $this->assertSame(100, $product->fresh()->quantity_on_hand);
    }

    /** @test */
    public function exchange_return_leg_with_unit_factor_above_one_restocks_the_correct_base_quantity(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $boxed = $this->boxedProduct($auth, $session['warehouse_id'], openingQuantity: 100, factor: 12);
        $partnerId = $this->boxedCustomer($auth, $boxed, 12000);
        $simpleReplacement = Product::create([
            'name' => 'صنف بديل بسيط', 'sale_price' => 5000,
            'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);

        // بيع صندوق واحد (١٢ قطعة أساس) بسعر ١٢٠.٠٠.
        $invoice = $this->checkoutBoxes($auth, $partnerId, $session['session_id'], $boxed, 1, 12000, ['cash' => 13800]);
        $this->assertSame(88, $boxed->fresh()->quantity_on_hand); // 100 - 12

        // استبدال: يُرجع الصندوق (طرف المرتجع) مقابل بديل بسيط لا يتتبَّع مخزوناً.
        $response = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $session['session_id'],
            'original_invoice_id' => $invoice->id,
            'return_items' => [[
                'source_line_id' => $invoice->lines->firstOrFail()->id,
                'quantity' => 1,
            ]],
            'surplus_refund_method' => 'credit',
            'replacement' => [
                'items' => [['product_id' => $simpleReplacement->id, 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 15]],
                'tenders' => ['cash' => 0],
            ],
        ])->assertCreated();

        // R2: طرف المرتجع في الاستبدال يمر عبر نفس ReturnService::postSalesReturn،
        // فيعيد ١٢ قطعة أساس (صندوق واحد × معامل ١٢) لا ١.
        $this->assertSame(100, $boxed->fresh()->quantity_on_hand);
        $returnId = $response['data']['return_document']['id'];
        $movement = StockMovement::where('source_type', ReturnDocument::class)->where('source_id', $returnId)->sole();
        $this->assertSame(12, $movement->quantity);
    }

    /**
     * طرف البديل (البيع الجديد) في الاستبدال يمر عبر PosService::checkout —
     * المسار المدقَّق في R1 — الذي يستعمل بالفعل `InvoiceLine::baseQuantity()`
     * عبر `InventoryService::recordSaleCogs`. هذا الاختبار يوثّق أن طرف البديل
     * سليم بلا تعديل، تماماً كما اشترطت مهمة R2: "إن كان سليماً وثّقه واختبره".
     */
    /** @test */
    public function exchange_replacement_leg_with_unit_factor_above_one_issues_the_correct_base_quantity(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $simpleOriginal = Product::create([
            'name' => 'صنف أصلي بسيط', 'sale_price' => 5000,
            'track_inventory' => false, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
        $boxedReplacement = $this->boxedProduct($auth, $session['warehouse_id'], openingQuantity: 100, factor: 12);
        // العميل نفسه يشتري الأصلي (وحدة أساس، لا حاجة لقائمة سعر) ثم يستبدله
        // بصناديق، فيحتاج قائمة السعر مسبقاً لسعر `carton` الصريح للبديل.
        $partnerId = $this->boxedCustomer($auth, $boxedReplacement, 12000);

        $invoice = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $session['session_id'],
            'items' => [['product_id' => $simpleOriginal->id, 'quantity' => 1, 'unit_price' => 5000, 'tax_rate' => 15]],
            'tenders' => ['cash' => 5750],
        ])->assertCreated();
        $invoiceModel = Invoice::with('lines')->findOrFail($invoice['data']['id']);

        // البديل صندوقان من صنف متتبَّع بمعامل ١٢ = ٢٤ قطعة أساس تخرج من المخزون.
        $response = $this->withToken($auth['token'])->postJson('/api/pos/exchanges', [
            'idempotency_key' => (string) Str::uuid(),
            'pos_session_id' => $session['session_id'],
            'original_invoice_id' => $invoiceModel->id,
            'return_items' => [[
                'source_line_id' => $invoiceModel->lines->firstOrFail()->id,
                'quantity' => 1,
            ]],
            'surplus_refund_method' => 'credit',
            'replacement' => [
                'items' => [['product_id' => $boxedReplacement->id, 'quantity' => 2, 'unit' => 'carton', 'unit_price' => 12000, 'tax_rate' => 15]],
                'tenders' => ['cash' => 18650],
            ],
        ])->assertCreated();

        $this->assertSame(76, $boxedReplacement->fresh()->quantity_on_hand); // 100 - 24
        $replacementId = $response['data']['replacement_invoice']['id'];
        $movement = StockMovement::where('source_type', Invoice::class)->where('source_id', $replacementId)->sole();
        $this->assertSame('out', $movement->type);
        $this->assertSame(24, $movement->quantity);
    }
}

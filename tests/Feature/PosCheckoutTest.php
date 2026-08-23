<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقد إتمام بيع POS: بيع مرحّل ذرياً، وسندات قبض بوسائل دفع مهيأة مرتبطة بجلسة
 * كاشير مفتوحة. لا تنشئ السياسة الجديدة أي قيد خارج InvoiceService/PaymentService.
 */
class PosCheckoutTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function balance(string $code): int
    {
        $account = Account::where('code', $code)->first();

        return $account?->balance?->balance ?? 0;
    }

    private int $deviceSequence = 0;

    private function openSession(array $auth, int $openingBalance = 0): string
    {
        $n = ++$this->deviceSequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن بيع {$n}", 'code' => "POS-C-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير بيع {$n}", 'code' => "POS-C-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
            'pos_device_id'  => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    private function checkout(string $token, string $partnerId, string $sessionId, array $tenders, ?array $items = null): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $sessionId,
            'items'          => $items ?? [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'        => $tenders,
        ]);
    }

    private function category(string $token, string $name): array
    {
        return $this->withToken($token)->postJson('/api/product-categories', ['name' => $name])
            ->assertCreated()['data'];
    }

    private function product(string $token, string $name, ?string $categoryId): array
    {
        return $this->withToken($token)->postJson('/api/products', [
            'name' => $name,
            'sku' => 'POS-CAT-' . uniqid(),
            'type' => 'good',
            'sale_price' => 10000,
            'category_id' => $categoryId,
        ])->assertCreated()['data'];
    }

    private function productItem(array $product): array
    {
        return ['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15];
    }

    private function methods(array $auth): array
    {
        return $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
    }

    private function methodBySettlement(array $methods, string $settlementType): array
    {
        foreach ($methods as $method) {
            if ($method['settlement_type'] === $settlementType) {
                return $method;
            }
        }

        $this->fail("لا توجد وسيلة دفع {$settlementType} مهيأة للاختبار.");
    }

    private function tender(array $method, int $amount): array
    {
        return ['payment_method_id' => $method['id'], 'amount' => $amount];
    }

    /** @test */
    public function customer_price_list_reprices_the_pos_catalog_and_is_enforced_before_checkout(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $product = $this->product($auth['token'], 'صنف قائمة عميل', null);
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', [
            'name' => 'قائمة عميل POS',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/price-lists/{$priceList['id']}/items", [
            'product_id' => $product['id'], 'price' => 8500,
        ])->assertCreated();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل بسعر خاص', 'type' => 'customer', 'default_price_list_id' => $priceList['id'],
        ])->assertCreated()['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');

        $catalog = $this->withToken($auth['token'])->getJson("/api/pos/products?partner_id={$partnerId}")
            ->assertOk()['data'];
        $shown = collect($catalog)->firstWhere('id', $product['id']);
        $this->assertSame('85.00', $shown['sale_price']);

        $pricedItem = $this->productItem($product);
        $pricedItem['unit_price'] = 8500;
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 9775)], [$pricedItem])
            ->assertCreated()
            ->assertJsonPath('data.price_list_id', $priceList['id'])
            ->assertJsonPath('data.total', '97.75');

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [$this->productItem($product)])
            ->assertStatus(422);
        $this->assertSame(1, Invoice::where('pos_session_id', $sessionId)->count());

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['apply_customer_price_list' => false],
        ])->assertOk();
        $catalogWithoutList = $this->withToken($auth['token'])->getJson("/api/pos/products?partner_id={$partnerId}")
            ->assertOk()['data'];
        $this->assertSame('100.00', collect($catalogWithoutList)->firstWhere('id', $product['id'])['sale_price']);
    }

    /** @test */
    public function pos_sells_an_alternate_unit_only_when_the_customer_price_list_defines_its_explicit_price(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $template = $this->withToken($auth['token'])->postJson('/api/unit-templates', [
            'name' => 'عبوة POS', 'base_unit' => 'piece',
            'units' => [['name' => 'carton', 'factor' => 12]],
        ])->assertCreated()['data'];
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'صنف وحدات POS', 'sku' => 'POS-UNIT-' . uniqid(), 'type' => 'good',
            'unit' => 'piece', 'unit_template_id' => $template['id'], 'sale_price' => 10000,
        ])->assertCreated()['data'];
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', [
            'name' => 'قائمة عبوات العميل',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/price-lists/{$priceList['id']}/items", [
            'product_id' => $product['id'], 'unit_name' => 'carton', 'price' => 120000,
        ])->assertCreated();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل العبوات', 'type' => 'customer', 'default_price_list_id' => $priceList['id'],
        ])->assertCreated()['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');

        $catalog = $this->withToken($auth['token'])->getJson("/api/pos/products?partner_id={$partnerId}")
            ->assertOk()['data'];
        $shown = collect($catalog)->firstWhere('id', $product['id']);
        $this->assertSame(['piece', 'carton'], array_column($shown['pos_units'], 'name'));
        $this->assertSame(['100.00', '1200.00'], array_column($shown['pos_units'], 'price'));

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 138000)], [[
            'product_id' => $product['id'], 'quantity' => 1, 'unit' => 'carton', 'unit_price' => 120000, 'tax_rate' => 15,
        ]])->assertCreated()->assertJsonPath('data.total', '1380.00');
        $invoice = Invoice::where('pos_session_id', $sessionId)->sole();
        $line = $invoice->lines()->sole();
        $this->assertSame('carton', $line->unit_name);
        $this->assertSame(12, $line->unit_factor);

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 138000)], [[
            'product_id' => $product['id'], 'quantity' => 1, 'unit' => 'carton', 'unit_price' => 119999, 'tax_rate' => 15,
        ]])->assertStatus(422);
        $this->assertSame(1, Invoice::where('pos_session_id', $sessionId)->count());

        $walkInCatalog = $this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'];
        $walkInProduct = collect($walkInCatalog)->firstWhere('id', $product['id']);
        $this->assertSame(['piece'], array_column($walkInProduct['pos_units'], 'name'));
        $walkInId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل نقدي بلا قائمة وحدات', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $this->checkout($auth['token'], $walkInId, $sessionId, [$this->tender($cash, 138000)], [[
            'product_id' => $product['id'], 'quantity' => 1, 'unit' => 'carton', 'unit_price' => 120000, 'tax_rate' => 15,
        ]])->assertStatus(422);
        $this->assertSame(1, Invoice::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function pos_catalog_exposes_an_alternate_barcode_only_for_its_explicitly_priced_customer_unit(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $template = $this->withToken($auth['token'])->postJson('/api/unit-templates', [
            'name' => 'قالب باركود POS', 'base_unit' => 'piece',
            'units' => [['name' => 'carton', 'factor' => 12]],
        ])->assertCreated()['data'];
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'صنف باركود وحدة POS', 'sku' => 'POS-SCAN-' . uniqid(), 'type' => 'good',
            'unit' => 'piece', 'unit_template_id' => $template['id'], 'sale_price' => 10000,
        ])->assertCreated()['data'];
        $code = 'POS-CARTON-' . uniqid();
        $this->withToken($auth['token'])->postJson("/api/products/{$product['id']}/barcodes", [
            'code' => $code, 'unit_name' => 'carton', 'default_quantity' => 5,
        ])->assertCreated();
        $priceList = $this->withToken($auth['token'])->postJson('/api/price-lists', [
            'name' => 'قائمة ماسح العميل',
        ])->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson("/api/price-lists/{$priceList['id']}/items", [
            'product_id' => $product['id'], 'unit_name' => 'carton', 'price' => 120000,
        ])->assertCreated();
        $customerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل ماسح الوحدة', 'type' => 'customer', 'default_price_list_id' => $priceList['id'],
        ])->assertCreated()['data']['id'];

        $customerCatalog = $this->withToken($auth['token'])->getJson("/api/pos/products?partner_id={$customerId}")
            ->assertOk()['data'];
        $shown = collect($customerCatalog)->firstWhere('id', $product['id']);
        $this->assertSame([['code' => $code, 'unit_name' => 'carton', 'default_quantity' => 5]], $shown['pos_barcodes']);

        $cashCatalog = $this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'];
        $this->assertSame([], collect($cashCatalog)->firstWhere('id', $product['id'])['pos_barcodes']);
    }

    /** @test */
    public function configured_cash_and_bank_methods_route_to_1110_and_1120_and_settle_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $bank = $this->methodBySettlement($this->methods($auth), 'bank');

        // بيع 115.00 (100 + 15% ضريبة): نقد 50 + وسيلة بنكية مهيأة 65.
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, [
            $this->tender($cash, 5000), $this->tender($bank, 6500),
        ])->assertCreated();

        $this->assertSame('115.00', $res['data']['total']);
        $this->assertSame('paid', $res['data']['payment_status']);

        // النقد على الصندوق، الوسيلة البنكية على البنك، الذمم صفر (سُدِّدت بالكامل).
        $this->assertSame(5000, $this->balance('1110'));
        $this->assertSame(6500, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(10000, $this->balance('4110'));
        $this->assertSame(1500, $this->balance('2120'));

        $invoice = Invoice::findOrFail($res['data']['id']);
        $payments = Payment::where('invoice_id', $invoice->id)->get()->keyBy('payment_method_id');
        $this->assertSame($cash['name'], $payments[$cash['id']]->payment_method_name);
        $this->assertSame($bank['name'], $payments[$bank['id']]->payment_method_name);
    }

    /** @test */
    public function checkout_requires_an_open_session_and_attaches_every_pos_document_to_it(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];

        // لا يُقبل عقد POS بلا جلسة صريحة؛ لا يكفي أن تنشئ الواجهة سلة محلية.
        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'    => [],
        ])->assertUnprocessable();

        $sessionId = $this->openSession($auth);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])->assertCreated();
        $invoice = Invoice::findOrFail($res['data']['id']);

        $this->assertSame($sessionId, $invoice->pos_session_id);
        $payments = Payment::where('invoice_id', $invoice->id)->get();
        $this->assertCount(1, $payments);
        $this->assertTrue($payments->every(fn (Payment $payment) => $payment->pos_session_id === $sessionId));
    }

    /** @test */
    public function a_cash_method_debits_only_its_cash_account(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])->assertCreated();

        $this->assertSame(11500, $this->balance('1110'));
        $this->assertSame(0, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'));
    }

    /** @test */
    public function deferred_payment_defaults_to_allowed_and_leaves_the_unpaid_amount_on_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');

        // 115.00: نقد 65 + آجل 50 وفق الافتراض المتوافق مع السلوك السابق.
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 6500)])->assertCreated();

        $this->assertSame('partial', $res['data']['payment_status']);
        $this->assertSame(6500, $this->balance('1110'));
        $this->assertSame(5000, $this->balance('1130'));
    }

    /** @test */
    public function disabled_deferred_payment_rejects_an_unpaid_balance_without_creating_documents(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['allow_deferred_payment' => false],
        ])->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 6500)])->assertStatus(422);

        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function pos_discount_policy_defaults_to_allowed_and_blocks_a_manual_discount_without_creating_documents_when_disabled(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $discountedItem = [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15, 'discount' => 1000]];

        // افتراض الإعداد لا يغيّر خصومات POS المستخدمة تاريخياً.
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 10350)], $discountedItem)
            ->assertCreated();

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['allow_discount' => false],
        ])->assertOk();
        $before = Invoice::where('pos_session_id', $sessionId)->count();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 10350)], $discountedItem)
            ->assertStatus(422);

        $this->assertSame($before, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame($before, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function pos_unit_price_override_defaults_to_blocked_and_allows_an_explicitly_enabled_custom_price(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $product = $this->product($auth['token'], 'صنف سعره مقيّد', null);
        $customPriceItem = $this->productItem($product);
        $customPriceItem['unit_price'] = 9000;

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 10350)], [$customPriceItem])
            ->assertStatus(422);
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['allow_unit_price_override' => true],
        ])->assertOk();
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 10350)], [$customPriceItem])
            ->assertCreated()
            ->assertJsonPath('data.total', '103.50');
    }

    /** @test */
    public function it_rejects_a_method_not_enabled_for_pos_without_creating_documents(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $bank = $this->methodBySettlement($this->methods($auth), 'bank');
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['enabled_payment_method_ids' => [$cash['id']]],
        ])->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($bank, 11500)])->assertStatus(422);

        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function only_configured_active_methods_are_accepted_for_every_tender_including_mixed_payments(): void
    {
        $auth = $this->registerTenant('pos-payment-enforcement', 'owner@pos-payment-enforcement.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل طرق الدفع', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $bank = $this->methodBySettlement($this->methods($auth), 'bank');

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => [
                'payment_methods_mode' => 'only',
                'enabled_payment_method_ids' => [$cash['id']],
                'default_payment_method_id' => $cash['id'],
            ],
        ])->assertOk();

        // وجود جزء نقدي صحيح لا يرخص الجزء البنكي المحظور في دفعة مختلطة.
        $this->checkout($auth['token'], $partnerId, $sessionId, [
            $this->tender($cash, 5000), $this->tender($bank, 6500),
        ])->assertUnprocessable();
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());

        // الطريقة المسموح بها إعدادياً لا تكون صالحة إذا عُطلت في المصدر المشترك.
        PaymentMethod::whereKey($cash['id'])->update(['is_active' => false]);
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])
            ->assertUnprocessable();
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function a_pos_with_no_enabled_payment_methods_cannot_create_an_invoice_even_when_deferred_sales_are_allowed(): void
    {
        $auth = $this->registerTenant('pos-no-methods', 'owner@pos-no-methods.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل بلا تحصيل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => [
                'payment_methods_mode' => 'none',
                'enabled_payment_method_ids' => [],
                'default_payment_method_id' => null,
                'allow_deferred_payment' => true,
            ],
        ])->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])
            ->assertUnprocessable();
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function checkout_rejects_a_foreign_tenant_payment_method_before_creating_documents(): void
    {
        $a = $this->registerTenant('pos-payment-owner-a', 'owner@pos-payment-owner-a.test');
        $b = $this->registerTenant('pos-payment-owner-b', 'owner@pos-payment-owner-b.test');
        app(TenantContext::class)->set($b['tenant_id']);
        $sessionId = $this->openSession($b);
        $partnerId = $this->withToken($b['token'])->postJson('/api/partners', ['name' => 'عميل المستأجر ب', 'type' => 'customer'])['data']['id'];
        $foreignCash = $this->methodBySettlement($this->methods($a), 'cash');

        $this->checkout($b['token'], $partnerId, $sessionId, [$this->tender($foreignCash, 11500)])->assertUnprocessable();
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function pos_category_policy_filters_the_catalogue_and_rejects_a_manually_submitted_forbidden_product(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $allowedCategory = $this->category($auth['token'], 'مسموح');
        $blockedCategory = $this->category($auth['token'], 'محظور');
        $allowed = $this->product($auth['token'], 'صنف مسموح', $allowedCategory['id']);
        $blocked = $this->product($auth['token'], 'صنف محظور', $blockedCategory['id']);
        $uncategorized = $this->product($auth['token'], 'صنف بلا تصنيف', null);

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => [
                'product_category_visibility_mode' => 'only',
                'product_category_ids' => [$allowedCategory['id']],
            ],
        ])->assertOk();

        $onlyIds = collect($this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'])->pluck('id')->all();
        $this->assertContains($allowed['id'], $onlyIds);
        $this->assertContains($uncategorized['id'], $onlyIds);
        $this->assertNotContains($blocked['id'], $onlyIds);

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [$this->productItem($allowed)])
            ->assertCreated();
        $beforeForbidden = Invoice::where('pos_session_id', $sessionId)->count();
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [$this->productItem($blocked)])
            ->assertStatus(422);
        $this->assertSame($beforeForbidden, Invoice::where('pos_session_id', $sessionId)->count());

        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => [
                'product_category_visibility_mode' => 'except',
                'product_category_ids' => [$allowedCategory['id']],
            ],
        ])->assertOk();
        $exceptIds = collect($this->withToken($auth['token'])->getJson('/api/pos/products')->assertOk()['data'])->pluck('id')->all();
        $this->assertNotContains($allowed['id'], $exceptIds);
        $this->assertContains($blocked['id'], $exceptIds);
        $this->assertContains($uncategorized['id'], $exceptIds);
    }

    /** @test */
    public function it_rejects_a_closed_session_before_creating_any_pos_document(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", ['closing_balance' => 0])
            ->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])->assertStatus(422);
        $this->assertSame(0, Invoice::where('pos_session_id', $sessionId)->count());
        $this->assertSame(0, Payment::where('pos_session_id', $sessionId)->count());
    }

    /** @test */
    public function it_isolates_references_to_the_tenant(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $b = $this->registerTenant('globex', 'owner@globex.test');
        app(TenantContext::class)->set($a['tenant_id']);
        $partnerA = $this->withToken($a['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];
        $sessionB = $this->openSession($b);
        $cashForB = $this->methodBySettlement($this->methods($b), 'cash');

        // المستأجر B لا يستطيع البيع لعميل المستأجر A، حتى مع جلسة POS تخصه.
        $this->checkout($b['token'], $partnerA, $sessionB, [$this->tender($cashForB, 11500)])->assertNotFound();
    }
}

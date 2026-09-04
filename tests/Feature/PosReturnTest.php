<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\PosExchange;
use App\Models\PosSessionEvent;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقد مرتجع POS: لا تسعير من الواجهة، ولا نقد يتجاوز سياسة الشركة أو رصيد الدرج،
 * والمرتجع يمر عبر محرك المرتجعات والقيد العكسي مع بقاء جلسة الكاشير مرجعه.
 */
class PosReturnTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->balance ?? 0);
    }

    /** @return array{session_id:string,warehouse_id:string} */
    private function openSession(array $auth, int $openingBalance = 0): array
    {
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن مرتجعات {$n}", 'code' => "POS-R-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير مرتجعات {$n}", 'code' => "POS-R-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];

        return ['session_id' => $sessionId, 'warehouse_id' => $warehouseId];
    }

    private function product(int $salePrice = 10000): Product
    {
        return Product::create([
            'name' => 'صنف مرتجع POS',
            // عملية POS في هذا الاختبار بسعر 100.00؛ نثبته على المنتج كي لا
            // تتحول بيانات اختبار مرتجع إلى تجاوز متعمد لسياسة سعر الوحدة.
            'sale_price' => $salePrice,
            'track_inventory' => false,
            'quantity_on_hand' => 0,
            'avg_cost' => 0,
        ]);
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل مرتجعات POS', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    private function checkout(
        array $auth,
        string $partnerId,
        string $sessionId,
        Product $product,
        array $tenders,
        int $quantity = 1,
        int $discount = 0,
    ): Invoice {
        $response = $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'idempotency_key' => (string) \Illuminate\Support\Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => [[
                'product_id' => $product->id,
                'quantity' => $quantity,
                'unit_price' => 10000,
                'tax_rate' => 15,
                'discount' => $discount,
            ]],
            'tenders' => $tenders,
        ])->assertCreated();

        return Invoice::with('lines')->findOrFail($response['data']['id']);
    }

    private function returnFromPos(
        array $auth,
        string $sessionId,
        Invoice $invoice,
        int $quantity,
        string $paymentType = 'cash',
        ?string $idempotencyKey = null,
    ) {
        return $this->withToken($auth['token'])->postJson('/api/pos/returns', [
            'idempotency_key' => $idempotencyKey ?? (string) \Illuminate\Support\Str::uuid(),
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $invoice->id,
            'payment_type' => $paymentType,
            'items' => [[
                'source_line_id' => $invoice->lines->firstOrFail()->id,
                'quantity' => $quantity,
            ]],
        ]);
    }

    /** @test */
    public function it_returns_a_discounted_pos_line_with_exact_minor_units_and_records_the_session_audit_event(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $invoice = $this->checkout(
            $auth,
            $this->customer($auth['token']),
            $session['session_id'],
            $this->product(),
            ['cash' => 34385],
            quantity: 3,
            discount: 100,
        );

        // 3 × 100.00 − 1.00 = 299.00؛ ضريبته 44.85 = 343.85.
        // الجزء الأول يحصل على 100.00 − 0.33 + 14.95 = 114.62 بدقة هللات.
        $first = $this->returnFromPos($auth, $session['session_id'], $invoice, 1)
            ->assertCreated()
            ->assertJsonPath('data.payment_type', 'cash');
        $return = ReturnDocument::with('lines')->findOrFail($first['data']['id']);
        $line = $return->lines->firstOrFail();

        $this->assertSame($session['session_id'], $return->pos_session_id);
        $this->assertSame(10000, $line->line_subtotal);
        $this->assertSame(33, $line->line_discount);
        $this->assertSame(1495, $line->line_tax);
        $this->assertSame(11462, $return->total);
        $this->assertSame('posted', $return->status);
        $this->assertSame(22923, $this->balance('1110'));
        $this->assertSame(19933, $this->balance('4110'));
        $this->assertSame(2990, $this->balance('2120'));
        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $session['session_id'],
            'type' => PosSessionEvent::TYPE_RETURN_RECORDED,
        ]);

        // الجزء الأخير يحمل بقايا التقريب: 0.67 خصم + 29.90 ضريبة، فيتماثل
        // مجموع المرتجعين مع إجمالي الفاتورة الأصلي بلا هللة مفقودة.
        $second = $this->returnFromPos($auth, $session['session_id'], $invoice, 2)->assertCreated();
        $this->assertSame(22923, (int) ReturnDocument::findOrFail($second['data']['id'])->total);
        $this->assertSame(0, $this->balance('1110'));
        $this->assertSame(0, $this->balance('4110'));
        $this->assertSame(0, $this->balance('2120'));

        $response = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session['session_id']}/report")
            ->assertOk()
            ->assertJsonCount(2, 'returns');
        $report = $response->json('report');
        $this->assertSame('343.85', $report['cash_refunds']);
        $this->assertSame('0.00', $report['expected']);
        $this->assertSame(2, $report['returns_count']);
        $this->assertSame('0.00', $report['net_sales']);
        $this->assertSame($report['returns_count'], count($response->json('returns')));
        $this->assertSame(
            ReturnDocument::where('pos_session_id', $session['session_id'])->orderBy('return_date')->orderBy('created_at')->pluck('id')->all(),
            collect($response->json('returns'))->pluck('id')->all(),
        );
    }

    /** @test */
    public function default_policy_rejects_cash_refund_for_a_card_only_pos_sale(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth, 20000);
        $invoice = $this->checkout(
            $auth,
            $this->customer($auth['token']),
            $session['session_id'],
            $this->product(),
            ['card' => 11500],
        );

        $this->returnFromPos($auth, $session['session_id'], $invoice, 1)
            ->assertStatus(422);
        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function opt_in_policy_allows_cash_refund_for_a_non_cash_sale_only_when_the_drawer_can_cover_it(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth, 20000);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['cash_refund_policy' => 'allow_any_pos_sale'],
        ])->assertOk();
        $invoice = $this->checkout(
            $auth,
            $this->customer($auth['token']),
            $session['session_id'],
            $this->product(),
            ['card' => 11500],
        );

        $this->returnFromPos($auth, $session['session_id'], $invoice, 1)->assertCreated();
        // رصيد فتح الجلسة تشغيلّي ولا ينشئ قيداً؛ رد النقد البديل يخرج فعلياً
        // من حساب الصندوق، فيما يبقى تحصيل البطاقة على البنك.
        $this->assertSame(-11500, $this->balance('1110'));
        $this->assertSame(11500, $this->balance('1120'));
        $report = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session['session_id']}/report")
            ->assertOk()
            ->json('report');
        $this->assertSame('85.00', $report['expected']);
    }

    /** @test */
    public function it_rejects_a_return_from_another_open_pos_session_before_writing_any_document(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $first = $this->openSession($auth);
        $secondAuth = $auth;
        $secondAuth['token'] = $this->tokenForRole($auth['tenant_id'], 'admin', 'second-return-cashier@test.local');
        $second = $this->openSession($secondAuth);
        $invoice = $this->checkout(
            $auth,
            $this->customer($auth['token']),
            $first['session_id'],
            $this->product(),
            ['cash' => 11500],
        );

        $this->returnFromPos($secondAuth, $second['session_id'], $invoice, 1)->assertStatus(422);
        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function returnable_endpoints_expose_session_bound_lines_and_a_truthful_cash_quote(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $invoice = $this->checkout(
            $auth,
            $this->customer($auth['token']),
            $session['session_id'],
            $this->product(),
            ['cash' => 5000, 'card' => 6500],
        );
        $lineId = $invoice->lines->firstOrFail()->id;

        $this->withToken($auth['token'])
            ->getJson("/api/pos/returnable-invoices?pos_session_id={$session['session_id']}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $invoice->id)
            ->assertJsonPath('data.0.cash_refund_available', '50.00');
        $this->withToken($auth['token'])
            ->getJson("/api/pos/returnable-invoices/{$invoice->id}?pos_session_id={$session['session_id']}")
            ->assertOk()
            ->assertJsonPath('data.lines.0.remaining', 1)
            ->assertJsonPath('data.lines.0.remaining_total', '115.00');
        $this->withToken($auth['token'])
            ->postJson('/api/pos/returns/quote', [
                'pos_session_id' => $session['session_id'],
                'original_invoice_id' => $invoice->id,
                'payment_type' => 'cash',
                'items' => [['source_line_id' => $lineId, 'quantity' => 1]],
            ])
            ->assertOk()
            ->assertJsonPath('data.total', '115.00')
            ->assertJsonPath('data.cash_allowed', false)
            ->assertJsonPath('data.cash_block_reason', 'سياسة نقطة البيع تسمح برد النقد حتى المبلغ النقدي المقبوض على الفاتورة المصدر فقط.');
    }

    private function exchange(
        array $auth,
        string $sessionId,
        Invoice $original,
        Product $replacement,
        int $replacementPrice,
        array $tenders = [],
        string $surplusRefundMethod = 'credit',
        ?string $idempotencyKey = null,
    ) {
        return $this->withToken($auth['token'])->postJson('/api/pos/exchanges', [
            'idempotency_key' => $idempotencyKey ?? (string) \Illuminate\Support\Str::uuid(),
            'pos_session_id' => $sessionId,
            'original_invoice_id' => $original->id,
            'return_items' => [[
                'source_line_id' => $original->lines->firstOrFail()->id,
                'quantity' => 1,
            ]],
            'surplus_refund_method' => $surplusRefundMethod,
            'replacement' => [
                'items' => [[
                    'product_id' => $replacement->id,
                    'quantity' => 1,
                    'unit_price' => $replacementPrice,
                    'tax_rate' => 15,
                ]],
                'tenders' => $tenders ?: ['cash' => 0],
            ],
        ]);
    }

    /** @test */
    public function exchange_applies_return_credit_to_the_replacement_and_collects_only_the_difference(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $customer = $this->customer($auth['token']);
        $original = $this->checkout($auth, $customer, $session['session_id'], $this->product(), ['cash' => 11500]);

        $response = $this->exchange($auth, $session['session_id'], $original, $this->product(20000), 20000, ['cash' => 11500])
            ->assertCreated()
            ->assertJsonPath('data.applied_credit_amount', '115.00')
            ->assertJsonPath('data.cash_refund_amount', '0.00')
            ->assertJsonPath('data.status', 'posted');
        $exchange = PosExchange::findOrFail($response['data']['id']);
        $replacement = Invoice::findOrFail($exchange->replacement_invoice_id);

        $this->assertSame(23000, (int) $replacement->paid_amount);
        $this->assertSame('paid', $replacement->payment_status);
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(23000, $this->balance('1110'));
        $this->assertSame(20000, $this->balance('4110'));
        $this->assertSame(3000, $this->balance('2120'));
        $this->assertDatabaseHas('pos_session_events', [
            'pos_session_id' => $session['session_id'],
            'type' => PosSessionEvent::TYPE_EXCHANGE_RECORDED,
            'payload->exchange_id' => $exchange->id,
        ]);
    }

    /** @test */
    public function default_exchange_policy_keeps_a_surplus_as_customer_credit_without_reducing_the_drawer(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $original = $this->checkout($auth, $this->customer($auth['token']), $session['session_id'], $this->product(), ['cash' => 11500]);

        $response = $this->exchange($auth, $session['session_id'], $original, $this->product(5000), 5000)
            ->assertCreated()
            ->assertJsonPath('data.applied_credit_amount', '57.50')
            ->assertJsonPath('data.cash_refund_amount', '0.00')
            ->assertJsonPath('data.journal_entry_id', null);

        $this->assertSame(-5750, $this->balance('1130'));
        $report = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session['session_id']}/report")
            ->assertOk()->json('report');
        $this->assertSame('0.00', $report['cash_refunds']);
        $this->assertSame('115.00', $report['expected']);
    }

    /** @test */
    public function exchange_cash_surplus_requires_the_opt_in_policy_and_updates_drawer_and_ledger(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['exchange_surplus_policy' => 'allow_cash_refund'],
        ])->assertOk();
        $original = $this->checkout($auth, $this->customer($auth['token']), $session['session_id'], $this->product(), ['cash' => 11500]);

        $response = $this->exchange($auth, $session['session_id'], $original, $this->product(5000), 5000, [], 'cash')
            ->assertCreated()
            ->assertJsonPath('data.cash_refund_amount', '57.50');
        $exchange = PosExchange::findOrFail($response['data']['id']);

        $this->assertNotNull($exchange->journal_entry_id);
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(5750, $this->balance('1110'));
        $report = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$session['session_id']}/report")
            ->assertOk()->json('report');
        $this->assertSame('57.50', $report['cash_refunds']);
        $this->assertSame('57.50', $report['expected']);
    }

    /** @test */
    public function exchange_rejects_a_cash_surplus_that_fails_the_existing_cash_refund_policy_without_writing_documents(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth, 20000);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['exchange_surplus_policy' => 'allow_cash_refund'],
        ])->assertOk();
        $original = $this->checkout($auth, $this->customer($auth['token']), $session['session_id'], $this->product(), ['card' => 11500]);

        $this->exchange($auth, $session['session_id'], $original, $this->product(5000), 5000, [], 'cash')->assertStatus(422);
        $this->assertSame(0, PosExchange::count());
        $this->assertSame(0, ReturnDocument::count());
        $this->assertSame(1, Invoice::count());
    }

    /** @test */
    public function exchange_quote_exposes_the_default_credit_only_policy_before_posting(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $original = $this->checkout($auth, $this->customer($auth['token']), $session['session_id'], $this->product(), ['cash' => 11500]);

        $this->withToken($auth['token'])->postJson('/api/pos/exchanges/quote', [
            'pos_session_id' => $session['session_id'],
            'original_invoice_id' => $original->id,
            'return_items' => [['source_line_id' => $original->lines->firstOrFail()->id, 'quantity' => 1]],
            'cash_surplus_amount' => 5750,
        ])
            ->assertOk()
            ->assertJsonPath('data.return_total', '115.00')
            ->assertJsonPath('data.exchange_surplus_policy', 'customer_credit_only')
            ->assertJsonPath('data.cash_allowed', false)
            ->assertJsonPath('data.cash_block_reason', 'إعدادات نقطة البيع تجعل فائض الاستبدال رصيداً للعميل فقط.');
        $this->assertSame(0, PosExchange::count());
        $this->assertSame(0, ReturnDocument::count());
    }
}

<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PosCheckoutAttempt;
use App\Models\PosSessionEvent;
use App\Models\StockMovement;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * عقد idempotency لإتمام بيع POS: نفس المفتاح المنطقي = بيع مالي واحد.
 */
class PosCheckoutIdempotencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    private function openSession(array $auth): string
    {
        $n = ++$this->deviceSequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن إتمام {$n}", 'code' => "POS-IDEM-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير إتمام {$n}", 'code' => "POS-IDEM-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    private function cashMethod(array $auth): array
    {
        $methods = $this->withToken($auth['token'])->getJson('/api/payment-methods')->assertOk()['data'];
        foreach ($methods as $method) {
            if ($method['settlement_type'] === 'cash') {
                return $method;
            }
        }
        $this->fail('لا توجد وسيلة نقدية.');
    }

    private function payload(string $partnerId, string $sessionId, string $key, array $cash, ?string $cartId = null, int $unitPrice = 10000): array
    {
        $body = [
            'idempotency_key' => $key,
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            'tenders' => [['payment_method_id' => $cash['id'], 'amount' => (int) round($unitPrice * 1.15)]],
        ];
        if ($cartId !== null) {
            $body['cart_id'] = $cartId;
        }

        return $body;
    }

    /** @test */
    public function the_same_idempotency_key_replays_one_financial_sale(): void
    {
        $auth = $this->registerTenant('pos-idem-replay', 'owner@pos-idem-replay.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل إعادة', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cash = $this->cashMethod($auth);
        $key = (string) Str::uuid();
        $cart = $this->withToken($auth['token'])->postJson('/api/pos/carts', [
            'pos_session_id' => $sessionId,
        ])->assertCreated()['data']['cart_id'];

        $first = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, $key, $cash, $cart))
            ->assertCreated();
        $invoiceId = $first['data']['id'];

        $second = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, $key, $cash, $cart))
            ->assertOk()
            ->assertJsonPath('data.id', $invoiceId)
            ->assertJsonPath('idempotent_replay', true);

        $this->assertSame($invoiceId, $second['data']['id']);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, PosCheckoutAttempt::count());
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->count());
        $this->assertDatabaseHas('pos_session_events', [
            'cart_id' => $cart,
            'type' => PosSessionEvent::TYPE_CHECKOUT_IDEMPOTENT_REPLAY,
        ]);
    }

    /** @test */
    public function a_different_payload_with_the_same_key_conflicts(): void
    {
        $auth = $this->registerTenant('pos-idem-conflict', 'owner@pos-idem-conflict.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل تعارض', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cash = $this->cashMethod($auth);
        $key = (string) Str::uuid();

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, $key, $cash))
            ->assertCreated();

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, $key, $cash, null, 20000))
            ->assertStatus(409);

        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, PosCheckoutAttempt::count());
    }

    /** @test */
    public function a_different_key_creates_a_new_sale(): void
    {
        $auth = $this->registerTenant('pos-idem-new', 'owner@pos-idem-new.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل جديد', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cash = $this->cashMethod($auth);

        $a = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, (string) Str::uuid(), $cash))
            ->assertCreated()['data']['id'];
        $b = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, (string) Str::uuid(), $cash))
            ->assertCreated()['data']['id'];

        $this->assertNotSame($a, $b);
        $this->assertSame(2, Invoice::count());
        $this->assertSame(2, PosCheckoutAttempt::count());
    }

    /** @test */
    public function the_same_key_is_isolated_across_tenants(): void
    {
        $authA = $this->registerTenant('pos-idem-t1', 'owner@pos-idem-t1.test');
        $authB = $this->registerTenant('pos-idem-t2', 'owner@pos-idem-t2.test');
        $key = (string) Str::uuid();

        app(TenantContext::class)->set($authA['tenant_id']);
        $sessionA = $this->openSession($authA);
        $partnerA = $this->withToken($authA['token'])->postJson('/api/partners', [
            'name' => 'عميل أ', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cashA = $this->cashMethod($authA);
        $invoiceA = $this->withToken($authA['token'])->postJson('/api/pos/checkout', $this->payload($partnerA, $sessionA, $key, $cashA))
            ->assertCreated()['data']['id'];

        app(TenantContext::class)->set($authB['tenant_id']);
        $sessionB = $this->openSession($authB);
        $partnerB = $this->withToken($authB['token'])->postJson('/api/partners', [
            'name' => 'عميل ب', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cashB = $this->cashMethod($authB);
        $invoiceB = $this->withToken($authB['token'])->postJson('/api/pos/checkout', $this->payload($partnerB, $sessionB, $key, $cashB))
            ->assertCreated()['data']['id'];

        $this->assertNotSame($invoiceA, $invoiceB);
        $this->assertSame(2, PosCheckoutAttempt::withoutGlobalScopes()->count());
    }

    /** @test */
    public function a_failed_checkout_can_retry_safely_with_the_same_key(): void
    {
        $auth = $this->registerTenant('pos-idem-fail', 'owner@pos-idem-fail.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل فشل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cash = $this->cashMethod($auth);
        $key = (string) Str::uuid();

        // فشل قبل commit: كمية صفرية ترفضها قواعد الطلب.
        $bad = $this->payload($partnerId, $sessionId, $key, $cash);
        $bad['items'][0]['quantity'] = 0;
        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $bad)->assertStatus(422);
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, PosCheckoutAttempt::count());

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $this->payload($partnerId, $sessionId, $key, $cash))
            ->assertCreated();
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, PosCheckoutAttempt::count());
    }

    /** @test */
    public function replay_does_not_duplicate_stock_or_journal_or_zatca_fields(): void
    {
        $auth = $this->registerTenant('pos-idem-stock', 'owner@pos-idem-stock.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل مخزون', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'صنف إتمام', 'sku' => 'IDEM-P-1', 'type' => 'good',
            'sale_price' => 10000, 'track_inventory' => false,
        ])->assertCreated()['data'];
        $cash = $this->cashMethod($auth);
        $key = (string) Str::uuid();
        $body = $this->payload($partnerId, $sessionId, $key, $cash);
        $body['items'] = [['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]];

        $first = $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body)->assertCreated()['data'];
        $this->withToken($auth['token'])->postJson('/api/pos/checkout', $body)->assertOk();

        $this->assertSame(1, Invoice::count());
        $invoice = Invoice::findOrFail($first['id']);
        $this->assertNotNull($invoice->zatca_qr);
        $this->assertNotNull($invoice->zatca_icv);
        $this->assertSame(1, JournalEntry::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count());
        $this->assertSame(
            StockMovement::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count(),
            StockMovement::where('source_type', Invoice::class)->where('source_id', $invoice->id)->count()
        );
    }

    /** @test */
    public function checkout_requires_an_idempotency_key(): void
    {
        $auth = $this->registerTenant('pos-idem-required', 'owner@pos-idem-required.test');
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل مطلوب', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $cash = $this->cashMethod($auth);

        $this->withToken($auth['token'])->postJson('/api/pos/checkout', [
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders' => [['payment_method_id' => $cash['id'], 'amount' => 11500]],
        ])->assertStatus(422)->assertJsonValidationErrors('idempotency_key');
    }
}

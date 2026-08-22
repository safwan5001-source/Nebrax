<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PosHeldSale;
use App\Models\Product;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * السلال المعلّقة مسودات تشغيلية: لا فاتورة ولا قبض ولا مخزون ولا قيد حتى يؤكد
 * الكاشير الدفع عبر PosService. تربطها الجلسة والمخزن والكاشير صراحةً.
 */
class PosHeldSaleTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @return array{session_id:string,warehouse_id:string,device_id:string} */
    private function openSession(array $auth): array
    {
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($auth['token'])->postJson('/api/warehouses', [
            'name' => "مخزن سلال {$n}", 'code' => "POS-H-W-{$n}", 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->postJson('/api/pos-devices', [
            'name' => "كاشير سلال {$n}", 'code' => "POS-H-{$n}", 'warehouse_id' => $warehouseId, 'is_active' => true,
        ])->assertCreated()['data']['id'];
        $sessionId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];

        return ['session_id' => $sessionId, 'warehouse_id' => $warehouseId, 'device_id' => $deviceId];
    }

    private function product(): Product
    {
        return Product::create([
            'name' => 'صنف سلة معلّقة',
            'track_inventory' => false,
            'quantity_on_hand' => 0,
            'avg_cost' => 0,
        ]);
    }

    private function hold(array $auth, string $sessionId, Product $product, ?string $customerId = null, ?string $unit = null)
    {
        return $this->withToken($auth['token'])->postJson('/api/pos/held-sales', [
            'pos_session_id' => $sessionId,
            'customer_id' => $customerId,
            'tax_inclusive' => false,
            'items' => [[
                'product_id' => $product->id,
                'description' => $product->name,
                'sku' => $product->sku,
                'quantity' => 2,
                'unit' => $unit,
                'unit_price' => 10000,
                'tax_rate' => 15,
                'discount' => 100,
            ]],
        ]);
    }

    /** @test */
    public function it_holds_and_resumes_a_pos_cart_without_creating_any_financial_or_inventory_document(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $product = $this->product();
        $customerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل سلة معلّقة', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $before = [
            'invoices' => Invoice::count(),
            'payments' => Payment::count(),
            'journals' => JournalEntry::count(),
        ];

        $response = $this->hold($auth, $session['session_id'], $product, $customerId, 'carton')
            ->assertCreated()
            ->assertJsonPath('data.status', 'held')
            ->assertJsonPath('data.tax_inclusive', false)
            ->assertJsonPath('data.items.0.quantity', 2)
            ->assertJsonPath('data.items.0.unit', 'carton')
            ->assertJsonPath('data.items.0.unit_price', '100.00')
            ->assertJsonPath('data.items.0.discount', '1.00');
        $heldId = $response['data']['id'];

        $this->assertSame($before['invoices'], Invoice::count());
        $this->assertSame($before['payments'], Payment::count());
        $this->assertSame($before['journals'], JournalEntry::count());
        $this->assertDatabaseHas('pos_held_sales', [
            'id' => $heldId,
            'pos_session_id' => $session['session_id'],
            'warehouse_id' => $session['warehouse_id'],
            'status' => PosHeldSale::STATUS_HELD,
        ]);

        $this->withToken($auth['token'])->getJson("/api/pos/held-sales?pos_session_id={$session['session_id']}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $heldId)
            ->assertJsonPath('data.0.customer.id', $customerId);
        $this->withToken($auth['token'])->postJson("/api/pos/held-sales/{$heldId}/resume", [
            'pos_session_id' => $session['session_id'],
        ])
            ->assertOk()
            ->assertJsonPath('data.status', PosHeldSale::STATUS_RESUMED)
            ->assertJsonPath('data.resumed_pos_session_id', $session['session_id']);
        $this->withToken($auth['token'])->postJson("/api/pos/held-sales/{$heldId}/resume", [
            'pos_session_id' => $session['session_id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function default_close_policy_discards_held_carts_when_the_pos_session_is_closed(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $session = $this->openSession($auth);
        $held = $this->hold($auth, $session['session_id'], $this->product())->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$session['session_id']}/close", [
            'closing_balance' => 0,
        ])->assertOk();

        $this->assertDatabaseHas('pos_held_sales', [
            'id' => $held['data']['id'],
            'status' => PosHeldSale::STATUS_DISCARDED,
        ]);
    }

    /** @test */
    public function keep_policy_allows_the_same_cashier_to_resume_a_held_cart_in_a_later_session_on_the_same_warehouse(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $first = $this->openSession($auth);
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', [
            'data' => ['held_sale_close_policy' => 'keep_for_next_session'],
        ])->assertOk();
        $held = $this->hold($auth, $first['session_id'], $this->product())->assertCreated();

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$first['session_id']}/close", [
            'closing_balance' => 0,
        ])->assertOk();
        $secondId = $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $first['device_id'],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->getJson("/api/pos/held-sales?pos_session_id={$secondId}")
            ->assertOk()
            ->assertJsonPath('data.0.id', $held['data']['id']);
        $this->withToken($auth['token'])->postJson("/api/pos/held-sales/{$held['data']['id']}/resume", [
            'pos_session_id' => $secondId,
        ])
            ->assertOk()
            ->assertJsonPath('data.resumed_pos_session_id', $secondId);
    }
}

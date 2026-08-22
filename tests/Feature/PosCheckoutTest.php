<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Payment;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقد إتمام بيع POS: بيع مرحّل ذرياً، وسندات قبض مرتبطة بجلسة كاشير مفتوحة.
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

    private function openSession(array $auth, int $openingBalance = 0): string
    {
        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
        ])->assertCreated()['data']['id'];
    }

    private function checkout(string $token, string $partnerId, string $sessionId, array $tenders): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($token)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $sessionId,
            'items'          => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
            'tenders'        => $tenders,
        ]);
    }

    /** @test */
    public function mixed_cash_and_card_routes_to_1110_and_1120_and_settles_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];

        // بيع 115.00 (100 + 15% ضريبة): نقد 50 + بطاقة 65.
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, [
            'cash' => 5000, 'card' => 6500, 'transfer' => 0, 'credit' => 0,
        ])->assertCreated();

        $this->assertSame('115.00', $res['data']['total']);
        $this->assertSame('paid', $res['data']['payment_status']);

        // النقد على الصندوق، البطاقة على البنك، الذمم صفر (سُدِّدت بالكامل).
        $this->assertSame(5000, $this->balance('1110'));
        $this->assertSame(6500, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'));
        $this->assertSame(10000, $this->balance('4110'));
        $this->assertSame(1500, $this->balance('2120'));
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
            'tenders'    => ['cash' => 11500],
        ])->assertUnprocessable();

        $sessionId = $this->openSession($auth);
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, ['cash' => 11500])->assertCreated();
        $invoice = Invoice::findOrFail($res['data']['id']);

        $this->assertSame($sessionId, $invoice->pos_session_id);
        $payments = Payment::where('invoice_id', $invoice->id)->get();
        $this->assertCount(1, $payments);
        $this->assertTrue($payments->every(fn (Payment $payment) => $payment->pos_session_id === $sessionId));
    }

    /** @test */
    public function pure_cash_sale_debits_only_the_cash_account(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل نقدي', 'type' => 'customer'])['data']['id'];

        $this->checkout($auth['token'], $partnerId, $sessionId, ['cash' => 11500])->assertCreated();

        $this->assertSame(11500, $this->balance('1110'));
        $this->assertSame(0, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1130'));
    }

    /** @test */
    public function partial_credit_leaves_the_unpaid_amount_on_receivables(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        // 115.00: نقد 65 + آجل 50.
        $res = $this->checkout($auth['token'], $partnerId, $sessionId, ['cash' => 6500, 'credit' => 5000])->assertCreated();

        $this->assertSame('partial', $res['data']['payment_status']);
        $this->assertSame(6500, $this->balance('1110'));
        $this->assertSame(5000, $this->balance('1130'));
    }

    /** @test */
    public function it_rejects_a_closed_session_before_creating_any_pos_document(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', ['name' => 'عميل', 'type' => 'customer'])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", ['closing_balance' => 0])
            ->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, ['cash' => 11500])->assertStatus(422);
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

        // المستأجر B لا يستطيع البيع لعميل المستأجر A، حتى مع جلسة POS تخصه.
        $this->checkout($b['token'], $partnerA, $sessionB, ['cash' => 11500])->assertNotFound();
    }
}

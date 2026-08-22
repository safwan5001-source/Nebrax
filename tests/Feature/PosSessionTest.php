<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\PosSession;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات جلسات POS: كل بيع داخل الوردية يرتبط بها صراحةً؛ لا يعتمد التقرير
 * على نافذة زمنية أو قيد صندوق عام قد يخص حركة أخرى.
 */
class PosSessionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function openSession(array $auth, int $openingBalance = 0): string
    {
        return $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', [
            'opening_balance' => $openingBalance,
        ])->assertCreated()['data']['id'];
    }

    private function customer(string $token, string $name = 'عميل نقدي'): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'customer',
        ])['data']['id'];
    }

    private function checkout(string $token, string $partnerId, string $sessionId, int $unitPrice = 100000): void
    {
        $this->withToken($token)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $sessionId,
            'items'          => [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]],
            'tenders'        => ['cash' => $unitPrice + intdiv($unitPrice * 15, 100)],
        ])->assertCreated();
    }

    /** @test */
    public function it_opens_a_session_and_blocks_a_second_open(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 50000])
            ->assertCreated()->assertJsonPath('data.status', 'open')->assertJsonPath('data.opening_balance', '500.00');

        // لا يمكن فتح جلسة ثانية بينما واحدة مفتوحة.
        $this->withToken($auth['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 10000])
            ->assertStatus(422);
    }

    /** @test */
    public function closing_computes_expected_and_difference_from_linked_cash_receipts_without_journal_entry(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $partnerId = $this->customer($auth['token']);

        // بيع POS نقدي مرحّل: 100,000 + 15% ضريبة = 115,000 هللة.
        $this->checkout($auth['token'], $partnerId, $id);

        // افتتاحي 50,000 + قبض POS منسوب 115,000 = متوقع 165,000؛ فرق صفر.
        $res = $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$id}/close", ['closing_balance' => 165000])
            ->assertOk();
        $this->assertSame('closed', $res['data']['status']);
        $this->assertSame('1650.00', $res['data']['expected_balance']);
        $this->assertSame('0.00', $res['data']['difference']);

        // إغلاق الجلسة لا يولد قيداً محاسبياً؛ البيع وسنده وحدهما يمران بالمحرك.
        $this->assertSame(0, JournalEntry::where('source_type', PosSession::class)->count());
    }

    /** @test */
    public function report_uses_only_pos_documents_linked_to_its_session(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth, 50000);
        $partnerId = $this->customer($auth['token']);

        $this->checkout($auth['token'], $partnerId, $id);
        $this->checkout($auth['token'], $partnerId, $id);

        // فاتورة نقدية عادية خلال النافذة نفسها: تؤثر في 1110، لكنها لا تخص جلسة POS.
        $ordinaryInvoiceId = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/invoices/{$ordinaryInvoiceId}/post")->assertOk();
        $this->assertNull(Invoice::findOrFail($ordinaryInvoiceId)->pos_session_id);

        // مبيعتان POS فقط: 230,000 قبض؛ المتوقع = 50,000 + 230,000.
        $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$id}/report")
            ->assertOk()
            ->assertJsonPath('report.cash_sales', '2300.00')
            ->assertJsonPath('report.sales_count', 2)
            ->assertJsonPath('report.average', '1150.00')
            ->assertJsonPath('report.expected', '2800.00')
            ->assertJsonPath('session.status', 'open');
    }

    /** @test */
    public function another_cashier_cannot_checkout_against_someone_elses_open_session(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);
        $id = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $otherToken = $this->tokenForRole($auth['tenant_id'], 'admin', 'cashier@acme.test');

        $this->withToken($otherToken)->postJson('/api/pos/checkout', [
            'partner_id'     => $partnerId,
            'pos_session_id' => $id,
            'items'          => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            'tenders'        => ['cash' => 115000],
        ])->assertStatus(422);

        $this->assertSame(0, Invoice::where('pos_session_id', $id)->count());
    }

    /** @test */
    public function sessions_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $this->withToken($a['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 1000])->assertCreated();

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson('/api/pos-sessions')->assertOk()->assertJsonCount(0, 'data');
        // المستأجر B يستطيع فتح جلسته؛ عزل المستأجر تام.
        $this->withToken($b['token'])->postJson('/api/pos-sessions/open', ['opening_balance' => 2000])->assertCreated();
    }
}

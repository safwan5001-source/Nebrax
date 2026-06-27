<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Quote;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات عروض الأسعار: الإجماليات مشتقّة من السطور، والتحويل ينشئ فاتورة
 * draft (بلا قيد محاسبي حتى تُرحَّل). تشغيل: php artisan test --filter=QuoteTest
 */
class QuoteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function partner(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @test */
    public function creating_a_quote_derives_totals_from_lines_without_any_journal_entry(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $res = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 2, 'unit_price' => 50000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('draft', $res['data']['status']);
        $this->assertSame('1000.00', $res['data']['subtotal']); // 2 × 500
        $this->assertSame('150.00', $res['data']['tax_amount']);
        $this->assertSame('1150.00', $res['data']['total']);

        // عرض السعر لا يولّد أي قيد محاسبي
        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Quote::class)->count());
    }

    /** @test */
    public function quote_requires_at_least_one_line(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId, 'items' => [],
        ])->assertStatus(422)->assertJsonValidationErrors('items');
    }

    /** @test */
    public function converting_a_quote_creates_a_draft_invoice_and_marks_it_converted(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];

        $invoice = $this->withToken($auth['token'])
            ->postJson("/api/quotes/{$quoteId}/convert", ['payment_type' => 'credit'])
            ->assertCreated();

        // الفاتورة الناتجة draft بنفس الإجمالي، وبلا قيد (لم تُرحَّل بعد)
        $this->assertSame('draft', $invoice['data']['status']);
        $this->assertSame('1150.00', $invoice['data']['total']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertTrue(Quote::find($quoteId)->isConverted());
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->count());
    }

    /** @test */
    public function a_quote_cannot_be_converted_twice(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $quoteId = $this->withToken($auth['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerId,
            'items'      => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/convert")->assertCreated();
        $this->withToken($auth['token'])->postJson("/api/quotes/{$quoteId}/convert")->assertStatus(422);
    }

    /** @test */
    public function quotes_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $partnerA = $this->partner($a['token']);
        $quoteId = $this->withToken($a['token'])->postJson('/api/quotes', [
            'partner_id' => $partnerA, 'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/quotes/{$quoteId}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/quotes')->assertOk()->assertJsonCount(0, 'data');
    }
}

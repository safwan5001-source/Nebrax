<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار أن إنشاء/ترحيل فاتورة عبر API يولّد القيد المحاسبي الصحيح عبر LedgerService.
 * تشغيل:  php artisan test --filter=ApiInvoiceTest
 */
class ApiInvoiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** @test */
    public function creating_and_posting_an_invoice_via_api_generates_a_balanced_entry(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        // إنشاء فاتورة (مسوّدة) عبر API
        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'   => $partnerId,
            'payment_type' => 'cash',
            'items'        => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $invoiceId = $create['data']['id'];
        $this->assertSame('draft', $create['data']['status']);
        $this->assertSame('1150.00', $create['data']['total']); // العرض بالريال

        // ترحيل الفاتورة عبر API
        $posted = $this->withToken($token)->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
        $this->assertSame('posted', $posted['data']['status']);
        $this->assertNotNull($posted['data']['zatca']['qr']); // ZATCA توّلد

        // التحقق من القيد المتولّد عبر LedgerService
        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $invoiceId)
            ->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);  // الصندوق
        $this->assertEquals(100000, $this->line($entry, '4110')->credit); // المبيعات
        $this->assertEquals(15000,  $this->line($entry, '2120')->credit); // ضريبة المخرجات
    }

    /** @test */
    public function invoice_validation_rejects_empty_items(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash', 'items' => [],
        ])->assertStatus(422)->assertJsonValidationErrors('items');
    }
}

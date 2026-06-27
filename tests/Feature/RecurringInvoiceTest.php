<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\RecurringInvoice;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات الفواتير الدورية: القالب يحسب إجمالياته من السطور، والتوليد ينشئ
 * فاتورة draft (بلا قيد) ويقدّم موعد التشغيل التالي.
 * تشغيل: php artisan test --filter=RecurringInvoiceTest
 */
class RecurringInvoiceTest extends TestCase
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
    public function creating_a_template_derives_totals_and_sets_next_run(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $res = $this->withToken($auth['token'])->postJson('/api/recurring-invoices', [
            'partner_id' => $partnerId,
            'frequency'  => 'monthly',
            'start_date' => '2026-06-01',
            'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $this->assertSame('1150.00', $res['data']['total']);
        $this->assertSame('2026-06-01', $res['data']['next_run_date']);
        $this->assertSame(0, $res['data']['generated_count']);
    }

    /** @test */
    public function generating_creates_a_draft_invoice_and_advances_next_run(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $id = $this->withToken($auth['token'])->postJson('/api/recurring-invoices', [
            'partner_id' => $partnerId,
            'frequency'  => 'monthly',
            'start_date' => '2026-06-01',
            'items'      => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])['data']['id'];

        $invoice = $this->withToken($auth['token'])->postJson("/api/recurring-invoices/{$id}/generate")->assertCreated();
        $this->assertSame('draft', $invoice['data']['status']);
        $this->assertSame('1150.00', $invoice['data']['total']);

        // تقدّم الموعد شهراً + زيادة العدّاد، وبلا قيد محاسبي (الفاتورة draft)
        $show = $this->withToken($auth['token'])->getJson("/api/recurring-invoices/{$id}")->assertOk();
        $this->assertSame('2026-07-01', $show['data']['next_run_date']);
        $this->assertSame(1, $show['data']['generated_count']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Invoice::class)->count());
    }

    /** @test */
    public function template_requires_at_least_one_line(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->partner($auth['token']);

        $this->withToken($auth['token'])->postJson('/api/recurring-invoices', [
            'partner_id' => $partnerId, 'items' => [],
        ])->assertStatus(422)->assertJsonValidationErrors('items');
    }

    /** @test */
    public function recurring_invoices_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $partnerA = $this->partner($a['token']);
        $id = $this->withToken($a['token'])->postJson('/api/recurring-invoices', [
            'partner_id' => $partnerA, 'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/recurring-invoices/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/recurring-invoices')->assertOk()->assertJsonCount(0, 'data');
    }
}

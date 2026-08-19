<?php

namespace Tests\Feature;

use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * عقد علاقات الفاتورة للقراءة فقط:
 * - تبويب المدفوعات يعرض مبلغ تخصيص الفاتورة لا مبلغ سند آخر.
 * - القيد يعود كقراءة فقط، وقيد التكلفة null عند غياب حركة مخزون.
 * - مركز التكلفة المرجعي يظهر مع الفاتورة ولا يتجاوز عزل المستأجر.
 */
class InvoiceRelationsApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function invoice_relations_expose_the_allocated_payment_accounting_links_and_cost_center(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل علاقات الفاتورة',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $costCenterId = $this->withToken($token)->postJson('/api/cost-centers', [
            'code' => 'SALES-REL',
            'name' => 'مركز مبيعات العلاقات',
        ])->assertCreated()['data']['id'];

        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'cost_center_id' => $costCenterId,
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $this->withToken($token)->postJson("/api/invoices/{$invoice['id']}/post")->assertOk();

        $payment = $this->withToken($token)->postJson('/api/payments', [
            'partner_id' => $partnerId,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 50000,
            'invoice_id' => $invoice['id'],
        ])->assertCreated()['data'];
        $this->withToken($token)->postJson("/api/payments/{$payment['id']}/post")->assertOk();

        $this->withToken($token)->getJson("/api/invoices/{$invoice['id']}")
            ->assertOk()
            ->assertJsonPath('data.cost_center.id', $costCenterId)
            ->assertJsonPath('data.cost_center.code', 'SALES-REL')
            ->assertJsonPath('data.cost_center.name', 'مركز مبيعات العلاقات');

        $this->withToken($token)->getJson("/api/invoices/{$invoice['id']}/payments")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $payment['id'])
            ->assertJsonPath('data.0.amount', '500.00')
            ->assertJsonPath('data.0.allocated_amount', '500.00')
            ->assertJsonPath('data.0.status', 'posted');

        $this->withToken($token)->getJson("/api/invoices/{$invoice['id']}/accounting")
            ->assertOk()
            ->assertJsonPath('data.sales_entry.status', 'posted')
            ->assertJsonCount(3, 'data.sales_entry.lines')
            ->assertJsonPath('data.cost_entry', null);
    }

    /** @test */
    public function invoice_relation_endpoints_respect_the_active_branch(): void
    {
        $auth = $this->registerTenant();
        app(TenantContext::class)->set($auth['tenant_id']);

        $mainBranch = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $otherBranch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع علاقات آخر'])
            ->assertCreated()['data']['id'];
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل فرع العلاقات',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $otherBranch])
            ->postJson('/api/invoices', [
                'partner_id' => $partnerId,
                'payment_type' => 'credit',
                'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
            ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson("/api/invoices/{$invoiceId}/payments")->assertNotFound();
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson("/api/invoices/{$invoiceId}/accounting")->assertNotFound();
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $otherBranch])
            ->getJson("/api/invoices/{$invoiceId}/payments")->assertOk()->assertJsonCount(0, 'data');
    }

    /** @test */
    public function invoice_relation_endpoints_do_not_cross_tenant_boundaries(): void
    {
        $first = $this->registerTenant();
        $second = $this->registerTenant('other-tenant', 'owner@other-tenant.test');

        $partnerId = $this->withToken($first['token'])->postJson('/api/partners', [
            'name' => 'عميل مستأجر أول',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($first['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($second['token'])->getJson("/api/invoices/{$invoiceId}/payments")->assertNotFound();
        $this->withToken($second['token'])->getJson("/api/invoices/{$invoiceId}/accounting")->assertNotFound();
    }
}

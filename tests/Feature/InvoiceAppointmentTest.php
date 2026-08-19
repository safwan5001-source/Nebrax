<?php

namespace Tests\Feature;

use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * الموعد المرتبط بالفاتورة وثيقة تشغيلية فقط:
 * مصدره يثبّت العميل ولا يسمح له بتغيير الأثر المالي أو تجاوز عزل الفرع.
 */
class InvoiceAppointmentTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function appointment_from_an_invoice_inherits_its_customer_and_appears_in_its_window(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل الموعد',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $invoice = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];

        $appointment = $this->withToken($token)->postJson('/api/appointments', [
            'invoice_id' => $invoice['id'],
            'title' => 'متابعة فاتورة',
            'appointment_at' => '2026-08-20 10:30:00',
            'duration_minutes' => 45,
        ])->assertCreated()
            ->assertJsonPath('data.invoice_id', $invoice['id'])
            ->assertJsonPath('data.partner_id', $partnerId)['data'];

        $this->withToken($token)->getJson("/api/invoices/{$invoice['id']}/appointments")
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $appointment['id'])
            ->assertJsonPath('data.0.invoice.id', $invoice['id'])
            ->assertJsonPath('data.0.invoice.number', $invoice['number']);
    }

    /** @test */
    public function invoice_appointment_rejects_a_customer_that_differs_from_the_source_invoice(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $invoiceCustomerId = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل الفاتورة', 'type' => 'customer'])->assertCreated()['data']['id'];
        $otherCustomerId = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل مختلف', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $invoiceCustomerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($token)->postJson('/api/appointments', [
            'invoice_id' => $invoiceId,
            'partner_id' => $otherCustomerId,
            'title' => 'موعد غير متسق',
            'appointment_at' => '2026-08-20 10:30:00',
        ])->assertStatus(422)
            ->assertJsonPath('message', 'يجب أن يطابق عميل الموعد عميل الفاتورة المصدر.');
    }

    /** @test */
    public function another_branch_cannot_list_appointments_for_an_invoice_outside_its_scope(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $mainBranch = $this->withToken($token)->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $otherBranch = $this->withToken($token)->postJson('/api/branches', ['name' => 'فرع مواعيد آخر'])->assertCreated()['data']['id'];
        $partnerId = $this->withToken($token)->postJson('/api/partners', ['name' => 'عميل الفرع', 'type' => 'customer'])->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($token)->withHeaders(['X-Branch-Id' => $otherBranch])->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($token)->withHeaders(['X-Branch-Id' => $mainBranch])
            ->getJson("/api/invoices/{$invoiceId}/appointments")->assertNotFound();
    }
}

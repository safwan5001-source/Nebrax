<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار عقد نقطة عرض السند (GET /api/payments/{id}) الذي يغذّي مستند سند القبض/الصرف:
 * يعيد الملاحظات وتخصيصات السند (نصّ المستند + المبلغ). لا قيود جديدة — عرض فقط.
 * تشغيل: php artisan test --filter=PaymentVoucherApiTest
 */
class PaymentVoucherApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function show_returns_notes_and_allocations_for_the_voucher(): void
    {
        ['token' => $token, 'tenant_id' => $tid] = $this->registerTenant('nibras', 'owner@nibras.test');
        app(TenantContext::class)->set($tid);

        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]] // 115000
        ));

        $payment = app(PaymentService::class)->post(app(PaymentService::class)->create(
            ['partner_id' => $customer->id, 'amount' => 115000, 'notes' => 'دفعة كاملة'],
            [['invoice_id' => $invoice->id, 'amount' => 115000]]
        ));

        $this->withToken($token)->getJson("/api/payments/{$payment->id}")
            ->assertOk()
            ->assertJsonPath('data.notes', 'دفعة كاملة')
            ->assertJsonCount(1, 'data.allocations')
            ->assertJsonPath('data.allocations.0.label', $invoice->number)
            ->assertJsonPath('data.allocations.0.amount', '1150.00');
    }
}

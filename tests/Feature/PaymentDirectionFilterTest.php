<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Payment;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تصفية المدفوعات بالاتجاه (`?direction=`) — تفصل شاشتَي مدفوعات العملاء
 * (قبض) والموردين (صرف)، وتبقى بلا اتجاه شاملةً (توافق رجعي).
 *
 * تشغيل: php artisan test --filter=PaymentDirectionFilterTest
 */
class PaymentDirectionFilterTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedPayments(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        $rows = [
            ['received', $customer->id, 'PAY-R1'],
            ['paid', $supplier->id, 'PAY-P1'],
            ['paid', $supplier->id, 'PAY-P2'],
        ];

        foreach ($rows as [$direction, $partnerId, $number]) {
            Payment::create([
                'tenant_id' => $tenantId, 'number' => $number,
                'partner_id' => $partnerId, 'direction' => $direction,
                'method' => 'cash', 'status' => 'posted',
                'payment_date' => '2026-01-01', 'amount' => 10000,
            ]);
        }
    }

    /** @test */
    public function filtering_by_paid_returns_only_supplier_payments(): void
    {
        $auth = $this->registerTenant();
        $this->seedPayments($auth['tenant_id']);

        $rows = $this->withToken($auth['token'])->getJson('/api/payments?direction=paid')
            ->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $this->assertSame(['paid', 'paid'], array_column($rows, 'direction'));
    }

    /** @test */
    public function filtering_by_received_returns_only_customer_payments(): void
    {
        $auth = $this->registerTenant();
        $this->seedPayments($auth['tenant_id']);

        $rows = $this->withToken($auth['token'])->getJson('/api/payments?direction=received')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('received', $rows[0]['direction']);
    }

    /** بلا اتجاه (أو اتجاه غير معروف) تُعاد كل المدفوعات — توافق رجعي. */
    /** @test */
    public function no_direction_returns_every_payment(): void
    {
        $auth = $this->registerTenant();
        $this->seedPayments($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson('/api/payments')
            ->assertOk()->assertJsonCount(3, 'data');

        $this->withToken($auth['token'])->getJson('/api/payments?direction=bogus')
            ->assertOk()->assertJsonCount(3, 'data');
    }
}

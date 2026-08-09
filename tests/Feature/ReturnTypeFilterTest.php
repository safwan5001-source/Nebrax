<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\ReturnDocument;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تصفية قائمة المرتجعات بالنوع (`?type=`) — تفصل شاشتَي مرتجعات المبيعات
 * والمشتريات، وتبقى بلا نوع شاملةً (توافق رجعي).
 *
 * تشغيل: php artisan test --filter=ReturnTypeFilterTest
 */
class ReturnTypeFilterTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedReturns(string $tenantId): void
    {
        app(TenantContext::class)->set($tenantId);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        foreach ([['sales', $customer->id, 'RS-1'], ['purchase', $supplier->id, 'RP-1'], ['purchase', $supplier->id, 'RP-2']] as [$type, $pid, $num]) {
            ReturnDocument::create([
                'tenant_id' => $tenantId, 'number' => $num, 'type' => $type,
                'partner_id' => $pid, 'payment_type' => 'credit', 'status' => 'draft',
                'return_date' => '2026-01-01', 'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
            ]);
        }
    }

    /** @test */
    public function filtering_by_purchase_returns_only_purchase_documents(): void
    {
        $auth = $this->registerTenant();
        $this->seedReturns($auth['tenant_id']);

        $rows = $this->withToken($auth['token'])->getJson('/api/returns?type=purchase')
            ->assertOk()->json('data');

        $this->assertCount(2, $rows);
        $this->assertSame(['purchase', 'purchase'], array_column($rows, 'type'));
    }

    /** @test */
    public function filtering_by_sales_returns_only_sales_documents(): void
    {
        $auth = $this->registerTenant();
        $this->seedReturns($auth['tenant_id']);

        $rows = $this->withToken($auth['token'])->getJson('/api/returns?type=sales')
            ->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('sales', $rows[0]['type']);
    }

    /** بلا نوع (أو نوع غير معروف) تُعاد كل المرتجعات — توافق رجعي. */
    /** @test */
    public function no_type_returns_every_document(): void
    {
        $auth = $this->registerTenant();
        $this->seedReturns($auth['tenant_id']);

        $this->withToken($auth['token'])->getJson('/api/returns')
            ->assertOk()->assertJsonCount(3, 'data');

        $this->withToken($auth['token'])->getJson('/api/returns?type=bogus')
            ->assertOk()->assertJsonCount(3, 'data');
    }
}

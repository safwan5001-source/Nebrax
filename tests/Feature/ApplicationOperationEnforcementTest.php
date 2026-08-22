<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\Employee;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * إنفاذ حالة التطبيق على العمليات التي لم يكن لها App Guard ثابت:
 * - سطح HR التشغيلي الحالي يُحرس مؤقتاً بـ hr.employees، من دون تغيير maturity
 *   للمفاتيح الفرعية الموجودة في الكتالوج.
 * - المرتجعات والإشعارات المشتركة تستمد مفتاحها من type/document المخزن، فلا
 *   يمنع purchases.cycle المرتجعات/الإشعارات البيعية.
 *
 * تشغيل: php artisan test --filter=ApplicationOperationEnforcementTest
 */
class ApplicationOperationEnforcementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function seedSalesReturnReferences(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);

        $customer = Partner::create(['name' => 'عميل اختبار', 'type' => 'customer']);
        $product = Product::create([
            'name' => 'منتج مرتجع',
            'sku' => 'RET-' . substr($tenantId, 0, 8),
            'track_inventory' => false,
            'quantity_on_hand' => 0,
            'avg_cost' => 0,
        ]);

        return ['customer_id' => $customer->id, 'product_id' => $product->id];
    }

    /** @test */
    public function a_disabled_hr_capability_denies_direct_operational_apis_even_when_rbac_allows_them(): void
    {
        $auth = $this->registerTenant('hr-disabled', 'owner@hr-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/payroll-runs')->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/shifts')->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/departments')->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/attendances', [])->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/leave-requests/00000000-0000-0000-0000-000000000001/approve')->assertForbidden();
    }

    /** @test */
    public function a_suspended_hr_capability_allows_reads_but_denies_hr_writes(): void
    {
        $auth = $this->registerTenant('hr-suspended', 'owner@hr-suspended.test');
        app(TenantContext::class)->set($auth['tenant_id']);

        Employee::create(['employee_no' => 'EMP-HARD-1', 'name' => 'موظف الحراسة']);

        $this->withToken($auth['token'])->postJson('/api/applications/disable', [
            'application_key' => 'hr.employees',
        ])->assertOk()->assertJsonPath('data.status', 'suspended');

        $this->withToken($auth['token'])->getJson('/api/payroll-runs')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/attendances')->assertOk();
        $this->withToken($auth['token'])->postJson('/api/payroll-runs', ['period' => '2026-01'])->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/me/attendance/check-in')->assertForbidden();
    }

    /** @test */
    public function an_enabled_hr_capability_preserves_existing_hr_reads_and_reaches_validation_for_writes(): void
    {
        $auth = $this->registerTenant('hr-enabled', 'owner@hr-enabled.test');

        $this->withToken($auth['token'])->getJson('/api/payroll-runs')->assertOk();
        // 422 means the request passed Application State and reached its existing validator.
        $this->withToken($auth['token'])->postJson('/api/payroll-runs', [])->assertStatus(422);
    }

    /** @test */
    public function disabling_purchases_denies_purchase_returns_and_purchase_debit_notes_by_direct_api(): void
    {
        $auth = $this->registerTenant('purchase-disabled', 'owner@purchase-disabled.test', autoEnableApplications: false);

        app(TenantContext::class)->set($auth['tenant_id']);
        $supplier = Partner::create(['name' => 'مورد الحراسة', 'type' => 'supplier']);
        $return = ReturnDocument::create([
            'number' => 'PR-GUARD-1', 'type' => 'purchase', 'partner_id' => $supplier->id,
            'payment_type' => 'credit', 'status' => 'draft', 'return_date' => '2026-01-01',
            'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);
        $note = CreditNote::create([
            'number' => 'DN-GUARD-1', 'type' => 'purchase', 'partner_id' => $supplier->id,
            'refund_type' => 'credit', 'status' => 'draft', 'note_date' => '2026-01-01',
            'subtotal' => 0, 'tax_amount' => 0, 'total' => 0,
        ]);

        $this->withToken($auth['token'])->getJson('/api/returns?type=purchase')->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/credit-notes?type=purchase')->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/credit-notes')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($auth['token'])->postJson('/api/returns', ['type' => 'purchase'])->assertForbidden();
        $this->withToken($auth['token'])->postJson("/api/returns/{$return->id}/post")->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/credit-notes', ['type' => 'purchase'])->assertForbidden();
        $this->withToken($auth['token'])->postJson("/api/credit-notes/{$note->id}/post")->assertForbidden();
    }

    /** @test */
    public function disabled_purchases_does_not_block_a_valid_sales_return(): void
    {
        $auth = $this->registerTenant('sales-return-still-works', 'owner@sales-return-still-works.test', autoEnableApplications: false);
        $refs = $this->seedSalesReturnReferences($auth['tenant_id']);

        $this->withToken($auth['token'])->postJson('/api/returns', [
            'type' => 'sales',
            'partner_id' => $refs['customer_id'],
            'payment_type' => 'credit',
            'items' => [[
                'product_id' => $refs['product_id'],
                'quantity' => 1,
                'unit_price' => 10000,
                'tax_rate' => 15,
            ]],
        ])->assertCreated()->assertJsonPath('data.type', 'sales');
    }

    /** @test */
    public function an_untyped_shared_return_list_hides_purchase_rows_only_when_purchases_is_disabled(): void
    {
        $auth = $this->registerTenant('shared-list', 'owner@shared-list.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $customer = Partner::create(['name' => 'عميل القائمة', 'type' => 'customer']);
        $supplier = Partner::create(['name' => 'مورد القائمة', 'type' => 'supplier']);

        foreach ([['sales', $customer->id, 'SR-HARD-1'], ['purchase', $supplier->id, 'PR-HARD-1']] as [$type, $partnerId, $number]) {
            ReturnDocument::create([
                'number' => $number,
                'type' => $type,
                'partner_id' => $partnerId,
                'payment_type' => 'credit',
                'status' => 'draft',
                'return_date' => '2026-01-01',
                'subtotal' => 0,
                'tax_amount' => 0,
                'total' => 0,
            ]);
        }

        $rows = $this->withToken($auth['token'])->getJson('/api/returns')->assertOk()->json('data');

        $this->assertCount(1, $rows);
        $this->assertSame('sales', $rows[0]['type']);
    }

    /** @test */
    public function tenant_a_application_state_cannot_change_tenant_b_route_access(): void
    {
        $tenantA = $this->registerTenant('isolated-a', 'owner@isolated-a.test', autoEnableApplications: false);
        $tenantB = $this->registerTenant('isolated-b', 'owner@isolated-b.test');

        $this->withToken($tenantA['token'])->getJson('/api/payroll-runs')->assertForbidden();
        $this->withToken($tenantB['token'])->getJson('/api/payroll-runs')->assertOk();
    }

    /** @test */
    public function rbac_remains_independent_when_the_sales_operation_is_not_application_blocked(): void
    {
        $auth = $this->registerTenant('rbac-independent', 'owner@rbac-independent.test');
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@rbac-independent.test');

        // sales.invoicing is mandatory, so the 403 must be RBAC rather than Application State.
        $this->withToken($staffToken)->postJson('/api/returns', ['type' => 'sales'])->assertForbidden();
    }

    /** @test */
    public function navigation_state_never_grants_direct_hr_api_access(): void
    {
        $auth = $this->registerTenant('nav-not-auth', 'owner@nav-not-auth.test', autoEnableApplications: false);
        $staffToken = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@nav-not-auth.test');

        $nav = $this->withToken($staffToken)->getJson('/api/applications/nav-state')
            ->assertOk()->json('data');
        $this->assertArrayHasKey('hr.employees', $nav);
        $this->assertFalse($nav['hr.employees']);
        $this->withToken($staffToken)->getJson('/api/payroll-runs')->assertForbidden();
    }

    /** @test */
    public function a_grandfathered_tenant_keeps_hr_route_access_without_an_explicit_state_row(): void
    {
        $auth = $this->registerTenant('grandfathered-hr', 'owner@grandfathered-hr.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);

        $tenant = \App\Models\Tenant::findOrFail($auth['tenant_id']);
        $tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        $this->assertDatabaseMissing('tenant_application_states', [
            'tenant_id' => $auth['tenant_id'],
            'application_key' => 'hr.employees',
        ]);
        $this->withToken($auth['token'])->getJson('/api/payroll-runs')->assertOk();
    }
}

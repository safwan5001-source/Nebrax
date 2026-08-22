<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * المرحلة الثانية: حراسة surfaces ذات الملكية الواضحة، مع تثبيت الفصل بين
 * application management وبين الآثار الأساسية للفاتورة والمخزون.
 *
 * تشغيل: php artisan test --filter=ApplicationSemanticsEnforcementTest
 */
class ApplicationSemanticsEnforcementTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function disabled_pos_denies_only_pos_settings_and_keeps_shared_sales_config_available(): void
    {
        $auth = $this->registerTenant('pos-settings-disabled', 'owner@pos-settings-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/sales-config/pos')->assertForbidden();
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', ['data' => []])->assertForbidden();

        // `sources` قسم مبيعات مشترك، لا يجوز أن تحجبه حالة POS.
        $this->withToken($auth['token'])->getJson('/api/sales-config/sources')->assertOk();
        $this->withToken($auth['token'])->putJson('/api/sales-config/sources', ['data' => []])->assertOk();
    }

    /** @test */
    public function pos_settings_follow_the_tenant_state_and_keep_rbac_independent(): void
    {
        $auth = $this->registerTenant('pos-settings-enabled', 'owner@pos-settings-enabled.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        app(TenantApplicationService::class)->enable('sales.pos', null);

        $this->withToken($auth['token'])->getJson('/api/sales-config/pos')->assertOk();
        $this->withToken($auth['token'])->putJson('/api/sales-config/pos', ['data' => ['allow_discount' => false]])->assertOk();

        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@pos-settings-enabled.test');
        $this->withToken($staff)->putJson('/api/sales-config/pos', ['data' => []])->assertForbidden();
    }

    /** @test */
    public function tenant_a_pos_state_does_not_grant_pos_settings_access_to_tenant_b(): void
    {
        $tenantA = $this->registerTenant('pos-tenant-a', 'owner@pos-tenant-a.test', autoEnableApplications: false);
        $tenantB = $this->registerTenant('pos-tenant-b', 'owner@pos-tenant-b.test', autoEnableApplications: false);

        app(TenantContext::class)->set($tenantA['tenant_id']);
        app(TenantApplicationService::class)->enable('sales.pos', null);

        $this->withToken($tenantA['token'])->getJson('/api/sales-config/pos')->assertOk();
        $this->withToken($tenantB['token'])->getJson('/api/sales-config/pos')->assertForbidden();
    }

    /** @test */
    public function grandfathered_tenants_keep_settings_access_without_explicit_application_rows(): void
    {
        $auth = $this->registerTenant('legacy-settings', 'owner@legacy-settings.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);
        $tenant = \App\Models\Tenant::findOrFail($auth['tenant_id']);
        $tenant->forceFill(['created_at' => '2020-01-01 00:00:00'])->save();

        $this->assertDatabaseMissing('tenant_application_states', ['tenant_id' => $auth['tenant_id'], 'application_key' => 'sales.pos']);
        $this->assertDatabaseMissing('tenant_application_states', ['tenant_id' => $auth['tenant_id'], 'application_key' => 'purchases.cycle']);
        $this->withToken($auth['token'])->getJson('/api/sales-config/pos')->assertOk();
        $this->withToken($auth['token'])->getJson('/api/purchase-settings')->assertOk();
    }

    /** @test */
    public function purchase_settings_follow_purchases_cycle_without_affecting_other_settings(): void
    {
        $auth = $this->registerTenant('purchase-settings-disabled', 'owner@purchase-settings-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/purchase-settings')->assertForbidden();
        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_tax_rate' => 5])->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/sales-settings')->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        app(TenantApplicationService::class)->enable('purchases.cycle', null);
        $this->withToken($auth['token'])->getJson('/api/purchase-settings')->assertOk();
        $this->withToken($auth['token'])->putJson('/api/purchase-settings', ['default_tax_rate' => 5])
            ->assertOk()->assertJsonPath('data.default_tax_rate', 5);
    }

    /** @test */
    public function expense_categories_follow_finance_operations_and_not_accounting_core(): void
    {
        $auth = $this->registerTenant('finance-categories-disabled', 'owner@finance-categories-disabled.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/expense-categories')->assertForbidden();
        $this->withToken($auth['token'])->postJson('/api/expense-categories', ['name' => 'إيجار'])->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/accounts')->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        app(TenantApplicationService::class)->enable('finance.operations', null);
        $this->withToken($auth['token'])->postJson('/api/expense-categories', ['name' => 'إيجار'])->assertCreated();
    }

    /** @test */
    public function disabled_zatca_settings_do_not_block_core_invoice_posting_or_generated_compliance_data(): void
    {
        $auth = $this->registerTenant('zatca-core-invoice', 'owner@zatca-core-invoice.test', autoEnableApplications: false);

        $this->withToken($auth['token'])->getJson('/api/zatca-settings')->assertForbidden();
        $this->withToken($auth['token'])->putJson('/api/zatca-settings', ['icv_scope' => 'tenant'])->assertForbidden();

        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل امتثال', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $invoiceId = $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'cash',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/invoices/{$invoiceId}/post")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted')
            ->assertJsonPath('data.zatca.uuid', fn ($value) => is_string($value) && $value !== '')
            ->assertJsonPath('data.zatca.qr', fn ($value) => is_string($value) && $value !== '');
    }

    /** @test */
    public function disabled_inventory_management_blocks_its_report_but_not_core_invoice_stock_and_cogs_effects(): void
    {
        $auth = $this->registerTenant('inventory-core-effects', 'owner@inventory-core-effects.test', autoEnableApplications: false);
        app(TenantContext::class)->set($auth['tenant_id']);

        // تقرير إدارة مخزون محمي، بينما قائمة المخازن مرجع مشترك لا تنكسر.
        $this->withToken($auth['token'])->getJson('/api/reports/inventory?view=value')->assertForbidden();
        $this->withToken($auth['token'])->getJson('/api/warehouses')->assertOk();

        $product = Product::create([
            'name' => 'صنف متتبّع',
            'sku' => 'INV-CORE-1',
            'track_inventory' => true,
            'sale_price' => 10000,
        ]);
        app(InventoryService::class)->receiveStock($product, 5, 4000);
        $customer = Partner::create(['name' => 'عميل مخزون', 'type' => 'customer']);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15]],
        );
        $posted = app(InvoiceService::class)->post($invoice);

        $this->assertNotNull($posted->journal_entry_id);
        $this->assertNotNull($posted->cogs_entry_id);
        $this->assertSame(3, $product->fresh()->quantity_on_hand);

        app(TenantApplicationService::class)->enable('inventory.core', null);
        $this->withToken($auth['token'])->getJson('/api/reports/inventory?view=value')->assertOk();
    }
}

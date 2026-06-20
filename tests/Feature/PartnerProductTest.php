<?php

namespace Tests\Feature;

use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة الأطراف والمنتجات — تثبت العزل والتخزين الصحيح.
 * تشغيل:  php artisan test --filter=PartnerProductTest
 */
class PartnerProductTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
    }

    /** @test */
    public function it_creates_a_partner_scoped_to_tenant(): void
    {
        $partner = Partner::create([
            'name' => 'عميل نقدي',
            'type' => 'customer',
            'city' => 'الدمام',
        ]);

        // tenant_id حُقن تلقائياً من السياق
        $this->assertEquals($this->tenant->id, $partner->tenant_id);
        $this->assertTrue($partner->isCustomer());
        $this->assertFalse($partner->isSupplier());
    }

    /** @test */
    public function partner_type_both_is_customer_and_supplier(): void
    {
        $partner = Partner::create(['name' => 'طرف مزدوج', 'type' => 'both']);

        $this->assertTrue($partner->isCustomer());
        $this->assertTrue($partner->isSupplier());
    }

    /** @test */
    public function partners_are_isolated_between_tenants(): void
    {
        Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->assertEquals(1, Partner::count());

        // مستأجر ثانٍ لا يرى أطراف الأول
        $tenantB = Tenant::create(['name' => 'شركة ثانية', 'slug' => 'other']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertEquals(0, Partner::count());
    }

    /** @test */
    public function it_stores_product_prices_as_minor_units(): void
    {
        // 100.50 ريال = 10050 هللة
        $product = Product::create([
            'name'       => 'منتج',
            'sale_price' => 10050,
            'tax_rate'   => 15,
        ]);

        $stored = Product::find($product->id);

        $this->assertSame(10050, $stored->sale_price); // bigint، لا float
        $this->assertSame(15, $stored->tax_rate);
        $this->assertSame('good', $stored->type);      // القيمة الافتراضية
    }

    /** @test */
    public function products_are_isolated_between_tenants(): void
    {
        Product::create(['name' => 'منتج أول', 'sale_price' => 5000]);
        $this->assertEquals(1, Product::count());

        $tenantB = Tenant::create(['name' => 'شركة ثانية', 'slug' => 'other']);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertEquals(0, Product::count());
    }
}

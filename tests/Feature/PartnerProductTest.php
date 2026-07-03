<?php

namespace Tests\Feature;

use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PartnerService;
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
    public function it_stores_a_partner_classification(): void
    {
        $partner = Partner::create(['name' => 'عميل مميّز', 'type' => 'customer', 'classification' => 'VIP']);

        $this->assertSame('VIP', Partner::find($partner->id)->classification);
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
    public function it_stores_a_product_barcode(): void
    {
        $product = Product::create(['name' => 'صنف', 'sale_price' => 5000, 'barcode' => '6281000123457']);

        $this->assertSame('6281000123457', Product::find($product->id)->barcode);
    }

    /** @test */
    public function it_stores_product_catalog_fields(): void
    {
        $product = Product::create([
            'name' => 'صنف', 'sale_price' => 5000,
            'description' => 'وصف تفصيلي', 'category' => 'مشروبات', 'brand' => 'نوفا', 'reorder_level' => 20,
        ]);

        $stored = Product::find($product->id);
        $this->assertSame('وصف تفصيلي', $stored->description);
        $this->assertSame('مشروبات', $stored->category);
        $this->assertSame('نوفا', $stored->brand);
        $this->assertSame(20, $stored->reorder_level);
    }

    /** @test */
    public function it_stores_product_extra_fields(): void
    {
        $supplier = Partner::create(['name' => 'مورّد', 'type' => 'supplier']);
        $product = Product::create([
            'name' => 'صنف', 'sale_price' => 5000,
            'supplier_id' => $supplier->id, 'min_sale_price' => 3000, 'discount' => 5,
            'discount_type' => 'percent', 'profit_margin' => 40, 'tags' => 'مميز,جديد', 'internal_notes' => 'سري',
        ]);

        $stored = Product::find($product->id);
        $this->assertSame($supplier->id, $stored->supplier_id);
        $this->assertSame(3000, $stored->min_sale_price);
        $this->assertSame(5, $stored->discount);
        $this->assertSame('percent', $stored->discount_type);
        $this->assertSame(40, $stored->profit_margin);
        $this->assertSame('مميز,جديد', $stored->tags);
        $this->assertSame('سري', $stored->internal_notes);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** @test */
    public function a_customer_opening_balance_debits_receivables_tagged_to_the_partner(): void
    {
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $entry = app(PartnerService::class)->recordOpeningBalance($customer, 50000); // 500.00

        $entry = JournalEntry::with('lines.account')->findOrFail($entry->id);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $ar = $this->line($entry, '1130');
        $this->assertEquals(50000, $ar->debit);              // العملاء مدين
        $this->assertEquals(50000, $this->line($entry, '3130')->credit); // الأرصدة الافتتاحية
        $this->assertEquals(Partner::class, $ar->partner_type); // مربوط بالطرف (لكشف الحساب)
        $this->assertEquals($customer->id, $ar->partner_id);
    }

    /** @test */
    public function a_supplier_opening_balance_credits_payables(): void
    {
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $supplier = Partner::create(['name' => 'مورّد', 'type' => 'supplier']);

        $entry = app(PartnerService::class)->recordOpeningBalance($supplier, 80000);

        $entry = JournalEntry::with('lines.account')->findOrFail($entry->id);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(80000, $this->line($entry, '2110')->credit); // الموردون دائن
        $this->assertEquals(80000, $this->line($entry, '3130')->debit);  // الأرصدة الافتتاحية
    }

    /** @test */
    public function a_zero_opening_balance_posts_nothing(): void
    {
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);

        $this->assertNull(app(PartnerService::class)->recordOpeningBalance($customer, 0));
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

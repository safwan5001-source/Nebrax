<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  أمر تشخيص المخزون — يكشف ولا يُصلح
 * ═══════════════════════════════════════════════════════════════
 *  الأمر أداة تقصٍّ على بيانات إنتاج حقيقية، فأخطر ما فيه أن يكتب شيئاً.
 *  اختبار صريح أدناه يقيس عدد القيود والحركات والأرصدة قبل وبعد.
 *
 *  تشغيل: php artisan test --filter=DiagnoseInventoryTest
 */
class DiagnoseInventoryTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
    }

    /** منتج متابَع برصيد افتتاحي. */
    private function product(string $sku, int $qty, int $cost = 10000): Product
    {
        $product = Product::create([
            'name' => "صنف {$sku}", 'sku' => $sku, 'type' => 'good',
            'sale_price' => $cost * 2, 'purchase_price' => $cost, 'track_inventory' => true,
        ]);

        if ($qty > 0) {
            app(InventoryService::class)->receiveStock($product, $qty, $cost);
        }

        return $product->fresh();
    }

    /** بيع يتجاوز المتاح — يُنزل الكمية إلى سالب (العطل قيد التشخيص). */
    private function oversell(Product $product, int $quantity): void
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => 20000, 'tax_rate' => 0]]
        );
        app(InvoiceService::class)->post($invoice);
    }

    /** @test */
    public function it_reports_a_clean_tenant_as_healthy(): void
    {
        $this->product('OK-1', 10);

        $this->artisan('inventory:diagnose')
            ->expectsOutputToContain('سليم')
            ->assertSuccessful();
    }

    /**
     * **جوهر الأداة.** الصنف السالب يظهر برمزه وكميته وقيمته.
     *
     * @test
     */
    public function it_lists_currently_negative_products(): void
    {
        $product = $this->product('NEG-1', 3);
        $this->oversell($product, 10);

        $this->assertSame(-7, $product->fresh()->quantity_on_hand, 'التهيئة يجب أن تُنتج كمية سالبة.');

        $this->artisan('inventory:diagnose')
            ->expectsOutputToContain('NEG-1')
            ->expectsOutputToContain('أصناف سالبة الآن')
            ->assertSuccessful();
    }

    /**
     * **ما لا يُرى بالعين.** صنفٌ سلب ثم عاد موجباً: كميته سليمة اليوم لكن
     * متوسطه قد يكون مُفسَداً — فيُعرض في مجموعة مستقلّة.
     *
     * @test
     */
    public function it_flags_products_that_recovered_from_negative(): void
    {
        $product = $this->product('REC-1', 3);
        $this->oversell($product, 10);                       // ⇒ −٧
        app(InventoryService::class)->receiveStock($product->fresh(), 20, 20000); // ⇒ +١٣

        $recovered = $product->fresh();
        $this->assertGreaterThan(0, $recovered->quantity_on_hand, 'عادت موجبة.');

        $this->artisan('inventory:diagnose')
            ->expectsOutputToContain('REC-1')
            ->expectsOutputToContain('متوسطها مشكوك فيه')
            ->assertSuccessful();
    }

    /** يعرض الثابت: رصيد 1140 مقابل مجموع دفتر المخزون. */
    /** @test */
    public function it_prints_the_control_account_against_the_subsidiary_ledger(): void
    {
        $product = $this->product('INV-1', 3);
        $this->oversell($product, 10);

        $this->artisan('inventory:diagnose')
            ->expectsOutputToContain('حساب 1140 المخزون')
            ->expectsOutputToContain('Σ(كمية × متوسط تكلفة)')
            ->assertSuccessful();
    }

    /**
     * **الضمان الحاسم:** أداة تقصٍّ على بيانات إنتاج **لا تكتب حرفاً**.
     *
     * @test
     */
    public function the_command_writes_nothing(): void
    {
        $product = $this->product('RO-1', 3);
        $this->oversell($product, 10);

        $before = [
            'entries'   => JournalEntry::count(),
            'movements' => StockMovement::count(),
            'quantity'  => $product->fresh()->quantity_on_hand,
            'avg'       => $product->fresh()->avg_cost,
            'balance'   => Account::where('code', '1140')->first()->balance?->balance,
        ];

        $this->artisan('inventory:diagnose')->assertSuccessful();

        $this->assertSame($before['entries'], JournalEntry::count());
        $this->assertSame($before['movements'], StockMovement::count());
        $this->assertSame($before['quantity'], $product->fresh()->quantity_on_hand);
        $this->assertSame($before['avg'], $product->fresh()->avg_cost);
        $this->assertSame($before['balance'], Account::where('code', '1140')->first()->balance?->balance);
    }

    /** التشخيص يعبر المستأجرين — ولا يخلط بياناتهم. */
    /** @test */
    public function it_can_target_a_single_tenant(): void
    {
        $product = $this->product('T1-NEG', 3);
        $this->oversell($product, 10);

        $other = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other',
            'vat_number' => '300000000000004', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);

        // بمعرّف المستأجر الآخر: لا يظهر صنف الأول
        $this->artisan('inventory:diagnose', ['--tenant' => $other->id])
            ->doesntExpectOutputToContain('T1-NEG')
            ->assertSuccessful();
    }
}

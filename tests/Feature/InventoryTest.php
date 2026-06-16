<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات وحدة المخزون الدائم — تثبت متوسط التكلفة المتحرك
 * وتوليد قيد تكلفة البضاعة المباعة عند الترحيل.
 * تشغيل:  php artisan test --filter=InventoryTest
 */
class InventoryTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected InventoryService $inventory;

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
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer  = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->inventory = app(InventoryService::class);
    }

    private function bal(string $code): int
    {
        $account = Account::where('code', $code)->first();
        return $account->balance?->balance ?? 0;
    }

    private function trackedProduct(): Product
    {
        return Product::create([
            'name'            => 'بضاعة',
            'sale_price'      => 10000,
            'track_inventory' => true,
        ]);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** @test */
    public function receive_stock_entry_is_balanced_uses_1140_2110_and_links_to_movement(): void
    {
        $product  = $this->trackedProduct();
        $movement = $this->inventory->receiveStock($product, 10, 4000); // 40000

        $entry = JournalEntry::with('lines.account')
            ->where('source_type', StockMovement::class)
            ->where('source_id', $movement->id)
            ->firstOrFail();

        // (د) الربط بمصدره (حركة المخزون)
        $this->assertSame($movement->id, $entry->source_id);
        $this->assertSame(StockMovement::class, $entry->source_type);

        // (أ) التوازن
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(40000, $entry->lines->sum('debit'));

        // (ب) استلام يمدِّن 1140 ويُدائن 2110
        $this->assertEquals(40000, $this->line($entry, '1140')->debit);
        $this->assertEquals(40000, $this->line($entry, '2110')->credit);

        // (ج) المبلغ مشتق: total_cost = quantity × unit_cost
        $this->assertEquals($movement->quantity * $movement->unit_cost, $entry->lines->sum('debit'));
    }

    /** @test */
    public function cogs_entry_is_balanced_uses_5110_1140_and_links_to_invoice(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 10, 4000); // متوسط 4000

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
        $posted = app(InvoiceService::class)->post($invoice);

        $cogs = JournalEntry::with('lines.account')->findOrFail($posted->cogs_entry_id);

        // (د) قيد التكلفة مربوط بالفاتورة مصدره
        $this->assertSame($posted->id, $cogs->source_id);
        $this->assertSame(Invoice::class, $cogs->source_type);

        // (أ) التوازن
        $this->assertEquals($cogs->lines->sum('debit'), $cogs->lines->sum('credit'));

        // (ب) بيع مخزون يمدِّن 5110 ويُدائن 1140
        $this->assertEquals(20000, $this->line($cogs, '5110')->debit);
        $this->assertEquals(20000, $this->line($cogs, '1140')->credit);

        // (ج) المبلغ مشتق: الكمية المباعة × متوسط التكلفة (5 × 4000)
        $this->assertEquals(5 * $product->fresh()->avg_cost, $this->line($cogs, '5110')->debit);
    }

    /** @test */
    public function receiving_stock_updates_quantity_cost_and_ledger(): void
    {
        $product = $this->trackedProduct();

        $this->inventory->receiveStock($product, 10, 4000); // 10 وحدات بتكلفة 40 لكل وحدة

        $product->refresh();
        $this->assertSame(10, $product->quantity_on_hand);
        $this->assertSame(4000, $product->avg_cost);

        // مدين المخزون 40000، دائن الموردون 40000
        // (2110 طبيعته دائنة، فرصيده الموجب يمثّل الالتزام)
        $this->assertEquals(40000, $this->bal('1140'));
        $this->assertEquals(40000, $this->bal('2110'));
    }

    /** @test */
    public function moving_average_cost_is_recomputed_on_each_receipt(): void
    {
        $product = $this->trackedProduct();

        $this->inventory->receiveStock($product, 10, 4000); // قيمة 40000
        $this->inventory->receiveStock($product, 10, 6000); // قيمة 60000

        $product->refresh();
        $this->assertSame(20, $product->quantity_on_hand);
        $this->assertSame(5000, $product->avg_cost);        // (40000+60000)/20
        $this->assertEquals(100000, $this->bal('1140'));
    }

    /** @test */
    public function selling_a_tracked_product_posts_cogs_and_reduces_stock(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 10, 4000);  // مخزون 40000

        // بيع 5 وحدات بسعر 100 لكل وحدة
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
        $posted = app(InvoiceService::class)->post($invoice);

        // قيد التكلفة وُلِّد وارتبط بالفاتورة
        $this->assertNotNull($posted->cogs_entry_id);

        // التكلفة = 5 × 4000 = 20000 → مدين 5110، المخزون ينخفض إلى 20000
        $this->assertEquals(20000, $this->bal('5110'));
        $this->assertEquals(20000, $this->bal('1140')); // 40000 − 20000

        $product->refresh();
        $this->assertSame(5, $product->quantity_on_hand);

        // حركتان: استلام (in) وبيع (out)
        $this->assertSame(2, $product->movements()->count());
    }

    /** @test */
    public function selling_a_non_tracked_product_generates_no_cogs(): void
    {
        $service = Product::create([
            'name' => 'خدمة', 'type' => 'service', 'sale_price' => 50000, 'track_inventory' => false,
        ]);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $service->id, 'quantity' => 1, 'unit_price' => 50000, 'tax_rate' => 15]]
        );
        $posted = app(InvoiceService::class)->post($invoice);

        $this->assertNull($posted->cogs_entry_id);
        $this->assertEquals(0, $this->bal('5110'));
    }

    /** @test */
    public function books_stay_balanced_after_inventory_and_sale(): void
    {
        $product = $this->trackedProduct();
        $this->inventory->receiveStock($product, 10, 4000);

        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash'],
            [['product_id' => $product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
        app(InvoiceService::class)->post($invoice);

        $tb = app(ReportService::class)->trialBalance();
        $this->assertTrue($tb['balanced']);
        $this->assertEquals($tb['total_debit'], $tb['total_credit']);
    }
}

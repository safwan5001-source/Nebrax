<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\StockPermitService;
use App\Services\Accounting\StocktakeService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-INV-4 — الجرد: لقطة الفتح مقابل الحركة المتزامنة
 * ═══════════════════════════════════════════════════════════════
 *  العلّة المؤكَّدة: `post()` كانت تطبّق `counted - system_quantity` على
 *  الرصيد القائم وقت الترحيل مباشرةً، بلا إثبات أن الرصيد ما يزال كما كان
 *  وقت الفتح. حركةٌ حقيقية (بيع، استلام شراء، إذن) بين الفتح والترحيل
 *  تجعل التصحيح خاطئاً رياضياً رغم حماية المستند من الترحيل المزدوج.
 *
 *  السياسة المعتمَدة: **يقظة (Option B)** — `post()` يقفل صفّ
 *  `ProductWarehouseStock` لكل صنفٍ معدود ويقارنه بلقطة الفتح قبل أي حركة
 *  أو قيد؛ أي تعارض يرفض الترحيل كلّه، ويُلزم `reconcile()` صريحاً يحدّث
 *  اللقطة ويمسح العدّ المتأثر فقط.
 *
 *  **تصحيحٌ بعد المراجعة المستقلة:** المقارنة الآن على `revision` — عدّاد
 *  رتيب يزيد مع كل حركة فعلية — لا الكمية النهائية وحدها، فتُكتشف حركة
 *  ذهاب-وعودة (ABA: ١٠٠→٩٠→١٠٠) رغم عودة الكمية إلى أصلها تماماً.
 *
 *  تشغيل: php artisan test --filter=StocktakeConcurrencyReconciliationTest
 */
class StocktakeConcurrencyReconciliationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Product $cement;
    protected Product $steel;
    protected Warehouse $main;
    protected Warehouse $second;
    protected Partner $customer;
    protected Partner $supplier;
    protected StocktakeService $stocktakes;
    protected InventoryService $inventory;
    protected InvoiceService $invoices;
    protected PurchaseService $purchases;
    protected StockPermitService $permits;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->main   = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'PR4-W1', 'is_default' => true]);
        $this->second = Warehouse::create(['name' => 'مخزن ٢', 'code' => 'PR4-W2']);

        $this->cement = Product::create([
            'name' => 'إسمنت', 'sku' => 'PR4-CEM', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
        $this->steel = Product::create([
            'name' => 'حديد', 'sku' => 'PR4-STL', 'type' => 'good',
            'sale_price' => 40000, 'purchase_price' => 30000, 'track_inventory' => true,
        ]);

        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        $this->inventory = app(InventoryService::class);
        $this->inventory->receiveStock($this->cement, 100, 10000, ['warehouse_id' => $this->main->id]);
        $this->inventory->receiveStock($this->steel, 50, 30000, ['warehouse_id' => $this->main->id]);

        $this->stocktakes = app(StocktakeService::class);
        $this->invoices   = app(InvoiceService::class);
        $this->purchases  = app(PurchaseService::class);
        $this->permits    = app(StockPermitService::class);
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->balance ?? 0);
    }

    private function assertLedgerMatchesStock(string $context = ''): void
    {
        $subsidiary = Product::all()->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);
        $this->assertSame($subsidiary, $this->balance('1140'), "1140 انفصل عن دفتر المخزون {$context}");
    }

    private function stockIn(Product $product, Warehouse $warehouse): int
    {
        return (int) ProductWarehouseStock::where('product_id', $product->id)
            ->where('warehouse_id', $warehouse->id)->value('quantity');
    }

    private function sell(Product $product, int $quantity): void
    {
        $invoice = $this->invoices->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'cash', 'warehouse_id' => $this->main->id],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => $product->sale_price, 'tax_rate' => 0]]
        );
        $this->invoices->post($invoice);
    }

    private function receivePurchase(Product $product, int $quantity, int $unitPrice): void
    {
        $purchase = $this->purchases->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'warehouse_id' => $this->main->id],
            [['product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 0]]
        );
        $this->purchases->post($purchase);
    }

    // ═══════════════════════════════════════════════════════════
    //  no intervening movement — current behavior preserved exactly
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function no_intervening_movement_preserves_the_current_posting_behavior(): void
    {
        $before = $this->balance('1140');
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);

        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertSame(-50000, (int) $posted->difference_value);
        $this->assertSame($before - 50000, $this->balance('1140'));
        $this->assertSame(95, $this->cement->fresh()->quantity_on_hand);
        $this->assertLedgerMatchesStock('بلا حركة متزامنة');
    }

    // ═══════════════════════════════════════════════════════════
    //  concurrency cases — each blocks posting with no mutation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_sale_between_snapshot_and_post_blocks_posting_without_any_mutation(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $this->sell($this->cement, 10); // ١٠٠ → ٩٠ فعلياً، قبل الترحيل

        $movementsBefore = StockMovement::count();
        $entriesBefore   = JournalEntry::count();
        $qtyBefore       = $this->cement->fresh()->quantity_on_hand;

        try {
            $this->stocktakes->post($stocktake->fresh());
            $this->fail('كان يجب رفض الترحيل — الرصيد تحرّك ببيعٍ منذ الفتح.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('إسمنت', $e->getMessage());
            $this->assertStringContainsString('وقت الفتح 100', $e->getMessage());
            $this->assertStringContainsString('الآن 90', $e->getMessage());
        }

        $this->assertSame('draft', $stocktake->fresh()->status, 'المستند بقي مسوّدة.');
        $this->assertNull($stocktake->fresh()->journal_entry_id);
        $this->assertSame($movementsBefore, StockMovement::count(), 'لا حركة مخزون إضافية من محاولة الترحيل.');
        $this->assertSame($entriesBefore, JournalEntry::count(), 'لا قيد محاسبي من محاولة الترحيل.');
        $this->assertSame($qtyBefore, $this->cement->fresh()->quantity_on_hand, 'لم تتحرّك الكمية بمحاولة الترحيل نفسها.');
    }

    /** @test */
    public function a_purchase_receipt_between_snapshot_and_post_blocks_posting(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 105]);

        $this->receivePurchase($this->cement, 5, 10000); // ١٠٠ → ١٠٥ باستلام شراء

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تحرّك رصيد');
        $this->stocktakes->post($stocktake->fresh());
    }

    /** @test */
    public function a_stock_permit_issue_between_snapshot_and_post_blocks_posting(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $this->permits->post($this->permits->create(
            ['type' => 'issue', 'warehouse_id' => $this->main->id, 'reason' => 'تلف'],
            [['product_id' => $this->cement->id, 'quantity' => 10]]
        ));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تحرّك رصيد');
        $this->stocktakes->post($stocktake->fresh());
    }

    /** @test */
    public function a_transfer_out_between_snapshot_and_post_blocks_posting_the_source_warehouse_count(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $this->permits->post($this->permits->create(
            ['type' => 'transfer', 'warehouse_id' => $this->main->id, 'target_warehouse_id' => $this->second->id],
            [['product_id' => $this->cement->id, 'quantity' => 15]]
        ));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تحرّك رصيد');
        $this->stocktakes->post($stocktake->fresh());
    }

    /** @test */
    public function a_transfer_in_between_snapshot_and_post_blocks_posting_the_destination_warehouse_count(): void
    {
        // جردٌ للمخزن الثاني (فارغٌ من الإسمنت حالياً) — سطرٌ صريح بصفر.
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->second->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 0]);

        $this->permits->post($this->permits->create(
            ['type' => 'transfer', 'warehouse_id' => $this->main->id, 'target_warehouse_id' => $this->second->id],
            [['product_id' => $this->cement->id, 'quantity' => 20]]
        ));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تحرّك رصيد');
        $this->stocktakes->post($stocktake->fresh());
    }

    /** حركتان متتاليتان — الفحص تراكمي، لا يكتفي بحركةٍ واحدة. */
    /** @test */
    public function multiple_movements_between_snapshot_and_post_still_block_posting(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 93]);

        $this->sell($this->cement, 10);              // ١٠٠ → ٩٠
        $this->receivePurchase($this->cement, 3, 10000); // ٩٠ → ٩٣ (لا يعود ١٠٠)

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تحرّك رصيد');
        $this->stocktakes->post($stocktake->fresh());
    }

    // ═══════════════════════════════════════════════════════════
    //  unrelated Product×Warehouse movement must not block a scoped count
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function movement_on_an_uncounted_product_in_the_same_warehouse_does_not_block_the_scoped_count(): void
    {
        // الجرد على الإسمنت وحده — الحديد خارج الورقة تماماً.
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $this->sell($this->steel, 5); // يحرّك الحديد، لا الإسمنت المعدود

        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertSame('posted', $posted->status);
        $this->assertSame(-50000, (int) $posted->difference_value);
        $this->assertLedgerMatchesStock('بعد حركة صنفٍ غير معدود');
    }

    /** @test */
    public function movement_in_a_different_warehouse_does_not_block_a_count_scoped_to_another_warehouse(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        // حركةٌ على نفس الصنف، لكن في المخزن الثاني — لا تمسّ صفّ المخزن الأول.
        $this->permits->post($this->permits->create(
            ['type' => 'receipt', 'warehouse_id' => $this->second->id],
            [['product_id' => $this->cement->id, 'quantity' => 7, 'unit_cost' => 10000]]
        ));

        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertSame('posted', $posted->status);
        $this->assertLedgerMatchesStock('بعد حركة نفس الصنف في مخزنٍ آخر');
    }

    // ═══════════════════════════════════════════════════════════
    //  reconcile() then retry — succeeds once, double-post still blocked
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function reconcile_then_a_fresh_count_and_retry_succeeds_exactly_once_and_matches_the_ledger(): void
    {
        $before = $this->balance('1140');
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $this->sell($this->cement, 10); // ١٠٠ → ٩٠

        try {
            $this->stocktakes->post($stocktake->fresh());
            $this->fail('كان يجب رفض الترحيل قبل المطابقة.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تحرّك رصيد', $e->getMessage());
        }

        $result = $this->stocktakes->reconcile($stocktake->fresh());
        $line = $result['stocktake']->lines->firstWhere('product_id', $this->cement->id);
        $this->assertSame([$this->cement->id], $result['reconciled_product_ids']);
        $this->assertSame(90, $line->system_quantity, 'اللقطة حُدِّثت للرصيد الحالي.');
        $this->assertNull($line->counted_quantity, 'العدّ السابق أُلغي — قِيسَ على رصيدٍ لم يعد قائماً.');

        // إعادة عدٍّ فعلية على الأساس الجديد، ثم ترحيلٌ ناجح.
        $this->stocktakes->count($result['stocktake'], [$this->cement->id => 95]);
        $posted = $this->stocktakes->post($result['stocktake']->fresh());

        $this->assertSame('posted', $posted->status);
        $this->assertSame(50000, (int) $posted->difference_value, '٩٥-٩٠=٥ زيادة × ١٠٠ ريال.');
        $this->assertSame($before - 100000 + 50000, $this->balance('1140'), 'صافي أثر البيع والجرد معاً.');
        $this->assertLedgerMatchesStock('بعد المطابقة وإعادة العدّ');

        // والترحيل المزدوج يبقى محظوراً كما كان.
        $this->expectExceptionMessage('لا يمكن ترحيل جرد مرحَّل.');
        $this->stocktakes->post($posted);
    }

    /** المطابقة لا تمسّ أصنافاً لم يتحرّك رصيدها إطلاقاً. */
    /** @test */
    public function reconcile_leaves_unaffected_lines_completely_untouched(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id, $this->steel->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95, $this->steel->id => 50]);

        $this->sell($this->cement, 10); // الإسمنت وحده يتحرّك

        $result = $this->stocktakes->reconcile($stocktake->fresh());
        $this->assertSame([$this->cement->id], $result['reconciled_product_ids'], 'الحديد لم يتحرّك فلا يُطابَق.');

        $steelLine = $result['stocktake']->lines->firstWhere('product_id', $this->steel->id);
        $this->assertSame(50, $steelLine->system_quantity);
        $this->assertSame(50, $steelLine->counted_quantity, 'عدّ الحديد بقي كما هو — لم يُلغَ.');
    }

    // ═══════════════════════════════════════════════════════════
    //  exact GL/subledger equality is preserved even under reconciliation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function delta_1140_exactly_equals_delta_subledger_across_a_sale_reconciliation_and_repost(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);
        $this->sell($this->cement, 10);

        try {
            $this->stocktakes->post($stocktake->fresh());
            $this->fail('توقّعت رفض الترحيل.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $result = $this->stocktakes->reconcile($stocktake->fresh());
        $this->stocktakes->count($result['stocktake'], [$this->cement->id => 95]);

        $beforeSubledger = $this->cement->fresh()->quantity_on_hand * $this->cement->fresh()->avg_cost;
        $before1140 = $this->balance('1140');

        $posted = $this->stocktakes->post($result['stocktake']->fresh());

        $afterSubledger = $this->cement->fresh()->quantity_on_hand * $this->cement->fresh()->avg_cost;
        $after1140 = $this->balance('1140');

        $this->assertSame($afterSubledger - $beforeSubledger, $after1140 - $before1140, 'Δ1140 = Δالدفتر المساعد تماماً.');
        $this->assertSame(50000, (int) $posted->difference_value);
    }

    // ═══════════════════════════════════════════════════════════
    //  PR-INV-4 review fix — revision identity, not quantity alone
    // ═══════════════════════════════════════════════════════════

    /**
     * **السيناريو الإلزامي بعد المراجعة:** ١٠٠ → صرف ← ٩٠ → استلام ← ١٠٠.
     * الكمية النهائية تساوي كمية اللقطة تماماً، لكن حركتين حقيقيتين وقعتا
     * على نفس الصنف/المخزن — فيجب أن يُرفض الترحيل رغم تطابق الكمية.
     */
    /** @test */
    public function an_aba_movement_that_returns_to_the_original_quantity_still_blocks_posting(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);

        $row = ProductWarehouseStock::where('product_id', $this->cement->id)->where('warehouse_id', $this->main->id)->first();
        $revisionAtOpen = $row->revision;

        $this->permits->post($this->permits->create(
            ['type' => 'issue', 'warehouse_id' => $this->main->id, 'reason' => 'صرف مؤقت'],
            [['product_id' => $this->cement->id, 'quantity' => 10]]
        )); // ١٠٠ → ٩٠

        $this->permits->post($this->permits->create(
            ['type' => 'receipt', 'warehouse_id' => $this->main->id],
            [['product_id' => $this->cement->id, 'quantity' => 10, 'unit_cost' => 10000]]
        )); // ٩٠ → ١٠٠ — نفس الكمية الأصلية بالضبط

        $this->assertSame(100, $this->cement->fresh()->quantity_on_hand, 'الكمية عادت لأصلها تماماً (ABA).');
        $row->refresh();
        $this->assertGreaterThan($revisionAtOpen, $row->revision, 'الـrevision تحرّك رغم عودة الكمية.');

        try {
            $this->stocktakes->post($stocktake->fresh());
            $this->fail('كان يجب رفض الترحيل — حركتان حقيقيتان وقعتا رغم تطابق الكمية النهائية.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تحرّك رصيده ثم عاد', $e->getMessage());
        }

        $this->assertSame('draft', $stocktake->fresh()->status);
        $this->assertNull($stocktake->fresh()->journal_entry_id);
    }

    /** المطابقة تلتقط حالة ABA كذلك — لا الكمية وحدها. */
    /** @test */
    public function reconcile_updates_both_quantity_and_revision_after_an_aba_movement(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);
        $originalRevision = $stocktake->lines->first()->system_revision;

        $this->permits->post($this->permits->create(
            ['type' => 'issue', 'warehouse_id' => $this->main->id, 'reason' => 'صرف'],
            [['product_id' => $this->cement->id, 'quantity' => 10]]
        ));
        $this->permits->post($this->permits->create(
            ['type' => 'receipt', 'warehouse_id' => $this->main->id],
            [['product_id' => $this->cement->id, 'quantity' => 10, 'unit_cost' => 10000]]
        ));

        $result = $this->stocktakes->reconcile($stocktake->fresh());
        $line = $result['stocktake']->lines->first();

        $this->assertSame([$this->cement->id], $result['reconciled_product_ids']);
        $this->assertSame(100, $line->system_quantity, 'الكمية الحالية بعد ABA.');
        $this->assertGreaterThan($originalRevision, $line->system_revision, 'الـrevision الجديد مسجَّل، لا القديم.');
        $this->assertNull($line->counted_quantity);

        // إعادة عدٍّ ثم ترحيل ينجح مرّة واحدة على الأساس الجديد.
        $this->stocktakes->count($result['stocktake'], [$this->cement->id => 100]);
        $posted = $this->stocktakes->post($result['stocktake']->fresh());
        $this->assertSame(0, (int) $posted->difference_value, 'لا فرق — العدّ الجديد يطابق الكمية بعد ABA بالضبط.');
    }

    // ═══════════════════════════════════════════════════════════
    //  every inventory movement path required by the contract bumps revision
    // ═══════════════════════════════════════════════════════════

    private function revisionOf(Product $product, Warehouse $warehouse): int
    {
        return (int) ProductWarehouseStock::where('product_id', $product->id)
            ->where('warehouse_id', $warehouse->id)->value('revision');
    }

    /** @test */
    public function a_sale_increments_the_warehouse_revision(): void
    {
        $before = $this->revisionOf($this->cement, $this->main);
        $this->sell($this->cement, 5);
        $this->assertGreaterThan($before, $this->revisionOf($this->cement, $this->main));
    }

    /** @test */
    public function a_purchase_receipt_increments_the_warehouse_revision(): void
    {
        $before = $this->revisionOf($this->cement, $this->main);
        $this->receivePurchase($this->cement, 5, 10000);
        $this->assertGreaterThan($before, $this->revisionOf($this->cement, $this->main));
    }

    /** @test */
    public function a_stock_permit_issue_increments_the_warehouse_revision(): void
    {
        $before = $this->revisionOf($this->cement, $this->main);
        $this->permits->post($this->permits->create(
            ['type' => 'issue', 'warehouse_id' => $this->main->id, 'reason' => 'تلف'],
            [['product_id' => $this->cement->id, 'quantity' => 5]]
        ));
        $this->assertGreaterThan($before, $this->revisionOf($this->cement, $this->main));
    }

    /** @test */
    public function a_stock_permit_receipt_increments_the_warehouse_revision(): void
    {
        $before = $this->revisionOf($this->cement, $this->main);
        $this->permits->post($this->permits->create(
            ['type' => 'receipt', 'warehouse_id' => $this->main->id],
            [['product_id' => $this->cement->id, 'quantity' => 5, 'unit_cost' => 10000]]
        ));
        $this->assertGreaterThan($before, $this->revisionOf($this->cement, $this->main));
    }

    /** التحويل يزيد الـrevision على **طرفَي** الحركة معاً — المصدر والوجهة. */
    /** @test */
    public function a_stock_permit_transfer_increments_the_revision_on_both_source_and_destination(): void
    {
        $beforeSource = $this->revisionOf($this->cement, $this->main);
        $beforeDestination = $this->revisionOf($this->cement, $this->second);

        $this->permits->post($this->permits->create(
            ['type' => 'transfer', 'warehouse_id' => $this->main->id, 'target_warehouse_id' => $this->second->id],
            [['product_id' => $this->cement->id, 'quantity' => 5]]
        ));

        $this->assertGreaterThan($beforeSource, $this->revisionOf($this->cement, $this->main));
        $this->assertGreaterThan($beforeDestination, $this->revisionOf($this->cement, $this->second));
    }

    /** ترحيل الجرد لتصحيح فرقٍ حقيقي هو نفسه حركةٌ تزيد الـrevision. */
    /** @test */
    public function posting_a_stocktake_difference_increments_the_revision_too(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);
        $before = $this->revisionOf($this->cement, $this->main);

        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);
        $this->stocktakes->post($stocktake->fresh());

        $this->assertGreaterThan($before, $this->revisionOf($this->cement, $this->main));
    }

    // ═══════════════════════════════════════════════════════════
    //  rollback leaves no revision residue
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_rejected_stock_permit_transfer_leaves_no_revision_residue_on_either_side(): void
    {
        $beforeSource = $this->revisionOf($this->cement, $this->main);
        $beforeDestination = $this->revisionOf($this->cement, $this->second);

        try {
            $this->permits->post($this->permits->create(
                ['type' => 'transfer', 'warehouse_id' => $this->main->id, 'target_warehouse_id' => $this->second->id],
                [['product_id' => $this->cement->id, 'quantity' => 1000]] // أكثر بكثير من المتاح
            ));
            $this->fail('كان يجب رفض التحويل لعدم كفاية الرصيد.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame($beforeSource, $this->revisionOf($this->cement, $this->main), 'لا زيادة revision من محاولة مرفوضة.');
        $this->assertSame($beforeDestination, $this->revisionOf($this->cement, $this->second));
    }

    /** رفضٌ من `assertSnapshotStillValid` نفسه لا يترك أثراً على أي صفٍّ — حتى الأصناف السليمة في نفس المستند. */
    /** @test */
    public function a_stale_stocktake_post_leaves_no_revision_residue_even_for_the_unaffected_line(): void
    {
        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id, $this->steel->id]);
        $this->stocktakes->count($stocktake, [$this->cement->id => 95, $this->steel->id => 50]);

        $this->sell($this->cement, 10); // الإسمنت وحده يتحرّك — الحديد سليم

        $cementRevisionBeforeAttempt = $this->revisionOf($this->cement, $this->main);
        $steelRevisionBeforeAttempt = $this->revisionOf($this->steel, $this->main);

        try {
            $this->stocktakes->post($stocktake->fresh());
            $this->fail('كان يجب رفض الترحيل.');
        } catch (RuntimeException) {
            // متوقَّع.
        }

        $this->assertSame($cementRevisionBeforeAttempt, $this->revisionOf($this->cement, $this->main));
        $this->assertSame($steelRevisionBeforeAttempt, $this->revisionOf($this->steel, $this->main), 'الصنف السليم لم يُمسّ رغم رفض المستند كلّه.');
    }
}

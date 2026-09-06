<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StockPermitService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-INV-3 — الإذن المخزني: كمية أساس رسمية + وحدة تجارية اختيارية
 * ═══════════════════════════════════════════════════════════════
 *  العلّة المؤكَّدة: `StockPermitLine.quantity` كانت تُستهلَك مباشرةً ككمية
 *  مخزون — كرتونٌ واحد بمعامل ٢٤ كان يُخرج/يُدخل قطعةً واحدة فقط. الإصلاح:
 *  الوحدة تُحلّ وتُنسَخ عند الإنشاء (نفس `UnitConversion` المستعمل في
 *  المشتريات والفواتير)، والكمية الأساس **الرسمية** تُحفَظ صراحةً على السطر
 *  قبل أي حركة مخزون، فلا تُعاد قراءتها من قالبٍ قد يتغيّر لاحقاً.
 *
 *  تشغيل: php artisan test --filter=StockPermitUomValuationTest
 */
class StockPermitUomValuationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Warehouse $main;
    protected StockPermitService $permits;
    protected InventoryService $inventory;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->main      = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'PR3-W1', 'is_default' => true]);
        $this->permits   = app(StockPermitService::class);
        $this->inventory = app(InventoryService::class);
    }

    private function bal(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->balance ?? 0);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    private function boxedProduct(int $factor = 24): Product
    {
        $template = UnitTemplate::create(['name' => 'قالب كراتين', 'base_unit' => 'piece']);
        $template->units()->create(['name' => 'carton', 'factor' => $factor]);

        return Product::create([
            'name' => 'بضاعة كراتين', 'unit' => 'piece', 'unit_template_id' => $template->id,
            'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
    }

    private function permit(string $type, array $items, array $extra = []): StockPermit
    {
        return $this->permits->create(array_merge([
            'type' => $type, 'warehouse_id' => $this->main->id, 'reason' => 'اختبار PR-INV-3',
        ], $extra), $items);
    }

    private function stockIn(Product $product, string $warehouseId): int
    {
        return (int) ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->where('product_id', $product->id)->value('quantity');
    }

    // ═══════════════════════════════════════════════════════════
    //  backward compatibility — no unit ⇒ explicit base-unit path
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_item_without_a_unit_is_stored_as_base_unit_factor_one_explicitly(): void
    {
        $product = Product::create(['name' => 'بضاعة أساس', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);

        $permit = $this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 10, 'unit_cost' => 10000],
        ]);

        $line = $permit->lines->first();
        $this->assertNull($line->unit_name, 'لا وحدة مُدخَلة ⇒ لقطة فارغة صراحة.');
        $this->assertSame(1, $line->unit_factor);
        $this->assertSame(10, $line->base_quantity, 'الكمية الأساس تساوي الكمية المُدخَلة بمعامل ١.');
    }

    // ═══════════════════════════════════════════════════════════
    //  receipt with alternate UOM — quantity + cost normalization
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_receipt_with_an_alternate_uom_converts_to_base_quantity_and_normalizes_the_cost(): void
    {
        $product = $this->boxedProduct(factor: 24);

        // كرتونان بسعر ٢٤٠٠٫٠٠ للكرتون ⇒ إجمالي ٤٨٠٠٫٠٠، و٤٨ قطعة أساس.
        $permit = $this->permits->post($this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 2, 'unit' => 'carton', 'unit_cost' => 240000],
        ]));

        $line = $permit->lines->first();
        $this->assertSame('carton', $line->unit_name);
        $this->assertSame(24, $line->unit_factor);
        $this->assertSame(48, $line->base_quantity, 'كرتونان × ٢٤ = ٤٨ قطعة أساس — لا ٢.');

        $product->refresh();
        $this->assertSame(48, $product->quantity_on_hand);
        // المتوسط = ٤٨٠٠٠٠ ÷ ٤٨ = ١٠٠٫٠٠ للقطعة — لا ٢٤٠٠٫٠٠ (سعر الكرتون خطأً).
        $this->assertSame(10000, $product->avg_cost);

        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $this->assertSame(480000, (int) $this->line($entry, '1140')->debit, 'القيمة الكلية المُدخَلة، لا سعر الكرتون منفرداً.');
        $this->assertSame(480000, (int) $this->line($entry, '5180')->credit);

        $movement = StockMovement::where('source_type', StockPermit::class)->where('source_id', $permit->id)->firstOrFail();
        $this->assertSame(48, $movement->quantity, 'دفتر المخزون بوحدة الأساس دائماً.');
        $this->assertSame(480000, $movement->total_cost);
    }

    // ═══════════════════════════════════════════════════════════
    //  issue with alternate UOM — base-quantity availability + GL
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_issue_with_an_alternate_uom_converts_to_base_quantity_and_checks_availability_in_base_units(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $this->inventory->receiveStock($product, 48, 10000, ['warehouse_id' => $this->main->id]);
        $product->refresh();
        $before1140 = $this->bal('1140');

        // كرتونٌ واحد = ٢٤ قطعة أساس، من رصيدٍ فيه ٤٨.
        $permit = $this->permits->post($this->permit('issue', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton'],
        ]));

        $line = $permit->lines->first();
        $this->assertSame(24, $line->base_quantity);

        $product->refresh();
        $this->assertSame(24, $product->quantity_on_hand, 'يخرج الكرتون كاملاً: ٢٤ قطعة، لا ١.');
        $this->assertSame(240000, (int) $line->line_cost, '٢٤ × متوسط ١٠٠٫٠٠.');

        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $this->assertSame(240000, (int) $this->line($entry, '5180')->debit);
        $this->assertSame(240000, (int) $this->line($entry, '1140')->credit);
        $this->assertSame(-240000, $this->bal('1140') - $before1140);
    }

    /** التوفّر يُفحَص بالكمية الأساس على المخزن المحدَّد — لا بعدد الكراتين المُدخَل. */
    /** @test */
    public function issuing_more_cartons_than_the_warehouse_holds_in_base_units_is_rejected(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $this->inventory->receiveStock($product, 30, 10000, ['warehouse_id' => $this->main->id]); // ٣٠ قطعة فقط

        // كرتونان = ٤٨ قطعة أساس مطلوبة، والمخزن يملك ٣٠ فقط.
        try {
            $this->permits->post($this->permit('issue', [
                ['product_id' => $product->id, 'quantity' => 2, 'unit' => 'carton'],
            ]));
            $this->fail('كان يجب رفض صرف كرتونين (٤٨ قطعة) من مخزنٍ فيه ٣٠.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('أقل من المطلوب', $e->getMessage());
        }

        $this->assertSame(30, $this->stockIn($product, $this->main->id), 'لا تحرّك جزئي عند الرفض.');
    }

    // ═══════════════════════════════════════════════════════════
    //  transfer with alternate UOM — converts once, same base qty both sides
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_same_branch_transfer_with_an_alternate_uom_moves_the_same_base_quantity_on_both_sides_with_no_gl(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $this->inventory->receiveStock($product, 48, 10000, ['warehouse_id' => $this->main->id]);
        $second = Warehouse::create(['name' => 'مخزن ٢', 'code' => 'PR3-W2']);
        $entries = JournalEntry::count();
        $before1140 = $this->bal('1140');

        $permit = $this->permits->post($this->permit('transfer', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton'],
        ], ['target_warehouse_id' => $second->id]));

        $this->assertNull($permit->journal_entry_id, 'التحويل داخل الفرع بلا قيد.');
        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame($before1140, $this->bal('1140'), 'صافي القيمة لم يتغيّر.');

        // نفس الكمية الأساس (٢٤) على الطرفين — تحويلٌ واحد لا اثنان مختلفان.
        $this->assertSame(24, $this->stockIn($product, $this->main->id));
        $this->assertSame(24, $this->stockIn($product, $second->id));
        $this->assertSame(48, $product->fresh()->quantity_on_hand);
        $this->assertSame(10000, (int) $product->fresh()->avg_cost, 'المتوسط لا ينحرف بتحويلٍ داخلي.');
    }

    /** @test */
    public function a_cross_branch_transfer_with_an_alternate_uom_posts_a_balanced_entry_at_carrying_value(): void
    {
        $branchA = Branch::create(['name' => 'الدمام', 'code' => 'PR3-BA']);
        $branchB = Branch::create(['name' => 'الجبيل', 'code' => 'PR3-BB']);
        $from = Warehouse::create(['name' => 'مخزن الدمام', 'code' => 'PR3-WA', 'branch_id' => $branchA->id]);
        $to   = Warehouse::create(['name' => 'مخزن الجبيل', 'code' => 'PR3-WB', 'branch_id' => $branchB->id]);

        $product = $this->boxedProduct(factor: 24);
        $this->inventory->receiveStock($product, 24, 10000, ['warehouse_id' => $from->id]);
        $before1140 = $this->bal('1140');

        $permit = $this->permits->post($this->permits->create(
            ['type' => 'transfer', 'warehouse_id' => $from->id, 'target_warehouse_id' => $to->id],
            [['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton']]
        ));

        $this->assertNotNull($permit->journal_entry_id, 'العبور بين الفروع يحتاج قيداً.');
        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $this->assertCount(2, $entry->lines);
        $entry->lines->each(fn (JournalLine $l) => $this->assertSame('1140', $l->account->code));
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'), 'القيد متوازن.');

        $debit = $entry->lines->firstWhere('debit', '>', 0);
        // ٢٤ قطعة (كرتون واحد) × متوسط ١٠٠٫٠٠ = ٢٤٠٠٫٠٠ — لا سعر الكرتون كرقمٍ واحد.
        $this->assertSame(240000, (int) $debit->debit);
        $this->assertSame($branchB->id, $debit->branch_id);

        $this->assertSame($before1140, $this->bal('1140'), 'صافي الشركة صفر.');
        $this->assertSame(0, $this->stockIn($product, $from->id));
        $this->assertSame(24, $this->stockIn($product, $to->id));
    }

    // ═══════════════════════════════════════════════════════════
    //  historical immutability — UnitTemplate mutation after posting
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function changing_the_unit_template_after_posting_does_not_reinterpret_the_permit(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $permit = $this->permits->post($this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton', 'unit_cost' => 240000],
        ]));
        $line = $permit->lines->first();
        $this->assertSame(24, $line->unit_factor);
        $this->assertSame(24, $line->base_quantity);

        // القالب يتغيّر لاحقاً — الكرتون يصير ١٢ بدل ٢٤.
        $product->unitTemplate->units()->where('name', 'carton')->update(['factor' => 12]);

        $line->refresh();
        $this->assertSame(24, $line->unit_factor, 'اللقطة التاريخية تبقى ٢٤ — لا القالب المحدَّث (١٢).');
        $this->assertSame(24, $line->base_quantity, 'الكمية الأساس المحفوظة لا تُعاد حسابها من القالب الحالي.');
        $this->assertSame(24, $product->fresh()->quantity_on_hand, 'الأثر المخزني الفعلي بقي بالتحويل التاريخي.');
    }

    // ═══════════════════════════════════════════════════════════
    //  unknown/invalid UOM fails closed — never defaults to factor 1
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_unknown_unit_fails_closed_and_creates_nothing(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $permitsBefore = StockPermit::count();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير معرَّفة');
        try {
            $this->permit('receipt', [
                ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'pallet', 'unit_cost' => 100000],
            ]);
        } finally {
            $this->assertSame($permitsBefore, StockPermit::count(), 'فشل الوحدة يُبطل إنشاء المستند كلّه.');
        }
    }

    /** @test */
    public function a_unit_name_without_any_template_on_the_product_fails_closed(): void
    {
        $product = Product::create(['name' => 'بضاعة بلا قالب', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);

        $this->expectException(RuntimeException::class);
        $this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton', 'unit_cost' => 100000],
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  double-post / atomic rollback with alternate UOM
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_posted_alternate_uom_permit_cannot_be_posted_again(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $permit = $this->permits->post($this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton', 'unit_cost' => 240000],
        ]));
        $qtyAfterFirstPost = $product->fresh()->quantity_on_hand;

        $this->expectExceptionMessage('لا يمكن ترحيل إذن غير مسوّد');
        try {
            $this->permits->post($permit);
        } finally {
            $this->assertSame($qtyAfterFirstPost, $product->fresh()->quantity_on_hand, 'لا مضاعفة للكمية عند إعادة المحاولة.');
        }
    }

    /** @test */
    public function a_rejected_alternate_uom_transfer_leaves_no_partial_stock_or_gl_mutation(): void
    {
        $branchA = Branch::create(['name' => 'فرع أ', 'code' => 'PR3-RA']);
        $branchB = Branch::create(['name' => 'فرع ب', 'code' => 'PR3-RB']);
        $from = Warehouse::create(['name' => 'مخزن أ', 'code' => 'PR3-RWA', 'branch_id' => $branchA->id]);
        $to   = Warehouse::create(['name' => 'مخزن ب', 'code' => 'PR3-RWB', 'branch_id' => $branchB->id]);

        $product = $this->boxedProduct(factor: 24);
        $this->inventory->receiveStock($product, 10, 10000, ['warehouse_id' => $from->id]); // أقل من الـ٢٤ المطلوبة

        $movementsBefore = StockMovement::count();
        $entriesBefore   = JournalEntry::count();
        $qtyBefore       = $product->fresh()->quantity_on_hand;

        $permit = $this->permits->create(
            ['type' => 'transfer', 'warehouse_id' => $from->id, 'target_warehouse_id' => $to->id],
            [['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton']]
        );

        try {
            $this->permits->post($permit);
            $this->fail('كان يجب رفض التحويل لعدم كفاية رصيد مخزن المصدر.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('أقل من المطلوب', $e->getMessage());
        }

        $this->assertSame('draft', $permit->fresh()->status);
        $this->assertNull($permit->fresh()->journal_entry_id);
        $this->assertSame($movementsBefore, StockMovement::count());
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame($qtyBefore, $product->fresh()->quantity_on_hand);
        $this->assertSame(10, $this->stockIn($product, $from->id));
        $this->assertSame(0, $this->stockIn($product, $to->id));
    }

    // ═══════════════════════════════════════════════════════════
    //  Δ1140 = Δ inventory subledger — exact, with alternate UOM
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_1140_delta_exactly_equals_the_subledger_delta_for_an_alternate_uom_receipt_and_issue(): void
    {
        $product = $this->boxedProduct(factor: 24);

        $before1140 = $this->bal('1140');
        $beforeSubledger = 0;

        $receipt = $this->permits->post($this->permit('receipt', [
            ['product_id' => $product->id, 'quantity' => 2, 'unit' => 'carton', 'unit_cost' => 240000],
        ]));

        $product->refresh();
        $afterReceiptSubledger = $product->quantity_on_hand * $product->avg_cost;
        $afterReceipt1140 = $this->bal('1140');
        $this->assertSame($afterReceiptSubledger - $beforeSubledger, $afterReceipt1140 - $before1140, 'Δ1140 = Δالدفتر المساعد بعد الإضافة.');

        $issue = $this->permits->post($this->permit('issue', [
            ['product_id' => $product->id, 'quantity' => 1, 'unit' => 'carton'],
        ]));

        $product->refresh();
        $afterIssueSubledger = $product->quantity_on_hand * $product->avg_cost;
        $afterIssue1140 = $this->bal('1140');
        $this->assertSame($afterIssueSubledger - $afterReceiptSubledger, $afterIssue1140 - $afterReceipt1140, 'Δ1140 = Δالدفتر المساعد بعد الصرف كذلك.');

        // والقيمة الكلية النهائية مطابقة تماماً بلا انحراف تراكمي.
        $this->assertSame($product->quantity_on_hand * $product->avg_cost, $this->bal('1140'));
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\ReturnDocument;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-INV-2 — مرتجع المشتريات: كمية الأساس التاريخية + القيمة الدفترية
 * ═══════════════════════════════════════════════════════════════
 *  ثغرتان مؤكَّدتان تُصلَحان معاً لأنهما تمسّان نفس الخروج المالي:
 *   ١. الكمية: ردّ كرتونٍ بمعامل ٢٤ كان يُخرج قطعة واحدة فقط من المخزون.
 *   ٢. القيمة: 1140 وحركة المخزون كانتا تُقيَّمان بسعر الاعتماد التجاري
 *      (`unit_price` على سطر المرتجع) لا بمتوسط التكلفة الفعلي الحالي —
 *      فينكسر الثابت `Δ 1140 = Δ الدفتر المساعد` كلما اختلف الاثنان.
 *
 *  تشغيل: php artisan test --filter=PurchaseReturnUomValuationTest
 */
class PurchaseReturnUomValuationTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected PurchaseService $purchases;
    protected ReturnService $returns;
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

        $this->supplier  = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->purchases = app(PurchaseService::class);
        $this->returns   = app(ReturnService::class);
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

    private function purchase(Product $product, int $quantity, int $unitPrice, array $item = [], array $head = []): Purchase
    {
        $p = $this->purchases->create(array_merge([
            'partner_id' => $this->supplier->id, 'payment_type' => 'credit',
        ], $head), [array_merge([
            'product_id' => $product->id, 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 0,
        ], $item)]);

        return $this->purchases->post($p);
    }

    private function purchaseLine(Purchase $purchase): PurchaseLine
    {
        return $purchase->lines()->firstOrFail();
    }

    // ═══════════════════════════════════════════════════════════
    //  original base unit return
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_base_unit_purchase_return_removes_the_exact_base_quantity(): void
    {
        $product = Product::create([
            'name' => 'بضاعة أساس', 'track_inventory' => true,
            'quantity_on_hand' => 0, 'avg_cost' => 0,
        ]);
        $purchase = $this->purchase($product, 10, 4000);
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            [
                'type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit',
                'original_id' => $purchase->id, 'original_type' => Purchase::class,
            ],
            [['product_id' => $product->id, 'source_line_id' => $this->purchaseLine($purchase)->id, 'quantity' => 3, 'unit_price' => 4000, 'tax_rate' => 0]]
        );
        $this->returns->post($return);

        $this->assertSame(7, $product->fresh()->quantity_on_hand);
        $this->assertSame(-12000, $this->bal('1140') - $before1140); // 3 × 4000
        $this->assertSame(0, $this->bal('5116'), 'لا فرق قيمة عندما يتساوى الاعتماد التجاري بالدفترية.');
        $this->assertSame(0, $this->bal('5180'), '5180 فروق الجرد والتلف لا يُستخدم لفرق التقييم إطلاقاً.');
    }

    // ═══════════════════════════════════════════════════════════
    //  original alt UOM factor 24: return 1 carton removes 24 base units
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function returning_one_carton_removes_twenty_four_base_units_not_one(): void
    {
        $product = $this->boxedProduct(factor: 24);
        // كرتونٌ واحد بسعر ٢٤٠٠٫٠٠ ⇒ ١٠٠٫٠٠ للقطعة (٢٤٠٠٠٠ ÷ ٢٤ هللة).
        $purchase = $this->purchase($product, 1, 240000, ['unit' => 'carton']);
        $this->assertSame(24, $product->fresh()->quantity_on_hand);
        $this->assertSame(10000, $product->fresh()->avg_cost);
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            [
                'type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit',
                'original_id' => $purchase->id, 'original_type' => Purchase::class,
            ],
            [['product_id' => $product->id, 'source_line_id' => $this->purchaseLine($purchase)->id, 'quantity' => 1, 'unit_price' => 240000, 'tax_rate' => 0]]
        );
        $posted = $this->returns->post($return);

        // العلّة المؤكَّدة: كان يخرج قطعةٌ واحدة فقط (`ReturnLine.quantity`
        // الخام) بدل ٢٤ (الكمية الحقيقية بوحدة المخزون).
        $this->assertSame(0, $product->fresh()->quantity_on_hand, 'يجب أن يخرج الكرتون كاملاً: ٢٤ قطعة.');
        $this->assertSame(-240000, $this->bal('1140') - $before1140); // ٢٤ × ١٠٠٫٠٠

        $movement = StockMovement::where('source_type', ReturnDocument::class)
            ->where('source_id', $posted->id)->firstOrFail();
        $this->assertSame(24, $movement->quantity);
        $this->assertSame(240000, $movement->total_cost);
    }

    // ═══════════════════════════════════════════════════════════
    //  UnitTemplate changed after original purchase does not alter
    //  historical return conversion
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function changing_the_unit_template_after_the_purchase_does_not_alter_the_historical_return(): void
    {
        $product = $this->boxedProduct(factor: 24);
        $purchase = $this->purchase($product, 1, 240000, ['unit' => 'carton']);
        $originalPurchaseLine = $this->purchaseLine($purchase);
        $this->assertSame(24, $originalPurchaseLine->unit_factor);

        // القالب يتغيّر لاحقاً — الكرتون يصير ١٢ بدل ٢٤.
        $product->unitTemplate->units()->where('name', 'carton')->update(['factor' => 12]);

        $return = $this->returns->create(
            [
                'type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit',
                'original_id' => $purchase->id, 'original_type' => Purchase::class,
            ],
            [['product_id' => $product->id, 'source_line_id' => $originalPurchaseLine->id, 'quantity' => 1, 'unit_price' => 240000, 'tax_rate' => 0]]
        );
        $this->returns->post($return);

        // المرجع سطر الشراء المحفوظ (unit_factor=24) لا القالب الحالي (12).
        $this->assertSame(0, $product->fresh()->quantity_on_hand, 'التحويل التاريخي (٢٤) يبقى، لا القالب المحدَّث (١٢).');
    }

    // ═══════════════════════════════════════════════════════════
    //  partial returns then remaining quantity
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function partial_returns_are_capped_by_the_cumulative_remaining_quantity(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $purchase = $this->purchase($product, 10, 4000);
        $line = $this->purchaseLine($purchase);
        $head = ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'original_id' => $purchase->id, 'original_type' => Purchase::class];

        $first = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 4, 'unit_price' => 4000, 'tax_rate' => 0]]);
        $this->returns->post($first);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تتجاوز المتبقي');
        $tooMuch = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 7, 'unit_price' => 4000, 'tax_rate' => 0]]);
        $this->returns->post($tooMuch);
    }

    /** @test */
    public function the_exact_remaining_quantity_after_a_partial_return_is_accepted(): void
    {
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $purchase = $this->purchase($product, 10, 4000);
        $line = $this->purchaseLine($purchase);
        $head = ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'original_id' => $purchase->id, 'original_type' => Purchase::class];

        $first = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 4, 'unit_price' => 4000, 'tax_rate' => 0]]);
        $this->returns->post($first);

        $rest = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 6, 'unit_price' => 4000, 'tax_rate' => 0]]);
        $this->returns->post($rest);

        $this->assertSame(0, $product->fresh()->quantity_on_hand);
    }

    // ═══════════════════════════════════════════════════════════
    //  concurrent/duplicate return attempt
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function two_drafts_created_before_either_posts_do_not_both_consume_the_same_remaining_quantity(): void
    {
        // المسوّدتان تُنشآن معاً (لا تحجزان)، ثم تُرحَّل الأولى فتستهلك ٦ من
        // ١٠ — والثانية تطلب ٦ أيضاً فتتجاوز المتبقي (٤) وتُرفض عند ترحيلها،
        // لا عند إنشائها؛ الحارس يُعاد تنفيذه **داخل معاملة الترحيل**.
        $product = Product::create(['name' => 'بضاعة', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $purchase = $this->purchase($product, 10, 4000);
        $line = $this->purchaseLine($purchase);
        $head = ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'original_id' => $purchase->id, 'original_type' => Purchase::class];

        $draftA = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 6, 'unit_price' => 4000, 'tax_rate' => 0]]);
        $draftB = $this->returns->create($head, [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 6, 'unit_price' => 4000, 'tax_rate' => 0]]);

        $this->returns->post($draftA);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تتجاوز المتبقي');
        $this->returns->post($draftB);
    }

    // ═══════════════════════════════════════════════════════════
    //  insufficient warehouse stock under negative-stock-disabled policy
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_return_exceeding_the_specific_warehouse_stock_is_rejected_when_negative_stock_is_disabled(): void
    {
        $this->assertFalse((bool) Settings::get('inventory', 'allow_negative_stock'), 'الافتراض الحامي يمنع الرصيد السالب.');

        $warehouse = Warehouse::create(['name' => 'مخزن الاختبار', 'code' => 'PR2-W1']);
        $product = $this->boxedProduct(factor: 24);
        $purchase = $this->purchase($product, 1, 240000, ['unit' => 'carton'], ['warehouse_id' => $warehouse->id]);
        $line = $this->purchaseLine($purchase);

        // محاكاة نقل ١٦ قطعة إلى مخزنٍ آخر بعد الاستلام: لم يبقَ في هذا
        // المخزن تحديداً سوى ٨ رغم أن الرصيد الكلي للمنتج لا يزال ٢٤.
        ProductWarehouseStock::where('product_id', $product->id)->where('warehouse_id', $warehouse->id)
            ->update(['quantity' => 8]);

        // ردّ الكرتون كاملاً يحتاج ٢٤ قطعة من هذا المخزن تحديداً — والكمية
        // المتبقية من الفاتورة (١ كرتون) تسمح به، لكن رصيد المخزن لا يكفي.
        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'warehouse_id' => $warehouse->id],
            [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 240000, 'tax_rate' => 0]]
        );

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أقل من المطلوب');
        $this->returns->post($return);
    }

    // ═══════════════════════════════════════════════════════════
    //  commercial value = / > / < carrying value
    // ═══════════════════════════════════════════════════════════

    /**
     * إعداد مشترك: دفعتان بتكلفتين مختلفتين تُنتجان متوسطاً مختلفاً عن كليهما،
     * فيتيح اختيار سطر الإرجاع (الأولى أو الثانية) كلا اتجاهي الفرق بإعداد واحد.
     *
     * دفعة ١: ١٠ × ٤٠٠٠ ⇒ بعدها المتوسط ٤٠٠٠.
     * دفعة ٢: ١٠ × ٦٠٠٠ ⇒ بعدها المتوسط (٤٠٠٠٠+٦٠٠٠٠)÷٢٠ = ٥٠٠٠.
     *
     * @return array{product:Product, batch1:Purchase, batch2:Purchase}
     */
    private function twoBatchSetup(): array
    {
        $product = Product::create(['name' => 'بضاعة دفعتين', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $batch1 = $this->purchase($product, 10, 4000);
        $this->assertSame(4000, $product->fresh()->avg_cost);
        $batch2 = $this->purchase($product, 10, 6000);
        $this->assertSame(5000, $product->fresh()->avg_cost);

        return ['product' => $product, 'batch1' => $batch1, 'batch2' => $batch2];
    }

    /** @test */
    public function commercial_value_equal_to_carrying_value_posts_no_variance(): void
    {
        $s = $this->twoBatchSetup();
        // العودة بسعر الاعتماد نفسه للمتوسط الحالي (٥٠٠٠) على أيّ سطر مصدر —
        // لا فرق قيمة رغم اختلاف سعر الشراء الأصلي للسطر.
        $line = $this->purchaseLine($s['batch1']);
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $s['product']->id, 'source_line_id' => $line->id, 'quantity' => 2, 'unit_price' => 5000, 'tax_rate' => 0]]
        );
        $this->returns->post($return);

        $this->assertSame(-10000, $this->bal('1140') - $before1140); // 2 × 5000 (الدفترية = التجارية هنا)
        $this->assertSame(0, $this->bal('5116'));
        $this->assertSame(0, $this->bal('5180'), '5180 فروق الجرد والتلف لا يُستخدم لفرق التقييم إطلاقاً.');
    }

    /** @test */
    public function commercial_value_above_carrying_value_credits_the_variance_account(): void
    {
        $s = $this->twoBatchSetup();
        // اعتماد المورّد بسعر الدفعة الثانية (٦٠٠٠) بينما المتوسط الحالي ٥٠٠٠
        // ⇒ اعتمادٌ أعلى من الدفترية بـ١٠٠٠ للقطعة (مكسب).
        $line = $this->purchaseLine($s['batch2']);
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $s['product']->id, 'source_line_id' => $line->id, 'quantity' => 2, 'unit_price' => 6000, 'tax_rate' => 0]]
        );
        $posted = $this->returns->post($return);

        $this->assertSame(-10000, $this->bal('1140') - $before1140);  // ٢ × ٥٠٠٠ الدفترية — لا ١٢٠٠٠ التجارية
        // 5116 حساب مدين الطبيعة؛ دائنٌ بـ٢٠٠٠ (مكسب) يُنقِص رصيده -٢٠٠٠.
        $this->assertSame(-2000, $this->bal('5116'));
        $this->assertSame(0, $this->bal('5180'), '5180 فروق الجرد والتلف لا يُستخدم لفرق التقييم إطلاقاً.');

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'), 'القيد يبقى متوازناً رغم الفرق.');
        $this->assertEquals(2000, (int) $this->line($entry, '5116')->credit);
        $this->assertNull($this->line($entry, '5180'), 'لا سطر على 5180 في هذا القيد إطلاقاً.');
        $this->assertEquals(12000, (int) $this->line($entry, '2110')->debit, 'ذمّة المورّد تبقى بالقيمة التجارية الكاملة.');
    }

    /** @test */
    public function commercial_value_below_carrying_value_debits_the_variance_account(): void
    {
        $s = $this->twoBatchSetup();
        // اعتماد المورّد بسعر الدفعة الأولى (٤٠٠٠) بينما المتوسط الحالي ٥٠٠٠
        // ⇒ اعتمادٌ أقلّ من الدفترية بـ١٠٠٠ للقطعة (خسارة كليّة ٢٠٠٠ لسطرَين).
        $line = $this->purchaseLine($s['batch1']);
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $s['product']->id, 'source_line_id' => $line->id, 'quantity' => 2, 'unit_price' => 4000, 'tax_rate' => 0]]
        );
        $posted = $this->returns->post($return);

        $this->assertSame(-10000, $this->bal('1140') - $before1140); // ٢ × ٥٠٠٠ الدفترية — لا ٨٠٠٠ التجارية
        // الفرق الكلي = ٢×(٥٠٠٠-٤٠٠٠) = ٢٠٠٠؛ 5116 مدين الطبيعة فيزيد رصيده +٢٠٠٠.
        $this->assertSame(2000, $this->bal('5116'));
        $this->assertSame(0, $this->bal('5180'), '5180 فروق الجرد والتلف لا يُستخدم لفرق التقييم إطلاقاً.');

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(2000, (int) $this->line($entry, '5116')->debit);
        $this->assertNull($this->line($entry, '5180'), 'لا سطر على 5180 في هذا القيد إطلاقاً.');
        $this->assertEquals(8000, (int) $this->line($entry, '2110')->debit, 'ذمّة المورّد تبقى بالقيمة التجارية الأصلية.');
    }

    // ═══════════════════════════════════════════════════════════
    //  tax-bearing purchase return
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_tax_bearing_return_keeps_tax_separate_from_the_carrying_value_variance(): void
    {
        $s = $this->twoBatchSetup();
        $line = $this->purchaseLine($s['batch2']); // سعر ٦٠٠٠ مقابل متوسط ٥٠٠٠ حالي

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $s['product']->id, 'source_line_id' => $line->id, 'quantity' => 2, 'unit_price' => 6000, 'tax_rate' => 15]]
        );
        $posted = $this->returns->post($return);

        // تجاري: ٢×٦٠٠٠=١٢٠٠٠ صافٍ، ضريبة ١٥٪=١٨٠٠، إجمالي ١٣٨٠٠.
        $this->assertSame(12000, (int) $posted->subtotal);
        $this->assertSame(1800, (int) $posted->tax_amount);
        $this->assertSame(13800, (int) $posted->total);

        $entry = $posted->journalEntry()->with('lines.account')->first();
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(13800, (int) $this->line($entry, '2110')->debit);
        $this->assertEquals(1800, (int) $this->line($entry, '1150')->credit, 'الضريبة تُعكس كاملة — لا تتأثر بفرق القيمة الدفترية.');
        $this->assertEquals(10000, (int) $this->line($entry, '1140')->credit, 'الدفترية وحدها (٢×٥٠٠٠)، بمعزل عن الضريبة.');
        $this->assertEquals(2000, (int) $this->line($entry, '5116')->credit, 'فرق القيمة (١٢٠٠٠-١٠٠٠٠) بمعزل عن الضريبة تماماً.');
        $this->assertNull($this->line($entry, '5180'), 'لا سطر على 5180 في هذا القيد إطلاقاً — فرق التقييم ليس على حساب الجرد والتلف.');
    }

    // ═══════════════════════════════════════════════════════════
    //  exact proof that movement/subledger delta equals 1140 delta
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_1140_delta_exactly_equals_the_subledger_delta_despite_a_commercial_divergence(): void
    {
        $s = $this->twoBatchSetup();
        $product = $s['product'];
        $line = $this->purchaseLine($s['batch2']); // فرق تقييم عمداً (٦٠٠٠ تجاري ضد ٥٠٠٠ دفتري)

        $beforeSubledger = $product->fresh()->quantity_on_hand * $product->fresh()->avg_cost;
        $before1140 = $this->bal('1140');

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 3, 'unit_price' => 6000, 'tax_rate' => 0]]
        );
        $this->returns->post($return);

        $product->refresh();
        $afterSubledger = $product->quantity_on_hand * $product->avg_cost;
        $after1140 = $this->bal('1140');

        $subledgerDelta = $afterSubledger - $beforeSubledger;
        $glDelta = $after1140 - $before1140;

        $this->assertSame(-3 * 5000, $subledgerDelta, 'الدفتر المساعد ينقص بالكمية × المتوسط — لا بسعر الاعتماد.');
        $this->assertSame($subledgerDelta, $glDelta, 'Δ 1140 = Δ الدفتر المساعد تماماً، بالهللة.');
    }

    // ═══════════════════════════════════════════════════════════
    //  rollback leaves no partial stock/GL/document mutation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_rejected_post_leaves_no_partial_stock_gl_or_document_mutation(): void
    {
        $warehouse = Warehouse::create(['name' => 'مخزن الاسترجاع', 'code' => 'PR2-W2']);
        $product = $this->boxedProduct(factor: 24);
        $purchase = $this->purchase($product, 1, 240000, ['unit' => 'carton'], ['warehouse_id' => $warehouse->id]);
        $line = $this->purchaseLine($purchase);
        ProductWarehouseStock::where('product_id', $product->id)->where('warehouse_id', $warehouse->id)
            ->update(['quantity' => 8]); // أقلّ من الـ٢٤ المطلوبة

        $movementsBefore = StockMovement::count();
        $entriesBefore = JournalEntry::count();
        $qtyBefore = $product->fresh()->quantity_on_hand;

        $return = $this->returns->create(
            ['type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'warehouse_id' => $warehouse->id],
            [['product_id' => $product->id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 240000, 'tax_rate' => 0]]
        );

        try {
            $this->returns->post($return);
            $this->fail('كان يجب رفض الترحيل لعدم كفاية رصيد المخزن.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('أقل من المطلوب', $e->getMessage());
        }

        $this->assertSame('draft', $return->fresh()->status, 'المستند بقي مسوّدة — لا ترحيل جزئي.');
        $this->assertNull($return->fresh()->journal_entry_id);
        $this->assertSame($movementsBefore, StockMovement::count(), 'لا حركة مخزون عند الرفض.');
        $this->assertSame($entriesBefore, JournalEntry::count(), 'لا قيد محاسبي عند الرفض.');
        $this->assertSame($qtyBefore, $product->fresh()->quantity_on_hand, 'الكمية الكلية لم تتحرّك.');
        $this->assertSame(
            8,
            (int) ProductWarehouseStock::where('product_id', $product->id)->where('warehouse_id', $warehouse->id)->value('quantity'),
            'رصيد المخزن المحدَّد لم يتحرّك.'
        );
    }

    // ═══════════════════════════════════════════════════════════
    //  5116 — new tenant seeder + safe provisioning for existing tenants
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_new_tenant_is_seeded_with_the_purchase_return_valuation_variance_account(): void
    {
        // $this->tenant أُنشئ في setUp() عبر نفس ChartOfAccountsSeeder المستعمل
        // لكل مستأجر جديد فعلياً — لا مسار اختباري موازٍ.
        $account = Account::where('code', '5116')->first();

        $this->assertNotNull($account, 'حساب 5116 يجب أن يُزرع لكل مستأجر جديد.');
        $this->assertSame('فروق تقييم مردودات المشتريات', $account->name);
        $this->assertSame('Purchase Return Valuation Variance', $account->name_en);
        $this->assertSame('expense', $account->type);
        $this->assertSame('debit', $account->normal_balance);
        $this->assertFalse((bool) $account->is_group);
        $this->assertTrue((bool) $account->is_system);

        $parent = Account::find($account->parent_id);
        $this->assertSame('51', $parent->code, 'يقع تحت مجموعة تكلفة المبيعات، جنباً إلى جنب مع 5115.');
    }

    /** @test */
    public function an_existing_tenant_predating_this_pr_receives_the_account_safely_without_duplicates_or_historical_changes(): void
    {
        // محاكاة مستأجرٍ قائم قبل هذا الـPR: يُحذف 5116 الذي زرعه seed()،
        // تاركاً بقية دليل الحسابات كما كان فعلياً على مستأجرٍ قديم.
        Account::where('tenant_id', $this->tenant->id)->where('code', '5116')->delete();
        $this->assertNull(Account::where('code', '5116')->first());

        // مرتجعٌ تاريخي مرحَّل **قبل** توفّر 5116 على هذا المستأجر — يثبت أن
        // ترقية الحساب لا تُعيد تصنيف أو تعدّل أي قيدٍ أو رصيدٍ قائم.
        $product = Product::create(['name' => 'بضاعة قديمة', 'track_inventory' => true, 'quantity_on_hand' => 0, 'avg_cost' => 0]);
        $purchase = $this->purchase($product, 5, 4000);
        $historicalReturn = $this->returns->create(
            [
                'type' => 'purchase', 'partner_id' => $this->supplier->id, 'payment_type' => 'credit',
                'original_id' => $purchase->id, 'original_type' => Purchase::class,
            ],
            [['product_id' => $product->id, 'source_line_id' => $this->purchaseLine($purchase)->id, 'quantity' => 2, 'unit_price' => 4000, 'tax_rate' => 0]]
        );
        $this->returns->post($historicalReturn);
        $historicalEntryId = $historicalReturn->fresh()->journal_entry_id;
        $historicalLineCountBefore = JournalLine::where('journal_entry_id', $historicalEntryId)->count();
        $accountsCountBefore = Account::where('tenant_id', $this->tenant->id)->count();

        $migration = require base_path('database/migrations/2026_09_06_010000_add_purchase_return_valuation_variance_account.php');
        $migration->up();

        $accounts = Account::where('tenant_id', $this->tenant->id)->where('code', '5116')->get();
        $this->assertCount(1, $accounts, 'حساب واحد فقط يُزرع.');
        $account = $accounts->first();
        $this->assertSame('فروق تقييم مردودات المشتريات', $account->name);
        $this->assertSame('expense', $account->type);
        $this->assertSame('debit', $account->normal_balance);
        $parent = Account::find($account->parent_id);
        $this->assertSame('51', $parent->code);

        // القيد التاريخي (المرحَّل قبل توفّر 5116) لم يتغيّر بحرف.
        $this->assertSame(
            $historicalLineCountBefore,
            JournalLine::where('journal_entry_id', $historicalEntryId)->count(),
            'لا إعادة تصنيف لأي سطر قيدٍ تاريخي.'
        );

        // إعادة التنفيذ لا تُنشئ نسخة مكرّرة (idempotent).
        $migration->up();
        $this->assertSame(
            1,
            Account::where('tenant_id', $this->tenant->id)->where('code', '5116')->count(),
            'إعادة تنفيذ الترقية لا تُكرّر الحساب.'
        );
        $this->assertSame(
            $accountsCountBefore + 1,
            Account::where('tenant_id', $this->tenant->id)->count(),
            'حسابٌ واحد إضافي فقط — بقية دليل الحسابات لم تتغيّر.'
        );
    }
}

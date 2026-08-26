<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\InventoryOpening;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryOpeningService;
use App\Services\Accounting\InventoryService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ترحيل الأرصدة الافتتاحية — الأثر المخزني والمحاسبي
 * ═══════════════════════════════════════════════════════════════
 *  **الثوابت المحروسة هنا:**
 *   1. قيدٌ **واحد** للمستند كلّه، مهما تعدّدت الأصناف والمخازن والفروع.
 *   2. مدين 1140 = دائن 3130 = **مجموع `total_cost` للحركات** هللةً بهللة.
 *   3. حركة المخزون تتبع **فرع مخزنها** لا الفرع النشط.
 *   4. الكل أو لا شيء: فشلُ سطرٍ يرجع بالمستند كلّه.
 *
 *  تشغيل: php artisan test --filter=InventoryOpeningPostingTest
 */
class InventoryOpeningPostingTest extends TestCase
{
    use RefreshDatabase;

    protected string $tenantId;
    protected InventoryOpeningService $openings;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);
        $this->tenantId = $tenant->id;

        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $this->openings = app(InventoryOpeningService::class);
    }

    private function product(string $sku, array $overrides = []): Product
    {
        return Product::create(array_merge([
            'name' => "صنف {$sku}", 'sku' => $sku, 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ], $overrides));
    }

    private function warehouse(string $code, ?string $branchId = null): Warehouse
    {
        return Warehouse::create([
            'name' => "مخزن {$code}", 'code' => $code, 'branch_id' => $branchId,
        ]);
    }

    private function balance(string $code): int
    {
        $account = Account::where('code', $code)->firstOrFail();

        return (int) JournalLine::where('account_id', $account->id)->sum('debit')
            - (int) JournalLine::where('account_id', $account->id)->sum('credit');
    }

    // ═══════════════════════ الأثر المخزني ═══════════════════════

    /** @test */
    public function posting_creates_movements_and_sets_quantity_and_average_cost(): void
    {
        $product = $this->product('P-1');
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->createDraft(
            ['opening_date' => '2026-01-01'],
            [['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 120, 'unit_cost' => 1850]]
        );

        $this->assertSame('draft', $opening->status);
        $this->assertSame(0, StockMovement::count(), 'المسودة لا تحرّك مخزوناً.');
        $this->assertSame(0, JournalEntry::count(), 'المسودة لا تولّد قيداً.');

        $posted = $this->openings->post($opening);

        $this->assertSame('posted', $posted->status);
        $product->refresh();
        $this->assertSame(120, $product->quantity_on_hand);
        $this->assertSame(1850, $product->avg_cost, 'المتوسط = القيمة ÷ الكمية لمنتج بلا رصيد سابق.');

        $movement = StockMovement::firstOrFail();
        $this->assertSame('in', $movement->type);
        $this->assertSame(120, $movement->quantity);
        $this->assertSame(120 * 1850, $movement->total_cost);
        $this->assertSame($warehouse->id, $movement->warehouse_id);
        $this->assertSame('2026-01-01', $movement->movement_date->toDateString(), 'تاريخ المستند لا تاريخ اليوم.');
        $this->assertSame(InventoryOpening::class, $movement->source_type);
        $this->assertSame($opening->id, $movement->source_id);

        $this->assertSame(120, (int) ProductWarehouseStock::where('warehouse_id', $warehouse->id)
            ->where('product_id', $product->id)->value('quantity'));
    }

    /** @test */
    public function posting_creates_exactly_one_balanced_entry_for_the_whole_document(): void
    {
        $warehouse = $this->warehouse('WH-1');
        $lines = [];
        foreach (['P-1', 'P-2', 'P-3', 'P-4'] as $sku) {
            $lines[] = [
                'product_id' => $this->product($sku)->id, 'warehouse_id' => $warehouse->id,
                'quantity' => 7, 'unit_cost' => 333,
            ];
        }

        $opening = $this->openings->post(
            $this->openings->createDraft(['opening_date' => '2026-01-01'], $lines)
        );

        $this->assertSame(1, JournalEntry::count(), 'قيدٌ واحد للمستند كلّه لا قيدٌ لكل صنف.');
        $this->assertSame(4, StockMovement::count());

        $entry = JournalEntry::with('lines')->firstOrFail();
        $this->assertSame(InventoryOpening::class, $entry->source_type);
        $this->assertSame($opening->id, $entry->source_id);
        $this->assertSame('2026-01-01', $entry->entry_date->toDateString());

        $expected = 4 * 7 * 333;
        $this->assertSame($expected, (int) $entry->lines->sum('debit'));
        $this->assertSame($expected, (int) $entry->lines->sum('credit'));
        $this->assertSame($expected, $this->balance('1140'), 'المخزون مدين بالإجمالي.');
        $this->assertSame(-$expected, $this->balance('3130'), 'الأرصدة الافتتاحية دائنة بالإجمالي.');
        $this->assertSame($expected, (int) $opening->fresh()->total_value);
        $this->assertSame(28, (int) $opening->fresh()->total_quantity);
    }

    /** @test */
    public function the_journal_total_equals_the_sum_of_stock_movements_to_the_halala(): void
    {
        $warehouse = $this->warehouse('WH-1');
        // كميات وتكاليف تنتج كسوراً في المتوسط عمداً — لو بُني القيد من رقمٍ
        // يُعاد اشتقاقه بدل مجموع الحركات لظهر الفرق هنا.
        $lines = [
            ['product_id' => $this->product('P-1')->id, 'warehouse_id' => $warehouse->id, 'quantity' => 3, 'unit_cost' => 3333],
            ['product_id' => $this->product('P-2')->id, 'warehouse_id' => $warehouse->id, 'quantity' => 7, 'unit_cost' => 1111],
            ['product_id' => $this->product('P-3')->id, 'warehouse_id' => $warehouse->id, 'quantity' => 11, 'unit_cost' => 909],
        ];

        $this->openings->post($this->openings->createDraft(['opening_date' => '2026-03-05'], $lines));

        $movements = (int) StockMovement::sum('total_cost');
        $entry = JournalEntry::with('lines')->firstOrFail();

        $this->assertSame($movements, (int) $entry->lines->sum('debit'));
        $this->assertSame($movements, (int) $entry->lines->sum('credit'));
        $this->assertSame($movements, $this->balance('1140'));
        $this->assertSame(3 * 3333 + 7 * 1111 + 11 * 909, $movements);
    }

    /** @test */
    public function warehouse_quantities_are_tracked_per_warehouse_for_one_product(): void
    {
        $product = $this->product('P-1');
        $first = $this->warehouse('WH-1');
        $second = $this->warehouse('WH-2');

        $this->openings->post($this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $product->id, 'warehouse_id' => $first->id, 'quantity' => 100, 'unit_cost' => 1000],
            ['product_id' => $product->id, 'warehouse_id' => $second->id, 'quantity' => 50, 'unit_cost' => 1600],
        ]));

        $product->refresh();
        $this->assertSame(150, $product->quantity_on_hand, 'الكمية الكلية مجموع المخزنين.');
        // (100×1000 + 50×1600) ÷ 150 = 180000 ÷ 150 = 1200
        $this->assertSame(1200, $product->avg_cost, 'المتوسط عالميّ على المنتج ويمزج المخزنين.');

        $this->assertSame(100, (int) ProductWarehouseStock::where('warehouse_id', $first->id)->value('quantity'));
        $this->assertSame(50, (int) ProductWarehouseStock::where('warehouse_id', $second->id)->value('quantity'));
        $this->assertSame(1, JournalEntry::count());
    }

    // ═══════════════════════ الفروع ═══════════════════════

    /** @test */
    public function movements_and_journal_lines_follow_the_warehouse_branch_not_the_active_one(): void
    {
        $dammam = Branch::create(['name' => 'فرع الدمام', 'code' => 'BR-1']);
        $khobar = Branch::create(['name' => 'فرع الخبر', 'code' => 'BR-2']);

        $productA = $this->product('P-A');
        $productB = $this->product('P-B');
        $warehouseA = $this->warehouse('WH-A', $dammam->id);
        $warehouseB = $this->warehouse('WH-B', $khobar->id);

        $opening = $this->openings->post($this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $productA->id, 'warehouse_id' => $warehouseA->id, 'quantity' => 10, 'unit_cost' => 1000],
            ['product_id' => $productB->id, 'warehouse_id' => $warehouseB->id, 'quantity' => 20, 'unit_cost' => 2000],
        ]));

        $this->assertSame($dammam->id, StockMovement::where('product_id', $productA->id)->value('branch_id'));
        $this->assertSame($khobar->id, StockMovement::where('product_id', $productB->id)->value('branch_id'));

        // قيدٌ واحد، أربعة سطور: مدين/دائن لكل فرع، والتوازن الكلي محفوظ.
        $this->assertSame(1, JournalEntry::count());
        $lines = JournalEntry::with('lines')->firstOrFail()->lines;
        $this->assertCount(4, $lines);
        $this->assertSame(50000, (int) $lines->sum('debit'));
        $this->assertSame(50000, (int) $lines->sum('credit'));

        $inventoryId = Account::where('code', '1140')->value('id');
        $this->assertSame(10000, (int) $lines->where('account_id', $inventoryId)->where('branch_id', $dammam->id)->sum('debit'));
        $this->assertSame(40000, (int) $lines->where('account_id', $inventoryId)->where('branch_id', $khobar->id)->sum('debit'));

        $openingId = Account::where('code', '3130')->value('id');
        $this->assertSame(10000, (int) $lines->where('account_id', $openingId)->where('branch_id', $dammam->id)->sum('credit'));
        $this->assertSame(40000, (int) $lines->where('account_id', $openingId)->where('branch_id', $khobar->id)->sum('credit'));

        $this->assertSame(50000, (int) $opening->fresh()->total_value);
    }

    /** @test */
    public function a_central_warehouse_line_stays_unallocated_and_is_never_glued_to_a_branch(): void
    {
        $dammam = Branch::create(['name' => 'فرع الدمام', 'code' => 'BR-1']);
        $branched = $this->warehouse('WH-A', $dammam->id);
        $central = $this->warehouse('WH-C');   // بلا فرع — مخزن مركزي

        $this->openings->post($this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-A')->id, 'warehouse_id' => $branched->id, 'quantity' => 10, 'unit_cost' => 1000],
            ['product_id' => $this->product('P-C')->id, 'warehouse_id' => $central->id, 'quantity' => 5, 'unit_cost' => 2000],
        ]));

        $inventoryId = Account::where('code', '1140')->value('id');
        $lines = JournalEntry::with('lines')->firstOrFail()->lines;

        $this->assertSame(10000, (int) $lines->where('account_id', $inventoryId)->where('branch_id', $dammam->id)->sum('debit'));
        $this->assertSame(10000, (int) $lines->where('account_id', $inventoryId)->whereNull('branch_id')->sum('debit'),
            'المخزن المركزي يبقى غير موزَّع على فرع.');
        $this->assertSame(20000, (int) $lines->sum('debit'));
        $this->assertSame(20000, (int) $lines->sum('credit'));

        $this->assertNull(StockMovement::whereHas('warehouse', fn ($q) => $q->where('code', 'WH-C'))->value('branch_id'));
    }

    // ═══════════════════════ الحماية والذرّية ═══════════════════════

    /** @test */
    public function a_product_with_a_prior_movement_is_refused_and_nothing_is_written(): void
    {
        $product = $this->product('P-1');
        $warehouse = $this->warehouse('WH-1');
        app(InventoryService::class)->receiveStock($product, 5, 1000, ['warehouse_id' => $warehouse->id]);

        $movementsBefore = StockMovement::count();
        $entriesBefore = JournalEntry::count();

        $opening = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 1000],
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/حركة مخزون سابقة/');

        try {
            $this->openings->post($opening);
        } finally {
            $this->assertSame($movementsBefore, StockMovement::count(), 'لا حركة جديدة.');
            $this->assertSame($entriesBefore, JournalEntry::count(), 'لا قيد جديد.');
            $this->assertSame('draft', $opening->fresh()->status);
        }
    }

    /** @test */
    public function a_second_post_is_blocked(): void
    {
        $opening = $this->openings->post($this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-1')->id, 'warehouse_id' => $this->warehouse('WH-1')->id,
                'quantity' => 10, 'unit_cost' => 1000],
        ]));

        $this->assertSame(1, JournalEntry::count());

        try {
            $this->openings->post($opening);
            $this->fail('كان يجب رفض الترحيل الثاني.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('مرحَّل بالفعل', $e->getMessage());
        }

        $this->assertSame(1, JournalEntry::count(), 'لا قيد ثانٍ.');
        $this->assertSame(1, StockMovement::count(), 'لا حركة ثانية.');
        $this->assertSame(10, Product::where('sku', 'P-1')->value('quantity_on_hand'), 'الكمية لم تتضاعف.');
    }

    /**
     * @test
     *
     * الترحيل يمرّ بحارس الحالة **داخل** المعاملة بعد `lockForUpdate`. هنا نحاكي
     * سبق طلبٍ آخر إلى الترحيل بين قراءة النموذج وفتح المعاملة: التحديث المباشر
     * على القاعدة يمثّل ما كتبه ذلك الطلب.
     */
    public function a_post_racing_another_post_finds_the_document_already_posted(): void
    {
        $opening = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-1')->id, 'warehouse_id' => $this->warehouse('WH-1')->id,
                'quantity' => 10, 'unit_cost' => 1000],
        ]);

        // نسخةٌ قديمة في يد الطلب البطيء، والقاعدة سبقته.
        DB::table('inventory_openings')->where('id', $opening->id)->update(['status' => 'posted']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/مرحَّل بالفعل/');

        try {
            $this->openings->post($opening);
        } finally {
            $this->assertSame(0, StockMovement::count(), 'الحارس داخل المعاملة منع الحركة.');
            $this->assertSame(0, JournalEntry::count());
        }
    }

    /** @test */
    public function one_bad_line_rolls_the_whole_document_back(): void
    {
        $good = $this->product('P-1');
        $bad = $this->product('P-2');
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $good->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 1000],
            ['product_id' => $bad->id, 'warehouse_id' => $warehouse->id, 'quantity' => 5, 'unit_cost' => 2000],
        ]);

        // يتغيّر الواقع بعد المسودة: الصنف الثاني لم يعد متتبَّعاً.
        $bad->update(['track_inventory' => false]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/لا يتتبّع مخزوناً/');

        try {
            $this->openings->post($opening);
        } finally {
            $this->assertSame(0, StockMovement::count(), 'حتى السطر السليم لم يُكتب.');
            $this->assertSame(0, JournalEntry::count());
            $this->assertSame(0, ProductWarehouseStock::count());
            $this->assertSame(0, Product::where('sku', 'P-1')->value('quantity_on_hand'));
            $this->assertSame('draft', $opening->fresh()->status);
        }
    }

    /** @test */
    public function posting_is_refused_when_a_product_gained_a_movement_after_the_draft(): void
    {
        $product = $this->product('P-1');
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 1000],
        ]);

        // شراءٌ حدث بين المسودة والترحيل.
        app(InventoryService::class)->receiveStock($product, 4, 900, ['warehouse_id' => $warehouse->id]);
        $entriesAfterPurchase = JournalEntry::count();

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/حركة مخزون سابقة/');

        try {
            $this->openings->post($opening);
        } finally {
            $this->assertSame(4, Product::where('sku', 'P-1')->value('quantity_on_hand'), 'الشراء وحده باقٍ.');
            $this->assertSame($entriesAfterPurchase, JournalEntry::count());
        }
    }

    // ═══════════ موافقة «تكلفة صفر»: قرارٌ محفوظ لا حالةُ طلب ═══════════

    /**
     * @test
     *
     * الموافقة تُقرأ من **المستند** لا من الطلب. مسودةٌ أُنشئت بلا موافقة لا
     * تُرحَّل بموافقةٍ عابرة، ولو حملت سطوراً بتكلفة صفر.
     */
    public function a_zero_cost_line_is_refused_when_the_document_carries_no_consent(): void
    {
        $product = $this->product('P-1', ['purchase_price' => 0]);
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 0],
        ]);

        $this->assertFalse($opening->allow_zero_cost, 'الافتراض: لا موافقة.');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/لا يحمل موافقة/');

        try {
            $this->openings->post($opening);
        } finally {
            $this->assertSame(0, StockMovement::count(), 'لا حركة.');
            $this->assertSame(0, JournalEntry::count(), 'لا قيد.');
            $this->assertSame(0, Product::where('sku', 'P-1')->value('quantity_on_hand'));
            $this->assertSame('draft', $opening->fresh()->status);
        }
    }

    /** @test */
    public function a_zero_cost_line_posts_when_the_document_carries_a_stored_consent(): void
    {
        $product = $this->product('P-1', ['purchase_price' => 0]);
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->createDraft(
            ['opening_date' => '2026-01-01', 'allow_zero_cost' => true],
            [['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 0]]
        );

        $this->assertTrue($opening->allow_zero_cost, 'الموافقة محفوظة على المستند.');

        $posted = $this->openings->post($opening);

        $this->assertSame('posted', $posted->status);
        $this->assertSame(10, Product::where('sku', 'P-1')->value('quantity_on_hand'));
        $this->assertSame(1, StockMovement::count());
        $this->assertTrue($posted->allow_zero_cost, 'الموافقة تبقى مقروءة بعد الترحيل.');
    }

    /**
     * @test
     *
     * الموافقة تُطلق تكلفة الصفر وحدها — لا تُخفّف أي حارس آخر.
     */
    public function a_stored_consent_does_not_loosen_any_other_guard(): void
    {
        $product = $this->product('P-1');
        $warehouse = $this->warehouse('WH-1');
        app(InventoryService::class)->receiveStock($product, 5, 1000, ['warehouse_id' => $warehouse->id]);

        $opening = $this->openings->createDraft(
            ['opening_date' => '2026-01-01', 'allow_zero_cost' => true],
            [['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 0]]
        );

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/حركة مخزون سابقة/');
        $this->openings->post($opening);
    }

    /** @test */
    public function a_zero_value_document_moves_quantity_without_a_journal_entry(): void
    {
        $product = $this->product('P-1', ['purchase_price' => 0]);
        $warehouse = $this->warehouse('WH-1');

        $opening = $this->openings->post($this->openings->createDraft(
            ['opening_date' => '2026-01-01', 'allow_zero_cost' => true],
            [['product_id' => $product->id, 'warehouse_id' => $warehouse->id, 'quantity' => 10, 'unit_cost' => 0]]
        ));

        $this->assertSame(10, Product::where('sku', 'P-1')->value('quantity_on_hand'));
        $this->assertSame(1, StockMovement::count());
        $this->assertSame(0, JournalEntry::count(), 'قيدٌ بصفرين ضجيجٌ في كشف الأستاذ.');
        $this->assertNull($opening->journal_entry_id);
        $this->assertSame(0, (int) $opening->total_value);
    }

    /** @test */
    public function a_draft_is_deletable_and_a_posted_document_is_not(): void
    {
        $draft = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-1')->id, 'warehouse_id' => $this->warehouse('WH-1')->id,
                'quantity' => 10, 'unit_cost' => 1000],
        ]);

        $this->openings->deleteDraft($draft);
        $this->assertSame(0, InventoryOpening::count());

        $posted = $this->openings->post($this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-2')->id, 'warehouse_id' => Warehouse::first()->id,
                'quantity' => 5, 'unit_cost' => 1000],
        ]));

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessageMatches('/لا يُحذف رصيد افتتاحي مرحَّل/');
        $this->openings->deleteDraft($posted);
    }

    /** @test */
    public function the_document_number_is_a_company_wide_sequence(): void
    {
        $warehouse = $this->warehouse('WH-1');

        $first = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-1')->id, 'warehouse_id' => $warehouse->id, 'quantity' => 1, 'unit_cost' => 100],
        ]);
        $second = $this->openings->createDraft(['opening_date' => '2026-01-01'], [
            ['product_id' => $this->product('P-2')->id, 'warehouse_id' => $warehouse->id, 'quantity' => 1, 'unit_cost' => 100],
        ]);

        $this->assertSame('OPN-2026-00001', $first->number);
        $this->assertSame('OPN-2026-00002', $second->number);
    }
}

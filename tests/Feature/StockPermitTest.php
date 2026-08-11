<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Branch;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\StockPermit;
use App\Models\Tenant;
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
 *  الأذون المخزنية — إضافة · صرف · تحويل
 * ═══════════════════════════════════════════════════════════════
 *  أول وحدة تحرّك حساب المراقبة 1140 بلا فاتورة شراء ولا بيع.
 *
 *  **الثابت المحروس في كل اختبار ترحيل:**
 *      رصيد 1140  =  Σ(كمية المنتج × متوسط تكلفته)
 *  انفصال الطرفين هو الفشل الصامت الذي رُفض من أجله تحميلُ الإشعار المدين
 *  على 1140 (#163) — وهنا يُحرَس بالقياس المباشر لا بالنيّة.
 *
 *  تشغيل: php artisan test --filter=StockPermitTest
 */
class StockPermitTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Product $product;
    protected Warehouse $main;
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

        $this->main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);

        $this->product = Product::create([
            'name' => 'إسمنت', 'sku' => 'CEM-1', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);

        // رصيد افتتاحي: ١٠٠ وحدة بتكلفة ١٠٠ ريال ⇒ قيمة المخزون ١٠٬٠٠٠ ريال
        app(InventoryService::class)->receiveStock($this->product, 100, 10000, [
            'warehouse_id' => $this->main->id,
        ]);
        $this->product->refresh();

        $this->permits = app(StockPermitService::class);
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    /** قيمة المخزون المشتقّة من دفتر المخزون المساعد. */
    private function subsidiaryValue(): int
    {
        return Product::all()->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);
    }

    /** **الثابت**: الدفتر العام يطابق الدفتر المساعد بلا فارق هللة. */
    private function assertLedgerMatchesStock(string $context = ''): void
    {
        $this->assertSame(
            $this->subsidiaryValue(),
            $this->balance('1140'),
            "1140 انفصل عن دفتر المخزون {$context}"
        );
    }

    private function permit(string $type, array $items, array $extra = []): StockPermit
    {
        return $this->permits->create(array_merge([
            'type' => $type, 'warehouse_id' => $this->main->id, 'reason' => 'اختبار',
        ], $extra), $items);
    }

    /** @test */
    public function the_chart_of_accounts_has_the_adjustment_account(): void
    {
        $account = Account::where('code', '5180')->first();

        $this->assertNotNull($account, 'حساب 5180 يجب أن يوجد في دليل الحسابات.');
        $this->assertSame('expense', $account->type);
        $this->assertFalse((bool) $account->is_group);
    }

    /**
     * **جوهر الوحدة #1 — إذن الصرف.** تلفٌ يخرج بمتوسط التكلفة:
     *   مدين 5180 / دائن 1140، والكمية تنقص، والثابت محفوظ.
     *
     * @test
     */
    public function an_issue_permit_credits_inventory_against_the_adjustment_account(): void
    {
        $before = $this->balance('1140');

        $permit = $this->permits->post($this->permit('issue', [
            ['product_id' => $this->product->id, 'quantity' => 10],
        ]));

        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $line  = fn (string $code) => $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);

        $this->assertSame(100000, (int) $line('5180')->debit);   // 10 × 100 ريال
        $this->assertSame(100000, (int) $line('1140')->credit);
        $this->assertSame($before - 100000, $this->balance('1140'));

        $this->assertSame(90, $this->product->fresh()->quantity_on_hand);
        $this->assertLedgerMatchesStock('بعد إذن الصرف');
    }

    /** التكلفة تُثبَّت في السطر عند الترحيل — أثرٌ رجعي لا يعتمد على متوسطٍ متغيّر. */
    /** @test */
    public function the_issue_cost_is_frozen_on_the_line_at_posting(): void
    {
        $permit = $this->permits->post($this->permit('issue', [
            ['product_id' => $this->product->id, 'quantity' => 10],
        ]));

        $line = $permit->lines->first();
        $this->assertSame(10000, $line->unit_cost);
        $this->assertSame(100000, $line->line_cost);
        $this->assertSame(100000, (int) $permit->total_cost);
    }

    /**
     * **جوهر الوحدة #2 — إذن الإضافة.** بضاعة وُجدت تدخل بالتكلفة المُدخَلة:
     *   مدين 1140 / دائن 5180 — فتخفّض صافي فروق الجرد.
     *
     * @test
     */
    public function a_receipt_permit_debits_inventory_against_the_adjustment_account(): void
    {
        $before = $this->balance('1140');

        $permit = $this->permits->post($this->permit('receipt', [
            ['product_id' => $this->product->id, 'quantity' => 5, 'unit_cost' => 10000],
        ]));

        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $line  = fn (string $code) => $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);

        $this->assertSame(50000, (int) $line('1140')->debit);
        $this->assertSame(50000, (int) $line('5180')->credit);
        $this->assertSame($before + 50000, $this->balance('1140'));

        $this->assertSame(105, $this->product->fresh()->quantity_on_hand);
        $this->assertLedgerMatchesStock('بعد إذن الإضافة');
    }

    /** الزيادة والعجز يتقاصّان في حساب واحد — فيقرأ صافي الفروق بندًا واحداً. */
    /** @test */
    public function surplus_and_shortage_net_against_each_other(): void
    {
        $this->permits->post($this->permit('issue', [
            ['product_id' => $this->product->id, 'quantity' => 10],
        ]));
        $this->permits->post($this->permit('receipt', [
            ['product_id' => $this->product->id, 'quantity' => 10, 'unit_cost' => 10000],
        ]));

        $this->assertSame(0, $this->balance('5180'), 'عجزٌ ثم زيادةٌ مساوية ⇒ صافٍ صفر.');
        $this->assertLedgerMatchesStock('بعد التقاصّ');
    }

    /**
     * **جوهر الوحدة #3 — التحويل داخل الفرع: لا قيد إطلاقاً.**
     * لم يتغيّر شيء في الدفتر العام، وقيدٌ بلا تغيير ضجيجٌ يُفسد كشف الأستاذ.
     *
     * @test
     */
    public function an_internal_transfer_moves_stock_without_any_journal_entry(): void
    {
        $second  = Warehouse::create(['name' => 'مخزن ٢', 'code' => 'WH-2']);
        $entries = JournalEntry::count();
        $before  = $this->balance('1140');

        $permit = $this->permits->post($this->permit('transfer', [
            ['product_id' => $this->product->id, 'quantity' => 30],
        ], ['target_warehouse_id' => $second->id]));

        $this->assertNull($permit->journal_entry_id, 'التحويل الداخلي بلا قيد.');
        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame($before, $this->balance('1140'), 'قيمة المخزون لم تتغيّر.');

        // الكمية الكلّية ثابتة، والمتوسط لم ينحرف
        $product = $this->product->fresh();
        $this->assertSame(100, $product->quantity_on_hand);
        $this->assertSame(10000, (int) $product->avg_cost);

        // وتوزّعت بين المخزنين
        $this->assertSame(70, $this->stockIn($this->main->id));
        $this->assertSame(30, $this->stockIn($second->id));
        $this->assertLedgerMatchesStock('بعد التحويل الداخلي');
    }

    /**
     * **التحويل بين فرعين:** قيدٌ على 1140 بطرفيه بوسمَي فرع مختلفين.
     * صافيه صفرٌ للشركة، ويصحّح ميزان كل فرع — ولولاه لبقيت قيمة البضاعة
     * مسجَّلة على الفرع الذي غادرته.
     *
     * @test
     */
    public function a_cross_branch_transfer_posts_a_zero_sum_entry_tagged_per_branch(): void
    {
        $branchA = Branch::create(['name' => 'الدمام', 'code' => 'BR-A']);
        $branchB = Branch::create(['name' => 'الجبيل', 'code' => 'BR-B']);

        $from = Warehouse::create(['name' => 'مخزن الدمام', 'code' => 'WH-A', 'branch_id' => $branchA->id]);
        $to   = Warehouse::create(['name' => 'مخزن الجبيل', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        // بضاعة في مخزن الدمام — عبر `receiveStock` لا `applyReceipt`: الثانية
        // بدائيةٌ لا تولّد قيداً (تُستخدم داخل عملية أكبر تُرحّل قيدها بنفسها)،
        // فاستعمالها منفردةً يفصل 1140 عن الدفتر المساعد — وقد أسقط الثابتُ
        // أدناه هذا الاختبار فعلاً حتى صُحّح.
        app(InventoryService::class)->receiveStock($this->product, 20, 10000, ['warehouse_id' => $from->id]);
        $before = $this->balance('1140');

        $permit = $this->permits->post($this->permits->create([
            'type' => 'transfer', 'warehouse_id' => $from->id, 'target_warehouse_id' => $to->id,
        ], [['product_id' => $this->product->id, 'quantity' => 20]]));

        $this->assertNotNull($permit->journal_entry_id, 'العبور بين الفروع يحتاج قيداً.');

        $entry = JournalEntry::with('lines.account')->findOrFail($permit->journal_entry_id);
        $this->assertCount(2, $entry->lines);

        // الحساب نفسه على الطرفين — الفارق في وسم الفرع وحده
        $entry->lines->each(fn (JournalLine $l) => $this->assertSame('1140', $l->account->code));
        $debit  = $entry->lines->firstWhere('debit', '>', 0);
        $credit = $entry->lines->firstWhere('credit', '>', 0);

        $this->assertSame($branchB->id, $debit->branch_id, 'المدين على فرع الوجهة.');
        $this->assertSame($branchA->id, $credit->branch_id, 'والدائن على فرع المصدر.');
        $this->assertSame(200000, (int) $debit->debit);

        // صافي أثره على الشركة صفر
        $this->assertSame($before, $this->balance('1140'));
        $this->assertLedgerMatchesStock('بعد التحويل بين الفروع');
    }

    /** لا يُصرَف ما ليس موجوداً — الكمية السالبة تفسد التقييم بلا رجعة. */
    /** @test */
    public function issuing_more_than_available_is_rejected(): void
    {
        $this->expectExceptionMessage('أقل من المطلوب');
        $this->permits->post($this->permit('issue', [
            ['product_id' => $this->product->id, 'quantity' => 500],
        ]));
    }

    /** الترحيل مرّة واحدة — لا مضاعفة للحركة ولا للقيد. */
    /** @test */
    public function a_posted_permit_cannot_be_posted_again(): void
    {
        $permit = $this->permits->post($this->permit('issue', [
            ['product_id' => $this->product->id, 'quantity' => 5],
        ]));

        $this->expectExceptionMessage('لا يمكن ترحيل إذن غير مسوّد');
        $this->permits->post($permit);
    }

    /** المسوّدة لا تمسّ شيئاً: لا حركة ولا قيد حتى الترحيل. */
    /** @test */
    public function a_draft_permit_touches_neither_stock_nor_ledger(): void
    {
        $movements = StockMovement::count();
        $entries   = JournalEntry::count();

        $this->permit('issue', [['product_id' => $this->product->id, 'quantity' => 10]]);

        $this->assertSame($movements, StockMovement::count());
        $this->assertSame($entries, JournalEntry::count());
        $this->assertSame(100, $this->product->fresh()->quantity_on_hand);
    }

    /** منتج غير متابَع مخزنياً لا مكان له في إذن مخزني. */
    /** @test */
    public function an_untracked_product_is_rejected(): void
    {
        $service = Product::create([
            'name' => 'استشارة', 'sku' => 'SRV-1', 'type' => 'service',
            'sale_price' => 50000, 'track_inventory' => false,
        ]);

        $this->expectExceptionMessage('غير متابَع مخزنياً');
        $this->permit('issue', [['product_id' => $service->id, 'quantity' => 1]]);
    }

    /** @test */
    public function a_transfer_to_the_same_warehouse_is_rejected(): void
    {
        $this->expectExceptionMessage('لا يُحوَّل المخزن إلى نفسه.');
        $this->permit('transfer', [['product_id' => $this->product->id, 'quantity' => 1]],
            ['target_warehouse_id' => $this->main->id]);
    }

    /** ترقيم مستقلّ لكل نوع. */
    /** @test */
    public function each_type_has_its_own_number_sequence(): void
    {
        $second = Warehouse::create(['name' => 'مخزن ٢', 'code' => 'WH-2']);

        $issue    = $this->permit('issue', [['product_id' => $this->product->id, 'quantity' => 1]]);
        $receipt  = $this->permit('receipt', [['product_id' => $this->product->id, 'quantity' => 1, 'unit_cost' => 10000]]);
        $transfer = $this->permit('transfer', [['product_id' => $this->product->id, 'quantity' => 1]],
            ['target_warehouse_id' => $second->id]);

        $this->assertStringStartsWith('SI-', $issue->number);
        $this->assertStringStartsWith('SR-', $receipt->number);
        $this->assertStringStartsWith('ST-', $transfer->number);
        $this->assertStringEndsWith('-00001', $issue->number);
        $this->assertStringEndsWith('-00001', $receipt->number);
    }

    /** كمية منتج في مخزن معيّن. */
    private function stockIn(string $warehouseId): int
    {
        return (int) \App\Models\ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->where('product_id', $this->product->id)->value('quantity');
    }
}

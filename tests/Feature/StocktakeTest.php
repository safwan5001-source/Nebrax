<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Product;
use App\Models\Stocktake;
use App\Models\Tenant;
use App\Models\Warehouse;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InventoryService;
use App\Services\Accounting\StocktakeService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  الجرد — عدُّ الواقع ومطابقته بالدفتر
 * ═══════════════════════════════════════════════════════════════
 *  المخزون الدائم يفترض أن الدفتر يعرف كل حركة؛ والجرد هو اللحظة التي
 *  يُسأل فيها الواقعُ نفسه. الفرق يُرحَّل إلى 5180 — الحساب نفسه الذي
 *  تستعمله الأذون، فيقرأ صافي الفروق بنداً واحداً مهما تعدّدت مصادره.
 *
 *  **الثابت المحروس:** بعد الترحيل يبقى 1140 = Σ(كمية × متوسط تكلفة).
 *
 *  تشغيل: php artisan test --filter=StocktakeTest
 */
class StocktakeTest extends TestCase
{
    use RefreshDatabase;

    protected Product $cement;
    protected Product $steel;
    protected Warehouse $main;
    protected StocktakeService $stocktakes;

    protected function setUp(): void
    {
        parent::setUp();

        $tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);

        $this->main = Warehouse::create(['name' => 'المخزن الرئيسي', 'code' => 'WH-1', 'is_default' => true]);

        $this->cement = Product::create([
            'name' => 'إسمنت', 'sku' => 'CEM-1', 'type' => 'good',
            'sale_price' => 20000, 'purchase_price' => 10000, 'track_inventory' => true,
        ]);
        $this->steel = Product::create([
            'name' => 'حديد', 'sku' => 'STL-1', 'type' => 'good',
            'sale_price' => 40000, 'purchase_price' => 30000, 'track_inventory' => true,
        ]);

        $inventory = app(InventoryService::class);
        $inventory->receiveStock($this->cement, 100, 10000, ['warehouse_id' => $this->main->id]);
        $inventory->receiveStock($this->steel, 50, 30000, ['warehouse_id' => $this->main->id]);

        $this->stocktakes = app(StocktakeService::class);
    }

    private function balance(string $code): int
    {
        return (int) (Account::where('code', $code)->first()->balance?->balance ?? 0);
    }

    private function assertLedgerMatchesStock(string $context = ''): void
    {
        $subsidiary = Product::all()->sum(fn (Product $p) => $p->quantity_on_hand * $p->avg_cost);

        $this->assertSame($subsidiary, $this->balance('1140'), "1140 انفصل عن دفتر المخزون {$context}");
    }

    private function open(): Stocktake
    {
        return $this->stocktakes->open(['warehouse_id' => $this->main->id]);
    }

    /** الفتح يلتقط أرصدة المخزن — والالتقاط لا الاشتقاق هو ما يجعل الورقة حجّة. */
    /** @test */
    public function opening_a_stocktake_snapshots_the_warehouse_balances(): void
    {
        $stocktake = $this->open();

        $this->assertCount(2, $stocktake->lines);
        $this->assertStringStartsWith('STK-', $stocktake->number);

        $cement = $stocktake->lines->firstWhere('product_id', $this->cement->id);
        $this->assertSame(100, $cement->system_quantity);
        $this->assertNull($cement->counted_quantity, 'لم يُعدّ بعد.');
    }

    /**
     * **جوهر الوحدة #1 — العجز.** المعدود أقلّ ⇒ مدين 5180 / دائن 1140،
     * والكمية تُصحَّح، والثابت محفوظ.
     *
     * @test
     */
    public function a_shortage_debits_the_adjustment_account_and_credits_inventory(): void
    {
        $before    = $this->balance('1140');
        $stocktake = $this->open();

        // نقص ٥ من الإسمنت (٥ × ١٠٠ ريال = ٥٠٠ ريال)
        $this->stocktakes->count($stocktake, [$this->cement->id => 95, $this->steel->id => 50]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $line  = fn (string $code) => $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);

        $this->assertSame(50000, (int) $line('5180')->debit);
        $this->assertSame(50000, (int) $line('1140')->credit);
        $this->assertSame($before - 50000, $this->balance('1140'));

        $this->assertSame(95, $this->cement->fresh()->quantity_on_hand);
        $this->assertSame(-50000, (int) $posted->difference_value);
        $this->assertLedgerMatchesStock('بعد ترحيل العجز');
    }

    /**
     * **جوهر الوحدة #2 — الزيادة.** المعدود أكثر ⇒ مدين 1140 / دائن 5180.
     *
     * @test
     */
    public function a_surplus_debits_inventory_and_credits_the_adjustment_account(): void
    {
        $before    = $this->balance('1140');
        $stocktake = $this->open();

        $this->stocktakes->count($stocktake, [$this->cement->id => 100, $this->steel->id => 53]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $line  = fn (string $code) => $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);

        $this->assertSame(90000, (int) $line('1140')->debit);   // ٣ × ٣٠٠ ريال
        $this->assertSame(90000, (int) $line('5180')->credit);
        $this->assertSame($before + 90000, $this->balance('1140'));

        $this->assertSame(53, $this->steel->fresh()->quantity_on_hand);
        $this->assertLedgerMatchesStock('بعد ترحيل الزيادة');
    }

    /**
     * **قيدٌ واحد للجرد كلّه** لا قيدٌ لكل صنف — الجرد حدثٌ واحد، وتفتيته
     * يُغرق كشف الأستاذ. عجزٌ في صنف وزيادةٌ في آخر يتقاصّان في القيد نفسه.
     *
     * @test
     */
    public function mixed_differences_post_as_a_single_net_entry(): void
    {
        $entriesBefore = JournalEntry::count();
        $stocktake     = $this->open();

        // −٥ إسمنت (٥٠٠ ريال) و +٣ حديد (٩٠٠ ريال) ⇒ صافي +٤٠٠ ريال
        $this->stocktakes->count($stocktake, [$this->cement->id => 95, $this->steel->id => 53]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertSame($entriesBefore + 1, JournalEntry::count(), 'قيدٌ واحد لا قيدان.');
        $this->assertSame(40000, (int) $posted->difference_value);

        $entry = JournalEntry::with('lines.account')->findOrFail($posted->journal_entry_id);
        $this->assertCount(2, $entry->lines);
        $this->assertSame(40000, (int) $entry->lines->first(fn (JournalLine $l) => $l->account->code === '1140')->debit);
        $this->assertLedgerMatchesStock('بعد التقاصّ');
    }

    /** جردٌ مطابقٌ تماماً لا قيد له — ولا يجب أن يكون. */
    /** @test */
    public function a_perfect_count_posts_no_entry(): void
    {
        $entriesBefore = JournalEntry::count();
        $stocktake     = $this->open();

        $this->stocktakes->count($stocktake, [$this->cement->id => 100, $this->steel->id => 50]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertNull($posted->journal_entry_id);
        $this->assertSame($entriesBefore, JournalEntry::count());
        $this->assertSame(0, (int) $posted->difference_value);
        $this->assertSame('posted', $posted->status);
    }

    /**
     * **الفارق الحاسم:** «لم يُعدّ» ليس «عُدَّ فلم يوجد».
     * صنفٌ لم يُذكر في العدّ يُتجاهَل تماماً — ولولا ذلك لصار بندٌ منسيّ
     * عجزاً كاملاً يُرحَّل ويُشطب من المخزون.
     *
     * @test
     */
    public function an_uncounted_line_is_ignored_not_treated_as_zero(): void
    {
        $stocktake = $this->open();

        // عُدَّ الإسمنت وحده؛ الحديد بقي null
        $this->stocktakes->count($stocktake, [$this->cement->id => 95]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        $this->assertSame(50, $this->steel->fresh()->quantity_on_hand, 'الحديد لم يُمسّ.');
        $this->assertSame(-50000, (int) $posted->difference_value, 'الفرق من الإسمنت وحده.');
        $this->assertLedgerMatchesStock('بعد تجاهل غير المعدود');
    }

    /** صفرٌ صريح يعني «عُدَّ فلم يوجد» — فيُشطب الرصيد كلّه. */
    /** @test */
    public function an_explicit_zero_writes_the_balance_off(): void
    {
        $stocktake = $this->open();

        $this->stocktakes->count($stocktake, [$this->cement->id => 0, $this->steel->id => 50]);
        $this->stocktakes->post($stocktake->fresh());

        $this->assertSame(0, $this->cement->fresh()->quantity_on_hand);
        $this->assertLedgerMatchesStock('بعد الشطب الكامل');
    }

    /** الترحيل مرّة واحدة. */
    /** @test */
    public function a_posted_stocktake_cannot_be_posted_or_counted_again(): void
    {
        $stocktake = $this->open();
        $this->stocktakes->count($stocktake, [$this->cement->id => 100, $this->steel->id => 50]);
        $posted = $this->stocktakes->post($stocktake->fresh());

        try {
            $this->stocktakes->count($posted, [$this->cement->id => 90]);
            $this->fail('كان يجب رفض تعديل جرد مرحَّل.');
        } catch (\RuntimeException $e) {
            $this->assertStringContainsString('مرحَّل', $e->getMessage());
        }

        $this->expectExceptionMessage('لا يمكن ترحيل جرد مرحَّل.');
        $this->stocktakes->post($posted);
    }

    /** المسوّدة لا تمسّ شيئاً حتى الترحيل. */
    /** @test */
    public function counting_alone_changes_neither_stock_nor_ledger(): void
    {
        $before    = $this->balance('1140');
        $stocktake = $this->open();

        $this->stocktakes->count($stocktake, [$this->cement->id => 40]);

        $this->assertSame(100, $this->cement->fresh()->quantity_on_hand);
        $this->assertSame($before, $this->balance('1140'));
    }

    /** الخدمات لا تُجرَد — لا كمية لها أصلاً. */
    /** @test */
    public function services_are_excluded_from_the_count_sheet(): void
    {
        $service = Product::create([
            'name' => 'استشارة', 'sku' => 'SRV-1', 'type' => 'service',
            'sale_price' => 50000, 'track_inventory' => false,
        ]);

        $stocktake = $this->stocktakes->open(
            ['warehouse_id' => $this->main->id],
            [$this->cement->id, $service->id]
        );

        $this->assertCount(1, $stocktake->lines);
        $this->assertSame($this->cement->id, $stocktake->lines->first()->product_id);
    }

    /** صنفٌ خارج ورقة الجرد يُرفض — لا يُدسّ عدٌّ لما لم يُلتقَط. */
    /** @test */
    public function counting_a_product_outside_the_sheet_is_rejected(): void
    {
        $other = Product::create([
            'name' => 'رمل', 'sku' => 'SND-1', 'type' => 'good',
            'sale_price' => 5000, 'purchase_price' => 2000, 'track_inventory' => true,
        ]);

        $stocktake = $this->stocktakes->open(['warehouse_id' => $this->main->id], [$this->cement->id]);

        $this->expectExceptionMessage('صنف خارج ورقة الجرد.');
        $this->stocktakes->count($stocktake, [$other->id => 5]);
    }

    /** مخزن فارغ لا يُجرَد — ورقةٌ بلا أصناف بلا معنى. */
    /** @test */
    public function an_empty_warehouse_cannot_be_counted(): void
    {
        $empty = Warehouse::create(['name' => 'مخزن فارغ', 'code' => 'WH-0']);

        $this->expectExceptionMessage('لا أصناف مخزنية في هذا المخزن لجردها.');
        $this->stocktakes->open(['warehouse_id' => $empty->id]);
    }
}

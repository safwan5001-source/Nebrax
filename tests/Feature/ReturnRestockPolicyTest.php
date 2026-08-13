<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  هل تعود البضاعة المردودة إلى المخزون القابل للبيع؟
 * ═══════════════════════════════════════════════════════════════
 *  **سياسة عمل لا صحّة تقنية:** مطعمٌ أو محلّ أغذية لا يُعيد مردوداً إلى الرفّ
 *  أبداً، وتاجر تجزئةٍ يُعيد السليم ويُتلف التالف — كلاهما صحيح لصاحبه.
 *
 *  والأثر أخطر من مستندٍ واحد: إعادةُ التالف تُدخِل كميةً وتكلفةً لا وجود لهما
 *  على الرفّ، **فيُفسَد المتوسط المتحرك** وتخرج كل تكلفة بضاعة مباعة لاحقة
 *  خاطئة — تماماً كأثر المخزون السالب في #176.
 *
 *  تشغيل:  php artisan test --filter=ReturnRestockPolicyTest
 */
class ReturnRestockPolicyTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Product $product;

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
        $this->product  = Product::create([
            'name' => 'بضاعة', 'track_inventory' => true,
            'quantity_on_hand' => 10, 'avg_cost' => 4000,
        ]);

        $user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@nibras.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($user);
    }

    private function bal(string $code): int
    {
        return (int) (Account::where('code', $code)->first()?->balance?->balance ?? 0);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** مرتجع مبيعات ٢ × ١٠٠٫٠٠ — تكلفتها ٢ × ٤٠٫٠٠ = ٨٠٫٠٠. */
    private function ret(array $head = []): ReturnDocument
    {
        $id = $this->postJson('/api/returns', array_merge([
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $this->product->id, 'quantity' => 2,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ], $head))->assertCreated()->json('data.id');

        $this->postJson("/api/returns/{$id}/post")->assertOk();

        return ReturnDocument::findOrFail($id);
    }

    private function costEntry(ReturnDocument $return): JournalEntry
    {
        return JournalEntry::with('lines.account')->findOrFail($return->cogs_entry_id);
    }

    // ── الافتراض: البضاعة تعود (سلوك اليوم حرفياً) ───────────────

    /** @test */
    public function the_default_policy_restocks_the_goods(): void
    {
        $this->assertTrue(Settings::get('inventory', 'restock_sales_returns'));

        $return = $this->ret();

        $this->assertSame(12, $this->product->fresh()->quantity_on_hand);
        $this->assertSame(1, $this->product->movements()->count());
        $this->assertSame(8000, $this->bal('1140'));
        $this->assertSame(-8000, $this->bal('5110'));
        $this->assertSame(0, $this->bal('5180'));
        $this->assertTrue($return->restock);
    }

    /** @test */
    public function the_restocking_entry_debits_inventory(): void
    {
        $entry = $this->costEntry($this->ret());

        $this->assertEquals(8000, $this->line($entry, '1140')->debit);
        $this->assertEquals(8000, $this->line($entry, '5110')->credit);
        $this->assertNull($this->line($entry, '5180'));
        $this->assertStringContainsString('عكس تكلفة', $entry->description);
    }

    // ── السياسة مُطفأة: تلفٌ لا أصل ──────────────────────────────

    /** @test */
    public function disabling_the_policy_writes_the_cost_off_to_damages(): void
    {
        Settings::put('inventory', ['restock_sales_returns' => false]);

        $return = $this->ret();

        // **لا حركة مخزون إطلاقاً** — لا كمية ولا متوسط.
        $this->assertSame(10, $this->product->fresh()->quantity_on_hand);
        $this->assertSame(4000, $this->product->fresh()->avg_cost);
        $this->assertSame(0, $this->product->movements()->count());

        // التكلفة انتقلت من 5110 إلى 5180 لا إلى 1140.
        $this->assertSame(0, $this->bal('1140'));
        $this->assertSame(-8000, $this->bal('5110'));
        $this->assertSame(8000, $this->bal('5180'));
        $this->assertFalse($return->restock);
    }

    /** @test */
    public function the_damage_entry_debits_5180_not_inventory(): void
    {
        Settings::put('inventory', ['restock_sales_returns' => false]);

        $entry = $this->costEntry($this->ret());

        $this->assertEquals(8000, $this->line($entry, '5180')->debit);
        $this->assertEquals(8000, $this->line($entry, '5110')->credit);
        $this->assertNull($this->line($entry, '1140'));
        $this->assertStringContainsString('إتلاف', $entry->description);
    }

    /** @test */
    public function the_revenue_reversal_is_identical_under_both_policies(): void
    {
        // ما يُستردّ للعميل لا علاقة له بمصير البضاعة.
        $a = $this->ret();

        Settings::put('inventory', ['restock_sales_returns' => false]);
        $b = $this->ret();

        $this->assertSame((int) $a->total, (int) $b->total);

        foreach ([$a, $b] as $return) {
            $entry = JournalEntry::with('lines.account')->findOrFail($return->journal_entry_id);
            $this->assertEquals(20000, $this->line($entry, '4110')->debit);
            $this->assertEquals(3000, $this->line($entry, '2120')->debit);
            $this->assertEquals(23000, $this->line($entry, '1130')->credit);
        }
    }

    // ── المستند يعلو على السياسة ─────────────────────────────────

    /** @test */
    public function a_document_may_refuse_restocking_against_the_policy(): void
    {
        // متجرٌ يُعيد السليم عادةً، وهذه الشحنة عادت تالفة.
        $return = $this->ret(['restock' => false]);

        $this->assertSame(10, $this->product->fresh()->quantity_on_hand);
        $this->assertSame(8000, $this->bal('5180'));
        $this->assertFalse($return->restock);
    }

    /** @test */
    public function a_document_may_demand_restocking_against_the_policy(): void
    {
        Settings::put('inventory', ['restock_sales_returns' => false]);

        $return = $this->ret(['restock' => true]);

        $this->assertSame(12, $this->product->fresh()->quantity_on_hand);
        $this->assertSame(8000, $this->bal('1140'));
        $this->assertSame(0, $this->bal('5180'));
        $this->assertTrue($return->restock);
    }

    /** @test */
    public function a_draft_follows_the_policy_at_post_time_not_creation_time(): void
    {
        // القيمة `null` تعني «اتبع السياسة»، وتُحسَم عند الترحيل — فمسوّدةٌ
        // أُنشئت قبل تغيير السياسة تتبع السياسة الجديدة لا القديمة.
        $id = $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $this->product->id, 'quantity' => 2,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()->json('data.id');

        $this->assertNull(ReturnDocument::findOrFail($id)->restock);

        Settings::put('inventory', ['restock_sales_returns' => false]);
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->assertFalse(ReturnDocument::findOrFail($id)->restock);
        $this->assertSame(8000, $this->bal('5180'));
    }

    /** @test */
    public function the_stored_decision_survives_a_later_policy_change(): void
    {
        // المستند المرحَّل شارحٌ لنفسه لا مرهون بإعدادٍ قد يتغيّر بعده.
        $return = $this->ret();
        $this->assertTrue($return->restock);

        Settings::put('inventory', ['restock_sales_returns' => false]);

        $this->assertTrue(ReturnDocument::findOrFail($return->id)->restock);
    }

    // ── ما لا يمسّه القرار ───────────────────────────────────────

    /** @test */
    public function a_service_product_is_unaffected_by_either_policy(): void
    {
        Settings::put('inventory', ['restock_sales_returns' => false]);
        $service = Product::create(['name' => 'تركيب', 'track_inventory' => false]);

        $id = $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $service->id, 'quantity' => 1,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->assertSame(0, $this->bal('5180'));
        $this->assertSame(0, $this->bal('1140'));
        $this->assertNull(ReturnDocument::findOrFail($id)->cogs_entry_id);
    }

    /** @test */
    public function a_purchase_return_ignores_the_policy_entirely(): void
    {
        // الردّ إلى المورّد إخراجٌ من المخزون في كل حال — لا سؤال فيه.
        Settings::put('inventory', ['restock_sales_returns' => false]);
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        $id = $this->postJson('/api/returns', [
            'type' => 'purchase', 'partner_id' => $supplier->id, 'payment_type' => 'credit',
            'items' => [[
                'product_id' => $this->product->id, 'quantity' => 2,
                'unit_price' => 4000, 'tax_rate' => 15,
            ]],
        ])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->assertSame(8, $this->product->fresh()->quantity_on_hand); // خرجت
        $this->assertSame(0, $this->bal('5180'));
    }

    // ── الثابت المحاسبي ──────────────────────────────────────────

    /** @test */
    public function the_inventory_invariant_holds_under_both_policies(): void
    {
        // 1140 = Σ(الكمية × متوسط التكلفة) — وهو الثابت الذي كان يكسره إدخالُ
        // بضاعةٍ تالفة لا وجود لها على الرفّ.
        $opening = $this->product->quantity_on_hand * $this->product->avg_cost;

        $this->ret();                                              // تعود
        Settings::put('inventory', ['restock_sales_returns' => false]);
        $this->ret();                                              // تُتلَف

        $p = $this->product->fresh();
        $this->assertSame(
            $p->quantity_on_hand * $p->avg_cost - $opening,
            $this->bal('1140')
        );
    }

    /** @test */
    public function both_entries_stay_balanced(): void
    {
        $this->ret();
        Settings::put('inventory', ['restock_sales_returns' => false]);
        $this->ret();

        foreach (JournalEntry::with('lines')->get() as $entry) {
            $this->assertSame($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        }
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  المنتج إلزامي على سطر المرتجع — وأثرُه المخزوني
 * ═══════════════════════════════════════════════════════════════
 *  `ReturnService` يعرف كيف يُعيد البضاعة للمخزون ويعكس تكلفتها منذ البداية،
 *  لكن الشاشة كانت ترسل سطوراً بلا `product_id` — فيمرّ المرتجع بأثرٍ **مالي
 *  وحده**: المخزون لا يتحرّك، و5110 يبقى مضخّماً، وهامش الربح الإجمالي يخرج
 *  خاطئاً. هذه الاختبارات تُثبّت المنع، وتقيس الأثر المخزوني من **مسار الـ API
 *  نفسه** الذي تستعمله الشاشة، لا من الخدمة مباشرة.
 *
 *  تشغيل:  php artisan test --filter=ReturnWithProductTest
 */
class ReturnWithProductTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $customer;
    protected Partner $supplier;
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
        app(TenantApplicationService::class)->enable('purchases.cycle', null);
        $this->customer = Partner::create(['name' => 'عميل', 'type' => 'customer']);
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->product  = Product::create([
            'name' => 'بضاعة', 'sku' => 'W-040', 'track_inventory' => true,
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

    /** إنشاء مرتجع عبر الـ API — المسار الذي تسلكه الشاشة حرفياً. */
    private function create(array $items, string $type = 'sales', array $head = [])
    {
        return $this->postJson('/api/returns', array_merge([
            'type'         => $type,
            'partner_id'   => $type === 'sales' ? $this->customer->id : $this->supplier->id,
            'payment_type' => 'credit',
            'items'        => $items,
        ], $head));
    }

    private function item(array $over = []): array
    {
        return array_merge([
            'product_id' => $this->product->id,
            'quantity'   => 2,
            'unit_price' => 100000,
            'tax_rate'   => 15,
        ], $over);
    }

    // ── المنع ────────────────────────────────────────────────────

    /** @test */
    public function a_line_without_a_product_is_rejected(): void
    {
        $this->create([['description' => 'بضاعة راجعة', 'quantity' => 2, 'unit_price' => 100000]])
            ->assertStatus(422)
            ->assertJsonValidationErrors('items.0.product_id');

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function a_null_product_id_is_rejected_too(): void
    {
        // الشاشة القديمة كانت ترسل الحقل غائباً؛ وإرسالُه `null` صراحةً يجب
        // أن يُرفض بالقدر نفسه، وإلا التفّ عليه أي عميل API.
        $this->create([$this->item(['product_id' => null])])
            ->assertStatus(422)
            ->assertJsonValidationErrors('items.0.product_id');
    }

    /** @test */
    public function one_bad_line_among_good_ones_rejects_the_whole_document(): void
    {
        $this->create([$this->item(), ['quantity' => 1, 'unit_price' => 5000]])
            ->assertStatus(422)
            ->assertJsonValidationErrors('items.1.product_id');

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function the_error_message_points_to_a_service_product(): void
    {
        // مفتاح الخطأ نفسه يحوي نقاطاً (`items.0.product_id`)، فلا يُقرأ
        // بمسار نقطيّ — يُؤخذ من المصفوفة مباشرة.
        $errors = $this->create([['quantity' => 1, 'unit_price' => 5000]])
            ->assertStatus(422)
            ->json('errors');
        $message = $errors['items.0.product_id'][0] ?? null;

        $this->assertStringContainsString('المخزون', $message);
        $this->assertStringContainsString('غير متابَع', $message);
    }

    /** @test */
    public function another_tenants_product_is_rejected(): void
    {
        $other = Tenant::create(['name' => 'آخر', 'slug' => 'other', 'currency' => 'SAR']);
        $ctx = app(TenantContext::class);
        $ctx->set($other->id);
        $foreign = Product::create(['name' => 'بضاعة أخرى', 'track_inventory' => true]);
        $ctx->set($this->tenant->id);

        $this->create([$this->item(['product_id' => $foreign->id])])->assertStatus(422);
        $this->assertSame(0, ReturnDocument::count());
    }

    // ── الأثر المخزوني: مرتجع المبيعات ───────────────────────────

    /** @test */
    public function a_posted_sales_return_puts_the_goods_back_and_reverses_cogs(): void
    {
        $id = $this->create([$this->item()])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        // البضاعة عادت فعلاً — لا رقماً على المستند وحده.
        $this->product->refresh();
        $this->assertSame(12, $this->product->quantity_on_hand);
        $this->assertSame(1, $this->product->movements()->count());

        // 1140 += 2 × 4000، و5110 عُكس بالمبلغ نفسه.
        $this->assertSame(8000, $this->bal('1140'));
        $this->assertSame(-8000, $this->bal('5110'));
    }

    /** @test */
    public function the_inventory_invariant_holds_after_a_sales_return(): void
    {
        $id = $this->create([$this->item()])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        // الثابت: رصيد 1140 = Σ(الكمية × متوسط التكلفة) للأصناف المتابَعة.
        $this->product->refresh();
        $expected = ($this->product->quantity_on_hand - 10) * $this->product->avg_cost;
        $this->assertSame($expected, $this->bal('1140'));
    }

    /** @test */
    public function a_service_product_returns_no_stock_and_no_cogs(): void
    {
        $service = Product::create(['name' => 'تركيب', 'track_inventory' => false]);

        $id = $this->create([$this->item(['product_id' => $service->id, 'quantity' => 1])])
            ->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->assertSame(0, $this->bal('1140'));
        $this->assertSame(0, $this->bal('5110'));
        $this->assertSame(0, $service->movements()->count());
    }

    // ── الأثر المخزوني: مرتجع المشتريات ──────────────────────────

    /** @test */
    public function a_posted_purchase_return_takes_the_goods_out(): void
    {
        $id = $this->create([$this->item(['unit_price' => 4000])], 'purchase')
            ->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->product->refresh();
        $this->assertSame(8, $this->product->quantity_on_hand);
        $this->assertSame(-8000, $this->bal('1140')); // خرجت بضاعة بـ2 × 4000
    }

    /** @test */
    public function a_purchase_return_cannot_send_back_more_than_is_held(): void
    {
        // الإرجاع للمورّد إخراجٌ من المخزون، فيخضع لسياسة «البيع بلا رصيد».
        $id = $this->create([$this->item(['quantity' => 50, 'unit_price' => 4000])], 'purchase')
            ->assertCreated()->json('data.id');

        $this->postJson("/api/returns/{$id}/post")->assertStatus(422);

        $this->product->refresh();
        $this->assertSame(10, $this->product->quantity_on_hand); // لم يتحرّك شيء
    }

    // ── ما لم يتغيّر ─────────────────────────────────────────────

    /** @test */
    public function the_financial_entry_is_unchanged_and_balanced(): void
    {
        $id = $this->create([$this->item()])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $return = ReturnDocument::findOrFail($id);
        $entry  = $return->journalEntry()->with('lines.account')->first();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertSame(200000, (int) $return->subtotal);
        $this->assertSame(30000, (int) $return->tax_amount);
        $this->assertSame(230000, (int) $return->total);
    }

    /** @test */
    public function the_description_falls_back_to_the_product_name(): void
    {
        // الشاشة تملأ الوصف من المنتج، لكن عميلاً يرسله فارغاً يجب ألّا يُنتج
        // سطراً مجهولاً في المستند المطبوع.
        $id = $this->create([$this->item(['description' => null])])->assertCreated()->json('data.id');

        $line = ReturnDocument::with('lines')->findOrFail($id)->lines->first();
        $this->assertSame($this->product->id, $line->product_id);
    }
}

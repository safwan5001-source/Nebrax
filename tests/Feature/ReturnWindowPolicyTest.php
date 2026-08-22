<?php

namespace Tests\Feature;

use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\TenantApplicationService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مهلة الردّ — سياسةٌ تُقاس من تاريخ المستند المصدر
 * ═══════════════════════════════════════════════════════════════
 *  **سياسة عمل لا صحّة تقنية:** التجزئة تضع مهلةً معلنة (١٤ يوماً مثلاً)،
 *  والمقاولات والعقود طويلة الأجل لا مهلة فيها أصلاً. كلاهما يُنتج بياناتٍ
 *  صحيحة، فالفرق تفضيلٌ لا سلامة.
 *
 *  والافتراض `0` = بلا حدّ — سلوك اليوم حرفياً.
 *
 *  تشغيل:  php artisan test --filter=ReturnWindowPolicyTest
 */
class ReturnWindowPolicyTest extends TestCase
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
            'name' => 'بضاعة', 'track_inventory' => true,
            'quantity_on_hand' => 100, 'avg_cost' => 4000,
        ]);

        $user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@nibras.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($user);
    }

    /** فاتورة مرحَّلة بتاريخ محدَّد. */
    private function invoice(string $date = '2026-01-01'): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit', 'invoice_date' => $date],
            [['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function purchase(string $date = '2026-01-01'): Purchase
    {
        $p = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit', 'purchase_date' => $date],
            [['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 15]]
        );

        return app(PurchaseService::class)->post($p);
    }

    /** مرتجع مرتبط بفاتورة، بتاريخ محدَّد. */
    private function ret(Invoice|Purchase $source, string $returnDate, array $head = [])
    {
        $line = $source->lines()->first();
        $sales = $source instanceof Invoice;

        return $this->postJson('/api/returns', array_merge([
            'type'         => $sales ? 'sales' : 'purchase',
            'partner_id'   => $sales ? $this->customer->id : $this->supplier->id,
            'payment_type' => 'credit',
            'return_date'  => $returnDate,
            'original_id'  => $source->id,
            'items'        => [[
                'product_id' => $this->product->id, 'source_line_id' => $line->id,
                'quantity' => 1, 'unit_price' => (int) $line->unit_price, 'tax_rate' => 15,
            ]],
        ], $head));
    }

    // ── الافتراض: بلا حدّ ────────────────────────────────────────

    /** @test */
    public function there_is_no_window_by_default(): void
    {
        $this->assertSame(0, Settings::get('sales', 'return_window_days'));

        // سنةٌ كاملة بعد الفاتورة — يُقبل.
        $this->ret($this->invoice('2026-01-01'), '2027-01-01')->assertCreated();
    }

    // ── المهلة مفعَّلة ───────────────────────────────────────────

    /** @test */
    public function a_return_inside_the_window_is_accepted(): void
    {
        Settings::put('sales', ['return_window_days' => 14]);

        $this->ret($this->invoice('2026-01-01'), '2026-01-10')->assertCreated();
    }

    /** @test */
    public function the_last_day_of_the_window_is_still_inside_it(): void
    {
        // «١٤ يوماً» تشمل اليوم الرابع عشر — الحدّ شامل لا حصري.
        Settings::put('sales', ['return_window_days' => 14]);

        $this->ret($this->invoice('2026-01-01'), '2026-01-15')->assertCreated();
    }

    /** @test */
    public function the_day_after_the_window_is_rejected(): void
    {
        Settings::put('sales', ['return_window_days' => 14]);

        $this->ret($this->invoice('2026-01-01'), '2026-01-16')->assertStatus(422);
        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function the_message_names_the_window_and_the_elapsed_days(): void
    {
        Settings::put('sales', ['return_window_days' => 14]);

        $message = $this->ret($this->invoice('2026-01-01'), '2026-02-01')
            ->assertStatus(422)
            ->json('message');

        $this->assertStringContainsString('14', $message);
        $this->assertStringContainsString('31', $message);
    }

    /** @test */
    public function a_return_dated_before_its_source_is_rejected(): void
    {
        // ليس «داخل المهلة» بل خارج المنطق — يُرفض ولو كانت المهلة واسعة.
        Settings::put('sales', ['return_window_days' => 365]);

        $this->ret($this->invoice('2026-06-01'), '2026-05-30')->assertStatus(422);
    }

    // ── النطاق ───────────────────────────────────────────────────

    /** @test */
    public function the_window_does_not_apply_without_a_source(): void
    {
        // المرتجع الحرّ بلا مرجعٍ زمني يُقاس عليه.
        Settings::put('sales', ['return_window_days' => 1]);

        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'return_date' => '2027-01-01',
            'items' => [[
                'product_id' => $this->product->id, 'quantity' => 1,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();
    }

    /** @test */
    public function the_sales_window_does_not_govern_purchase_returns(): void
    {
        // مفتاحان لا مفتاح: قد تضع المؤسسة مهلةً لعملائها ولا تخضع لمهلةٍ
        // مع مورّديها.
        Settings::put('sales', ['return_window_days' => 1]);

        $this->ret($this->purchase('2026-01-01'), '2026-06-01')->assertCreated();
    }

    /** @test */
    public function the_purchase_window_governs_purchase_returns(): void
    {
        Settings::put('purchases', ['return_window_days' => 30]);

        $this->ret($this->purchase('2026-01-01'), '2026-01-20')->assertCreated();
        $this->ret($this->purchase('2026-01-01'), '2026-03-01')->assertStatus(422);
    }

    // ── الترحيل ──────────────────────────────────────────────────

    /** @test */
    public function a_draft_inside_the_window_still_posts_after_the_window_passes(): void
    {
        // المهلة تُقاس بـ**تاريخ المرتجع** المخزَّن لا بلحظة الترحيل، فمسوّدةٌ
        // صحيحة لا تصير باطلة بمرور الوقت وحده.
        Settings::put('sales', ['return_window_days' => 14]);

        $id = $this->ret($this->invoice('2026-01-01'), '2026-01-05')
            ->assertCreated()->json('data.id');

        $this->postJson("/api/returns/{$id}/post")->assertOk();
        $this->assertSame('posted', ReturnDocument::findOrFail($id)->status);
    }

    /** @test */
    public function tightening_the_policy_blocks_posting_an_existing_draft(): void
    {
        // والعكس مقصود: مسوّدةٌ صارت خارج المهلة الجديدة لا تُرحَّل — الحارس
        // يُعاد عند الترحيل، فلا يمرّ ما لم يعد مقبولاً بالسياسة القائمة.
        $id = $this->ret($this->invoice('2026-01-01'), '2026-03-01')
            ->assertCreated()->json('data.id');

        Settings::put('sales', ['return_window_days' => 14]);

        $this->postJson("/api/returns/{$id}/post")->assertStatus(422);
        $this->assertSame('draft', ReturnDocument::findOrFail($id)->status);
    }
}

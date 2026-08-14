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
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  مرتجع من مستند مصدر — الحدّ والسقف
 * ═══════════════════════════════════════════════════════════════
 *  قراران مفصولان بالمعيار: «هل الخيار الآخر يُنتج بياناتٍ مختلفة أم خاطئة؟»
 *
 *  • **صحّة تقنية (منعٌ صارم):** مستندٌ يعلن مرجعاً لا يناقضه — لا كمية تتجاوز
 *    المبيع (تراكمياً)، ولا سعرَ ردٍّ يتجاوز سعر البيع (ربح وهمي).
 *  • **سياسة (مفتاح):** إلزام وجود مصدر أصلاً — التجزئة تريده والخدمات لا.
 *
 *  تشغيل:  php artisan test --filter=ReturnFromSourceTest
 */
class ReturnFromSourceTest extends TestCase
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

    /** فاتورة مبيعات مرحَّلة: ٥ × ١٠٠٫٠٠ من الصنف. */
    private function invoice(array $items = null): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            $items ?? [['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function purchase(): Purchase
    {
        $p = app(PurchaseService::class)->create(
            ['partner_id' => $this->supplier->id, 'payment_type' => 'credit'],
            [['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 15]]
        );

        return app(PurchaseService::class)->post($p);
    }

    /** إنشاء مرتجع عبر الـ API — مسار الشاشة حرفياً. */
    private function ret(array $items, array $head = [])
    {
        return $this->postJson('/api/returns', array_merge([
            'type'         => 'sales',
            'partner_id'   => $this->customer->id,
            'payment_type' => 'credit',
            'items'        => $items,
        ], $head));
    }

    private function line(Invoice|Purchase $doc): object
    {
        return $doc->lines()->first();
    }

    // ── الكمية: صحّة تقنية ───────────────────────────────────────

    /** @test */
    public function returning_within_the_invoiced_quantity_is_accepted(): void
    {
        $invoice = $this->invoice();
        $line    = $this->line($invoice);

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $line->id,
            'quantity' => 3, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated();

        $this->assertSame($invoice->id, ReturnDocument::firstOrFail()->original_id);
        $this->assertSame(Invoice::class, ReturnDocument::firstOrFail()->original_type);
    }

    /** @test */
    public function returning_more_than_invoiced_is_rejected(): void
    {
        $invoice = $this->invoice();

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 6, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);

        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function the_quantity_limit_is_cumulative_across_posted_returns(): void
    {
        // خمسةٌ لا تُرَدّ ثلاث مرات: ٣ ثم ٣ يتجاوزان المبيع.
        $invoice = $this->invoice();
        $lineId  = $this->line($invoice)->id;

        $first = $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $lineId,
            'quantity' => 3, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$first}/post")->assertOk();

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $lineId,
            'quantity' => 3, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);

        // والمتبقي (٢) يُقبل.
        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $lineId,
            'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated();
    }

    /** @test */
    public function two_drafts_do_not_both_post_beyond_the_limit(): void
    {
        // المسوّدة لا تحجز كميةً (فلا تُقفل مسوّدةٌ منسيّة ردّاً مشروعاً)،
        // فالحارس يُعاد عند الترحيل — وإلا مرّت الثانية.
        $invoice = $this->invoice();
        $lineId  = $this->line($invoice)->id;

        $items = [[
            'product_id' => $this->product->id, 'source_line_id' => $lineId,
            'quantity' => 4, 'unit_price' => 10000, 'tax_rate' => 15,
        ]];

        $a = $this->ret($items, ['original_id' => $invoice->id])->assertCreated()->json('data.id');
        $b = $this->ret($items, ['original_id' => $invoice->id])->assertCreated()->json('data.id');

        $this->postJson("/api/returns/{$a}/post")->assertOk();
        $this->postJson("/api/returns/{$b}/post")->assertStatus(422);
    }

    /** @test */
    public function the_same_product_on_two_invoice_lines_is_limited_per_line(): void
    {
        // هذا ما يعجز عنه الربط على الرأس وحده: ٥ بـ١٠٠٫٠٠ و٣ بـ٨٠٫٠٠.
        $invoice = $this->invoice([
            ['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15],
            ['product_id' => $this->product->id, 'quantity' => 3, 'unit_price' => 8000, 'tax_rate' => 15],
        ]);
        $cheap = $invoice->lines()->where('unit_price', 8000)->firstOrFail();

        // ٨ من السطر الرخيص (٣ فقط) مرفوضة رغم أن المجموع المباع ٨.
        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $cheap->id,
            'quantity' => 8, 'unit_price' => 8000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);

        // وسعر السطر الغالي على السطر الرخيص مرفوض كذلك.
        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $cheap->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);
    }

    // ── السعر: سقفٌ لا تثبيت ─────────────────────────────────────

    /** @test */
    public function a_return_price_above_the_invoiced_price_is_rejected(): void
    {
        $invoice = $this->invoice();

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 1, 'unit_price' => 12000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);
    }

    /** @test */
    public function a_partial_refund_below_the_invoiced_price_is_allowed(): void
    {
        // الردّ بأقلّ استردادٌ جزئي مشروع (رسوم إعادة تخزين مثلاً).
        $invoice = $this->invoice();

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 1, 'unit_price' => 9000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated();
    }

    // ── سلامة الرابط ─────────────────────────────────────────────

    /** @test */
    public function a_source_belonging_to_another_partner_is_rejected(): void
    {
        $invoice = $this->invoice();
        $other   = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id, 'partner_id' => $other->id])->assertStatus(422);
    }

    /** @test */
    public function a_draft_source_cannot_be_returned_against(): void
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $this->product->id, 'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15]]
        );

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $draft->lines()->first()->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $draft->id])->assertStatus(422);
    }

    /** @test */
    public function a_line_from_a_different_document_is_rejected(): void
    {
        $a = $this->invoice();
        $b = $this->invoice();

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($b)->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $a->id])->assertStatus(422);
    }

    /** @test */
    public function a_linked_return_requires_a_source_line_on_every_item(): void
    {
        $invoice = $this->invoice();

        $this->ret([[
            'product_id' => $this->product->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertStatus(422);
    }

    /** @test */
    public function a_purchase_return_is_limited_by_its_purchase(): void
    {
        $purchase = $this->purchase();

        $head = [
            'type' => 'purchase', 'partner_id' => $this->supplier->id,
            'original_id' => $purchase->id,
        ];

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($purchase)->id,
            'quantity' => 9, 'unit_price' => 4000, 'tax_rate' => 15,
        ]], $head)->assertStatus(422);

        $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($purchase)->id,
            'quantity' => 5, 'unit_price' => 4000, 'tax_rate' => 15,
        ]], $head)->assertCreated();
    }

    // ── السياسة: إلزام المصدر ────────────────────────────────────

    /** @test */
    public function a_free_return_without_a_source_is_allowed_by_default(): void
    {
        // الافتراض هو سلوك اليوم حرفياً — لا يتعطّل مستأجر قائم بترقية.
        $this->assertFalse(Settings::get('sales', 'require_return_source'));

        $this->ret([[
            'product_id' => $this->product->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]])->assertCreated();
    }

    /** @test */
    public function enabling_the_policy_rejects_a_return_without_a_source(): void
    {
        Settings::put('sales', ['require_return_source' => true]);

        $this->ret([[
            'product_id' => $this->product->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
        ]])->assertStatus(422);
    }

    /** @test */
    public function the_sales_policy_does_not_govern_purchase_returns(): void
    {
        // مفتاحان لا مفتاح: قد تُلزِم المؤسسةُ إيصالاً لردّ عميلها ولا تُلزِم
        // فاتورةً لردّها على مورّدها.
        Settings::put('sales', ['require_return_source' => true]);

        $this->ret([[
            'product_id' => $this->product->id,
            'quantity' => 1, 'unit_price' => 4000, 'tax_rate' => 15,
        ]], ['type' => 'purchase', 'partner_id' => $this->supplier->id])->assertCreated();
    }

    // ── نقطة السحب ───────────────────────────────────────────────

    /** @test */
    public function the_returnable_endpoint_reports_remaining_quantities(): void
    {
        $invoice = $this->invoice();
        $lineId  = $this->line($invoice)->id;

        $first = $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $lineId,
            'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$first}/post")->assertOk();

        $this->getJson("/api/returns/returnable/sales/{$invoice->id}")
            ->assertOk()
            ->assertJsonPath('data.lines.0.quantity', 5)
            ->assertJsonPath('data.lines.0.returned', 2)
            ->assertJsonPath('data.lines.0.remaining', 3)
            ->assertJsonPath('data.lines.0.unit_price', '100.00')
            ->assertJsonPath('data.fully_returned', false);
    }

    /** @test */
    public function a_fully_returned_document_reports_zero_remaining(): void
    {
        $invoice = $this->invoice();

        $id = $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $this->getJson("/api/returns/returnable/sales/{$invoice->id}")
            ->assertOk()
            ->assertJsonPath('data.lines.0.remaining', 0)
            ->assertJsonPath('data.fully_returned', true);
    }

    /** @test */
    public function the_pulled_line_falls_back_to_the_product_name(): void
    {
        // سطرٌ عنوانه «—» في شاشة الردّ يجعل المستخدم يردّ صنفاً لا يعرفه.
        $invoice = $this->invoice();

        $this->getJson("/api/returns/returnable/sales/{$invoice->id}")
            ->assertOk()
            ->assertJsonPath('data.lines.0.description', 'بضاعة');
    }

    /** @test */
    public function the_returnable_endpoint_refuses_a_draft_document(): void
    {
        $draft = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000]]
        );

        $this->getJson("/api/returns/returnable/sales/{$draft->id}")->assertStatus(422);
    }

    /** @test */
    public function another_tenants_document_is_not_returnable(): void
    {
        $other = Tenant::create(['name' => 'آخر', 'slug' => 'other', 'currency' => 'SAR']);
        $ctx   = app(TenantContext::class);
        $ctx->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $theirCustomer = Partner::create(['name' => 'عميلهم', 'type' => 'customer']);
        $theirProduct  = Product::create(['name' => 'بضاعتهم', 'track_inventory' => false]);
        $theirs = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $theirCustomer->id, 'payment_type' => 'credit'],
            [['product_id' => $theirProduct->id, 'quantity' => 1, 'unit_price' => 10000]]
        ));
        $ctx->set($this->tenant->id);

        $this->getJson("/api/returns/returnable/sales/{$theirs->id}")->assertNotFound();
    }

    // ── قائمة المستندات القابلة للردّ ────────────────────────────

    /** @test */
    public function the_sources_endpoint_lists_only_this_partners_posted_documents(): void
    {
        $mine = $this->invoice();

        // فاتورة عميلٍ آخر، وأخرى مسوّدة — كلتاهما خارج القائمة.
        $other = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);
        app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $other->id, 'payment_type' => 'credit'],
            [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000]]
        ));
        app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000]]
        );

        $data = $this->getJson("/api/returns/sources/sales?partner_id={$this->customer->id}")
            ->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertSame($mine->id, $data[0]['id']);
        $this->assertSame(5, $data[0]['remaining']);
        $this->assertNull($data[0]['blocked_reason']);
    }

    /** @test */
    public function a_fully_returned_document_is_listed_with_its_reason(): void
    {
        // يُعرَض ولا يُخفى: إخفاء فاتورةٍ يعرف المستخدم رقمها يجعله يظنّ أنه
        // أخطأ فيه بدل أن يعرف أنها رُدَّت.
        $invoice = $this->invoice();

        $id = $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 5, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id])->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $data = $this->getJson("/api/returns/sources/sales?partner_id={$this->customer->id}")
            ->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertSame(0, $data[0]['remaining']);
        $this->assertSame('fully_returned', $data[0]['blocked_reason']);
    }

    /** @test */
    public function a_document_past_its_window_is_listed_with_its_reason(): void
    {
        Settings::put('sales', ['return_window_days' => 14]);
        $this->invoice(); // بتاريخ اليوم — داخل المهلة

        $old = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit',
             'invoice_date' => now()->subDays(90)->toDateString()],
            [['product_id' => $this->product->id, 'quantity' => 1, 'unit_price' => 10000]]
        ));

        $data = collect($this->getJson("/api/returns/sources/sales?partner_id={$this->customer->id}")
            ->assertOk()->json('data'))->keyBy('id');

        $this->assertSame('out_of_window', $data[$old->id]['blocked_reason']);
        $this->assertSame(90, $data[$old->id]['elapsed_days']);
    }

    /** @test */
    public function fully_returned_outranks_out_of_window_as_a_reason(): void
    {
        // سببٌ واحد يكفي، والنهائي أسبق من القابل للتفاوض خارج النظام.
        Settings::put('sales', ['return_window_days' => 14]);

        $invoice = app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit',
             'invoice_date' => now()->subDays(90)->toDateString()],
            [['product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 10000]]
        ));

        // ردٌّ كاملٌ بتاريخٍ داخل المهلة وقتها
        $id = $this->ret([[
            'product_id' => $this->product->id, 'source_line_id' => $this->line($invoice)->id,
            'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15,
        ]], ['original_id' => $invoice->id, 'return_date' => now()->subDays(85)->toDateString()])
            ->assertCreated()->json('data.id');
        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $data = $this->getJson("/api/returns/sources/sales?partner_id={$this->customer->id}")
            ->assertOk()->json('data');

        $this->assertSame('fully_returned', $data[0]['blocked_reason']);
    }

    /** @test */
    public function the_sources_endpoint_returns_nothing_without_a_partner(): void
    {
        $this->invoice();

        $this->getJson('/api/returns/sources/sales')->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function another_tenants_documents_never_appear(): void
    {
        $other = Tenant::create(['name' => 'آخر', 'slug' => 'other', 'currency' => 'SAR']);
        $ctx   = app(TenantContext::class);
        $ctx->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $theirCustomer = Partner::create(['name' => 'عميلهم', 'type' => 'customer']);
        $theirProduct  = Product::create(['name' => 'بضاعتهم', 'track_inventory' => false]);
        app(InvoiceService::class)->post(app(InvoiceService::class)->create(
            ['partner_id' => $theirCustomer->id, 'payment_type' => 'credit'],
            [['product_id' => $theirProduct->id, 'quantity' => 1, 'unit_price' => 10000]]
        ));
        $ctx->set($this->tenant->id);

        $this->getJson("/api/returns/sources/sales?partner_id={$theirCustomer->id}")
            ->assertOk()->assertJsonPath('data', []);
    }

    /** @test */
    public function purchase_sources_follow_the_purchase_window(): void
    {
        Settings::put('sales', ['return_window_days' => 1]);      // لا يحكمها
        Settings::put('purchases', ['return_window_days' => 30]);

        $purchase = $this->purchase();

        $data = $this->getJson("/api/returns/sources/purchase?partner_id={$this->supplier->id}")
            ->assertOk()->json('data');

        $this->assertCount(1, $data);
        $this->assertNull($data[0]['blocked_reason']);
        $this->assertSame($purchase->number, $data[0]['number']);
    }

    // ── ما لم يتغيّر ─────────────────────────────────────────────

    /** @test */
    public function an_unlinked_return_keeps_working_untouched(): void
    {
        $id = $this->ret([[
            'product_id' => $this->product->id,
            'quantity' => 2, 'unit_price' => 10000, 'tax_rate' => 15,
        ]])->assertCreated()->json('data.id');

        $this->postJson("/api/returns/{$id}/post")->assertOk();

        $return = ReturnDocument::findOrFail($id);
        $this->assertNull($return->original_id);
        $this->assertSame('posted', $return->status);
        $this->assertSame(102, $this->product->fresh()->quantity_on_hand); // البضاعة عادت
    }
}

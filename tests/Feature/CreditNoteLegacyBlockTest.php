<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\CreditNoteLegacyReview;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PosReturnService;
use App\Services\TenantApplicationService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use ReflectionMethod;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — حظر محدّد للإشعارات التاريخية غير القابلة للربط + مسار مراجعة المالية
 * ═══════════════════════════════════════════════════════════════
 *  إشعارٌ دائن مرحَّل سبق REM-02 بلا `source_line_id`: يُنسب آلياً إن كان منتجه سطراً
 *  وحيداً في الفاتورة (يُحتسب في السقف). وإلا (بلا منتج / منتج متكرر) لا يُخمَّن، وتُحظر
 *  العمليات المتأثرة على تلك الفاتورة وحدها (إشعار دائن، مرتجع API، مرتجع POS) حتى تحسمه
 *  المالية بقرارٍ مكتوب (`credit-notes:legacy-resolve`) — دون تعديل أي مستند مرحَّل.
 *
 *  تشغيل:  php artisan test --filter=CreditNoteLegacyBlockTest
 */
class CreditNoteLegacyBlockTest extends TestCase
{
    use RefreshDatabase;

    private const REASON = 'مراجعة المالية: التسوية تخص هذا البند فقط';

    protected Tenant $tenant;
    protected User $user;
    protected Partner $customer;
    protected Product $service;

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
        $this->service  = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
        $this->user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@nibras.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($this->user);
    }

    public function call($method, $uri, $parameters = [], $cookies = [], $files = [], $server = [], $content = null)
    {
        $tenant = app(TenantContext::class);
        $setup = $tenant->id();

        try {
            return parent::call($method, $uri, $parameters, $cookies, $files, $server, $content);
        } finally {
            $setup === null ? $tenant->forget() : $tenant->set($setup);
        }
    }

    // ── أدوات ────────────────────────────────────────────────────

    private function sale(array $items, ?Partner $customer = null): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(['partner_id' => ($customer ?? $this->customer)->id, 'payment_type' => 'credit'], $items);

        return $svc->post($invoice);
    }

    private function item(int $qty, int $price, ?Product $product = null): array
    {
        return ['product_id' => ($product ?? $this->service)->id, 'quantity' => $qty, 'unit_price' => $price, 'tax_rate' => 15];
    }

    /** إشعار دائن مرحَّل قديم (قبل REM-02): مربوط بالفاتورة، وأسطره بلا source_line_id. */
    private function legacyNote(Invoice $invoice, ?string $productId, int $qty = 1, int $net = 10000): CreditNoteLine
    {
        $note = CreditNote::create([
            'number' => 'CN-OLD-'.uniqid(), 'type' => 'sales', 'partner_id' => $invoice->partner_id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'posted',
            'original_invoice_id' => $invoice->id, 'subtotal' => $net, 'tax_amount' => intdiv($net * 15, 100), 'total' => $net + intdiv($net * 15, 100),
        ]);

        return CreditNoteLine::create([
            'credit_note_id' => $note->id, 'product_id' => $productId, 'description' => 'تسوية قديمة',
            'quantity' => $qty, 'unit_price' => intdiv($net, max(1, $qty)), 'tax_rate' => 15,
            'line_subtotal' => $net, 'line_tax' => intdiv($net * 15, 100), 'line_total' => $net + intdiv($net * 15, 100),
        ]);
    }

    private function noteAttempt(Invoice $invoice, int $qty = 1)
    {
        return $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]],
        ]);
    }

    private function returnAttempt(Invoice $invoice, int $qty = 1)
    {
        $line = $invoice->lines->first();

        return $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [['product_id' => $line->product_id, 'source_line_id' => $line->id, 'quantity' => $qty, 'unit_price' => (int) $line->unit_price]],
        ]);
    }

    private function posDerive(Invoice $invoice, int $qty = 1): array
    {
        $service = app(PosReturnService::class);
        $derive = new ReflectionMethod($service, 'buildSourceItems');
        $derive->setAccessible(true);

        return $derive->invoke($service, $invoice->fresh('lines'), [['source_line_id' => $invoice->lines->first()->id, 'quantity' => $qty]]);
    }

    private function resolve(CreditNoteLine $line, array $options): int
    {
        return $this->artisan('credit-notes:legacy-resolve', array_merge([
            'line' => $line->id, '--tenant' => $this->tenant->id, '--reason' => self::REASON, '--by' => $this->user->email,
        ], $options))->run();
    }

    private function assertBlocked(Invoice $invoice): void
    {
        $message = 'لا يُسمح بإشعار دائن أو مرتجع إضافي عليها حتى تراجعها المالية';
        $this->noteAttempt($invoice)->assertStatus(422)->assertJsonFragment(['message' => "على الفاتورة {$invoice->number} 1 سطر/أسطر إشعارٍ دائن مرحَّل قديم لا يُنسب إلى سطر بعينه في الفاتورة؛ {$message} (credit-notes:legacy-review)."]);
        $this->returnAttempt($invoice)->assertStatus(422);
        try {
            $this->posDerive($invoice);
            $this->fail('مرتجع POS يجب أن يُحظر.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString($message, $e->getMessage());
        }

        $source = collect($this->getJson("/api/returns/sources/sales?partner_id={$invoice->partner_id}")->assertOk()->json('data'))->firstWhere('id', $invoice->id);
        $this->assertSame('legacy_credit_review', $source['blocked_reason']);
        $this->getJson("/api/returns/returnable/sales/{$invoice->id}")->assertOk()->assertJsonPath('data.blocked_reason', 'legacy_credit_review');
    }

    // ═══════════════════════════════════════════════════════════
    //  الحظر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_legacy_line_without_a_product_blocks_every_further_reversal_on_that_invoice(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $this->legacyNote($invoice, null);

        $this->assertBlocked($invoice);
        $this->assertSame(0, CreditNote::where('status', 'draft')->count(), 'لم يُنشأ شيء.');
    }

    /** @test */
    public function a_legacy_line_whose_product_repeats_on_the_invoice_is_blocked_too(): void
    {
        $invoice = $this->sale([$this->item(2, 10000), $this->item(2, 20000)]);
        $this->legacyNote($invoice, $this->service->id);

        $this->assertBlocked($invoice);
    }

    /** @test */
    public function the_block_is_per_invoice_and_does_not_touch_other_invoices_or_attributable_lines(): void
    {
        $blocked = $this->sale([$this->item(3, 10000)]);
        $this->legacyNote($blocked, null);
        $other = $this->sale([$this->item(3, 10000)]);

        $this->noteAttempt($other)->assertCreated();
        $this->returnAttempt($other)->assertCreated();

        // سطر قديم بمنتجٍ وحيد في فاتورته يُنسب آلياً ويُحتسب، ولا يحظر.
        $attributable = $this->sale([$this->item(3, 10000)]);
        $this->legacyNote($attributable, $this->service->id);
        $this->noteAttempt($attributable, 3)->assertStatus(422)->assertJsonFragment(['message' => 'الكمية (3) تتجاوز المتبقي (2) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة.']);
        $this->noteAttempt($attributable, 2)->assertCreated();
    }

    // ═══════════════════════════════════════════════════════════
    //  مسار المراجعة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_review_report_lists_the_unresolved_line_with_candidate_lines_and_is_read_only(): void
    {
        $invoice = $this->sale([$this->item(2, 10000), $this->item(1, 5000, Product::create(['name' => 'ب', 'track_inventory' => false]))]);
        $legacy = $this->legacyNote($invoice, null, 1, 10000);
        $before = CreditNoteLegacyReview::count();

        $this->artisan('credit-notes:legacy-review', ['--tenant' => $this->tenant->id, '--json' => true])
            ->expectsOutputToContain($legacy->id)
            ->assertSuccessful();

        $this->assertSame($before, CreditNoteLegacyReview::count());
        $rows = app(\App\Services\Accounting\CreditNoteLegacyReviewService::class)->unresolved();
        $this->assertCount(1, $rows);
        $this->assertSame($invoice->number, $rows[0]['invoice_number']);
        $this->assertSame(10000, $rows[0]['net']);
        $this->assertCount(2, $rows[0]['candidate_lines']);
    }

    /** @test */
    public function attributing_the_line_lifts_the_block_and_counts_it_against_the_cap(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $line = $invoice->lines->first();
        $legacy = $this->legacyNote($invoice, null, 1, 10000);

        $this->assertSame(0, $this->resolve($legacy, ['--attribute-to' => $line->id]));

        // لم يعد محظوراً، لكن الوحدة المستهلكة تُحتسب: 3 − 1 = 2 متبقية.
        $this->noteAttempt($invoice, 3)->assertStatus(422)->assertJsonFragment(['message' => 'الكمية (3) تتجاوز المتبقي (2) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة.']);
        $this->noteAttempt($invoice, 2)->assertCreated();
        $this->returnAttempt($invoice, 1)->assertCreated();
        $source = collect($this->getJson("/api/returns/sources/sales?partner_id={$invoice->partner_id}")->json('data'))->firstWhere('id', $invoice->id);
        $this->assertNull($source['blocked_reason']);
    }

    /** @test */
    public function marking_the_line_not_applicable_lifts_the_block_without_counting_it(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, null);

        $this->assertSame(0, $this->resolve($legacy, ['--not-applicable' => true]));

        $this->noteAttempt($invoice, 3)->assertCreated(); // لا يستهلك سطراً
        $review = CreditNoteLegacyReview::sole();
        $this->assertSame(CreditNoteLegacyReview::NOT_APPLICABLE, $review->outcome);
        $this->assertNull($review->source_line_id);
        $this->assertSame($this->user->id, $review->reviewed_by);
        $this->assertSame(self::REASON, $review->reason);
    }

    /** @test */
    public function the_return_window_is_a_return_policy_not_a_credit_note_rule(): void
    {
        \App\Support\Settings::put('sales', ['return_window_days' => 1]);
        $invoice = $this->sale([$this->item(2, 10000)]);
        Invoice::query()->whereKey($invoice->id)->update(['invoice_date' => now()->subDays(30)->toDateString()]);

        // قائمة المصادر تعلّم الفاتورة خارج مهلة الردّ (للمرتجعات)…
        $source = collect($this->getJson("/api/returns/sources/sales?partner_id={$invoice->partner_id}")->assertOk()->json('data'))->firstWhere('id', $invoice->id);
        $this->assertSame('out_of_window', $source['blocked_reason']);

        // …والخادم يقبل الإشعار الدائن عليها (الشاشة لا تمنعه: noteBlockedReasonKey).
        $this->noteAttempt($invoice->fresh('lines'), 1)->assertCreated();
    }

    /** @test */
    public function resolving_never_modifies_any_posted_document(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, null);
        $snapshot = fn () => [
            CreditNote::orderBy('id')->get()->map->getAttributes()->all(),
            CreditNoteLine::orderBy('id')->get()->map->getAttributes()->all(),
            Invoice::orderBy('id')->get()->map->getAttributes()->all(),
        ];
        $before = $snapshot();

        $this->resolve($legacy, ['--attribute-to' => $invoice->lines->first()->id]);

        $this->assertSame($before, $snapshot(), 'قرار المراجعة طبقة تراكب: لا تعديل على الإشعار ولا أسطره ولا الفاتورة.');
    }

    /** @test */
    public function the_review_command_validates_every_input(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, null);
        $foreign = $this->sale([$this->item(1, 10000)]);

        // خياران معاً / لا خيار.
        $this->assertSame(2, $this->resolve($legacy, ['--attribute-to' => $invoice->lines->first()->id, '--not-applicable' => true]));
        $this->assertSame(2, $this->resolve($legacy, []));
        // سبب قصير، مراجِع مجهول.
        $this->assertSame(1, $this->resolve($legacy, ['--not-applicable' => true, '--reason' => 'قصير']));
        $this->assertSame(1, $this->resolve($legacy, ['--not-applicable' => true, '--by' => 'nobody@nowhere.test']));
        // سطر من فاتورةٍ أخرى.
        $this->assertSame(1, $this->resolve($legacy, ['--attribute-to' => $foreign->lines->first()->id]));
        // مستأجر غير صالح.
        $this->assertSame(2, $this->resolve($legacy, ['--not-applicable' => true, '--tenant' => 'not-a-uuid']));

        $this->assertSame(0, CreditNoteLegacyReview::count(), 'لم يُكتب أي قرار.');

        // سطرٌ محسوم لا يُحسم مرتين.
        $this->assertSame(0, $this->resolve($legacy, ['--not-applicable' => true]));
        $this->assertSame(1, $this->resolve($legacy, ['--not-applicable' => true]));
        $this->assertSame(1, CreditNoteLegacyReview::count());
    }

    /** @test */
    public function an_attributable_line_cannot_be_overridden_by_a_review(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, $this->service->id); // يُنسب آلياً: لا حاجة لمراجعة

        $this->assertSame(1, $this->resolve($legacy, ['--not-applicable' => true]));
        $this->assertSame(0, CreditNoteLegacyReview::count());
    }

    /** @test */
    public function review_decisions_are_append_only(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, null);
        $this->resolve($legacy, ['--not-applicable' => true]);
        $review = CreditNoteLegacyReview::sole();

        try {
            $review->update(['reason' => 'تعديل صامت لقرار سابق']);
            $this->fail('التعديل يجب أن يُرفض.');
        } catch (RuntimeException) {
        }
        try {
            $review->delete();
            $this->fail('الحذف يجب أن يُرفض.');
        } catch (RuntimeException) {
        }
        $this->assertSame(1, CreditNoteLegacyReview::count());
    }

    // ═══════════════════════════════════════════════════════════
    //  عزل المستأجرين
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function another_tenant_can_neither_see_nor_resolve_nor_be_blocked_by_a_legacy_line(): void
    {
        $invoice = $this->sale([$this->item(3, 10000)]);
        $legacy = $this->legacyNote($invoice, null);

        $other = Tenant::create(['name' => 'مستأجر آخر', 'slug' => 'other', 'vat_number' => '300000000000011', 'currency' => 'SAR']);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $otherUser = User::create(['tenant_id' => $other->id, 'name' => 'م', 'email' => 'admin@other.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner']);
        $otherCustomer = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);
        $otherProduct = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
        $otherInvoice = $this->sale([$this->item(2, 10000, $otherProduct)], $otherCustomer);
        $this->assertSame([], app(\App\Services\Accounting\CreditNoteLegacyReviewService::class)->unresolved(), 'تقرير المستأجر الآخر لا يرى سطرنا.');

        // قرارٌ على سطر مستأجرنا بسياق المستأجر الآخر: غير موجود.
        $this->artisan('credit-notes:legacy-resolve', [
            'line' => $legacy->id, '--tenant' => $other->id, '--not-applicable' => true,
            '--reason' => self::REASON, '--by' => $otherUser->email,
        ])->expectsOutputToContain('السطر غير موجود')->assertFailed();
        // ولا يُحظر مستندُ المستأجر الآخر بسببه.
        app(\App\Services\Accounting\ReturnSourceAllocator::class)->assertNoUnresolvedLegacyCredits($otherInvoice);

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, CreditNoteLegacyReview::count());
        $this->assertCount(1, app(\App\Services\Accounting\CreditNoteLegacyReviewService::class)->unresolved());
    }
}

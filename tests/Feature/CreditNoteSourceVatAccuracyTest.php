<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\CreditNote;
use App\Models\CreditNoteLine;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\TenantApplicationService;
use App\Support\Settings;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-02 — دقّة ضريبة الإشعار الدائن (VAT-02 · ACC-06)
 * ═══════════════════════════════════════════════════════════════
 *  الإشعار المرتبط بفاتورة مرحَّلة يرث **المحصَّل فعلاً** على سطرها (أساس صافٍ
 *  بعد خصم السطر وحصة خصم الرأس + ضريبة، في وضع الفاتورة) بدل إعادة حسابه من
 *  سعر العميل و15% ثابتة، ويُسقَّف تراكمياً **مع المرتجعات**.
 *
 *  ثابت الاختبارات المركزي: Σ(أساس/ضريبة/إجمالي) الإشعارات المرحَّلة على فاتورةٍ
 *  بعد استنفاد كمياتها = أساس/ضريبة/إجمالي الفاتورة هللةً بهللة، و2120 مدين =
 *  الضريبة المحصَّلة، والقيد متوازن.
 *
 *  تشغيل:  php artisan test --filter=CreditNoteSourceVatAccuracyTest
 */
class CreditNoteSourceVatAccuracyTest extends TestCase
{
    use RefreshDatabase;

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

    // ── أدوات ────────────────────────────────────────────────────

    /**
     * `SetTenant` ينسى المستأجر بعد كل طلب كما يفعل الإنتاج بين الطلبات؛ فيُعاد
     * سياق التهيئة بعده ليتابع الاختبار إنشاء مستنداتٍ بالخدمات مباشرة.
     * (بخلاف `InteractsWithApi` لا نُنسي حارس المصادقة: نعمل بـ`Sanctum::actingAs`.)
     */
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

    /** @param array<int, array<string,mixed>> $items */
    private function sale(array $items, array $head = []): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $head), $items);

        return $svc->post($invoice);
    }

    private function item(int $qty, int $unitPrice, int $rate = 15, int $discount = 0): array
    {
        return array_filter([
            'product_id' => $this->service->id,
            'quantity'   => $qty,
            'unit_price' => $unitPrice,
            'tax_rate'   => $rate,
            'discount'   => $discount ?: null,
        ], fn ($v) => $v !== null);
    }

    /**
     * بنود إشعار: [[سطر المصدر, الكمية, سعر?]]. العميل يرسل `tax_rate` مبالغاً فيه
     * عمداً — لا يُعتمد للحساب.
     *
     * @param  array<int, array{0:object,1:int,2?:int}>  $picks
     */
    private function lines(array $picks): array
    {
        return array_map(function (array $p) {
            $row = ['source_line_id' => $p[0]->id, 'quantity' => $p[1], 'tax_rate' => 100];
            if (isset($p[2])) {
                $row['unit_price'] = $p[2];
            }

            return $row;
        }, $picks);
    }

    private function noteResponse(Invoice $invoice, array $picks, array $extra = [], ?string $branchId = null)
    {
        $this->flushHeaders();
        if ($branchId !== null) {
            $this->withHeader('X-Branch-Id', $branchId);
        }

        return $this->postJson('/api/credit-notes', array_merge([
            'partner_id' => $invoice->partner_id,
            'original_invoice_id' => $invoice->id,
            'items' => $this->lines($picks),
        ], $extra));
    }

    /** إشعار عبر الـ API (إنشاء + ترحيل) — مسار الشاشة. */
    private function note(Invoice $invoice, array $picks, bool $post = true, array $extra = [], ?string $branchId = null): CreditNote
    {
        $id = $this->noteResponse($invoice, $picks, $extra, $branchId)->assertCreated()->json('data.id');

        if ($post) {
            $this->postJson("/api/credit-notes/{$id}/post")->assertOk();
        }
        $this->flushHeaders();

        return CreditNote::with('lines')->findOrFail($id);
    }

    /** @param array<int, CreditNote> $notes */
    private function totals(array $notes): array
    {
        return [
            'net'   => (int) array_sum(array_map(fn ($n) => (int) $n->subtotal, $notes)),
            'tax'   => (int) array_sum(array_map(fn ($n) => (int) $n->tax_amount, $notes)),
            'total' => (int) array_sum(array_map(fn ($n) => (int) $n->total, $notes)),
        ];
    }

    /** @return array<string, array{debit:int, credit:int}> */
    private function entry(CreditNote $note): array
    {
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', CreditNote::class)->where('source_id', $note->id)->sole();

        $out = [];
        foreach ($entry->lines as $line) {
            $code = $line->account->code;
            $out[$code]['debit']  = ($out[$code]['debit'] ?? 0) + (int) $line->debit;
            $out[$code]['credit'] = ($out[$code]['credit'] ?? 0) + (int) $line->credit;
        }

        return $out;
    }

    private function assertBalanced(CreditNote $note): void
    {
        $entry = JournalEntry::with('lines')
            ->where('source_type', CreditNote::class)->where('source_id', $note->id)->sole();
        $this->assertSame((int) $entry->lines->sum('debit'), (int) $entry->lines->sum('credit'));
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame((int) JournalLine::sum('debit'), (int) JournalLine::sum('credit'));
    }

    private function invoiceTotals(Invoice $invoice): array
    {
        return [
            'net'   => (int) $invoice->subtotal - (int) $invoice->discount,
            'tax'   => (int) $invoice->tax_amount,
            'total' => (int) $invoice->total,
        ];
    }

    // ═══════════════════════════════════════════════════════════
    //  الشامل / غير الشامل
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_note_against_an_inclusive_invoice_credits_exactly_the_charged_vat(): void
    {
        // VAT-02: 115.00 شاملة → صافي 100.00 + ضريبة 15.00. قبل الإصلاح: 115.00 + 17.25.
        $invoice = $this->sale([$this->item(1, 11500)], ['tax_inclusive' => true]);
        $this->assertSame(1500, (int) $invoice->tax_amount);

        $note = $this->note($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame([10000, 1500, 11500], [(int) $note->subtotal, (int) $note->tax_amount, (int) $note->total]);
        $line = $note->lines->first();
        $this->assertSame($invoice->lines->first()->id, $line->source_line_id);
        $this->assertSame(15, (int) $line->tax_rate, 'المعدل من سطر الفاتورة لا من الطلب (100).');

        $e = $this->entry($note);
        $this->assertSame(10000, $e['4110']['debit']);
        $this->assertSame(1500, $e['2120']['debit'], '2120 مدين = الضريبة المحصَّلة بالضبط.');
        $this->assertSame(11500, $e['1130']['credit']);
        $this->assertBalanced($note);
    }

    /** @test */
    public function a_note_against_an_exclusive_invoice_is_unchanged(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);

        $note = $this->note($invoice, [[$invoice->lines->first(), 2]]);

        $this->assertSame([20000, 3000, 23000], [(int) $note->subtotal, (int) $note->tax_amount, (int) $note->total]);
        $this->assertSame($this->invoiceTotals($invoice), $this->totals([$note]));
    }

    /** @test */
    public function the_probe_r4_over_credit_is_rejected(): void
    {
        // قبل الإصلاح: كمية 2 على فاتورة 1 شاملة ⇒ 264.50 وضريبة 34.50 تُرحَّل فعلاً.
        $invoice = $this->sale([$this->item(1, 11500)], ['tax_inclusive' => true]);

        $this->noteResponse($invoice, [[$invoice->lines->first(), 2]])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'الكمية (2) تتجاوز المتبقي (1) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة.']);

        $this->assertSame(0, CreditNote::count());
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->count());
    }

    /** @test */
    public function partial_and_repeated_notes_of_an_inclusive_line_sum_to_the_original_to_the_penny(): void
    {
        // 3 × 100.01 شاملة: صافٍ 260.90 وضريبة 39.13 (3 × 100.01 = 300.03).
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();
        $this->assertSame([26090, 3913, 30003], array_values($this->invoiceTotals($invoice)));

        $notes = [
            $this->note($invoice, [[$line, 1]]),
            $this->note($invoice, [[$line, 1]]),
            $this->note($invoice, [[$line, 1]]),
        ];

        $this->assertSame($this->invoiceTotals($invoice), $this->totals($notes));
        $this->assertBooksBalanced();
    }

    /** @test */
    public function seven_single_unit_notes_of_a_small_exclusive_line_sum_to_the_original_vat(): void
    {
        // 7 × 0.10: ضريبة السطر 0.11. إعادة الحساب لكل جزء (15% × 0.10 = 0.015 → 0.02) كانت تعطي 0.14.
        $invoice = $this->sale([$this->item(7, 10)]);
        $line = $invoice->lines->first();
        $this->assertSame(11, (int) $invoice->tax_amount);

        $notes = [];
        for ($i = 0; $i < 7; $i++) {
            $notes[] = $this->note($invoice, [[$line, 1]]);
        }

        $this->assertSame(11, $this->totals($notes)['tax'], 'Σ ضرائب الأجزاء = ضريبة الفاتورة (7 × 0.10 → 0.11 لا 0.14).');
        $this->assertSame($this->invoiceTotals($invoice), $this->totals($notes));
    }

    /** @test */
    public function the_split_order_does_not_change_the_total(): void
    {
        $invoice = $this->sale([$this->item(5, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $notes = [
            $this->note($invoice, [[$line, 3]]),
            $this->note($invoice, [[$line, 1]]),
            $this->note($invoice, [[$line, 1]]),
        ];

        $this->assertSame($this->invoiceTotals($invoice), $this->totals($notes));
    }

    // ═══════════════════════════════════════════════════════════
    //  الخصومات: السطر والرأس
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_note_against_a_header_discounted_invoice_credits_the_discounted_vat(): void
    {
        // 100.00 بخصم رأس 10.00 → ضريبة 13.50 وإجمالي 103.50 (لا 115.00).
        $invoice = $this->sale([$this->item(1, 10000)], ['discount' => 1000]);
        $this->assertSame(1350, (int) $invoice->tax_amount);

        $note = $this->note($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame([9000, 1350, 10350], [(int) $note->subtotal, (int) $note->tax_amount, (int) $note->total]);
        $e = $this->entry($note);
        $this->assertSame(9000, $e['4110']['debit']);
        $this->assertSame(1350, $e['2120']['debit']);
        $this->assertSame(10350, $e['1130']['credit']);
        $this->assertBalanced($note);
    }

    /** @test */
    public function line_and_header_discounts_on_an_inclusive_multi_line_invoice_return_to_the_penny(): void
    {
        $invoice = $this->sale([
            $this->item(3, 11500, 15, 1500),
            $this->item(2, 5250, 5),
        ], ['tax_inclusive' => true, 'discount' => 777]);
        [$a, $b] = $invoice->lines->all();

        $n1 = $this->note($invoice, [[$a, 1], [$b, 1]]);
        $n2 = $this->note($invoice, [[$a, 2], [$b, 1]]);

        $this->assertSame($this->invoiceTotals($invoice), $this->totals([$n1, $n2]));
        $this->assertSame(
            (int) $n1->lines->sum('line_discount') + (int) $n2->lines->sum('line_discount'),
            (int) $invoice->lines->sum('line_discount') + 777,
            'خصم السطر + حصة الرأس يُنقلان كاملين إلى سطور الإشعارات.'
        );
        $this->assertBooksBalanced();
    }

    // ═══════════════════════════════════════════════════════════
    //  معدلات الضريبة الافتراضية
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_sourced_note_inherits_the_invoice_rate_after_the_default_rate_changes(): void
    {
        $invoice = $this->sale([$this->item(1, 10000, 15)]);

        Settings::put('sales', ['default_tax_rate' => 5]);

        $note = $this->note($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame(1500, (int) $note->tax_amount, 'المعدل المحصَّل 15% وإن صار الافتراضي 5%.');
        $this->assertSame(15, (int) $note->lines->first()->tax_rate);
    }

    /** @test */
    public function a_standalone_note_uses_the_configured_default_rate_not_a_hard_coded_15(): void
    {
        Settings::put('sales', ['allow_standalone_credit_notes' => true, 'default_tax_rate' => 5]);

        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000]], // بلا tax_rate
        ])->assertCreated()->json('data.id');

        $note = CreditNote::with('lines')->findOrFail($id);
        $this->assertSame([10000, 500, 10500], [(int) $note->subtotal, (int) $note->tax_amount, (int) $note->total]);
        $this->assertSame(5, (int) $note->lines->first()->tax_rate);

        // والمعدل الصريح يبقى كما أُرسل.
        $explicit = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 0]],
        ])->assertCreated()->json('data');
        $this->assertSame('0.00', $explicit['tax_amount']);
    }

    /** @test */
    public function the_default_rate_still_defaults_to_15_when_unchanged(): void
    {
        Settings::put('sales', ['allow_standalone_credit_notes' => true]);

        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])->assertCreated()->json('data.id');

        $this->assertSame(1500, (int) CreditNote::findOrFail($id)->tax_amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  السقف التراكمي مع المرتجعات
    // ═══════════════════════════════════════════════════════════

    private function returnOf(Invoice $invoice, $line, int $qty, bool $post = true): ReturnDocument
    {
        $id = $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [[
                'product_id' => $line->product_id, 'source_line_id' => $line->id,
                'quantity' => $qty, 'unit_price' => (int) $line->unit_price,
            ]],
        ])->assertCreated()->json('data.id');

        if ($post) {
            $this->postJson("/api/returns/{$id}/post")->assertOk();
        }

        return ReturnDocument::with('lines')->findOrFail($id);
    }

    /** @test */
    public function notes_and_returns_share_one_cumulative_cap_and_sum_to_the_invoice(): void
    {
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $return = $this->returnOf($invoice, $line, 1);
        $note = $this->note($invoice, [[$line, 2]]);

        // المتبقي صفر: لا إشعار ولا مرتجع إضافي.
        $this->noteResponse($invoice, [[$line, 1]])->assertStatus(422);
        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [['product_id' => $line->product_id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => (int) $line->unit_price]],
        ])->assertStatus(422);

        $this->assertSame(
            $this->invoiceTotals($invoice),
            [
                'net'   => (int) $return->subtotal + (int) $note->subtotal,
                'tax'   => (int) $return->tax_amount + (int) $note->tax_amount,
                'total' => (int) $return->total + (int) $note->total,
            ]
        );
        $this->assertBooksBalanced();
    }

    /** @test */
    public function the_returnable_endpoint_counts_posted_notes_but_not_drafts(): void
    {
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $this->note($invoice, [[$line, 1]]);
        $this->note($invoice, [[$line, 1]], post: false); // مسوّدة لا تحجز

        $row = $this->getJson("/api/returns/returnable/sales/{$invoice->id}")->assertOk()->json('data.lines.0');

        $this->assertSame(3, $row['quantity']);
        $this->assertSame(1, $row['returned'], 'الإشعار المرحَّل يستهلك الكمية، والمسوّدة لا.');
        $this->assertSame(2, $row['remaining']);
        $this->assertSame('86.96', $row['returned_net']);
        $this->assertSame('173.94', $row['remaining_net']);
    }

    /** @test */
    public function the_return_source_list_reflects_credit_note_usage(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $find = fn () => collect($this->getJson("/api/returns/sources/sales?partner_id={$invoice->partner_id}")
            ->assertOk()->json('data'))->firstWhere('id', $invoice->id);

        $this->assertSame(2, $find()['remaining']);

        $this->note($invoice, [[$line, 1]]);
        $this->assertSame(1, $find()['remaining']);
        $this->assertNull($find()['blocked_reason']);

        $this->note($invoice, [[$line, 1]]);
        $this->assertSame(0, $find()['remaining']);
        $this->assertSame('fully_returned', $find()['blocked_reason'], 'فاتورة استُنفدت بإشعارات لا تُعرض صالحةً للردّ.');
    }

    /** @test */
    public function pos_style_return_derivation_counts_credit_notes_and_closes_the_vat_exactly(): void
    {
        // 7 × 0.10: ضريبة 0.11. إشعار بوحدة (0.01) ثم ردّ POS لما تبقّى (6): كان
        // يُشتقّ بـ floor(11×6/7)=0.09 فتبقى هللة بلا عكس؛ الآن يأخذ المتبقي الفعلي 0.10.
        $invoice = $this->sale([$this->item(7, 10)]);
        $line = $invoice->lines->first();
        $note = $this->note($invoice, [[$line, 1]]);
        $this->assertSame(1, (int) $note->tax_amount);

        $service = app(\App\Services\Accounting\PosReturnService::class);
        $derive = new \ReflectionMethod($service, 'buildSourceItems');
        $derive->setAccessible(true);

        $items = $derive->invoke($service, $invoice->fresh('lines'), [['source_line_id' => $line->id, 'quantity' => 6]]);
        $this->assertSame(10, $items[0]['line_tax_override']);
        $this->assertSame(11, (int) $note->tax_amount + $items[0]['line_tax_override'], 'Σ الإشعار + ردّ POS = ضريبة الفاتورة.');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تتجاوز المتبقي');
        $derive->invoke($service, $invoice->fresh('lines'), [['source_line_id' => $line->id, 'quantity' => 7]]);
    }

    /** @test */
    public function pos_style_derivation_after_a_note_on_a_header_discounted_invoice_never_exceeds_the_invoice(): void
    {
        // 2 × 100.00 بخصم رأس 20.00: صافٍ 180.00 وضريبة 27.00. إشعار بوحدة ثم ردّ POS للأخرى:
        // المجموع = الفاتورة بالضبط (كان يُشتقّ الجزء الأخير من الخام فيتجاوز).
        $invoice = $this->sale([$this->item(2, 10000)], ['discount' => 2000]);
        $line = $invoice->lines->first();
        $this->assertSame([18000, 2700], [(int) $invoice->subtotal - (int) $invoice->discount, (int) $invoice->tax_amount]);

        $note = $this->note($invoice, [[$line, 1]]);

        $service = app(\App\Services\Accounting\PosReturnService::class);
        $derive = new \ReflectionMethod($service, 'buildSourceItems');
        $derive->setAccessible(true);
        $item = $derive->invoke($service, $invoice->fresh('lines'), [['source_line_id' => $line->id, 'quantity' => 1]])[0];

        $posNet = $item['line_subtotal_override'] - $item['line_discount'];
        $this->assertSame(18000, (int) $note->subtotal + $posNet, 'Σ الأساس = صافي الفاتورة.');
        $this->assertSame(2700, (int) $note->tax_amount + $item['line_tax_override'], 'Σ الضريبة = ضريبة الفاتورة.');
    }

    /** @test */
    public function a_pos_final_part_does_not_sweep_the_amount_withheld_by_a_reduced_price_credit(): void
    {
        // 2 × 100.00: إشعار بوحدة بنصف السعر (50.00 + ضريبة 7.50) ثم ردّ POS للوحدة الأخيرة.
        // الفرق المحتجَز (50.00) قرارٌ تجاري لا يُردّ معها: 100.00 + 15.00 لا 150.00 + 22.50.
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();
        $note = $this->note($invoice, [[$line, 1, 5000]]);
        $this->assertSame([5000, 750], [(int) $note->subtotal, (int) $note->tax_amount]);

        $service = app(\App\Services\Accounting\PosReturnService::class);
        $derive = new \ReflectionMethod($service, 'buildSourceItems');
        $derive->setAccessible(true);
        $item = $derive->invoke($service, $invoice->fresh('lines'), [['source_line_id' => $line->id, 'quantity' => 1]])[0];

        $this->assertSame(10000, $item['line_subtotal_override'] - $item['line_discount']);
        $this->assertSame(1500, $item['line_tax_override']);
    }

    /** @test */
    public function a_note_first_then_a_return_is_also_capped(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $this->note($invoice, [[$line, 2]]);

        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [['product_id' => $line->product_id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 10000]],
        ])->assertStatus(422)->assertJsonFragment(['message' => 'الكمية المردودة (1) تتجاوز المتبقي من الفاتورة (0) لهذا البند.']);
    }

    /** @test */
    public function a_historically_over_credited_vat_is_never_credited_again(): void
    {
        // إشعار تاريخي مرحَّل (سبق الإصلاح) خصم كامل ضريبة السطر عن وحدة واحدة من اثنتين.
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $legacy = CreditNote::create([
            'number' => 'CN-LEGACY-1', 'type' => 'sales', 'partner_id' => $invoice->partner_id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'posted',
            'original_invoice_id' => $invoice->id,
        ]);
        CreditNoteLine::create([
            'credit_note_id' => $legacy->id, 'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            'line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 3000, 'line_total' => 13000,
        ]);

        $note = $this->note($invoice, [[$line, 1]]);

        $this->assertSame(0, (int) $note->tax_amount, 'ضريبة السطر استُنفدت: لا يُخصم أكثر مما حُصِّل.');
        $this->assertSame(10000, (int) $note->subtotal);
    }

    /** @test */
    public function a_legacy_posted_note_without_line_links_still_consumes_the_cap_when_attributable(): void
    {
        // إشعار مرحَّل سبق REM-02: بلا source_line_id لكن منتجه سطرٌ وحيد في الفاتورة.
        $invoice = $this->sale([$this->item(1, 10000)]);
        $line = $invoice->lines->first();

        $legacy = CreditNote::create([
            'number' => 'CN-LEGACY-2', 'type' => 'sales', 'partner_id' => $invoice->partner_id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'posted',
            'original_invoice_id' => $invoice->id,
        ]);
        CreditNoteLine::create([
            'credit_note_id' => $legacy->id, 'product_id' => $line->product_id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            'line_subtotal' => 10000, 'line_tax' => 1500, 'line_total' => 11500,
        ]);

        // لا إشعار جديد ولا مرتجع يعيدان خصم الوحدة نفسها.
        $this->noteResponse($invoice, [[$line, 1]])->assertStatus(422)
            ->assertJsonFragment(['message' => 'الكمية (1) تتجاوز المتبقي (0) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة.']);
        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [['product_id' => $line->product_id, 'source_line_id' => $line->id, 'quantity' => 1, 'unit_price' => 10000]],
        ])->assertStatus(422);

        $row = $this->getJson("/api/returns/returnable/sales/{$invoice->id}")->assertOk()->json('data.lines.0');
        $this->assertSame(0, $row['remaining']);
        $this->assertSame('100.00', $row['returned_net']);
    }

    /** @test */
    public function drafts_do_not_reserve_quantity_but_the_second_post_is_rejected_under_the_cap(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $first = $this->note($invoice, [[$line, 2]], post: false);
        $second = $this->note($invoice, [[$line, 2]], post: false);

        $this->postJson("/api/credit-notes/{$first->id}/post")->assertOk();
        $this->postJson("/api/credit-notes/{$second->id}/post")
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'الكمية (2) تتجاوز المتبقي (0) من سطر الفاتورة بعد المرتجعات والإشعارات السابقة.']);

        $this->assertSame('draft', $second->fresh()->status);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->where('source_id', $second->id)->count());
        $this->assertSame(1, JournalEntry::where('source_type', CreditNote::class)->count());
    }

    /** @test */
    public function the_post_time_rederivation_closes_the_remainder_across_two_drafts(): void
    {
        // مسوّدتان تُحسبان معاً كلٌّ لوحدها: الترحيل تحت القفل يجعل مجموعهما دقيقاً.
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $a = $this->note($invoice, [[$line, 1]], post: false);
        $b = $this->note($invoice, [[$line, 2]], post: false);
        $this->postJson("/api/credit-notes/{$b->id}/post")->assertOk();
        $this->postJson("/api/credit-notes/{$a->id}/post")->assertOk();

        $this->assertSame($this->invoiceTotals($invoice), $this->totals([$a->fresh(), $b->fresh()]));
    }

    // ═══════════════════════════════════════════════════════════
    //  السعر: يخفّض ولا يرفع
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_price_above_the_invoiced_price_is_rejected_and_below_scales_net_and_vat(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $this->noteResponse($invoice, [[$line, 1, 10001]])->assertStatus(422);

        $note = $this->note($invoice, [[$line, 1, 5000]]);
        $this->assertSame([5000, 750, 5750], [(int) $note->subtotal, (int) $note->tax_amount, (int) $note->total]);
    }

    /** @test */
    public function the_printed_line_carries_a_pre_tax_unit_price_that_reconciles_with_tax_and_total(): void
    {
        // فاتورة شاملة: unit_price المخزَّن 115.00 (مفتاح مقارنة السقف) والمطبوع يُظهر 100.00 قبل الضريبة.
        $invoice = $this->sale([$this->item(2, 11500)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $full = $this->note($invoice, [[$line, 1]]);
        $row = $this->getJson("/api/credit-notes/{$full->id}")->assertOk()->json('data.lines.0');
        $this->assertSame('115.00', $row['unit_price']);
        $this->assertSame('100.00', $row['unit_price_before_tax']);
        $this->assertSame('15.00', $row['line_tax']);
        $this->assertSame('115.00', $row['line_total']);

        // استرداد جزئي بنصف السعر: السعر قبل الضريبة يتناسب (50.00) والإجمالي 57.50.
        $half = $this->note($invoice, [[$line, 1, 5750]]);
        $row = $this->getJson("/api/credit-notes/{$half->id}")->assertOk()->json('data.lines.0');
        $this->assertSame('50.00', $row['unit_price_before_tax']);
        $this->assertSame('57.50', $row['line_total']);

        // إشعار مستقل: غير شامل، فالسعر قبل الضريبة = السعر.
        Settings::put('sales', ['allow_standalone_credit_notes' => true]);
        $standalone = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])->assertCreated()->json('data.lines.0');
        $this->assertSame('100.00', $standalone['unit_price_before_tax']);
    }

    /** @test */
    public function an_omitted_unit_price_defaults_to_the_invoiced_price(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);

        $note = $this->note($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame(10000, (int) $note->lines->first()->unit_price);
    }

    // ═══════════════════════════════════════════════════════════
    //  صحّة المصدر: مرحَّل، للعميل نفسه، سطره، المستأجر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_draft_invoice_is_not_a_valid_source(): void
    {
        $svc = app(InvoiceService::class);
        $draft = $svc->create(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], [$this->item(1, 10000)]);

        $this->noteResponse($draft->load('lines'), [[$draft->lines->first(), 1]])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'لا يُصدَر إشعار دائن على فاتورة غير مرحّلة.']);
    }

    /** @test */
    public function a_cancelled_invoice_is_not_a_valid_source(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);
        $invoice->update(['status' => 'cancelled']);

        $this->noteResponse($invoice, [[$invoice->lines->first(), 1]])->assertStatus(422);
    }

    /** @test */
    public function a_different_customer_cannot_credit_the_invoice(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);
        $other = Partner::create(['name' => 'عميل آخر', 'type' => 'customer']);

        $this->noteResponse($invoice, [[$invoice->lines->first(), 1]], ['partner_id' => $other->id])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'الفاتورة المصدر لا تخصّ عميل الإشعار.']);
        $this->assertSame(0, CreditNote::count());
    }

    /** @test */
    public function a_line_of_another_invoice_is_rejected(): void
    {
        $a = $this->sale([$this->item(1, 10000)]);
        $b = $this->sale([$this->item(1, 20000)]);

        $this->noteResponse($a, [[$b->lines->first(), 1]])
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'البند المحدَّد لا يخصّ الفاتورة المصدر.']);
    }

    /** @test */
    public function a_line_without_source_line_id_is_matched_by_product_only_when_unambiguous(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);
        $note = $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id,
            'items' => [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated();
        $this->assertSame($invoice->lines->first()->id, CreditNoteLine::where('credit_note_id', $note['data']['id'])->sole()->source_line_id);

        $twice = $this->sale([$this->item(1, 10000), $this->item(1, 20000)]);
        $this->postJson('/api/credit-notes', [
            'partner_id' => $twice->partner_id, 'original_invoice_id' => $twice->id,
            'items' => [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 10000]],
        ])->assertStatus(422)->assertJsonFragment(['message' => 'المنتج يتكرر في الفاتورة المصدر؛ حدّد سطره بـ source_line_id.']);

        $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id,
            'items' => [['description' => 'حرّ', 'quantity' => 1, 'unit_price' => 10000]],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_product_that_differs_from_the_source_line_is_rejected(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);
        $other = Product::create(['name' => 'منتج آخر', 'track_inventory' => false]);

        $this->postJson('/api/credit-notes', [
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id,
            'items' => [['source_line_id' => $invoice->lines->first()->id, 'product_id' => $other->id, 'quantity' => 1]],
        ])->assertStatus(422)->assertJsonFragment(['message' => 'منتج بند الإشعار لا يطابق منتج سطر الفاتورة المصدر.']);
    }

    /** @test */
    public function a_foreign_tenant_invoice_is_not_found_and_leaks_nothing(): void
    {
        $foreignTenant = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'other', 'vat_number' => '300000000000011', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($foreignTenant->id);
        app(ChartOfAccountsSeeder::class)->seed($foreignTenant->id);
        $foreignCustomer = Partner::create(['name' => 'عميل أجنبي', 'type' => 'customer']);
        $foreignProduct = Product::create(['name' => 'خدمة', 'track_inventory' => false]);
        $svc = app(InvoiceService::class);
        $foreign = $svc->post($svc->create(
            ['partner_id' => $foreignCustomer->id, 'payment_type' => 'credit'],
            [['product_id' => $foreignProduct->id, 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]]
        ));
        $foreignLineId = $foreign->lines->first()->id;
        $foreignInvoiceId = $foreign->id;

        app(TenantContext::class)->set($this->tenant->id);

        $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'original_invoice_id' => $foreignInvoiceId,
            'items' => [['source_line_id' => $foreignLineId, 'quantity' => 1]],
        ])->assertNotFound();

        // وسطرٌ أجنبي مع فاتورة محلية: يُرفض كذلك (السطر لا يخصّ الفاتورة).
        $local = $this->sale([$this->item(1, 10000)]);
        $this->noteResponse($local, [[(object) ['id' => $foreignLineId], 1]])->assertStatus(422);
        $this->assertSame(0, CreditNote::count());
    }

    // ═══════════════════════════════════════════════════════════
    //  الفروع
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_branch_restricted_user_cannot_use_show_or_post_notes_or_invoices_of_another_branch(): void
    {
        $a = Branch::create(['code' => '00002', 'name' => 'فرع أ', 'is_main' => false]);
        $b = Branch::create(['code' => '00003', 'name' => 'فرع ب', 'is_main' => false]);

        app(BranchContext::class)->set($b->id);
        $invoiceB = $this->sale([$this->item(1, 10000)]);
        $this->assertSame($b->id, $invoiceB->branch_id);
        $noteB = $this->note($invoiceB, [[$invoiceB->lines->first(), 1]], post: false, branchId: $b->id);
        $this->assertSame($b->id, $noteB->branch_id);

        $restricted = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'محدود', 'email' => 'branch-a@nibras.sa',
            'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        $restricted->branches()->sync([$a->id]);
        Sanctum::actingAs($restricted);
        $this->flushHeaders();

        // فاتورة فرع آخر ⇒ 404 غير مُسرِّب، لا إنشاء.
        $this->noteResponse($invoiceB, [[$invoiceB->lines->first(), 1]])->assertNotFound();
        $this->assertSame(1, CreditNote::count());

        // إشعار فرع آخر: لا عرض ولا ترحيل.
        $this->getJson("/api/credit-notes/{$noteB->id}")->assertNotFound();
        $this->postJson("/api/credit-notes/{$noteB->id}/post")->assertNotFound();
        $this->assertSame('draft', $noteB->fresh()->status);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->count());
    }

    /** @test */
    public function a_note_in_another_branch_shares_the_cumulative_cap_with_the_invoice_branch(): void
    {
        $a = Branch::create(['code' => '00002', 'name' => 'فرع البيع', 'is_main' => false]);
        $b = Branch::create(['code' => '00003', 'name' => 'فرع الإشعار', 'is_main' => false]);

        app(BranchContext::class)->set($a->id);
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        // بالخدمة مباشرة وبأرقام صريحة: فهرس ترقيم الإشعارات بلا فرع على SQLite فقد
        // شرط WHERE بعد إعادة بناء الجدول (علّة SQLite قائمة سبق توثيقها في REM-01؛
        // PostgreSQL سليم).
        $svc = app(CreditNoteService::class);
        $make = function (string $number, string $branchId) use ($svc, $invoice, $line) {
            app(BranchContext::class)->set($branchId);

            return $svc->post($svc->create([
                'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'number' => $number,
            ], [['source_line_id' => $line->id, 'quantity' => 1]]));
        };

        $n1 = $make('CN-BR-B1', $b->id);
        $this->assertSame($b->id, $n1->branch_id, 'يوسم الإشعار بفرعه لا بفرع الفاتورة.');
        $n2 = $make('CN-BR-A1', $a->id);
        $this->assertSame($a->id, $n2->branch_id);

        try {
            $make('CN-BR-B2', $b->id);
            $this->fail('السقف مشترك عبر الفروع.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تتجاوز المتبقي', $e->getMessage());
        }
        $this->assertSame($this->invoiceTotals($invoice), $this->totals([$n1, $n2]));
    }

    // ═══════════════════════════════════════════════════════════
    //  ADR-E — الإشعار المستقل سياسةٌ تُضبط
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_standalone_note_is_refused_by_default_and_allowed_by_the_setting(): void
    {
        $payload = [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ];

        $this->assertFalse(Settings::get('sales', 'allow_standalone_credit_notes'));
        $this->postJson('/api/credit-notes', $payload)
            ->assertStatus(422)
            ->assertJsonFragment(['message' => 'إعدادات المبيعات تُلزِم ربط الإشعار الدائن بفاتورة مرحَّلة. فعّل «السماح بإشعار دائن مستقل» في إعدادات المبيعات لإصدار إشعار بلا فاتورة.']);
        $this->assertSame(0, CreditNote::count());

        $this->putJson('/api/sales-settings', ['allow_standalone_credit_notes' => true])->assertOk();
        $this->postJson('/api/credit-notes', $payload)->assertCreated();
    }

    /** @test */
    public function the_standalone_policy_does_not_touch_purchase_debit_notes(): void
    {
        $supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);

        $this->postJson('/api/credit-notes', [
            'partner_id' => $supplier->id, 'type' => 'purchase',
            'items' => [['quantity' => 1, 'unit_price' => 10000]],
        ])->assertCreated();
    }

    /** @test */
    public function posted_standalone_notes_remain_valid_when_the_policy_is_later_switched_off(): void
    {
        Settings::put('sales', ['allow_standalone_credit_notes' => true]);
        $id = $this->postJson('/api/credit-notes', [
            'partner_id' => $this->customer->id, 'type' => 'sales',
            'items' => [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]],
        ])->assertCreated()->json('data.id');

        Settings::put('sales', ['allow_standalone_credit_notes' => false]);

        // مسوّدة مستقلة سابقة تُرحَّل بالإجمالي المخزَّن كما هو (سياسة الإنشاء لا الترحيل).
        $this->postJson("/api/credit-notes/{$id}/post")->assertOk();
        $this->assertSame(11500, (int) CreditNote::findOrFail($id)->total);
    }

    // ═══════════════════════════════════════════════════════════
    //  توافق المسوّدات التاريخية المرتبطة بفاتورة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_historic_invoice_linked_draft_without_line_links_is_rederived_on_post(): void
    {
        // مسوّدة سبقت REM-02: مرتبطة بفاتورة شاملة، حُسبت بـ 15% فوق السعر الشامل (الخطأ).
        $invoice = $this->sale([$this->item(1, 11500)], ['tax_inclusive' => true]);
        $draft = CreditNote::create([
            'number' => 'CN-HIST-1', 'type' => 'sales', 'partner_id' => $invoice->partner_id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'draft',
            'original_invoice_id' => $invoice->id,
            'subtotal' => 11500, 'tax_amount' => 1725, 'total' => 13225,
        ]);
        CreditNoteLine::create([
            'credit_note_id' => $draft->id, 'product_id' => $this->service->id,
            'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15,
            'line_subtotal' => 11500, 'line_tax' => 1725, 'line_total' => 13225,
        ]);

        $this->postJson("/api/credit-notes/{$draft->id}/post")->assertOk();

        $draft = $draft->fresh('lines');
        $this->assertSame([10000, 1500, 11500], [(int) $draft->subtotal, (int) $draft->tax_amount, (int) $draft->total]);
        $this->assertSame($invoice->lines->first()->id, $draft->lines->first()->source_line_id);
        $this->assertSame(1500, $this->entry($draft)['2120']['debit']);
    }

    /** @test */
    public function a_historic_draft_that_cannot_be_mapped_is_refused_without_any_ledger_effect(): void
    {
        $invoice = $this->sale([$this->item(1, 10000), $this->item(1, 20000)]);
        $draft = CreditNote::create([
            'number' => 'CN-HIST-2', 'type' => 'sales', 'partner_id' => $invoice->partner_id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'draft',
            'original_invoice_id' => $invoice->id,
        ]);
        CreditNoteLine::create([
            'credit_note_id' => $draft->id, 'product_id' => $this->service->id,
            'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15,
            'line_subtotal' => 10000, 'line_tax' => 1500, 'line_total' => 11500,
        ]);

        $this->postJson("/api/credit-notes/{$draft->id}/post")->assertStatus(422);

        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame(0, JournalEntry::where('source_type', CreditNote::class)->count());
    }

    /** @test */
    public function posted_notes_are_never_rewritten_by_later_activity(): void
    {
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();
        $first = $this->note($invoice, [[$line, 1]]);
        $snapshot = $first->lines->map->only(['line_subtotal', 'line_discount', 'line_tax', 'line_total'])->all();

        $this->note($invoice, [[$line, 1]]);
        $this->note($invoice, [[$line, 1]]);

        $this->assertSame($snapshot, $first->fresh('lines')->lines->map->only(['line_subtotal', 'line_discount', 'line_tax', 'line_total'])->all());
        $this->expectException(RuntimeException::class);
        app(CreditNoteService::class)->post($first->fresh());
    }

    // ═══════════════════════════════════════════════════════════
    //  حذف الفاتورة المصدر
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_draft_invoice_referenced_by_a_historic_note_cannot_be_deleted(): void
    {
        $svc = app(InvoiceService::class);
        $draft = $svc->create(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], [$this->item(1, 10000)]);
        CreditNote::create([
            'number' => 'CN-HIST-3', 'type' => 'sales', 'partner_id' => $this->customer->id,
            'refund_type' => 'credit', 'note_date' => now()->toDateString(), 'status' => 'posted',
            'original_invoice_id' => $draft->id,
        ]);

        try {
            $svc->deleteDraft($draft);
            $this->fail('حذف فاتورة يشير إليها إشعار يجب أن يُرفض.');
        } catch (RuntimeException $e) {
            $this->assertSame('لا يمكن حذف فاتورة يشير إليها إشعار دائن.', $e->getMessage());
        }

        $this->assertNotNull(Invoice::find($draft->id));
        $this->assertSame($draft->id, CreditNote::where('number', 'CN-HIST-3')->value('original_invoice_id'));
    }
}

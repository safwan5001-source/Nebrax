<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PurchaseService;
use App\Services\Accounting\ReturnService;
use App\Services\TenantApplicationService;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  AWJ-TAX-REM-01 — دقّة ضريبة المرتجعات (VAT-01 · VAT-13)
 * ═══════════════════════════════════════════════════════════════
 *  المرتجع المرتبط بمصدر يرث **المحصَّل فعلاً** على سطر المصدر (أساس صافٍ +
 *  ضريبة، بعد خصم السطر وحصة خصم الرأس، ووضع الضريبة المتضمّن/غير المتضمّن)
 *  بدل إعادة حسابه من السعر الإجمالي المُرسَل. ولا يتجاوز مجموع المرتجعات أبداً
 *  أساس المصدر أو ضريبته أو إجماليه.
 *
 *  ثابت الاختبارات المركزي: بعد ردّ **كل** كميات مستندٍ بلا شحن ولا تسوية، يساوي
 *  Σ(أساس/ضريبة/إجمالي) المرتجعات المرحَّلة أساس/ضريبة/إجمالي المستند هللةً بهللة.
 *
 *  تشغيل:  php artisan test --filter=ReturnSourceVatAccuracyTest
 */
class ReturnSourceVatAccuracyTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected User $user;
    protected Partner $customer;
    protected Partner $supplier;
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
        $this->supplier = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        // بنود خدمية (بلا تتبع مخزون) لعزل الحساب الضريبي؛ والمخزون في اختبارٍ مستقل.
        $this->service = Product::create(['name' => 'خدمة', 'track_inventory' => false]);

        $this->user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'admin@nibras.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($this->user);
    }

    // ── أدوات ────────────────────────────────────────────────────

    /** @param array<int, array<string,mixed>> $items */
    private function sale(array $items, array $head = []): Invoice
    {
        $svc = app(InvoiceService::class);
        $invoice = $svc->create(array_merge(['partner_id' => $this->customer->id, 'payment_type' => 'credit'], $head), $items);

        return $svc->post($invoice);
    }

    /** @param array<int, array<string,mixed>> $items */
    private function purchaseDoc(array $items, array $head = []): Purchase
    {
        $svc = app(PurchaseService::class);
        $purchase = $svc->create(array_merge(['partner_id' => $this->supplier->id, 'payment_type' => 'credit'], $head), $items);

        return $svc->post($purchase);
    }

    private function item(int $qty, int $unitPrice, int $rate = 15, int $discount = 0, ?Product $product = null): array
    {
        return array_filter([
            'product_id' => ($product ?? $this->service)->id,
            'quantity'   => $qty,
            'unit_price' => $unitPrice,
            'tax_rate'   => $rate,
            'discount'   => $discount ?: null,
        ], fn ($v) => $v !== null);
    }

    /**
     * بنود مرتجع بكمياتها: [[سطر المصدر, الكمية, سعر الإرسال?]]. السعر الافتراضي
     * هو سعر المصدر الإجمالي — ما تعرضه الشاشة حرفياً.
     *
     * @param  array<int, array{0:object,1:int,2?:int}>  $picks
     */
    private function lines(array $picks): array
    {
        return array_map(fn (array $p) => [
            'product_id'     => $p[0]->product_id,
            'source_line_id' => $p[0]->id,
            'quantity'       => $p[1],
            'unit_price'     => $p[2] ?? (int) $p[0]->unit_price,
            'tax_rate'       => 15, // مُرسَلة عمداً: لا تُعتمد للحساب
        ], $picks);
    }

    /** مرتجع مبيعات عبر الـ API (إنشاء + ترحيل) — مسار الشاشة حرفياً. */
    private function apiReturn(Invoice $invoice, array $picks, bool $post = true): ReturnDocument
    {
        $id = $this->postJson('/api/returns', [
            'type'         => 'sales',
            'partner_id'   => $invoice->partner_id,
            'payment_type' => 'credit',
            'original_id'  => $invoice->id,
            'items'        => $this->lines($picks),
        ])->assertCreated()->json('data.id');

        if ($post) {
            $this->postJson("/api/returns/{$id}/post")->assertOk();
        }

        return ReturnDocument::with('lines')->findOrFail($id);
    }

    private function draft(Invoice|Purchase $doc, array $picks, string $type = 'sales', array $head = []): ReturnDocument
    {
        return app(ReturnService::class)->create(array_merge([
            'type'         => $type,
            'partner_id'   => $doc->partner_id,
            'payment_type' => 'credit',
            'original_id'  => $doc->id,
        ], $head), $this->lines($picks));
    }

    private function postDraft(ReturnDocument $return): ReturnDocument
    {
        return app(ReturnService::class)->post($return);
    }

    /** @return array<string, array{debit:int, credit:int}> بمفتاح كود الحساب */
    private function entry(ReturnDocument $return): array
    {
        $out = [];
        foreach (JournalEntry::with('lines.account')->findOrFail($return->fresh()->journal_entry_id)->lines as $line) {
            /** @var JournalLine $line */
            $code = $line->account->code;
            $out[$code] = [
                'debit'  => ($out[$code]['debit'] ?? 0) + (int) $line->debit,
                'credit' => ($out[$code]['credit'] ?? 0) + (int) $line->credit,
            ];
        }

        return $out;
    }

    private function assertBalanced(ReturnDocument $return): void
    {
        $e = $this->entry($return);
        $this->assertSame(
            array_sum(array_column($e, 'debit')),
            array_sum(array_column($e, 'credit')),
            'القيد العكسي يجب أن يتوازن.'
        );
    }

    private function assertBooksBalanced(): void
    {
        $this->assertSame(
            (int) JournalLine::sum('debit'),
            (int) JournalLine::sum('credit'),
            'مجموع المدين = مجموع الدائن في كل الدفتر.'
        );
    }

    private function totals(array $returns): array
    {
        $t = ['net' => 0, 'tax' => 0, 'total' => 0];
        foreach ($returns as $r) {
            $r = $r->fresh();
            $t['net'] += (int) $r->subtotal;
            $t['tax'] += (int) $r->tax_amount;
            $t['total'] += (int) $r->total;
        }

        return $t;
    }

    // ═══════════════════════════════════════════════════════════
    //  المبيعات: السعر المتضمّن / غير المتضمّن
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_full_return_of_an_inclusive_sale_reverses_exactly_the_charged_net_and_vat(): void
    {
        // VAT-01 / probe R2: 115.00 متضمّن → صافي 100.00 + ضريبة 15.00.
        // قبل الإصلاح كان المرتجع يُرحَّل 115.00 + 17.25 = 132.25.
        $invoice = $this->sale([$this->item(1, 11500)], ['tax_inclusive' => true]);
        $this->assertSame(1500, (int) $invoice->tax_amount);
        $this->assertSame(11500, (int) $invoice->total);

        $return = $this->apiReturn($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame(10000, (int) $return->subtotal);
        $this->assertSame(1500, (int) $return->tax_amount);
        $this->assertSame(11500, (int) $return->total);
        $this->assertTrue((bool) $return->tax_inclusive, 'المرتجع يرث وضع الضريبة من مصدره.');

        $e = $this->entry($return);
        $this->assertSame(10000, $e['4110']['debit']);
        $this->assertSame(1500, $e['2120']['debit'], '2120 مدين = الضريبة المحصَّلة بالضبط.');
        $this->assertSame(11500, $e['1130']['credit']);
        $this->assertBalanced($return);
    }

    /** @test */
    public function a_full_return_of_an_exclusive_sale_is_unchanged(): void
    {
        $invoice = $this->sale([$this->item(2, 10000)]);

        $return = $this->apiReturn($invoice, [[$invoice->lines->first(), 2]]);

        $this->assertSame(20000, (int) $return->subtotal);
        $this->assertSame(3000, (int) $return->tax_amount);
        $this->assertSame(23000, (int) $return->total);
        $this->assertFalse((bool) $return->tax_inclusive);
    }

    /** @test */
    public function partial_and_repeated_returns_of_an_inclusive_line_sum_to_the_original_to_the_penny(): void
    {
        // 3 × 100.01 متضمّن: إجمالي السطر 300.03 → ضريبة 39.13 وصافي 260.90.
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $this->assertSame(3913, (int) $invoice->tax_amount);
        $line = $invoice->lines->first();

        $r1 = $this->apiReturn($invoice, [[$line, 1]]);
        $r2 = $this->apiReturn($invoice, [[$line, 1]]);
        $r3 = $this->apiReturn($invoice, [[$line, 1]]);

        // نصيب كل وحدة F(c+1) − F(c) مع F(n) = floor(المحصَّل × n ÷ 3).
        $this->assertSame([8696, 8697, 8697], [(int) $r1->subtotal, (int) $r2->subtotal, (int) $r3->subtotal]);
        $this->assertSame([1304, 1304, 1305], [(int) $r1->tax_amount, (int) $r2->tax_amount, (int) $r3->tax_amount]);
        $this->assertSame(
            ['net' => 26090, 'tax' => 3913, 'total' => 30003],
            $this->totals([$r1, $r2, $r3])
        );
        foreach ([$r1, $r2, $r3] as $r) {
            $this->assertBalanced($r);
        }
        $this->assertBooksBalanced();
    }

    /** @test */
    public function seven_single_unit_returns_credit_the_original_vat_not_a_rounded_up_sum(): void
    {
        // VAT-13 / probe R1: 7 × 0.10 → ضريبة 0.11؛ قبل الإصلاح Σ = 0.14 وإجمالي 0.84.
        $invoice = $this->sale([$this->item(7, 10)]);
        $this->assertSame(11, (int) $invoice->tax_amount);
        $this->assertSame(81, (int) $invoice->total);
        $line = $invoice->lines->first();

        $returns = [];
        for ($i = 0; $i < 7; $i++) {
            $returns[] = $this->apiReturn($invoice, [[$line, 1]]);
        }

        // F(k) = floor(11k ÷ 7) = 1،3،4،6،7،9،11 ⇒ الأنصبة 1،2،1،2،1،2،2 (Σ = 11).
        $this->assertSame([1, 2, 1, 2, 1, 2, 2], array_map(fn ($r) => (int) $r->tax_amount, $returns));
        $this->assertSame(['net' => 70, 'tax' => 11, 'total' => 81], $this->totals($returns));
    }

    // ═══════════════════════════════════════════════════════════
    //  الخصومات: السطر والرأس
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_return_of_a_header_discounted_sale_reverses_the_discounted_vat(): void
    {
        // probe R3: 100.00 بخصم رأس 10.00 → ضريبة 13.50 وإجمالي 103.50.
        // قبل الإصلاح كان المرتجع الكامل يُرحَّل 115.00 (ضريبة 15.00).
        $invoice = $this->sale([$this->item(1, 10000)], ['discount' => 1000]);
        $this->assertSame(1350, (int) $invoice->tax_amount);
        $this->assertSame(10350, (int) $invoice->total);

        $return = $this->apiReturn($invoice, [[$invoice->lines->first(), 1]]);

        $this->assertSame(9000, (int) $return->subtotal);
        $this->assertSame(1350, (int) $return->tax_amount);
        $this->assertSame(10350, (int) $return->total);

        $e = $this->entry($return);
        $this->assertSame(9000, $e['4110']['debit']);
        $this->assertSame(1350, $e['2120']['debit']);
        $this->assertSame(10350, $e['1130']['credit']);
        $this->assertBalanced($return);
    }

    /** @test */
    public function line_and_header_discounts_on_an_inclusive_multi_line_sale_return_to_the_penny(): void
    {
        // سطران بنسبتين مختلفتين وخصم سطر وخصم رأس ووضع متضمّن.
        $invoice = $this->sale([
            $this->item(3, 11500, 15, 1500),
            $this->item(2, 5250, 5),
        ], ['tax_inclusive' => true, 'discount' => 777]);
        [$a, $b] = $invoice->lines->all();

        $r1 = $this->apiReturn($invoice, [[$a, 1], [$b, 1]]);
        $r2 = $this->apiReturn($invoice, [[$a, 2], [$b, 1]]);

        $this->assertSame(
            [
                'net'   => (int) $invoice->subtotal - (int) $invoice->discount,
                'tax'   => (int) $invoice->tax_amount,
                'total' => (int) $invoice->total,
            ],
            $this->totals([$r1, $r2]),
            'Σ المرتجعات = المحصَّل على الفاتورة هللةً بهللة.'
        );
        $this->assertBooksBalanced();
    }

    /** @test */
    public function the_client_cannot_inflate_the_vat_through_unit_price_or_tax_rate(): void
    {
        $invoice = $this->sale([$this->item(1, 10000)]);
        $line = $invoice->lines->first();

        $id = $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => [[
                'product_id' => $line->product_id, 'source_line_id' => $line->id,
                'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 100, // نسبة مبالغ فيها
            ]],
        ])->assertCreated()->json('data.id');

        $return = ReturnDocument::with('lines')->find($id);
        $this->assertSame(1500, (int) $return->tax_amount, 'النسبة من سطر المصدر لا من الطلب.');
        $this->assertSame(15, (int) $return->lines->first()->tax_rate);
    }

    /** @test */
    public function a_partial_refund_below_the_invoiced_price_scales_net_and_vat_proportionally(): void
    {
        // الاسترداد بنصف السعر (رسوم إعادة تخزين) يبقى مشروعاً — وبضريبة نصفية.
        $invoice = $this->sale([$this->item(2, 10000)]);
        $line = $invoice->lines->first();

        $r1 = $this->apiReturn($invoice, [[$line, 1, 5000]]);

        $this->assertSame(5000, (int) $r1->subtotal);
        $this->assertSame(750, (int) $r1->tax_amount);
        $this->assertSame(5750, (int) $r1->total);

        // الفرق المحتجَز (رسوم إعادة التخزين) لا يعود إلى المرتجع الأخير.
        $r2 = $this->apiReturn($invoice, [[$line, 1]]);
        $this->assertSame(10000, (int) $r2->subtotal);
        $this->assertSame(1500, (int) $r2->tax_amount);
        $this->assertSame(['net' => 15000, 'tax' => 2250, 'total' => 17250], $this->totals([$r1, $r2]));
    }

    // ═══════════════════════════════════════════════════════════
    //  الحدود التراكمية
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_return_beyond_the_remaining_quantity_is_rejected_and_nothing_extra_is_refunded(): void
    {
        $invoice = $this->sale([$this->item(2, 11500)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $this->apiReturn($invoice, [[$line, 2]]);

        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
            'original_id' => $invoice->id, 'items' => $this->lines([[$line, 1]]),
        ])->assertStatus(422);

        $this->assertSame(1, ReturnDocument::count());
    }

    /** @test */
    public function two_drafts_created_together_cannot_both_post_beyond_the_invoice(): void
    {
        $invoice = $this->sale([$this->item(2, 11500)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $a = $this->draft($invoice, [[$line, 2]]);
        $b = $this->draft($invoice, [[$line, 2]]);

        $this->postDraft($a);
        try {
            $this->postDraft($b);
            $this->fail('الترحيل الثاني يجب أن يُرفض.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تتجاوز المتبقي', $e->getMessage());
        }

        $this->assertSame(['net' => 20000, 'tax' => 3000, 'total' => 23000], $this->totals([$a]));
        $this->assertSame('draft', $b->fresh()->status);
    }

    /** @test */
    public function drafts_created_before_any_posting_are_re_derived_at_post_so_the_sum_is_exact(): void
    {
        // ثلاث مسوّدات (1+1+1) أُنشئت قبل ترحيل أيٍّ منها: لا تعرف إحداها الأخرى،
        // فكلٌّ حُسبت «غير أخيرة» (floor). الترحيل تحت القفل يُسند الباقي للأخيرة.
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $drafts = [
            $this->draft($invoice, [[$line, 1]]),
            $this->draft($invoice, [[$line, 1]]),
            $this->draft($invoice, [[$line, 1]]),
        ];
        $this->assertSame(1304, (int) $drafts[2]->tax_amount, 'مبلغ المسوّدة تقديري قبل الترحيل.');

        $posted = array_map(fn ($d) => $this->postDraft($d), $drafts);

        $this->assertSame(
            ['net' => 26090, 'tax' => 3913, 'total' => 30003],
            $this->totals($posted)
        );
        foreach ($posted as $p) {
            $this->assertBalanced($p);
        }
    }

    /** @test */
    public function a_historical_over_reversed_return_never_lets_a_new_return_exceed_the_charged_vat(): void
    {
        // مرتجعٌ تاريخي (قبل الإصلاح) عكَس 132.25 من 115.00 متضمّن؛ لا نمسّه.
        // المرتجع اللاحق على الباقي لا يردّ أكثر ممّا بقي (صفر هنا) ولا يخرج سالباً.
        $invoice = $this->sale([$this->item(2, 11500)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $old = ReturnDocument::create([
            'number' => 'SRET-HIST-1', 'type' => 'sales', 'partner_id' => $this->customer->id,
            'status' => 'posted', 'return_date' => now()->toDateString(),
            'original_type' => Invoice::class, 'original_id' => $invoice->id,
            'subtotal' => 11500, 'tax_amount' => 1725, 'total' => 13225,
        ]);
        ReturnLine::create([
            'return_id' => $old->id, 'product_id' => $line->product_id, 'source_line_id' => $line->id,
            'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15,
            'line_subtotal' => 11500, 'line_discount' => 0, 'line_tax' => 1725, 'line_total' => 13225,
        ]);

        $next = $this->apiReturn($invoice, [[$line, 1]]);

        // المحصَّل على السطر 20000 صافٍ و3000 ضريبة؛ المرتجع القديم سبق بـ11500/1725.
        $this->assertSame(8500, (int) $next->subtotal);
        $this->assertSame(1275, (int) $next->tax_amount);
        $this->assertLessThanOrEqual(3000, 1725 + (int) $next->tax_amount);
        $this->assertBalanced($next);
    }

    // ═══════════════════════════════════════════════════════════
    //  ثابت المجموع — خصائص على سيناريوهات عشوائية ثابتة البذرة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function summed_returns_always_equal_the_invoice_for_randomised_scenarios(): void
    {
        mt_srand(20261010);

        for ($scenario = 0; $scenario < 40; $scenario++) {
            $inclusive = (bool) mt_rand(0, 1);
            $lineCount = mt_rand(1, 3);
            $items = [];
            $grossSum = 0;
            for ($i = 0; $i < $lineCount; $i++) {
                $qty = mt_rand(1, 9);
                $price = mt_rand(1, 60000);
                $rate = [15, 15, 5, 0][mt_rand(0, 3)];
                $gross = $qty * $price;
                $lineDiscount = mt_rand(0, 3) === 0 ? mt_rand(0, intdiv($gross, 3)) : 0;
                $items[] = $this->item($qty, $price, $rate, $lineDiscount);
                $grossSum += $gross - $lineDiscount;
            }
            // خصم الرأس بالأساس الصافي — يبقى دون ربع الإجمالي كي يصحّ في الوضعين.
            $head = ['tax_inclusive' => $inclusive];
            if (mt_rand(0, 1)) {
                $head['discount'] = mt_rand(0, intdiv($grossSum, 4));
            }

            $invoice = $this->sale($items, $head);
            $lines = $invoice->lines->all();

            // قسّم كل سطر إلى أجزاء عشوائية، ثم رُدَّ بترتيبٍ عشوائي — مرحَّلاً
            // فوراً تارةً، وكمسوّدات مرحَّلة لاحقاً تارةً (تزامن مُحاكى).
            $parts = [];
            foreach ($lines as $line) {
                $left = (int) $line->quantity;
                while ($left > 0) {
                    $take = mt_rand(1, $left);
                    $parts[] = [$line, $take];
                    $left -= $take;
                }
            }
            shuffle($parts);

            $returns = [];
            if (mt_rand(0, 1)) {
                foreach ($parts as $p) {
                    $returns[] = $this->postDraft($this->draft($invoice, [$p]));
                }
            } else {
                $drafts = array_map(fn ($p) => $this->draft($invoice, [$p]), $parts);
                shuffle($drafts);
                foreach ($drafts as $d) {
                    $returns[] = $this->postDraft($d);
                }
            }

            $this->assertSame(
                [
                    'net'   => (int) $invoice->subtotal - (int) $invoice->discount,
                    'tax'   => (int) $invoice->tax_amount,
                    'total' => (int) $invoice->total,
                ],
                $this->totals($returns),
                "السيناريو {$scenario}: " . json_encode(['head' => $head, 'items' => $items])
            );
        }

        $this->assertBooksBalanced();
    }

    // ═══════════════════════════════════════════════════════════
    //  دفتر الأستاذ وضريبة المخرجات
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function output_vat_nets_to_zero_after_every_line_is_returned(): void
    {
        $invoice = $this->sale([
            $this->item(3, 11500, 15, 1500),
            $this->item(2, 5250, 15),
        ], ['tax_inclusive' => true, 'discount' => 777]);
        [$a, $b] = $invoice->lines->all();

        $this->apiReturn($invoice, [[$a, 3], [$b, 2]]);

        $vatBalance = (int) JournalLine::query()
            ->whereHas('account', fn ($q) => $q->where('code', '2120'))
            ->selectRaw('COALESCE(SUM(credit),0) - COALESCE(SUM(debit),0) as net')
            ->value('net');
        $this->assertSame(0, $vatBalance, 'الضريبة المحصَّلة = الضريبة المعكوسة بالضبط.');

        $salesBalance = (int) JournalLine::query()
            ->whereHas('account', fn ($q) => $q->where('code', '4110'))
            ->selectRaw('COALESCE(SUM(credit),0) - COALESCE(SUM(debit),0) as net')
            ->value('net');
        $this->assertSame(0, $salesBalance);
        $this->assertBooksBalanced();
    }

    /** @test */
    public function inventory_and_cogs_effects_are_unchanged_by_the_vat_fix(): void
    {
        $goods = Product::create([
            'name' => 'بضاعة', 'track_inventory' => true,
            'quantity_on_hand' => 10, 'avg_cost' => 4000,
        ]);
        $invoice = $this->sale([$this->item(3, 11500, 15, 0, $goods)], ['tax_inclusive' => true]);
        $afterSale = (int) Product::find($goods->id)->quantity_on_hand;
        $line = $invoice->lines->first();

        $return = $this->apiReturn($invoice, [[$line, 2]]);

        $this->assertSame($afterSale + 2, (int) Product::find($goods->id)->quantity_on_hand, 'يعود المخزون بالكمية.');
        $this->assertNotNull($return->fresh()->cogs_entry_id);
        $cogs = JournalEntry::with('lines.account')->find($return->fresh()->cogs_entry_id);
        $this->assertSame(8000, (int) $cogs->lines->sum('debit'), 'عكس التكلفة = 2 × 40.00 بغضّ النظر عن الضريبة.');
        $this->assertSame(['net' => 20000, 'tax' => 3000, 'total' => 23000], $this->totals([$return]));
    }

    // ═══════════════════════════════════════════════════════════
    //  المشتريات
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_purchase_return_against_an_inclusive_purchase_reverses_the_charged_input_vat(): void
    {
        // 2 × 57.50 متضمّن: لكل وحدة صافٍ 50.00 وضريبة 7.50؛ بدون المصدر كانت 66.125.
        $purchase = $this->purchaseDoc([$this->item(2, 5750)], ['tax_inclusive' => true]);
        $this->assertSame(1500, (int) $purchase->tax_amount);
        $line = $purchase->lines->first();

        $return = $this->draft($purchase, [[$line, 2]], 'purchase');
        $return = $this->postDraft($return);

        $this->assertSame(10000, (int) $return->subtotal);
        $this->assertSame(1500, (int) $return->tax_amount);
        $this->assertSame(11500, (int) $return->total);

        $e = $this->entry($return);
        $this->assertSame(11500, $e['2110']['debit'], 'ذمّة المورّد تنقص بالإجمالي المدفوع بالضبط.');
        $this->assertSame(1500, $e['1150']['credit'], 'ضريبة المدخلات المعكوسة = المستردّة بالضبط.');
        $this->assertBalanced($return);
    }

    /** @test */
    public function repeated_returns_of_a_header_discounted_purchase_sum_to_the_purchase(): void
    {
        $purchase = $this->purchaseDoc(
            [$this->item(3, 10001), $this->item(2, 5250, 5)],
            ['tax_inclusive' => true, 'discount' => 900]
        );
        [$a, $b] = $purchase->lines->all();

        $returns = [
            $this->postDraft($this->draft($purchase, [[$a, 1]], 'purchase')),
            $this->postDraft($this->draft($purchase, [[$a, 2], [$b, 1]], 'purchase')),
            $this->postDraft($this->draft($purchase, [[$b, 1]], 'purchase')),
        ];

        $this->assertSame(
            ['net' => (int) $purchase->total - (int) $purchase->tax_amount, 'tax' => (int) $purchase->tax_amount, 'total' => (int) $purchase->total],
            $this->totals($returns)
        );
        foreach ($returns as $r) {
            $this->assertBalanced($r);
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  المرتجع الحرّ (بلا مصدر)
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_free_return_honours_the_tax_inclusive_flag(): void
    {
        $item = [['product_id' => $this->service->id, 'quantity' => 1, 'unit_price' => 11500, 'tax_rate' => 15]];

        $inclusive = app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'tax_inclusive' => true,
        ], $item);
        $this->assertSame([10000, 1500, 11500], [(int) $inclusive->subtotal, (int) $inclusive->tax_amount, (int) $inclusive->total]);

        $exclusive = app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit',
        ], $item);
        $this->assertSame([11500, 1725, 13225], [(int) $exclusive->subtotal, (int) $exclusive->tax_amount, (int) $exclusive->total], 'الافتراض: غير متضمّن، كما كان.');

        $viaApi = $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $this->customer->id, 'payment_type' => 'credit', 'tax_inclusive' => true,
            'items' => $item,
        ])->assertCreated();
        $this->assertSame(1500, (int) ReturnDocument::find($viaApi->json('data.id'))->tax_amount);
    }

    // ═══════════════════════════════════════════════════════════
    //  ReturnableController — الحقول المضافة
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function the_returnable_endpoint_exposes_net_price_and_charged_vat_without_changing_existing_fields(): void
    {
        $invoice = $this->sale([$this->item(2, 11500)], ['tax_inclusive' => true, 'discount' => 2000]);
        $line = $invoice->lines->first();
        $this->apiReturn($invoice, [[$line, 1]]);

        $data = $this->getJson("/api/returns/returnable/sales/{$invoice->id}")->assertOk()->json('data');
        $row = $data['lines'][0];

        // الحقول القائمة بحالها.
        $this->assertSame('115.00', $row['unit_price']);
        $this->assertSame(2, $row['quantity']);
        $this->assertSame(1, $row['returned']);
        $this->assertSame(1, $row['remaining']);
        $this->assertSame(15, $row['tax_rate']);
        // الإضافات.
        $this->assertTrue($data['tax_inclusive']);
        $this->assertSame('100.00', $row['unit_price_before_tax']);
        $this->assertSame('180.00', $row['charged_net'], '200.00 صافٍ − خصم رأس 20.00.');
        $this->assertSame('27.00', $row['charged_tax']);
        $this->assertSame('90.00', $row['returned_net']);
        $this->assertSame('13.50', $row['returned_tax']);
        $this->assertSame('90.00', $row['remaining_net']);
        $this->assertSame('13.50', $row['remaining_tax']);
    }

    // ═══════════════════════════════════════════════════════════
    //  العزل: المستأجر والفرع
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function another_tenants_invoice_can_neither_be_returned_nor_listed(): void
    {
        $invoice = $this->sale([$this->item(1, 11500)], ['tax_inclusive' => true]);
        $line = $invoice->lines->first();

        $other = Tenant::create([
            'name' => 'مؤسسة أخرى', 'slug' => 'other',
            'vat_number' => '300000000000011', 'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $foreignCustomer = Partner::create(['name' => 'عميل أجنبي', 'type' => 'customer']);
        $foreignUser = User::create([
            'tenant_id' => $other->id, 'name' => 'مدير آخر',
            'email' => 'admin@other.sa', 'password' => bcrypt('secret1234'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($foreignUser);

        $this->postJson('/api/returns', [
            'type' => 'sales', 'partner_id' => $foreignCustomer->id, 'payment_type' => 'credit',
            'original_id' => $invoice->id,
            'items' => $this->lines([[$line, 1]]),
        ])->assertStatus(422);

        $this->getJson("/api/returns/returnable/sales/{$invoice->id}")->assertNotFound();

        app(TenantContext::class)->set($this->tenant->id);
        $this->assertSame(0, ReturnDocument::count());
    }

    /** @test */
    public function a_return_in_another_branch_inherits_the_source_amounts_and_shares_the_cumulative_cap(): void
    {
        $a = Branch::create(['code' => '00002', 'name' => 'فرع البيع', 'is_main' => false]);
        $b = Branch::create(['code' => '00003', 'name' => 'فرع المرتجع', 'is_main' => false]);

        app(BranchContext::class)->set($a->id);
        $invoice = $this->sale([$this->item(3, 10001)], ['tax_inclusive' => true, 'discount' => 500]);
        $line = $invoice->lines->first();
        $this->assertSame($a->id, $invoice->branch_id);

        app(BranchContext::class)->set($b->id);
        // أرقام صريحة: فهرس SQLite المحلي لأرقام المرتجعات بلا فرع فقدَ شرطه الجزئي بعد
        // إعادة بناء الجدول (عيب تهيئة SQLite سابق، لا صلة له بهذا الإصلاح؛ PostgreSQL سليم).
        $r1 = $this->postDraft($this->draft($invoice, [[$line, 1]], 'sales', ['number' => 'BR-B-1']));
        $this->assertSame($b->id, $r1->branch_id, 'يوسم المرتجع بفرعه لا بفرع المصدر.');

        app(BranchContext::class)->set($a->id);
        $r2 = $this->postDraft($this->draft($invoice, [[$line, 1]], 'sales', ['number' => 'BR-A-1']));

        // السقف تراكمي عبر الفروع: الفرع الثالث لا يردّ أكثر ممّا بقي.
        app(BranchContext::class)->set($b->id);
        $r3 = $this->postDraft($this->draft($invoice, [[$line, 1]], 'sales', ['number' => 'BR-B-2']));

        $this->assertSame(
            [
                'net'   => (int) $invoice->subtotal - (int) $invoice->discount,
                'tax'   => (int) $invoice->tax_amount,
                'total' => (int) $invoice->total,
            ],
            $this->totals([$r1, $r2, $r3])
        );

        try {
            $this->draft($invoice, [[$line, 1]], 'sales', ['number' => 'BR-B-3']);
            $this->fail('ارتدادٌ رابع يتجاوز المباع يجب أن يُرفض.');
        } catch (RuntimeException $e) {
            $this->assertStringContainsString('تتجاوز المتبقي', $e->getMessage());
        }
    }
}

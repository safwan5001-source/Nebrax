<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Purchase;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\PurchaseService;
use App\Services\Reporting\ReportService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Laravel\Sanctum\Sanctum;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  «تم الدفع بالفعل» + حالة الاستلام — فاتورة الشراء
 * ═══════════════════════════════════════════════════════════════
 *  يثبت أن السداد الفوري يمرّ **سنداً حقيقياً** لا اختصاراً في قيد الفاتورة،
 *  وأن الشراء النقدي لم يعد يظهر ديناً في أعمار الديون الدائنة.
 *
 *  تشغيل:  php artisan test --filter=PurchasePaidOnPostTest
 */
class PurchasePaidOnPostTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Partner $supplier;
    protected Product $product;
    protected PurchaseService $purchases;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras',
            'vat_number' => '300000000000003', 'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->supplier  = Partner::create(['name' => 'مورد', 'type' => 'supplier']);
        $this->product   = Product::create(['name' => 'بضاعة', 'sale_price' => 10000, 'track_inventory' => true]);
        $this->purchases = app(PurchaseService::class);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** فاتورة ١٠ × ١٠٠٫٠٠ + ١٥٪ = ١١٥٠٫٠٠ ريال (١١٥٠٠٠ هللة). */
    private function buy(array $head = []): Purchase
    {
        return $this->purchases->create(
            array_merge(['partner_id' => $this->supplier->id, 'payment_type' => 'credit'], $head),
            [['product_id' => $this->product->id, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]]
        );
    }

    private function balance(string $code): int
    {
        // الحساب بلا حركة لا سطرَ رصيدٍ له بعد — وهو صفرٌ لا خطأ.
        return (int) (Account::where('code', $code)->first()?->balance?->balance ?? 0);
    }

    // ── السداد الفوري ────────────────────────────────────────────

    /** @test */
    public function a_credit_purchase_without_prepayment_creates_no_voucher(): void
    {
        $posted = $this->purchases->post($this->buy());

        $this->assertSame(0, Payment::count());
        $this->assertSame('unpaid', $posted->payment_status);
        $this->assertSame(115000, $this->balance('2110'));
    }

    /** @test */
    public function paying_the_full_amount_on_post_settles_the_purchase(): void
    {
        $posted = $this->purchases->post($this->buy(['paid_on_post' => 115000]));

        $this->assertSame('paid', $posted->payment_status);
        $this->assertSame(115000, $posted->paid_amount);
        $this->assertSame(0, $posted->remaining());
        $this->assertSame(0, $this->balance('2110'));
    }

    /** @test */
    public function a_partial_prepayment_leaves_the_rest_as_a_real_debt(): void
    {
        $posted = $this->purchases->post($this->buy(['paid_on_post' => 40000]));

        $this->assertSame('partial', $posted->payment_status);
        $this->assertSame(40000, $posted->paid_amount);
        $this->assertSame(75000, $posted->remaining());

        // الباقي دَينٌ حقيقي في الدفتر لا رقمٌ على المستند وحده.
        $this->assertSame(75000, $this->balance('2110'));
    }

    /** @test */
    public function the_voucher_debits_payables_and_credits_the_chosen_account(): void
    {
        $posted = $this->purchases->post($this->buy([
            'paid_on_post' => 115000, 'payment_method' => 'bank',
        ]));

        $payment = Payment::firstOrFail();
        $this->assertSame('bank', $payment->method);
        $this->assertSame('paid', $payment->direction);

        $entry = $payment->journalEntry()->with('lines.account')->first();
        $this->assertEquals(115000, $this->line($entry, '2110')->debit);
        $this->assertEquals(115000, $this->line($entry, '1120')->credit); // البنك
        $this->assertNull($this->line($entry, '1110'));
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));

        $this->assertSame(0, $this->balance('2110'));
        $this->assertSame(-115000, $this->balance('1120')); // البنك نقص
        $this->assertSame(115000, $posted->paid_amount);
    }

    /** @test */
    public function the_voucher_carries_the_purchase_date_and_number(): void
    {
        $this->purchases->post($this->buy([
            'purchase_date' => '2026-03-05', 'paid_on_post' => 115000,
        ]));

        $payment = Payment::firstOrFail();
        $this->assertSame('2026-03-05', $payment->payment_date->toDateString());
        $this->assertStringContainsString('BILL-2026-00001', (string) $payment->notes);
    }

    /** @test */
    public function the_voucher_is_allocated_to_the_purchase(): void
    {
        $posted  = $this->purchases->post($this->buy(['paid_on_post' => 60000]));
        $payment = Payment::firstOrFail();

        $alloc = $payment->allocations()->firstOrFail();
        $this->assertSame(Purchase::class, $alloc->allocatable_type);
        $this->assertSame($posted->id, $alloc->allocatable_id);
        $this->assertSame(60000, (int) $alloc->amount);
    }

    /** @test */
    public function a_prepayment_above_the_total_is_capped_at_the_total(): void
    {
        // الإفراط لا يُرفض بل يُقصَر: قبولُه كان سيُنشئ رصيداً مديناً للمورّد
        // من فاتورةٍ واحدة، وهو ما يمنعه `PaymentService` أصلاً فيُفشل الترحيل.
        $posted = $this->purchases->post($this->buy(['paid_on_post' => 999999]));

        $this->assertSame(115000, $posted->paid_amount);
        $this->assertSame('paid', $posted->payment_status);
        $this->assertSame(115000, (int) Payment::firstOrFail()->amount);
    }

    /** @test */
    public function the_prepayment_is_ignored_while_the_purchase_is_a_draft(): void
    {
        $draft = $this->buy(['paid_on_post' => 115000]);

        $this->assertSame(0, Payment::count());
        $this->assertSame('unpaid', $draft->payment_status);
        $this->assertSame(0, $this->balance('2110'));
    }

    /** @test */
    public function a_cash_purchase_is_fully_paid_even_without_the_field(): void
    {
        $posted = $this->purchases->post($this->buy(['payment_type' => 'cash']));

        $this->assertSame('paid', $posted->payment_status);
        $this->assertSame(115000, (int) Payment::firstOrFail()->amount);
        $this->assertSame(0, $this->balance('2110'));
        $this->assertSame(-115000, $this->balance('1110'));
    }

    /** @test */
    public function the_supplier_statement_shows_the_invoice_then_its_payment(): void
    {
        $this->purchases->post($this->buy(['paid_on_post' => 115000]));

        $statement = app(ReportService::class)->partnerStatement($this->supplier->id, []);

        $this->assertCount(2, $statement['rows']);
        $this->assertSame(0, (int) $statement['closing_balance']);
    }

    // ── الخلل المُصلَح: أعمار الديون الدائنة ─────────────────────

    /** @test */
    public function a_cash_purchase_no_longer_appears_in_payables_aging(): void
    {
        $this->purchases->post($this->buy(['payment_type' => 'cash']));

        $aging = app(ReportService::class)->aging('payable');

        // كان يظهر التزاماً بـ١١٥٠٫٠٠ ريال لا وجود له في الدفتر.
        $this->assertSame(0, (int) $aging['totals']['total']);
        $this->assertEmpty($aging['rows']);
    }

    /** @test */
    public function partially_paid_purchases_age_by_the_remaining_amount_only(): void
    {
        $this->purchases->post($this->buy(['paid_on_post' => 40000]));

        $aging = app(ReportService::class)->aging('payable');

        $this->assertSame(75000, (int) $aging['totals']['total']);
    }

    // ── حالة الاستلام ────────────────────────────────────────────

    /** @test */
    public function posting_stamps_the_receipt_date_with_the_purchase_date(): void
    {
        $posted = $this->purchases->post($this->buy(['purchase_date' => '2026-02-01']));

        $this->assertSame('received', $posted->received_status);
        $this->assertSame('2026-02-01', $posted->received_date->toDateString());
    }

    /** @test */
    public function an_explicit_receipt_date_survives_posting(): void
    {
        $posted = $this->purchases->post($this->buy([
            'purchase_date' => '2026-02-01', 'received_date' => '2026-02-09',
        ]));

        $this->assertSame('2026-02-09', $posted->received_date->toDateString());
    }

    /** @test */
    public function a_pending_receipt_is_left_undated_and_still_enters_stock(): void
    {
        $posted = $this->purchases->post($this->buy(['received_status' => 'pending']));

        $this->assertSame('pending', $posted->received_status);
        $this->assertNull($posted->received_date);

        // الحقل إعلامي: المخزون يدخل عند الترحيل كما كان — لا فصل بعد.
        $this->assertSame(10, $this->product->fresh()->quantity_on_hand);
    }

    /** @test */
    public function the_receipt_status_is_editable_while_draft(): void
    {
        $draft = $this->buy(['received_status' => 'pending']);

        $updated = $this->purchases->update($draft, [
            'partner_id'      => $this->supplier->id,
            'received_status' => 'received',
            'received_date'   => '2026-04-02',
        ], [['product_id' => $this->product->id, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]]);

        $this->assertSame('received', $updated->received_status);
        $this->assertSame('2026-04-02', $updated->received_date->toDateString());
    }

    /** @test */
    public function editing_an_unrelated_field_keeps_the_prepayment(): void
    {
        // نفس فخّ #166: `??` كان يقرأ الغياب صفراً فيمحو دفعةً مقدَّمة عند
        // تعديل ملاحظة. المفتاح الغائب يعني «اتركه»، والمُرسَل صفراً يعني «امحُه».
        $draft = $this->buy(['paid_on_post' => 50000, 'payment_method' => 'bank']);

        $updated = $this->purchases->update($draft, [
            'partner_id' => $this->supplier->id,
            'notes'      => 'ملاحظة',
        ], [['product_id' => $this->product->id, 'quantity' => 10, 'unit_price' => 10000, 'tax_rate' => 15]]);

        $this->assertSame(50000, $updated->paid_on_post);
        $this->assertSame('bank', $updated->payment_method);
    }

    // ── الـ API ──────────────────────────────────────────────────

    /** @test */
    public function the_api_accepts_the_prepayment_and_reports_it_back(): void
    {
        $user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'a@b.c', 'password' => bcrypt('secret'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($user);

        $created = $this->postJson('/api/purchases', [
            'partner_id'      => $this->supplier->id,
            'payment_type'    => 'credit',
            'paid_on_post'    => 40000,
            'payment_method'  => 'bank',
            'received_status' => 'pending',
            'items'           => [[
                'product_id' => $this->product->id, 'quantity' => 10,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertCreated();

        $created->assertJsonPath('data.paid_on_post', '400.00')
            ->assertJsonPath('data.payment_method', 'bank')
            ->assertJsonPath('data.received_status', 'pending');

        $this->postJson("/api/purchases/{$created->json('data.id')}/post")
            ->assertOk()
            ->assertJsonPath('data.payment_status', 'partial')
            ->assertJsonPath('data.paid_amount', '400.00')
            ->assertJsonPath('data.remaining', '750.00');
    }

    /** @test */
    public function the_api_rejects_an_unknown_payment_method(): void
    {
        $user = User::create([
            'tenant_id' => $this->tenant->id, 'name' => 'مدير',
            'email' => 'a@b.c', 'password' => bcrypt('secret'), 'role' => 'owner',
        ]);
        Sanctum::actingAs($user);

        $this->postJson('/api/purchases', [
            'partner_id'     => $this->supplier->id,
            'payment_method' => 'crypto',
            'items'          => [[
                'product_id' => $this->product->id, 'quantity' => 1,
                'unit_price' => 10000, 'tax_rate' => 15,
            ]],
        ])->assertStatus(422)->assertJsonValidationErrors('payment_method');
    }
}

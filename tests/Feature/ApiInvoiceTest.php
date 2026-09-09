<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\Payment;
use App\Models\Product;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبار أن إنشاء/ترحيل فاتورة عبر API يولّد القيد المحاسبي الصحيح عبر LedgerService.
 * تشغيل:  php artisan test --filter=ApiInvoiceTest
 */
class ApiInvoiceTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** @test */
    public function creating_and_posting_an_invoice_via_api_generates_a_balanced_entry(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        // إنشاء فاتورة (مسوّدة) عبر API
        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'   => $partnerId,
            'payment_type' => 'cash',
            'items'        => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $invoiceId = $create['data']['id'];
        $this->assertSame('draft', $create['data']['status']);
        $this->assertSame('1150.00', $create['data']['total']); // العرض بالريال

        // ترحيل الفاتورة عبر API
        $posted = $this->withToken($token)->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
        $this->assertSame('posted', $posted['data']['status']);
        $this->assertNotNull($posted['data']['zatca']['qr']); // ZATCA توّلد

        // التحقق من القيد المتولّد عبر LedgerService
        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)
            ->where('source_id', $invoiceId)
            ->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);  // الصندوق
        $this->assertEquals(100000, $this->line($entry, '4110')->credit); // المبيعات
        $this->assertEquals(15000,  $this->line($entry, '2120')->credit); // ضريبة المخرجات
    }

    /** @test */
    public function invoice_line_product_snapshots_stay_stable_in_the_api_response(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل اللقطة', 'type' => 'customer',
        ])->assertCreated()['data']['id'];
        $productId = $this->withToken($token)->postJson('/api/products', [
            'name' => 'منتج الإصدار الأول', 'sku' => 'SKU-ORIGINAL', 'barcode' => '6281234567890',
            'type' => 'good', 'sale_price' => 115000, 'tax_rate' => 15,
        ])->assertCreated()['data']['id'];

        $created = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash', 'tax_inclusive' => true,
            'items' => [['product_id' => $productId, 'quantity' => 1, 'unit_price' => 115000, 'tax_rate' => 15]],
        ])->assertCreated()
            ->assertJsonPath('data.lines.0.product_name', 'منتج الإصدار الأول')
            ->assertJsonPath('data.lines.0.product_code', 'SKU-ORIGINAL')
            ->assertJsonPath('data.lines.0.barcode', '6281234567890')
            ->assertJsonPath('data.lines.0.unit_price_before_tax', '1000.00');

        app(TenantContext::class)->set($auth['tenant_id']);
        Product::findOrFail($productId)->update([
            'name' => 'منتج بعد التعديل', 'sku' => 'SKU-CHANGED', 'barcode' => '6280000000000',
        ]);

        $this->withToken($token)->getJson('/api/invoices/'.$created['data']['id'])->assertOk()
            ->assertJsonPath('data.lines.0.product_name', 'منتج الإصدار الأول')
            ->assertJsonPath('data.lines.0.product_code', 'SKU-ORIGINAL')
            ->assertJsonPath('data.lines.0.barcode', '6281234567890')
            ->assertJsonPath('data.lines.0.unit_price_before_tax', '1000.00');
    }

    /** @test */
    public function invoice_validation_rejects_empty_items(): void
    {
        $auth = $this->registerTenant();
        $partnerId = $this->withToken($auth['token'])->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson('/api/invoices', [
            'partner_id' => $partnerId, 'payment_type' => 'cash', 'items' => [],
        ])->assertStatus(422)->assertJsonValidationErrors('items');
    }

    /** @test */
    public function duplicating_an_invoice_via_api_creates_a_clean_draft_copy(): void
    {
        $auth = $this->registerTenant();
        $token = $auth['token'];
        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل النسخ', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $source = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'        => $partnerId,
            'is_paid'           => true,
            'payment_method'    => 'transfer',
            'payment_reference' => 'TRF-API-COPY',
            'items'             => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $copy = $this->withToken($token)
            ->postJson('/api/invoices/'.$source['data']['id'].'/duplicate')
            ->assertCreated();

        $this->assertNotSame($source['data']['id'], $copy['data']['id']);
        $this->assertNotSame($source['data']['number'], $copy['data']['number']);
        $this->assertSame('draft', $copy['data']['status']);
        $this->assertFalse($copy['data']['is_paid']);
        $this->assertSame('unpaid', $copy['data']['payment_status']);
        $this->assertSame('0.00', $copy['data']['paid_amount']);
        $this->assertSame($source['data']['total'], $copy['data']['total']);
    }

    /**
     * @test
     * الحمولة كما ترسلها شاشة إنشاء الفاتورة بعد تأشير «مدفوع بالفعل»:
     * بلا `payment_type` إطلاقاً، ومعها تفاصيل الدفع الثلاثة.
     */
    public function posting_a_paid_already_invoice_via_api_settles_it_with_a_receipt_voucher(): void
    {
        $auth  = $this->registerTenant();
        $token = $auth['token'];

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'        => $partnerId,
            'is_paid'           => true,
            'payment_method'    => 'transfer',
            'payment_reference' => 'TRF-99120',
            'items'             => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $invoiceId = $create['data']['id'];
        $this->assertTrue($create['data']['is_paid']);
        $this->assertSame('credit', $create['data']['payment_type']); // التأشير يفرض الآجل

        $posted = $this->withToken($token)->postJson("/api/invoices/{$invoiceId}/post")->assertOk();
        $this->assertSame('paid', $posted['data']['payment_status']);
        $this->assertSame('1150.00', $posted['data']['paid_amount']);
        $this->assertSame('0.00', $posted['data']['remaining']);

        // سند القبض يظهر في قائمة المدفوعات — لا أثرَ خفياً داخل قيد الفاتورة.
        $payments = $this->withToken($token)->getJson('/api/payments?direction=received')->assertOk();
        $this->assertCount(1, $payments['data']);
        $this->assertSame('1150.00', $payments['data'][0]['amount']);
        $this->assertSame('bank', $payments['data'][0]['method']);
        $this->assertSame('TRF-99120', $payments['data'][0]['reference']);

        // وذمّة العميل تنخفض فوراً: سطران في كشف حسابه (فاتورة ثم تحصيل)
        // والرصيد الختامي صفر.
        $statement = $this->withToken($token)
            ->getJson("/api/reports/partner-statement/{$partnerId}")->assertOk();
        $this->assertCount(2, $statement['rows']);
        $this->assertSame('1150.00', $statement['rows'][0]['debit']);  // الفاتورة على 1130
        $this->assertSame('1150.00', $statement['rows'][1]['credit']); // سند القبض يقفلها
        $this->assertSame('0.00', $statement['closing_balance']);
    }

    /**
     * PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR — regression: `is_paid=true` reaches
     * `InvoiceService::settle()` → `PaymentService::post()`. The authenticated
     * actor performing the post request must reach that treasury authorization
     * boundary so a `deposit_scope=user` naming them explicitly does not
     * spuriously deny a legitimate auto-settlement. Prior to the fix,
     * `InvoiceController::post()` called `$this->invoices->post($invoice)`
     * with no actor, and `settle()` called `payments->post($payment)` with no
     * actor either.
     *
     * @test
     */
    public function invoice_auto_settlement_succeeds_when_deposit_scope_user_matches_the_authenticated_actor(): void
    {
        $auth = $this->registerTenant('inv-actor-allow', 'owner@inv-actor-allow.test');
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل فحص actor مسموح', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();
        $owner = User::where('tenant_id', $auth['tenant_id'])->where('email', 'owner@inv-actor-allow.test')->sole();
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $owner->id,
        ])->save();

        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'     => $partnerId,
            'is_paid'        => true,
            'payment_method' => 'cash',
            'items'          => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        $posted = $this->withToken($token)->postJson("/api/invoices/{$create['data']['id']}/post")->assertOk();
        $this->assertSame('paid', $posted['data']['payment_status']);
        $this->assertSame(1, Payment::where('status', 'posted')->count());
    }

    /**
     * PR-ACL-INVOICE-PURCHASE-SETTLE-ACTOR — regression: a treasury deposit
     * locked to a DIFFERENT user than the one posting the invoice must be
     * denied, and the denial must leave no partial financial/state effect.
     * `InvoiceService::post()` wraps invoice status update, journal entry
     * creation AND `settle()` inside one `DB::transaction()`, so a denial
     * inside `settle()` must roll back the invoice's own posting too — the
     * invoice stays `draft`, no journal entry, no posted payment.
     *
     * @test
     */
    public function invoice_auto_settlement_is_denied_when_deposit_scope_user_does_not_match_the_actor_with_no_partial_effect(): void
    {
        $auth = $this->registerTenant('inv-actor-deny', 'owner@inv-actor-deny.test');
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل فحص actor ممنوع', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();
        $stranger = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'محاسب آخر', 'email' => 'stranger@inv-actor-deny.test',
            'password' => 'password123', 'role' => 'admin',
        ]);
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $stranger->id,
        ])->save();

        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'     => $partnerId,
            'is_paid'        => true,
            'payment_method' => 'cash',
            'items'          => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();
        $invoiceId = $create['data']['id'];

        $before = [
            'invoices_posted' => Invoice::where('status', 'posted')->count(),
            'payments' => Payment::count(),
            'journal_entries' => JournalEntry::count(),
        ];

        $this->withToken($token)->postJson("/api/invoices/{$invoiceId}/post")->assertStatus(422);

        $this->assertSame('draft', Invoice::findOrFail($invoiceId)->status, 'رفض التخويل يجب ألا يترك الفاتورة مرحّلة جزئياً.');
        $this->assertSame($before['invoices_posted'], Invoice::where('status', 'posted')->count());
        $this->assertSame($before['payments'], Payment::count(), 'رفض التخويل يجب ألا يترك سند قبض جزئي.');
        $this->assertSame($before['journal_entries'], JournalEntry::count(), 'رفض التخويل يجب ألا يترك أثراً محاسبياً جزئياً — حتى قيد الفاتورة نفسه.');
    }

    /**
     * Treasury Resolution Inspection (2026-09-09) — CHARACTERIZATION, not a
     * fix. Proves the CONFIRMED gap in §18.3/§20/§26 of the living reference:
     * `InvoiceService::post()` debits GL `1110` directly for a direct cash
     * sale (`payment_type=cash`, no `is_paid`) via a hardcoded `accountId()`
     * lookup, and never calls `CashBankAccountService::resolveForPayment()`
     * or `assertAllowed()` for that path — unlike the `is_paid=true` path
     * immediately above, which is fully protected since PR #734.
     *
     * A "stranger" whom the tenant's main cash treasury explicitly excludes
     * (`deposit_scope=user` naming someone else) can still post a direct
     * cash sale and successfully debit that exact treasury's GL account.
     * This is the current, live, unfixed behavior — asserted here so a
     * future fix flips this test's expectation deliberately, not silently.
     *
     * @test
     */
    public function direct_cash_sale_bypasses_treasury_deposit_acl_characterization(): void
    {
        $auth = $this->registerTenant('cash-sale-gap', 'owner@cash-sale-gap.test');
        $token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $partnerId = $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل فحص فجوة البيع النقدي المباشر', 'type' => 'customer',
        ])->assertCreated()['data']['id'];

        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = CashBankAccount::where('type', 'cash')->where('is_main', true)->firstOrFail();
        $stranger = User::create([
            'tenant_id' => $auth['tenant_id'], 'name' => 'محاسب آخر', 'email' => 'stranger@cash-sale-gap.test',
            'password' => 'password123', 'role' => 'admin',
        ]);
        // الخزينة الرئيسية تستثني صراحةً من يرحّل الفاتورة أدناه (المالك).
        $cash->forceFill([
            'deposit_scope' => 'user',
            'deposit_scope_subject' => $stranger->id,
        ])->save();

        // بيع نقدي مباشر — بلا is_paid، فلا يمر عبر settle()/PaymentService إطلاقاً.
        $create = $this->withToken($token)->postJson('/api/invoices', [
            'partner_id'   => $partnerId,
            'payment_type' => 'cash',
            'items'        => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated();

        // يُرحَّل بنجاح رغم أن المالك (الفاعل الفعلي) ليس subject الخزينة —
        // لا رفض 422، لا سند قبض يتحقق، لا CashBankAccountService متورطة.
        $posted = $this->withToken($token)->postJson("/api/invoices/{$create['data']['id']}/post")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Invoice::class)->where('source_id', $posted['data']['id'])->firstOrFail();
        $this->assertEquals(115000, $this->line($entry, '1110')->debit, 'القيد يمدِّن 1110 — نفس حساب أستاذ الخزينة الرئيسية.');
        $this->assertSame($cash->account_id, $this->line($entry, '1110')->account_id, 'حساب 1110 هو بالضبط account_id للخزينة الرئيسية المقفلة على "stranger".');
        $this->assertSame(0, Payment::count(), 'لا سند قبض ولا CashBankAccountService في هذا المسار إطلاقاً.');
    }
}

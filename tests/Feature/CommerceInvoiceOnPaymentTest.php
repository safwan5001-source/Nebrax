<?php

namespace Tests\Feature;

use App\Models\CommerceListing;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderPosting;
use App\Models\InventoryReservation;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\PaymentAttempt;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Commerce\FulfillmentPolicyService;
use App\Services\PaymentAttemptPostingService;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * H4-03 / D-13 — فاتورة وقيود طلب المتجر الإلكتروني عند تأكيد الدفع. مغلقة افتراضياً (بوابة نشر + مرجع EXT-05 + سياسة مستأجر + نمط أسعار شاملة).
 * الفاتورة: مدين 1130 / دائن 4110 + 2120 (+COGS/مخزون)، السند A1: مدين 1170 / دائن 1130، والحجز يُستهلك.
 */
class CommerceInvoiceOnPaymentTest extends TestCase
{
    use InteractsWithApi;
    use OnlineStorefrontHarness;
    use RefreshDatabase;

    private Warehouse $warehouse;

    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now('UTC')->setDate(2026, 10, 23)->setTime(9, 0));
        $this->bootOnlineStore();
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);
        $this->warehouse = Warehouse::create(['name' => 'مخزن المتجر', 'code' => 'INV-W1', 'is_default' => true]);
        app(FulfillmentPolicyService::class)->setFixedWarehouse($this->channel->id, $this->warehouse->id);
        app(TenantContext::class)->forget();
    }

    private function open(bool $gate = true, string $trigger = 'on_payment_confirmed', ?string $mode = 'inclusive'): void
    {
        config(['payments.commerce_invoice_on_payment.enabled' => $gate, 'payments.commerce_invoice_on_payment.tax_opinion_ref' => $gate ? 'EXT-05/TEST' : null]);
        app(TenantContext::class)->set($this->tenant->id);
        Settings::put('sales', array_filter(['commerce_invoice_trigger' => $trigger, 'commerce_price_tax_mode' => $mode]));
        app(TenantContext::class)->forget();
    }

    private function tracked(int $onHand = 10, int $taxRate = 15): Product
    {
        app(TenantContext::class)->set($this->tenant->id);
        $product = Product::create(['name' => 'منتج مخزني', 'sku' => 'IV-'.Str::random(8), 'unit' => 'piece', 'sale_price' => 5000, 'purchase_price' => 2000, 'avg_cost' => 2000, 'tax_rate' => $taxRate, 'is_active' => true, 'track_inventory' => true]);
        CommerceListing::create(['product_id' => $product->id, 'sales_channel_id' => $this->channel->id, 'is_published' => true]);
        ProductWarehouseStock::create(['product_id' => $product->id, 'warehouse_id' => $this->warehouse->id, 'quantity' => $onHand]);
        DB::table('products')->where('id', $product->id)->update(['quantity_on_hand' => $onHand]);
        app(TenantContext::class)->forget();

        return $product;
    }

    /** @return array{order: array, attempt: PaymentAttempt} طلب إلكتروني ملتقَط ومثبَّت مدفوعاً. */
    private function paid(Product $product, string $key = 'idem-iv-001', ?int $delivery = null): array
    {
        $order = $this->onlineOrder(product: $product, key: $key);
        if ($delivery !== null) {
            DB::table('commerce_orders')->where('id', $order['order_id'])->update(['delivery_amount_minor' => $delivery, 'total' => 5000 + $delivery]);
            DB::table('commerce_payment_intents')->where('commerce_order_id', $order['order_id'])->update(['amount_minor' => 5000 + $delivery]);
        }
        $this->startPayment($order)->assertCreated();
        $attempt = $this->attempts($order['order_id'])->first();
        $this->capture($attempt, 5000 + ($delivery ?? 0));
        $this->paymentStatus($order)->assertOk();

        return ['order' => $order, 'attempt' => $attempt];
    }

    private function runPosting(): array
    {
        return app(PaymentAttemptPostingService::class)->runPending();
    }

    /** @return list<array{0: string, 1: int, 2: int}> */
    private function lines(JournalEntry $entry): array
    {
        return DB::table('journal_lines as l')->join('accounts as a', 'a.id', '=', 'l.account_id')->where('l.journal_entry_id', $entry->id)
            ->orderBy('a.code')->get(['a.code', 'l.debit', 'l.credit'])->map(fn ($r) => [(string) $r->code, (int) $r->debit, (int) $r->credit])->all();
    }

    #[Test]
    public function by_default_a_captured_online_order_is_paid_but_creates_no_invoice_or_entries(): void
    {
        $this->open(false, 'none', null);
        $paid = $this->paid($this->tracked());

        $this->assertSame('paid', $this->intent($paid['order']['order_id'])->status);
        $this->assertNull($paid['attempt']->fresh()->posting_status);
        $counts = $this->counts();
        $this->assertSame(0, $counts['invoices'] + $counts['payments'] + $counts['journal_entries'] + $counts['stock_movements'] + $counts['attempt_postings']);
        $this->assertSame(0, DB::table('commerce_order_postings')->count());
        $this->assertSame('active', InventoryReservation::query()->withoutGlobalScopes()->first()->status, 'الحجز دائم حتى الإصدار');
    }

    #[Test]
    public function every_condition_is_required_to_enable_posting(): void
    {
        foreach ([[false, 'on_payment_confirmed', 'inclusive'], [true, 'none', 'inclusive'], [true, 'on_payment_confirmed', null]] as $i => [$gate, $trigger, $mode]) {
            $this->open($gate, $trigger, $mode);
            if ($mode === null) {
                app(TenantContext::class)->set($this->tenant->id);
                $tenant = \App\Models\Tenant::find($this->tenant->id);
                $settings = $tenant->settings; unset($settings['sales']['commerce_price_tax_mode']); $tenant->update(['settings' => $settings]);
                app(TenantContext::class)->forget();
            }
            $paid = $this->paid($this->tracked(), 'idem-iv-c'.$i);
            $this->assertNull($paid['attempt']->fresh()->posting_status, "الحالة {$i}: يجب ألا يُرحَّل");
        }
        $this->assertSame(0, DB::table('invoices')->count());
    }

    #[Test]
    public function the_settings_api_rejects_enabling_the_trigger_while_the_deployment_gate_is_closed(): void
    {
        $this->open(false, 'none', null);
        app(TenantContext::class)->set($this->tenant->id);
        $owner = \App\Models\User::create(['tenant_id' => $this->tenant->id, 'name' => 'o', 'email' => 'o-'.Str::random(5).'@online-pay.test', 'password' => 'password123', 'role' => 'owner']);
        $token = $owner->createToken('t')->plainTextToken;
        app(TenantContext::class)->forget();

        $this->withToken($token)->putJson('/api/sales-settings', ['commerce_invoice_trigger' => 'on_payment_confirmed'])->assertStatus(422);
        $this->open(true, 'none', null);
        $this->withToken($token)->putJson('/api/sales-settings', ['commerce_invoice_trigger' => 'on_payment_confirmed', 'commerce_price_tax_mode' => 'inclusive'])->assertOk();
        $this->withToken($token)->putJson('/api/sales-settings', ['commerce_price_tax_mode' => 'exclusive'])->assertStatus(422);
    }

    #[Test]
    public function a_captured_order_gets_one_posted_invoice_and_one_gateway_voucher_and_consumes_its_hold(): void
    {
        $this->open();
        $product = $this->tracked(10);
        $paid = $this->paid($product);
        $this->runPosting();

        $attempt = $paid['attempt']->fresh();
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $attempt->posting_status);
        $this->assertSame('2026-10-23', $attempt->accounting_date->toDateString());

        $anchor = CommerceOrderPosting::query()->withoutGlobalScopes()->sole();
        $invoice = Invoice::query()->withoutGlobalScopes()->findOrFail($anchor->invoice_id);
        $payment = Payment::query()->withoutGlobalScopes()->findOrFail($anchor->payment_id);
        $this->assertSame($paid['order']['order_id'], $anchor->commerce_order_id);
        $this->assertSame('posted', $invoice->status);
        $this->assertSame(5000, (int) $invoice->total);
        $this->assertTrue((bool) $invoice->tax_inclusive);
        $this->assertSame('simplified', $invoice->zatca_document_type);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertSame(5000, (int) $invoice->paid_amount);
        $this->assertSame('posted', $payment->status);
        $this->assertSame($this->gateway->id, $payment->payment_gateway_id);

        // قيد الفاتورة: مدين العملاء = الإجمالي، دائن الإيراد + الضريبة، موازن.
        $invoiceEntry = JournalEntry::query()->withoutGlobalScopes()->where('source_type', Invoice::class)->where('source_id', $invoice->id)->where('status', 'posted')->get()
            ->first(fn ($e) => collect($this->lines($e))->contains(fn ($l) => $l[0] === '1130' && $l[1] === 5000));
        $this->assertNotNull($invoiceEntry);
        $rows = $this->lines($invoiceEntry);
        $this->assertSame(5000, array_sum(array_column($rows, 1)));
        $this->assertSame(5000, array_sum(array_column($rows, 2)));
        $this->assertContains(['1130', 5000, 0], $rows);
        $this->assertContains(['2120', 0, 652], $rows);
        $this->assertContains(['4110', 0, 4348], $rows);
        // سند القبض A1.
        $this->assertSame([['1130', 0, 5000], ['1170', 5000, 0]], $this->lines(JournalEntry::query()->withoutGlobalScopes()->where('source_type', Payment::class)->where('source_id', $payment->id)->sole()));

        // الحجز استُهلك والمخزون خرج بحركة الفاتورة وحدها.
        $this->assertSame('consumed', InventoryReservation::query()->withoutGlobalScopes()->sole()->status);
        $this->assertSame(1, DB::table('stock_movements')->where('product_id', $product->id)->count());
        $this->assertSame(9, (int) DB::table('product_warehouse_stock')->where('product_id', $product->id)->value('quantity'));

        // idempotent: لا فاتورة ولا سند ثانٍ.
        $before = $this->counts();
        $this->runPosting();
        app(PaymentAttemptPostingService::class)->process(PaymentAttempt::query()->withoutGlobalScopes()->findOrFail($attempt->id), true);
        $this->assertSame($before, $this->counts());
        $this->assertSame(1, DB::table('commerce_order_postings')->count());
        $this->assertSame(1, DB::table('invoices')->count());
    }

    #[Test]
    public function delivery_is_split_into_net_and_vat_with_the_rounding_difference_absorbed_so_the_total_equals_what_was_paid(): void
    {
        $this->open();
        $paid = $this->paid($this->tracked(), 'idem-iv-ship', 1000);
        $this->runPosting();

        $invoice = Invoice::query()->withoutGlobalScopes()->sole();
        $this->assertSame(6000, (int) $invoice->total);
        $this->assertSame(870, (int) $invoice->shipping, 'round(1000/1.15)');
        $this->assertSame(PaymentAttempt::POSTING_POSTED, $paid['attempt']->fresh()->posting_status);
        $this->assertSame(6000, (int) Payment::query()->withoutGlobalScopes()->sole()->amount);
    }

    #[Test]
    public function a_locked_period_blocks_posting_without_entries_and_an_explicit_repost_after_opening_posts_with_the_original_date(): void
    {
        $this->open();
        app(TenantContext::class)->set($this->tenant->id);
        $owner = \App\Models\User::create(['tenant_id' => $this->tenant->id, 'name' => 'o', 'email' => 'o2-'.Str::random(5).'@online-pay.test', 'password' => 'password123', 'role' => 'owner']);
        $lock = app(AccountingPeriodLockService::class)->create('2026-10-01', '2026-10-31', 'إقفال أكتوبر', $owner);
        app(TenantContext::class)->forget();

        $paid = $this->paid($this->tracked());
        $this->runPosting();

        $attempt = $paid['attempt']->fresh();
        $this->assertSame(PaymentAttempt::POSTING_BLOCKED_PERIOD, $attempt->posting_status);
        $this->assertSame('2026-10-23', $attempt->accounting_date->toDateString());
        $this->assertSame('paid', $this->intent($paid['order']['order_id'])->status, 'الدفع محفوظ');
        $this->assertSame(0, DB::table('invoices')->count());
        $this->assertSame(0, DB::table('payments')->count());
        $this->assertSame(0, DB::table('commerce_order_postings')->count());
        $this->assertSame('active', InventoryReservation::query()->withoutGlobalScopes()->sole()->status);

        app(TenantContext::class)->set($this->tenant->id);
        app(AccountingPeriodLockService::class)->release($lock['id'], 'فتح رسمي', $owner);
        $this->runPosting(); // لا إعادة آلية
        $this->assertSame(0, DB::table('invoices')->count());
        $this->assertSame(PaymentAttemptPostingService::OUTCOME_POSTED, app(PaymentAttemptPostingService::class)->process(PaymentAttempt::query()->findOrFail($attempt->id), true));
        $this->assertSame('2026-10-23', Invoice::query()->sole()->invoice_date->toDateString());
        $this->assertSame(1, DB::table('commerce_order_postings')->count());
    }

    #[Test]
    public function an_unsupported_tax_rate_is_not_postable_and_creates_nothing(): void
    {
        $this->open();
        $paid = $this->paid($this->tracked(10, 5));
        $this->runPosting();

        $attempt = $paid['attempt']->fresh();
        $this->assertSame(PaymentAttempt::POSTING_NOT_POSTABLE, $attempt->posting_status);
        $this->assertSame('unsupported_tax_rate', $attempt->posting_blocked_reason['reason']);
        $this->assertSame(0, DB::table('invoices')->count());
        $this->assertSame(0, DB::table('commerce_order_postings')->count());
        $this->assertSame('paid', $this->intent($paid['order']['order_id'])->status);
        $this->assertSame('active', InventoryReservation::query()->withoutGlobalScopes()->sole()->status, 'الحجز لا يُستهلك بلا فاتورة');
    }

    #[Test]
    public function the_manual_link_policy_waits_for_a_staff_partner_and_never_blocks_the_batch(): void
    {
        $this->open();
        app(TenantContext::class)->set($this->tenant->id);
        Settings::put('sales', ['commerce_partner_policy' => 'manual_link']);
        app(TenantContext::class)->forget();
        $paid = $this->paid($this->tracked());

        $summary = $this->runPosting();

        $this->assertSame(0, $summary['processed'], 'بلا طرف لا يدخل الدفعة');
        $this->assertSame(PaymentAttempt::POSTING_PENDING, $paid['attempt']->fresh()->posting_status);
        $this->assertSame(0, DB::table('invoices')->count());

        // ربط موظف ⇒ يُرحَّل في الدورة التالية.
        $partner = \App\Models\Partner::query()->withoutGlobalScopes()->create(['tenant_id' => $this->tenant->id, 'name' => 'عميل مربوط', 'type' => 'customer']);
        DB::table('commerce_orders')->where('id', $paid['order']['order_id'])->update(['partner_id' => $partner->id]);
        $this->assertSame(1, $this->runPosting()['posted']);
        $this->assertSame($partner->id, Invoice::query()->withoutGlobalScopes()->sole()->partner_id);
    }

    #[Test]
    public function the_bridge_never_writes_the_ledger_directly_and_stays_out_of_the_attempt_posting_service(): void
    {
        $bridge = file_get_contents(app_path('Services/Commerce/CommerceOrderPostingService.php'));
        $this->assertDoesNotMatchRegularExpression('/LedgerService|JournalEntry::|JournalLine|table\([\'"]journal_|table\([\'"]stock_movements/', $bridge);
        $this->assertStringContainsString('InvoiceService', $bridge);
        $this->assertStringContainsString('PaymentService', $bridge);
    }
}

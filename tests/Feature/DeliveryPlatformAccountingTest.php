<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\Branch;
use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\DeliveryInvoiceContextService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\PaymentService;
use App\Services\DeliveryPlatformConfigService;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * DLV-ACCOUNTING-1 — تحصيل منصات التوصيل: مقاصة مستحقات بدل نقد/بنك.
 *
 * `Invoice.partner_id` يبقى طرف الفاتورة الافتراضي/الزائر دوماً (DG-2)؛ سياق
 * المنصة توثيق تحليلي منفصل (`DeliveryInvoiceContext`)، والقيد الوحيد الجديد
 * هو مدين `platform_receivable_clearing` (1180) / دائن `accounts_receivable`
 * (1130) على سند قبض عادي — بلا عمولة ولا ضريبة ولا تسوية (DG-3).
 *
 * تشغيل: php artisan test --filter=DeliveryPlatformAccountingTest
 */
class DeliveryPlatformAccountingTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;

    private Partner $customer;

    private PaymentService $payments;

    private DeliveryPlatformConfigService $platforms;

    private DeliveryInvoiceContextService $contexts;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'شركة توصيل الأفق',
            'slug' => 'dlv-acc-1',
            'vat_number' => '300000000000020',
            'currency' => 'SAR',
        ]);

        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->customer = Partner::create(['name' => 'عميل نقطة البيع', 'type' => 'customer']);
        $this->payments = app(PaymentService::class);
        $this->platforms = app(DeliveryPlatformConfigService::class);
        $this->contexts = app(DeliveryInvoiceContextService::class);
    }

    // ───────────────────────────── إيجابية ─────────────────────────────

    /** @test */
    public function gross_invoice_is_posted_unchanged_regardless_of_delivery_context(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);

        $this->assertSame(115000, $invoice->total);
        $this->assertSame(100000, $invoice->subtotal);
        $this->assertSame(15000, $invoice->tax_amount);
        $this->assertSame($this->customer->id, $invoice->partner_id);

        $this->contexts->record($invoice, $profile);

        $this->assertSame(100000, $invoice->fresh()->subtotal);
        $this->assertSame($this->customer->id, $invoice->fresh()->partner_id);
    }

    /** @test */
    public function platform_collected_payment_debits_platform_clearing_and_credits_receivable(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $payment = $this->collectPlatform($invoice, 115000, $profile);

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertEquals(115000, $this->line($entry, '1180')->debit);
        $this->assertEquals(115000, $this->line($entry, '1130')->credit);
        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, Account::where('code', '1180')->first()->balance->fresh()->balance);
        $this->assertEquals(0, Account::where('code', '1130')->first()->balance->fresh()->balance);
    }

    /** @test */
    public function platform_collected_payment_creates_zero_cash_or_bank_lines(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $payment = $this->collectPlatform($invoice, 115000, $profile);

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertNull($this->line($entry, '1110'));
        $this->assertNull($this->line($entry, '1120'));
        $this->assertCount(2, $entry->lines);
    }

    /** @test */
    public function platform_collected_payment_updates_invoice_paid_amount_and_status(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $payment = $this->collectPlatform($invoice, 115000, $profile);

        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame('paid', $invoice->fresh()->payment_status);
        $this->assertSame('posted', $payment->fresh()->status);
    }

    /** @test */
    public function delivery_invoice_context_pins_traceable_platform_identity_and_version(): void
    {
        $profile = $this->platformProfile('mrsool', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $version = $this->platforms->latestVersion($profile->fresh());

        $context = $this->contexts->record($invoice, $profile, ['external_order_reference' => 'MRSOOL-100']);

        $this->assertSame($invoice->id, $context->invoice_id);
        $this->assertSame($profile->sales_channel_id, $context->sales_channel_id);
        $this->assertSame($profile->id, $context->delivery_platform_profile_id);
        $this->assertSame($version->id, $context->delivery_platform_profile_version_id);
        $this->assertSame(Version::COLLECTION_PLATFORM, $context->collection_mode);
        $this->assertSame('MRSOOL-100', $context->external_order_reference);
    }

    /** @test */
    public function delivery_invoice_context_survives_later_profile_version_changes(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $context = $this->contexts->record($invoice, $profile);
        $pinnedVersionId = $context->delivery_platform_profile_version_id;

        // تعديل لاحق على الإعداد ينتج نسخة جديدة — لا يغيّر السياق المثبّت.
        $this->platforms->update($profile->fresh(), ['display_name' => 'جاهز (مُحدَّث)']);
        $this->platforms->update($profile->fresh(), ['collection_mode' => Version::COLLECTION_MERCHANT]);

        $context->refresh();
        $this->assertSame($pinnedVersionId, $context->delivery_platform_profile_version_id);
        $this->assertSame(Version::COLLECTION_PLATFORM, $context->collection_mode);
    }

    /** @test */
    public function merchant_collected_invoice_without_platform_payment_behaves_as_ordinary_pos(): void
    {
        $profile = $this->platformProfile('keeta', Version::COLLECTION_MERCHANT);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $payment = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'cash',
        ]));

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertEquals(115000, $this->line($entry, '1110')->debit);
        $this->assertNull($this->line($entry, '1180'));
    }

    /** @test */
    public function ordinary_cash_and_card_collections_without_any_delivery_platform_are_unchanged(): void
    {
        $invoice = $this->postedInvoice(100000);

        $cash = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 60000,
            'method' => 'cash',
        ]));
        $bank = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 55000,
            'method' => 'bank',
        ]));

        $this->assertEquals(60000, $this->line(JournalEntry::with('lines.account')->findOrFail($cash->journal_entry_id), '1110')->debit);
        $this->assertEquals(55000, $this->line(JournalEntry::with('lines.account')->findOrFail($bank->journal_entry_id), '1120')->debit);
        $this->assertSame(115000, $invoice->fresh()->paid_amount);
        $this->assertSame('paid', $invoice->fresh()->payment_status);
    }

    /** @test */
    public function existing_gateway_clearing_behavior_is_unaffected_by_platform_clearing(): void
    {
        $gateway = \App\Models\PaymentGateway::create([
            'provider' => \App\Models\PaymentGateway::PROVIDER_STRIPE,
            'name' => 'Stripe',
        ]);
        $invoice = $this->postedInvoice(100000);

        $payment = $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'bank',
            'payment_gateway_id' => $gateway->id,
        ]));

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertEquals(115000, $this->line($entry, '1170')->debit);
        $this->assertNull($this->line($entry, '1180'));
        $this->assertNull(Account::where('code', '1180')->first()->balance);
    }

    // ───────────────────────────── سلبية ─────────────────────────────

    /** @test */
    public function missing_platform_receivable_clearing_mapping_fails_closed(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        AccountRoleMapping::query()->where('role_key', 'platform_receivable_clearing')->delete();

        $journalsBefore = JournalEntry::count();
        $draft = $this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'bank',
            'delivery_platform_profile_id' => $profile->id,
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($draft);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::count());
            $this->assertSame(0, $invoice->fresh()->paid_amount);
        }
    }

    /** @test */
    public function ordinary_cash_payment_on_a_platform_collected_invoice_is_rejected(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $journalsBefore = JournalEntry::count();
        $draft = $this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'cash',
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($draft);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::count());
            $this->assertSame(0, $invoice->fresh()->paid_amount);
        }
    }

    /** @test */
    public function recording_without_an_explicit_version_survives_a_later_profile_revision(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);

        $first = $this->contexts->record($invoice, $profile);

        // تعديل لاحق ينتج نسخة 2 — إعادة محاولة التسجيل بلا نسخة محدَّدة صراحةً
        // يجب أن تعيد الصف الثابت القائم لا أن تتعارض معه.
        $this->platforms->update($profile->fresh(), ['display_name' => 'جاهز (محدَّث)']);

        $second = $this->contexts->record($invoice, $profile->fresh());

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, DeliveryInvoiceContext::count());
    }

    /** @test */
    public function backfill_migration_refuses_to_commandeer_an_existing_non_clearing_account_at_1180(): void
    {
        $legacyTenant = Tenant::create(['name' => 'مستأجر قديم', 'slug' => 'dlv-acc-1-legacy']);
        app(TenantContext::class)->set($legacyTenant->id);
        Account::create([
            'tenant_id' => $legacyTenant->id,
            'code' => '1180',
            'name' => 'حساب مخصص للمستأجر',
            'name_en' => 'Custom Tenant Account',
            'type' => 'liability',
            'normal_balance' => 'credit',
            'is_group' => false,
            'is_system' => false,
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $migration = require database_path('migrations/2026_10_28_010000_add_platform_receivable_clearing_account.php');

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('تعارض');
        $migration->up();
    }

    /** @test */
    public function platform_collected_payment_without_any_invoice_allocation_is_rejected(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);

        $journalsBefore = JournalEntry::count();
        $draft = $this->payments->create([
            'partner_id' => $this->customer->id,
            'amount' => 115000,
            'method' => 'bank',
            'delivery_platform_profile_id' => $profile->id,
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($draft);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::count());
        }
    }

    /** @test */
    public function platform_collected_payment_against_a_merchant_collected_context_is_rejected(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_MERCHANT);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $journalsBefore = JournalEntry::count();
        $draft = $this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'bank',
            'delivery_platform_profile_id' => $profile->id,
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($draft);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::count());
            $this->assertSame(0, $invoice->fresh()->paid_amount);
        }
    }

    /** @test */
    public function recording_the_same_delivery_context_twice_is_idempotent(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);

        $first = $this->contexts->record($invoice, $profile, ['external_order_reference' => 'REF-1']);
        $second = $this->contexts->record($invoice, $profile, ['external_order_reference' => 'REF-1']);

        $this->assertSame($first->id, $second->id);
        $this->assertSame(1, DeliveryInvoiceContext::count());
    }

    /** @test */
    public function duplicate_external_order_reference_across_invoices_does_not_merge_contexts(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoiceA = $this->postedInvoice(100000);
        $invoiceB = $this->postedInvoice(50000);

        $contextA = $this->contexts->record($invoiceA, $profile, ['external_order_reference' => 'SAME-REF']);
        $contextB = $this->contexts->record($invoiceB, $profile, ['external_order_reference' => 'SAME-REF']);

        $this->assertNotSame($contextA->id, $contextB->id);
        $this->assertSame($invoiceA->id, $contextA->invoice_id);
        $this->assertSame($invoiceB->id, $contextB->invoice_id);
        $this->assertSame(2, DeliveryInvoiceContext::count());
    }

    /** @test */
    public function cross_tenant_platform_profile_is_rejected_on_context_recording(): void
    {
        $invoice = $this->postedInvoice(100000);

        $tenantB = Tenant::create(['name' => 'مستأجر ب', 'slug' => 'dlv-acc-1-b']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $foreignProfile = $this->platformProfile('mrsool', Version::COLLECTION_PLATFORM);

        app(TenantContext::class)->set($this->tenant->id);

        $this->expectException(RuntimeException::class);
        $this->contexts->record($invoice, $foreignProfile);
    }

    /** @test */
    public function forging_a_different_branch_on_delivery_invoice_context_is_rejected(): void
    {
        $invoice = $this->postedInvoice(100000);
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $otherBranch = Branch::create(['name' => 'فرع آخر', 'code' => 'B2']);

        $this->expectException(DomainException::class);
        DeliveryInvoiceContext::create([
            'invoice_id' => $invoice->id,
            'branch_id' => $otherBranch->id,
            'sales_channel_id' => $profile->sales_channel_id,
            'delivery_platform_profile_id' => $profile->id,
            'delivery_platform_profile_version_id' => $this->platforms->latestVersion($profile->fresh())->id,
            'collection_mode' => Version::COLLECTION_PLATFORM,
        ]);
    }

    /** @test */
    public function payment_linked_to_mismatched_platform_profile_is_rejected(): void
    {
        $profileA = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $profileB = $this->platformProfile('mrsool', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profileA);

        $journalsBefore = JournalEntry::count();
        $draft = $this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => 115000,
            'method' => 'bank',
            'delivery_platform_profile_id' => $profileB->id,
        ]);

        $this->expectException(RuntimeException::class);
        try {
            $this->payments->post($draft);
        } finally {
            $this->assertSame($journalsBefore, JournalEntry::count());
            $this->assertSame(0, $invoice->fresh()->paid_amount);
        }
    }

    /** @test */
    public function foreign_invoice_is_rejected_when_recording_delivery_context(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);

        $tenantB = Tenant::create(['name' => 'مستأجر ج', 'slug' => 'dlv-acc-1-c']);
        app(TenantContext::class)->set($tenantB->id);
        app(ChartOfAccountsSeeder::class)->seed($tenantB->id);
        $customerB = Partner::create(['name' => 'عميل ج', 'type' => 'customer']);
        $invoiceB = app(InvoiceService::class)->create(
            ['partner_id' => $customerB->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
        $invoiceB = app(InvoiceService::class)->post($invoiceB);

        app(TenantContext::class)->set($this->tenant->id);

        $this->expectException(RuntimeException::class);
        $this->contexts->record($invoiceB, $profile);
    }

    /** @test */
    public function no_commission_fee_tax_or_settlement_posting_exists_for_platform_clearing(): void
    {
        $profile = $this->platformProfile('jahez', Version::COLLECTION_PLATFORM);
        $invoice = $this->postedInvoice(100000);
        $this->contexts->record($invoice, $profile);

        $payment = $this->collectPlatform($invoice, 115000, $profile);

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertCount(2, $entry->lines);
        $this->assertNull($this->line($entry, '5510'));
        $this->assertEquals(0, (int) (Account::where('code', '5510')->first()->balance?->balance ?? 0));
        $this->assertFalse(class_exists('App\\Models\\DeliveryPlatformSettlement'));
    }

    // ───────────────────────────── مساعدات ─────────────────────────────

    private function postedInvoice(int $unitPrice): Invoice
    {
        $invoice = app(InvoiceService::class)->create(
            ['partner_id' => $this->customer->id, 'payment_type' => 'credit'],
            [['quantity' => 1, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );

        return app(InvoiceService::class)->post($invoice);
    }

    private function platformProfile(string $platformKey, string $collectionMode): DeliveryPlatformProfile
    {
        return $this->platforms->create([
            'platform_key' => $platformKey,
            'collection_mode' => $collectionMode,
        ]);
    }

    private function collectPlatform(Invoice $invoice, int $amount, DeliveryPlatformProfile $profile): Payment
    {
        return $this->payments->post($this->payments->create([
            'partner_id' => $this->customer->id,
            'invoice_id' => $invoice->id,
            'amount' => $amount,
            'method' => 'bank',
            'delivery_platform_profile_id' => $profile->id,
        ]));
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }
}

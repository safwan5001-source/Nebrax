<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\PlatformAdministrator;
use App\Models\Product;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\LedgerService;
use App\Services\Accounting\ZatcaRolloutControlService;
use App\Support\Settings;
use App\Support\TreasurySelectionException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * TREASURY-T5 — الاسترداد النقدي للإشعار الدائن للمبيعات يتبع خزينة التحصيل الأصلية (مغلق افتراضياً خلف بوابة T4).
 *
 * يغطي: `legacy` دون تغيير، التوجيه المشتقّ من قيد البيع (1110 القديمة، خزينة مُوجَّهة، قيد بسطرَي مدين)، رفض المستقل والآجل مهما كانت
 * السياسة (D-T5-2)، غموض/غياب خزينة المصدر، تعطيل الخزينة وعملتها، صلاحية `withdraw` (لا `deposit`)، عزل المستأجرين، الذرّية بلا قيد ولا ICV،
 * وعدم تأثّر ZATCA. المبالغ بالهللات: ثلاث وحدات بـ1000 + 15% = 115000 للوحدة.
 */
class TreasuryCreditNoteRefundRoutingTest extends TestCase
{
    use CapturesThrowable;
    use RefreshDatabase;

    private string $tenantId;
    private string $partnerId;
    private string $productId;
    private User $owner;

    protected function setUp(): void
    {
        parent::setUp();
        [$this->tenantId, $this->partnerId, $this->productId, $this->owner] = $this->newTenant('t5-main');
        app(TenantContext::class)->set($this->tenantId);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    /** @return array{0:string,1:string,2:string,3:User} */
    private function newTenant(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => 'مؤسسة '.$slug, 'slug' => $slug.'-'.Str::random(5), 'vat_number' => '300000000000003',
            'cr_number' => '2050000001', 'country' => 'SA', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($tenant->id);
        Settings::put('company', [
            'building_no' => '2322', 'street' => 'Synthetic Street', 'additional_no' => '1234',
            'district' => 'Synthetic District', 'city' => 'Dammam', 'postal_code' => '32241',
        ], $tenant);
        $owner = User::create([
            'tenant_id' => $tenant->id, 'name' => 'المالك', 'email' => Str::random(8).'@t5.test', 'password' => 'password123', 'role' => 'owner',
        ]);
        $partner = Partner::create(['name' => 'عميل', 'type' => 'customer'])->id;
        $product = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false])->id;

        return [$tenant->id, $partner, $product, $owner];
    }

    private function gate(bool $open): void
    {
        config(['treasury.cash_sale_routing_enabled' => $open]);
    }

    private function activate(string $policy = 'main'): void
    {
        $this->gate(true);
        Settings::put('sales', ['cash_sale_treasury_policy' => $policy]);
    }

    private function user(string $role = 'admin'): User
    {
        return User::create([
            'tenant_id' => $this->tenantId, 'name' => 'مستخدم '.$role, 'email' => Str::random(8).'@t5.test', 'password' => 'password123', 'role' => $role,
        ]);
    }

    private function newTreasury(string $name = 'خزينة إضافية', string $type = 'cash'): CashBankAccount
    {
        $payload = ['type' => $type, 'name' => $name, 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'];
        if ($type === 'bank') {
            $payload += ['bank_name' => 'بنك', 'account_number' => 'SA'.random_int(1000, 9999).'0000'];
        }

        return CashBankAccount::with('account')->findOrFail(app(CashBankAccountService::class)->create($payload, $this->owner)->id);
    }

    private function entity(string $code): CashBankAccount
    {
        return CashBankAccount::with('account')->whereHas('account', fn ($q) => $q->where('code', $code))->firstOrFail();
    }

    private function makeMain(CashBankAccount $e): void
    {
        app(CashBankAccountService::class)->makeMain($e);
    }

    /** بيع نقدي مرحَّل: [مبلغ المدين = 115000 × الكمية]. */
    private function sale(array $extra = [], int $quantity = 3): Invoice
    {
        $svc = app(InvoiceService::class);
        $draft = $svc->create(
            array_merge(['partner_id' => $this->partnerId, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'], $extra),
            [['product_id' => $this->productId, 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => 100000, 'tax_rate' => 15]]
        );

        return $svc->post($draft, null, $this->owner);
    }

    private function note(Invoice $source, string $refund = 'cash', int $quantity = 1): CreditNote
    {
        return app(CreditNoteService::class)->create([
            'partner_id' => $source->partner_id, 'original_invoice_id' => $source->id, 'refund_type' => $refund,
        ], [['source_line_id' => $source->lines()->first()->id, 'quantity' => $quantity]]);
    }

    private function standalone(string $refund = 'cash'): CreditNote
    {
        Settings::put('sales', ['allow_standalone_credit_notes' => true]);

        return app(CreditNoteService::class)->create(
            ['partner_id' => $this->partnerId, 'type' => 'sales', 'refund_type' => $refund],
            [['description' => 'تسوية', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        );
    }

    private function postNote(CreditNote $note, ?User $actor = null): CreditNote
    {
        return app(CreditNoteService::class)->post(CreditNote::findOrFail($note->id), $actor ?? $this->owner);
    }

    /** @return array<int,string> "كود Dr|Cr مبلغ" مرتّبة */
    private function lines(string $sourceId): array
    {
        $entry = JournalEntry::with('lines.account')->where('source_id', $sourceId)->firstOrFail();
        $out = $entry->lines->map(fn ($l) => $l->account->code.($l->debit ? ' Dr '.$l->debit : ' Cr '.$l->credit))->all();
        sort($out);

        return $out;
    }

    private function snapshot(): array
    {
        return [
            'entries' => JournalEntry::count(),
            'chain' => DB::table('zatca_chain_entries')->count(),
            'icv' => (int) (DB::table('zatca_chains')->where('tenant_id', $this->tenantId)->value('last_icv') ?? 0),
        ];
    }

    private function reason(callable $fn): string
    {
        $e = $this->thrown($fn, 'يجب أن يُرفض', TreasurySelectionException::class);

        return $e->reason;
    }

    private const REFUND_1110 = ['1110 Cr 115000', '2120 Dr 15000', '4110 Dr 100000'];

    private function refunded(array $creditAccountLine): array
    {
        $l = ['2120 Dr 15000', '4110 Dr 100000', $creditAccountLine[0]];
        sort($l);

        return $l;
    }

    // ───────────────────────── legacy: دون تغيير ─────────────────────────

    /** @test */
    public function with_the_gate_closed_a_cash_note_credits_1110_exactly_as_before_even_without_withdraw_permission(): void
    {
        $sale = $this->sale();
        $stranger = $this->user();
        DB::table('cash_bank_accounts')->where('type', 'cash')->where('is_main', true)
            ->update(['withdraw_scope' => 'user', 'withdraw_scope_subject' => $stranger->id]);

        $note = $this->postNote($this->note($sale));          // المالك غير مخوَّل على السحب، ويرحَّل كما كان (لا تخويل على legacy)

        $this->assertSame('posted', $note->status);
        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($note->id));
    }

    /** @test */
    public function with_the_gate_closed_standalone_and_credit_sourced_cash_notes_still_post_to_1110(): void
    {
        $standalone = $this->postNote($this->standalone());
        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($standalone->id));

        $creditSale = $this->sale(['payment_type' => 'credit']);
        $note = $this->postNote($this->note($creditSale));
        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($note->id));
    }

    /** @test */
    public function a_stored_routed_policy_is_ignored_while_the_gate_is_closed(): void
    {
        $sale = $this->sale();
        $this->gate(false);
        Settings::put('sales', ['cash_sale_treasury_policy' => 'main']);

        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($this->postNote($this->note($sale))->id));
    }

    // ───────────────────────── التوجيه المشتقّ ─────────────────────────

    /** @test */
    public function a_cash_sale_collected_in_1110_before_activation_is_refunded_from_1110_identically(): void
    {
        $sale = $this->sale();                                   // قبل التفعيل: Dr 1110
        $legacy = $this->postNote($this->note($sale));
        $extra = $this->newTreasury();
        $this->makeMain($extra);                                 // الرئيسية صارت 1111
        $this->activate('main');

        $routed = $this->postNote($this->note($sale));

        $this->assertSame($this->lines($legacy->id), $this->lines($routed->id), 'قيد مطابق حرفياً — المشتقّ 1110 لا الرئيسية الحالية');
        $this->assertSame($this->refunded(['1110 Cr 115000']), $this->lines($routed->id));
    }

    /** @test */
    public function a_sale_routed_to_1111_is_refunded_from_1111_even_after_the_main_moves_again(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $this->assertSame('1111 Dr 345000', collect($this->lines($sale->id))->first(fn ($l) => str_starts_with($l, '1111')));

        $t1112 = $this->newTreasury('خزينة 1112');
        $this->makeMain($t1112);                                 // الرئيسية الآن 1112 — لا علاقة لها بالردّ

        $note = $this->postNote($this->note($sale));

        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($note->id));
    }

    /** @test */
    public function a_sale_with_a_negative_adjustment_has_two_debit_lines_and_only_the_treasury_line_is_used(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale(['adjustment' => -500]);
        $this->assertContains('5170 Dr 500', $this->lines($sale->id), 'قيد البيع يحمل سطر مدين ثانياً للتسوية');

        $note = $this->postNote($this->note($sale));

        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($note->id), 'الدائن هو الخزينة لا حساب التسوية');
    }

    /** @test */
    public function the_credit_refund_route_is_unchanged_when_routing_is_active(): void
    {
        $this->activate('main');
        $sale = $this->sale();

        $note = $this->postNote($this->note($sale, 'credit'));

        $this->assertSame($this->refunded(['1130 Cr 115000']), $this->lines($note->id));
    }

    // ───────────────────────── D-T5-2: المستقل والآجل مرفوضان مهما كانت السياسة ─────────────────────────

    /** @test */
    public function standalone_and_credit_sourced_cash_notes_are_rejected_under_both_policies_without_any_trace(): void
    {
        foreach (['main', 'explicit_required'] as $policy) {
            $this->activate($policy);
            $creditSale = $this->sale(['payment_type' => 'credit']);
            $paidSale = $this->sale(['is_paid' => true, 'payment_method' => 'cash']);
            $before = $this->snapshot();

            foreach ([$this->standalone(), $this->note($creditSale), $this->note($paidSale)] as $note) {
                $this->assertSame(TreasurySelectionException::REFUND_SOURCE_REQUIRED, $this->reason(fn () => $this->postNote($note)), $policy);
                $this->assertSame('draft', $note->fresh()->status);
            }
            $this->assertSame($before, $this->snapshot(), "بلا قيد ولا ICV ($policy)");
        }
    }

    /** @test */
    public function the_supported_alternative_credit_note_then_a_refund_voucher_posts_normally(): void
    {
        $this->activate('explicit_required');
        $creditSale = $this->sale(['payment_type' => 'credit']);

        $note = $this->postNote($this->note($creditSale, 'credit'));

        $this->assertSame($this->refunded(['1130 Cr 115000']), $this->lines($note->id));
    }

    // ───────────────────────── غموض/غياب خزينة المصدر ─────────────────────────

    /** @test */
    public function a_source_entry_with_several_treasury_debit_lines_or_none_is_rejected_never_guessed(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->activate('main');
        $sale = $this->sale();
        $noteTwo = $this->note($sale);
        $noteNone = $this->note($sale);
        $accounts = fn (string $code) => (string) DB::table('accounts')->where('tenant_id', $this->tenantId)->where('code', $code)->value('id');
        $seed = fn (array $lines) => app(LedgerService::class)->post($lines, [
            'entry_date' => now()->toDateString(), 'description' => 'قيد اختبار', 'source_type' => Invoice::class, 'source_id' => $sale->id,
        ])->id;

        // خزينتان في قيد المصدر
        DB::table('invoices')->where('id', $sale->id)->update(['journal_entry_id' => $seed([
            ['account_id' => $accounts('1110'), 'debit' => 50000],
            ['account_id' => $t1111->account_id, 'debit' => 65000],
            ['account_id' => $accounts('4110'), 'credit' => 115000],
        ])]);
        $this->assertSame(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED, $this->reason(fn () => $this->postNote($noteTwo)));

        // لا خزينة في قيد المصدر
        DB::table('invoices')->where('id', $sale->id)->update(['journal_entry_id' => $seed([
            ['account_id' => $accounts('5170'), 'debit' => 115000],
            ['account_id' => $accounts('4110'), 'credit' => 115000],
        ])]);
        $this->assertSame(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED, $this->reason(fn () => $this->postNote($noteNone)));
        $this->assertSame('draft', $noteTwo->fresh()->status);
        $this->assertSame('draft', $noteNone->fresh()->status);
    }

    // ───────────────────────── حالة الخزينة والعملة (بعد ترحيل البيع) ─────────────────────────

    /** @test */
    public function a_source_treasury_deactivated_after_the_sale_rejects_the_refund_with_no_fallback(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $note = $this->note($sale);
        $this->makeMain($this->entity('1110'));
        app(CashBankAccountService::class)->deactivate($t1111->fresh());
        $before = $this->snapshot();

        $this->assertSame(TreasurySelectionException::INACTIVE, $this->reason(fn () => $this->postNote($note)));

        $this->assertSame('draft', $note->fresh()->status);
        $this->assertSame($before, $this->snapshot());
        $this->assertSame(0, DB::table('journal_entries')->where('source_id', $note->id)->count(), 'لا سقوط إلى 1110 ولا إلى الرئيسية');
    }

    /** @test */
    public function a_source_treasury_in_another_currency_is_rejected(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $note = $this->note($sale);
        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['currency' => 'USD']);

        $this->assertSame(TreasurySelectionException::CURRENCY_MISMATCH, $this->reason(fn () => $this->postNote($note)));
        $this->assertSame('draft', $note->fresh()->status);
    }

    /** @test */
    public function a_source_account_that_is_no_longer_a_valid_treasury_ledger_account_is_rejected(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $note = $this->note($sale);

        DB::table('accounts')->where('id', $t1111->account_id)->update(['is_active' => false]);
        $this->assertSame(TreasurySelectionException::GL_ACCOUNT_INACTIVE, $this->reason(fn () => $this->postNote($note)));
        DB::table('accounts')->where('id', $t1111->account_id)->update(['is_active' => true]);

        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($this->postNote($note)->id), 'سليم بعد الإصلاح');
    }

    // ───────────────────────── صلاحية السحب ─────────────────────────

    /** @test */
    public function the_withdraw_scope_of_the_resolved_treasury_is_enforced_and_deposit_is_not_enough(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $admin = $this->user('admin');
        $note = $this->note($sale);
        $before = $this->snapshot();

        // الإيداع مفتوح للجميع، والسحب لمستخدم آخر فقط
        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update([
            'deposit_scope' => 'all', 'withdraw_scope' => 'user', 'withdraw_scope_subject' => $admin->id,
        ]);
        $this->assertSame(TreasurySelectionException::NOT_PERMITTED, $this->reason(fn () => $this->postNote($note, $this->owner)));
        $this->assertSame($before, $this->snapshot());
        $this->assertSame('draft', $note->fresh()->status);

        // بلا فاعل: فشل مغلق لنطاق مقيَّد
        $this->assertSame(TreasurySelectionException::NOT_PERMITTED, $this->reason(
            fn () => app(CreditNoteService::class)->post(CreditNote::findOrFail($note->id))
        ));

        // المخوَّل يرحّل
        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($this->postNote($note, $admin)->id));
    }

    /** @test */
    public function role_scoped_withdraw_is_checked_per_role(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['withdraw_scope' => 'role', 'withdraw_scope_subject' => 'admin']);

        $this->assertSame(TreasurySelectionException::NOT_PERMITTED, $this->reason(fn () => $this->postNote($this->note($sale), $this->owner)));
        $this->assertSame('posted', $this->postNote($this->note($sale), $this->user('admin'))->status);
    }

    /** @test */
    public function the_http_endpoint_passes_the_authenticated_actor_to_the_withdraw_check(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $note = $this->note($sale);
        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['withdraw_scope' => 'role', 'withdraw_scope_subject' => 'admin']);

        $applications = app(\App\Services\TenantApplicationService::class);
        foreach (\App\Support\ApplicationCatalog::all() as $key => $application) {
            if (! $application['mandatory'] && $application['maturity'] === \App\Support\ApplicationCatalog::MATURITY_BUILT) {
                $applications->enable($key, null);
            }
        }
        \Laravel\Sanctum\Sanctum::actingAs($this->owner, ['*']);
        $this->postJson("/api/credit-notes/{$note->id}/post")->assertStatus(422);
        $this->assertSame('draft', $note->fresh()->status);

        \Laravel\Sanctum\Sanctum::actingAs($this->user('admin'), ['*']);
        $this->postJson("/api/credit-notes/{$note->id}/post")->assertOk();
        $this->assertSame($this->refunded(['1111 Cr 115000']), $this->lines($note->id));
    }

    // ───────────────────────── عزل المستأجرين ─────────────────────────

    /** @test */
    public function another_tenants_invoice_or_entry_never_resolves_a_treasury(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $sale = $this->sale();
        $noteA = $this->note($sale);

        // مستأجر آخر بفاتورته النقدية
        [$otherTenant, $otherPartner, $otherProduct, $otherOwner] = $this->newTenant('t5-other');
        $svc = app(InvoiceService::class);
        $foreign = $svc->post($svc->create(
            ['partner_id' => $otherPartner, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'],
            [['product_id' => $otherProduct, 'description' => 'x', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ), null, $otherOwner);
        $foreignEntry = $foreign->journal_entry_id;
        app(TenantContext::class)->set($this->tenantId);

        // 1) إشعار لا يستطيع الإشارة إلى فاتورة مستأجر آخر
        $notesBefore = CreditNote::count();
        $e = $this->thrown(fn () => app(CreditNoteService::class)->create(
            ['partner_id' => $this->partnerId, 'original_invoice_id' => $foreign->id, 'refund_type' => 'cash'],
            [['source_line_id' => $foreign->lines()->withoutGlobalScopes()->first()->id, 'quantity' => 1]]
        ), 'يجب أن يُرفض');
        $this->assertTrue(str_contains($e->getMessage(), 'غير موجودة') || str_contains($e->getMessage(), 'No query results'), 'فاتورة المستأجر الآخر غير مرئية: '.$e->getMessage());
        $this->assertSame($notesBefore, CreditNote::count(), 'لا مسودة أُنشئت');

        // 2) قيد مصدر مزروع من مستأجر آخر لا يُرى (قراءة مقيَّدة بالمستأجر) فلا خزينة مشتقّة
        DB::table('invoices')->where('id', $sale->id)->update(['journal_entry_id' => $foreignEntry]);
        $this->assertSame(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED, $this->reason(fn () => $this->postNote($noteA)));
        $this->assertSame('draft', $noteA->fresh()->status);
    }

    /**
     * مراجع غير سليمة مزروعة بـSQL خام داخل قيد البيع (لا يصنعها أي مسار تطبيقي): سطر مدين لمستأجر آخر على قيدنا، ثم حساب خزينة
     * لمستأجر آخر على سطر مدين يحمل مستأجرنا. كل القراءات في المحلِّل مقيَّدة بالمستأجر: لا شيء من مستأجر آخر يُرى ولا يُستعمل ولا يظهر في القيد.
     *
     * @test
     */
    public function planted_cross_tenant_lines_and_accounts_inside_the_source_entry_are_never_seen_or_used(): void
    {
        $this->activate('main');
        $sale = $this->sale();
        $ours = $this->entity('1110');

        [$otherTenant] = $this->newTenant('t5-other-planted');
        app(CashBankAccountService::class)->bootstrapDefaults();
        $foreignTreasuryAccount = DB::table('cash_bank_accounts')->where('tenant_id', $otherTenant)->where('type', 'cash')->value('account_id');
        $this->assertNotNull($foreignTreasuryAccount, 'خزينة المستأجر الآخر موجودة');
        app(TenantContext::class)->set($this->tenantId);

        // (أ) سطر مدين يحمل tenant_id المستأجر الآخر وحسابه، على قيد بيعنا: غير مرئي ⇒ تبقى خزينتنا الوحيدة 1110 ويُرحَّل منها.
        DB::table('journal_lines')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $otherTenant, 'journal_entry_id' => $sale->journal_entry_id,
            'account_id' => $foreignTreasuryAccount, 'debit' => 5, 'credit' => 0, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $note = $this->postNote($this->note($sale), $this->owner);
        $this->assertSame('posted', $note->status);
        $accounts = DB::table('journal_lines')->where('journal_entry_id', $note->journal_entry_id)->pluck('account_id')->all();
        $this->assertContains($ours->account_id, $accounts, 'الاسترداد من خزينتنا المشتقّة');
        $this->assertNotContains($foreignTreasuryAccount, $accounts, 'لا أثر لحساب مستأجر آخر في القيد');
        $this->assertSame($this->tenantId, DB::table('journal_entries')->where('id', $note->journal_entry_id)->value('tenant_id'));

        // (ب) سطر مدين يحمل مستأجرنا لكن حسابه لمستأجر آخر (وحذف سطر خزينتنا): الكيان الأجنبي غير مرئي ⇒ لا خزينة مشتقّة، فشل مغلق.
        $sale2 = $this->sale();
        DB::table('journal_lines')->where('journal_entry_id', $sale2->journal_entry_id)->where('debit', '>', 0)
            ->update(['account_id' => $foreignTreasuryAccount]);
        $draft = $this->note($sale2);
        $before = $this->snapshot();
        $this->assertSame(TreasurySelectionException::SOURCE_TREASURY_UNRESOLVED, $this->reason(fn () => $this->postNote($draft, $this->owner)));
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame($before, $this->snapshot(), 'الرفض لم يترك أثراً');
    }

    /** @test */
    public function the_resolver_reads_only_through_tenant_scoped_models_and_never_by_raw_sql(): void
    {
        $src = file_get_contents(app_path('Services/Accounting/CreditNoteRefundTreasuryResolver.php'));
        $this->assertStringNotContainsString('withoutGlobalScope', $src);
        $this->assertStringNotContainsString('DB::table', $src);
        $this->assertStringNotContainsString('DB::select', $src);
        $this->assertStringNotContainsString('->toBase()', $src);
        $this->assertStringNotContainsString('tenant_id', $src, 'لا معرّف مستأجر يُمرَّر من المدخلات');
    }

    // ───────────────────────── الذرّية والتراجع ─────────────────────────

    /** @test */
    public function a_rejection_leaves_no_entry_icv_or_chain_change_and_the_fixed_note_posts_exactly_once(): void
    {
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $this->gateZatca();
        $sale = $this->sale();
        $note = $this->note($sale);
        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['is_active' => false]);
        $before = $this->snapshot();

        $this->assertSame(TreasurySelectionException::INACTIVE, $this->reason(fn () => $this->postNote($note)));
        $this->assertSame($before, $this->snapshot(), 'لا قيد ولا ICV ولا مدخل سلسلة');
        $row = DB::table('credit_notes')->where('id', $note->id)->first();
        $this->assertSame('draft', $row->status);
        $this->assertNull($row->journal_entry_id);
        $this->assertNull($row->zatca_icv);

        DB::table('cash_bank_accounts')->where('id', $t1111->id)->update(['is_active' => true]);
        $posted = $this->postNote($note);
        $this->assertSame(1, DB::table('journal_entries')->where('source_id', $posted->id)->count());
        $this->assertSame($before['chain'] + 1, DB::table('zatca_chain_entries')->count());

        $this->thrown(fn () => $this->postNote($note), 'إعادة الترحيل تُرفض');
        $this->assertSame(1, DB::table('journal_entries')->where('source_id', $posted->id)->count(), 'لا قيد ثانٍ');
    }

    // ───────────────────────── ZATCA ─────────────────────────

    private function gateZatca(): void
    {
        $admin = PlatformAdministrator::create([
            'name' => 'مدير منصة', 'email' => Str::random(10).'@platform.test', 'password' => 'secret-password-1', 'is_active' => true,
        ]);
        app(ZatcaRolloutControlService::class)->setTenantState($admin, $this->tenantId, true, 'تفعيل تجريبي للاختبار');
    }

    /** @test */
    public function zatca_documents_do_not_depend_on_the_refunded_treasury_and_the_chain_stays_contiguous(): void
    {
        $this->gateZatca();
        $saleA = $this->sale();                                   // قبل التوجيه: Dr 1110
        $t1111 = $this->newTreasury('خزينة 1111');
        $this->makeMain($t1111);
        $this->activate('main');
        $saleB = $this->sale();                                   // موجَّه: Dr 1111

        $a = $this->postNote($this->note($saleA));                // Cr 1110
        $b = $this->postNote($this->note($saleB));                // Cr 1111
        $this->assertContains('1110 Cr 115000', $this->lines($a->id));
        $this->assertContains('1111 Cr 115000', $this->lines($b->id));

        $ra = DB::table('credit_notes')->where('id', $a->id)->first();
        $rb = DB::table('credit_notes')->where('id', $b->id)->first();
        $this->assertSame('generated', $rb->zatca_status);
        $this->assertSame((int) $ra->zatca_icv + 1, (int) $rb->zatca_icv, 'ICV متتابع');
        $this->assertSame($ra->zatca_hash, $rb->zatca_previous_hash, 'PIH = هاش السابق');
        foreach ([$t1111->account_id, $t1111->id, '1111'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $rb->zatca_xml, 'XML لا يذكر الخزينة');
        }
        $skeleton = fn (string $xml) => preg_match_all('/<([A-Za-z0-9:]+)[ >\/]/', $xml, $m) ? $m[1] : [];
        $this->assertSame($skeleton($ra->zatca_xml), $skeleton($rb->zatca_xml), 'بنية المستند واحدة');
        foreach (['PayableAmount', 'TaxAmount', 'TaxInclusiveAmount'] as $tag) {
            preg_match('/<cbc:'.$tag.'[^>]*>([^<]+)</', $ra->zatca_xml, $x);
            preg_match('/<cbc:'.$tag.'[^>]*>([^<]+)</', $rb->zatca_xml, $y);
            $this->assertSame($x[1] ?? null, $y[1] ?? null, $tag);
        }
    }

    // ───────────────────────── حارس ثابت ─────────────────────────

    /** @test */
    public function only_the_routed_paths_use_the_treasury_resolver_namely_sale_credit_note_and_pos_refund(): void
    {
        $users = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'))) as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $path = str_replace('\\', '/', $file->getPathname());
            if (str_ends_with($path, '/TreasurySelectionResolver.php') || str_contains($path, '/app/Support/')) {
                continue;   // العقد نفسه وقيمه المساندة (تعليقات فقط)؛ المستدعون في الخدمات
            }
            if (preg_match('/\bTreasurySelectionResolver\b/', (string) file_get_contents($file->getPathname()))) {
                $users[] = basename($path);
            }
        }
        sort($users);
        $this->assertSame(['CreditNoteRefundTreasuryResolver.php', 'InvoiceService.php', 'PosCashRefundTreasuryResolver.php'], $users, 'T4 البيع وT5 الاسترداد وT6 ردّ POS؛ المرتجعات والاستبدال تستعمل مُحلِّلَي T5/T6 لا المحلِّل العام مباشرة');

        // T6: المرتجعات توجَّه عبر مُحلِّلَي الاسترداد، وحارس T4 يبقى على فرع legacy فقط.
        $returns = (string) file_get_contents(base_path('app/Services/Accounting/ReturnService.php'));
        $this->assertStringContainsString('CreditNoteRefundTreasuryResolver', $returns);
        $this->assertStringContainsString('PosCashRefundTreasuryResolver', $returns);
        $this->assertStringContainsString('CashSaleRefundGuard', $returns, 'حارس T4 يبقى على فرع legacy');
    }

    /** @test */
    public function no_hard_coded_1110_remains_on_the_routed_branch_and_nothing_catches_the_resolver_failures(): void
    {
        $service = (string) file_get_contents(base_path('app/Services/Accounting/CreditNoteService.php'));
        $this->assertStringContainsString('CreditNoteRefundTreasuryResolver::class', $service);
        // الحساب النقدي من المسار الموجَّه أولاً، و1110 فقط كبديل المسار القديم (`?? ACC_CASH`)
        $this->assertStringContainsString('($cashAccountId ?? $this->accountId(self::ACC_CASH))', $service);

        $resolver = (string) file_get_contents(base_path('app/Services/Accounting/CreditNoteRefundTreasuryResolver.php'));
        $this->assertDoesNotMatchRegularExpression("/'1110'|\"1110\"|catch\\s*\\(/", preg_replace('#/\*.*?\*/#s', '', $resolver));
    }
}

<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\CreditNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\Accounting\ReturnService;
use App\Support\CashSaleTreasuryPolicy;
use App\Support\Settings;
use App\Support\TreasurySelectionException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Tests\TestCase;

/**
 * TREASURY-T4 — توجيه خزينة البيع النقدي المباشر عبر عقد T3، **مغلق افتراضياً**.
 *
 * يغطي: السلوك القائم (legacy) بكل صوره، السياسة `main` و`explicit_required`، الاختيار الصريح وفحصه، الرفض بلا سقوط إلى 1110،
 * التخويل على الكيان المحلول، الذرّية والتراجع، تطابق بقية القيد وZATCA، حارس الردّ النقدي، وعزل المستأجرين.
 * مبالغ بالهللات: فاتورة 1000 + 15% = 115000.
 */
class TreasuryCashSaleRoutingTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;

    private array $auth;
    private string $tenantId;
    private string $partnerId;
    private string $productId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('t4-main', 'owner@t4-main.test');
        $this->tenantId = $this->auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
        $this->partnerId = Partner::create(['name' => 'عميل نقدي', 'type' => 'customer'])->id;
        $this->productId = Product::create(['name' => 'خدمة', 'type' => 'service', 'track_inventory' => false])->id;
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function gate(bool $open): void
    {
        config(['treasury.cash_sale_routing_enabled' => $open]);
    }

    /** يخزّن السياسة مباشرةً (محاكاةً لقيمة مخزَّنة قبل/خارج الـAPI). */
    private function store(string $policy): void
    {
        Settings::put('sales', ['cash_sale_treasury_policy' => $policy]);
    }

    private function activate(string $policy): void
    {
        $this->gate(true);
        $this->store($policy);
    }

    private function newTreasury(string $type = 'cash', string $name = 'خزينة إضافية'): CashBankAccount
    {
        $payload = ['type' => $type, 'name' => $name, 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'];
        if ($type === 'bank') {
            $payload += ['bank_name' => 'بنك تجريبي', 'account_number' => 'SA'.random_int(1000, 9999).'0000'];
        }
        $id = $this->withToken($this->auth['token'])->postJson('/api/cash-bank-accounts', $payload)->assertCreated()->json('data.id');

        return CashBankAccount::with('account')->findOrFail($id);
    }

    private function entity(string $code): CashBankAccount
    {
        return CashBankAccount::with('account')->whereHas('account', fn ($q) => $q->where('code', $code))->firstOrFail();
    }

    private function makeMain(CashBankAccount $e): void
    {
        app(CashBankAccountService::class)->makeMain($e);
    }

    private function draft(array $extra = [], int $unitPrice = 100000, int $quantity = 1): Invoice
    {
        return app(InvoiceService::class)->create(
            array_merge(['partner_id' => $this->partnerId, 'payment_type' => 'cash', 'zatca_document_type' => 'simplified'], $extra),
            [['product_id' => $this->productId, 'description' => 'خدمة', 'quantity' => $quantity, 'unit_price' => $unitPrice, 'tax_rate' => 15]]
        );
    }

    private function postInv(Invoice $invoice, ?User $actor = null): Invoice
    {
        return app(InvoiceService::class)->post($invoice, null, $actor ?? $this->owner());
    }

    private function owner(): User
    {
        return User::where('tenant_id', $this->tenantId)->where('email', 'owner@t4-main.test')->sole();
    }

    /** @return array<int, string> "كود Dr|Cr مبلغ" مرتّبة — للمقارنة قبل/بعد. */
    private function lines(JournalEntry|string|null $entryOrSourceId): array
    {
        $entry = $entryOrSourceId instanceof JournalEntry
            ? $entryOrSourceId
            : JournalEntry::with('lines.account')->where('source_id', $entryOrSourceId)->firstOrFail();
        $entry->loadMissing('lines.account');
        $out = $entry->lines->map(fn ($l) => $l->account->code.($l->debit ? ' Dr '.$l->debit : ' Cr '.$l->credit))->all();
        sort($out);

        return $out;
    }

    private function debitCode(Invoice $posted): string
    {
        return JournalEntry::with('lines.account')->where('source_id', $posted->id)->firstOrFail()
            ->lines->first(fn ($l) => $l->debit > 0)->account->code;
    }

    private function entryCount(): int
    {
        return JournalEntry::count();
    }

    private function failure(callable $fn, string $class = RuntimeException::class): \Throwable
    {
        return $this->thrown($fn, 'يجب أن يُرفض', $class);
    }

    private function assertReason(string $reason, callable $fn): void
    {
        $e = $this->failure($fn, TreasurySelectionException::class);
        $this->assertSame($reason, $e->reason);
    }

    private const BASE_SALE = ['4110 Cr 100000', '2120 Cr 15000'];

    // ───────────────────────── السلوك القائم (legacy) ─────────────────────────

    /** @test */
    public function legacy_default_posts_to_1110_and_matches_the_historical_entry(): void
    {
        $this->assertSame('legacy', Settings::get('sales', 'cash_sale_treasury_policy'));
        $this->assertSame('legacy', CashSaleTreasuryPolicy::effective());

        $posted = $this->postInv($this->draft());

        $this->normalized($posted);
    }

    private function normalized(Invoice $posted): array
    {
        $l = $this->lines($posted->id);
        $expected = array_merge(['1110 Dr 115000'], self::BASE_SALE);
        sort($expected);
        $this->assertSame($expected, $l);

        return $expected;
    }

    /** @test */
    public function legacy_ignores_the_main_treasury_and_the_stored_cash_account_id_exactly_as_before(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);

        $posted = $this->postInv($this->draft(['cash_account_id' => $extra->account_id]));

        $this->assertSame('1110', $this->debitCode($posted), 'الأصل: الصندوق 1110 دوماً، الرئيسية و cash_account_id متجاهَلان');
        $this->normalized($posted);
    }

    /** @test */
    public function a_stored_non_legacy_policy_is_ignored_while_the_gate_is_closed(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->gate(false);
        $this->store('main');

        $this->assertSame('main', CashSaleTreasuryPolicy::configured());
        $this->assertSame('legacy', CashSaleTreasuryPolicy::effective());

        $this->assertSame('1110', $this->debitCode($this->postInv($this->draft())));
        $this->assertSame('1110', $this->debitCode($this->postInv($this->draft(['cash_account_id' => $extra->account_id]))));
    }

    /** @test */
    public function an_open_gate_with_the_legacy_policy_still_posts_to_1110(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('legacy');

        $this->assertSame('1110', $this->debitCode($this->postInv($this->draft(['cash_account_id' => $extra->account_id]))));
    }

    /** @test */
    public function legacy_keeps_tolerating_an_unvalidated_cash_account_id_on_the_draft(): void
    {
        $bank = $this->newTreasury('bank', 'بنك');

        $draft = $this->draft(['cash_account_id' => $bank->account_id]);   // لا رفض عند الحفظ (سلوك اليوم)
        $this->assertSame($bank->account_id, $draft->cash_account_id);
        $this->assertSame('1110', $this->debitCode($this->postInv($draft)));
    }

    // ───────────────────────── الإعداد (API) ─────────────────────────

    /** @test */
    public function the_settings_api_accepts_only_legacy_while_the_gate_is_closed_and_reports_availability(): void
    {
        $t = $this->auth['token'];
        $show = $this->withToken($t)->getJson('/api/sales-settings')->assertOk();
        $show->assertJsonPath('data.cash_sale_treasury_policy', 'legacy')
            ->assertJsonPath('data.cash_sale_treasury_routing_available', false)
            ->assertJsonPath('data.cash_sale_treasury_policy_effective', 'legacy');

        $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'main'])
            ->assertStatus(422)->assertJsonValidationErrors('cash_sale_treasury_policy');
        $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'explicit_required'])->assertStatus(422);
        $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'bogus'])->assertStatus(422);
        $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'legacy'])->assertOk()
            ->assertJsonPath('data.cash_sale_treasury_policy', 'legacy');
        $this->assertSame('legacy', Settings::get('sales', 'cash_sale_treasury_policy'));
    }

    /** @test */
    public function the_settings_api_accepts_every_policy_once_the_gate_is_open_and_other_settings_are_untouched(): void
    {
        $t = $this->auth['token'];
        $this->gate(true);
        $before = Settings::get('sales', 'default_tax_rate');

        foreach (['main', 'explicit_required', 'legacy'] as $policy) {
            $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => $policy])->assertOk()
                ->assertJsonPath('data.cash_sale_treasury_policy', $policy)
                ->assertJsonPath('data.cash_sale_treasury_routing_available', true)
                ->assertJsonPath('data.cash_sale_treasury_policy_effective', $policy);
        }
        $this->assertSame($before, Settings::get('sales', 'default_tax_rate'));
        $this->withToken($t)->putJson('/api/sales-settings', ['cash_sale_treasury_policy' => 'nope'])->assertStatus(422);
    }

    // ───────────────────────── MainOfType ─────────────────────────

    /** @test */
    public function main_policy_with_main_on_1110_produces_the_same_entry_as_legacy(): void
    {
        $legacy = $this->postInv($this->draft());
        $this->activate('main');
        $routed = $this->postInv($this->draft());

        $this->assertSame($this->lines($legacy->id), $this->lines($routed->id));
        $this->assertSame('1110', $this->debitCode($routed));
        $this->assertSame($legacy->total, $routed->total);
        $this->assertSame($legacy->tax_amount, $routed->tax_amount);
    }

    /** @test */
    public function main_policy_routes_an_omitted_selection_to_the_main_treasury(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');

        $posted = $this->postInv($this->draft());

        $this->assertSame('1111', $this->debitCode($posted));
        $this->assertSame($this->sorted(array_merge(['1111 Dr 115000'], self::BASE_SALE)), $this->lines($posted->id));
    }

    private function sorted(array $a): array
    {
        sort($a);

        return $a;
    }

    /** @test */
    public function an_explicit_selection_wins_over_the_main_treasury(): void
    {
        $extra = $this->newTreasury();                       // 1111، ليست الرئيسية
        $this->activate('main');

        $this->assertTrue((bool) $this->entity('1110')->is_main);
        $this->assertSame('1111', $this->debitCode($this->postInv($this->draft(['cash_account_id' => $extra->account_id]))));
        $this->assertSame('1110', $this->debitCode($this->postInv($this->draft(['cash_account_id' => $this->entity('1110')->account_id]))));
    }

    /** @test */
    public function the_revenue_and_vat_lines_and_totals_are_identical_whatever_the_debited_treasury(): void
    {
        $legacy = $this->postInv($this->draft());
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');
        $routed = $this->postInv($this->draft());

        $this->assertSame('1110', $this->debitCode($legacy));
        $this->assertSame('1111', $this->debitCode($routed));
        $this->assertSame(
            array_values(array_filter($this->lines($legacy->id), fn ($l) => ! str_starts_with($l, '1110'))),
            array_values(array_filter($this->lines($routed->id), fn ($l) => ! str_starts_with($l, '1111'))),
            'ما عدا السطر المدين: الإيراد والضريبة متطابقان'
        );
        foreach (['subtotal', 'tax_amount', 'total', 'discount', 'shipping', 'adjustment'] as $f) {
            $this->assertSame($legacy->{$f}, $routed->{$f}, $f);
        }
        $this->assertSame(115000, $routed->total);
        $this->assertSame(15000, $routed->tax_amount);
    }

    // ───────────────────────── ExplicitRequired ─────────────────────────

    /** @test */
    public function explicit_required_rejects_a_missing_selection_leaves_the_draft_and_accepts_an_explicit_one(): void
    {
        $extra = $this->newTreasury();
        $this->activate('explicit_required');
        $draft = $this->draft();
        $before = $this->entryCount();

        $this->assertReason(TreasurySelectionException::EXPLICIT_REQUIRED, fn () => $this->postInv($draft));
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame($before, $this->entryCount());

        $with = $this->draft(['cash_account_id' => $extra->account_id]);
        $this->assertSame('1111', $this->debitCode($this->postInv($with)));
        $withLegacyId = $this->draft(['cash_account_id' => $this->entity('1110')->account_id]);
        $this->assertSame('1110', $this->debitCode($this->postInv($withLegacyId)));
    }

    // ───────────────────────── اختيار غير صالح (لا سقوط إلى 1110) ─────────────────────────

    /** @test */
    public function invalid_explicit_selections_are_rejected_at_save_and_at_post(): void
    {
        $bank = $this->newTreasury('bank', 'بنك');
        $cash = $this->newTreasury('cash', 'خزينة');
        $stray = Account::create([
            'parent_id' => Account::where('code', '111')->value('id'), 'code' => '1119', 'name' => 'ليس خزينة', 'type' => 'asset',
            'normal_balance' => 'debit', 'is_group' => false, 'is_system' => false, 'currency' => 'SAR', 'is_active' => true,
        ]);
        $this->activate('main');
        $before = $this->entryCount();

        // عند الحفظ (create)
        $this->assertReason(TreasurySelectionException::WRONG_TYPE, fn () => $this->draft(['cash_account_id' => $bank->account_id]));
        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->draft(['cash_account_id' => $stray->id]));
        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->draft(['cash_account_id' => (string) Account::where('code', '1130')->value('id')]));
        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->draft(['cash_account_id' => '1110']));

        // عند الحفظ (update) وعند الترحيل: مسوّدة سليمة ثم تُعطَّل الخزينة
        $good = $this->draft(['cash_account_id' => $cash->account_id]);
        app(CashBankAccountService::class)->deactivate($cash->fresh());
        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->postInv($good));
        $this->assertSame('draft', $good->fresh()->status);
        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => app(InvoiceService::class)->update(
            $good->fresh(), ['partner_id' => $this->partnerId, 'cash_account_id' => $cash->account_id],
            [['product_id' => $this->productId, 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]
        ));

        $this->assertSame($before, $this->entryCount(), 'لا قيد من أي رفض');
        $this->assertSame(0, JournalEntry::whereHas('lines.account', fn ($q) => $q->where('code', '1110'))->where('source_type', Invoice::class)->count(), 'لا سقوط صامت إلى 1110');
    }

    /** @test */
    public function an_inactive_group_or_non_asset_ledger_account_is_rejected_at_post(): void
    {
        $cash = $this->newTreasury();
        $this->activate('main');
        $draft = $this->draft(['cash_account_id' => $cash->account_id]);

        DB::table('accounts')->where('id', $cash->account_id)->update(['is_active' => false]);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INACTIVE, fn () => $this->postInv($draft));
        DB::table('accounts')->where('id', $cash->account_id)->update(['is_active' => true, 'is_group' => true]);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INVALID, fn () => $this->postInv($draft));
        DB::table('accounts')->where('id', $cash->account_id)->update(['is_group' => false, 'type' => 'expense']);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INVALID, fn () => $this->postInv($draft));
        DB::table('accounts')->where('id', $cash->account_id)->update(['type' => 'asset']);

        $this->assertSame('1111', $this->debitCode($this->postInv($draft)), 'سليم بعد الإصلاح');
    }

    /** @test */
    public function an_inactive_missing_or_ambiguous_main_is_rejected_and_never_replaced_by_1110(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');
        $before = $this->entryCount();

        // الرئيسية معطَّلة
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => false]);
        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->postInv($this->draft()));

        // لا رئيسية وأكثر من مرشّح نشط
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => true]);
        DB::table('cash_bank_accounts')->where('type', 'cash')->update(['is_main' => false]);
        $this->assertReason(TreasurySelectionException::AMBIGUOUS_DEFAULT, fn () => $this->postInv($this->draft()));

        // لا رئيسية ومرشّح وحيد: لا يُرقَّى
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => false]);
        $this->assertReason(TreasurySelectionException::NO_DEFAULT, fn () => $this->postInv($this->draft()));

        $this->assertSame($before, $this->entryCount());
    }

    // ───────────────────────── عزل المستأجرين ─────────────────────────

    /** @test */
    public function another_tenants_treasury_is_rejected_by_the_api_and_by_the_service(): void
    {
        $other = $this->registerTenant('t4-other', 'owner@t4-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $foreign = CashBankAccount::with('account')->where('type', 'cash')->where('is_main', true)->firstOrFail();
        app(TenantContext::class)->set($this->tenantId);
        $this->activate('main');

        // الـAPI (ملكية المستأجر)
        $this->withToken($this->auth['token'])->postJson('/api/invoices', [
            'partner_id' => $this->partnerId, 'payment_type' => 'cash', 'cash_account_id' => $foreign->account_id,
            'items' => [['product_id' => $this->productId, 'description' => 'خدمة', 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 15]],
        ])->assertStatus(422);

        // الخدمة (تجاوز الـAPI): معرّف غريب = not_found بالرسالة نفسها لمعرّف غير موجود
        $e1 = $this->failure(fn () => $this->draft(['cash_account_id' => $foreign->account_id]), TreasurySelectionException::class);
        $e2 = $this->failure(fn () => $this->draft(['cash_account_id' => (string) \Illuminate\Support\Str::uuid()]), TreasurySelectionException::class);
        $this->assertSame('not_found', $e1->reason);
        $this->assertSame($e2->getMessage(), $e1->getMessage());

        // مسوّدة مزروعة بمعرّف غريب خارج الحفظ (SQL خام) لا تُرحَّل
        $draft = $this->draft();
        DB::table('invoices')->where('id', $draft->id)->update(['cash_account_id' => $foreign->account_id]);
        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->postInv($draft->fresh()));
        $this->assertSame('draft', $draft->fresh()->status);
    }

    /** @test */
    public function the_policy_is_per_tenant_and_one_tenants_main_never_affects_another(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');
        $a = $this->postInv($this->draft());
        $this->assertSame('1111', $this->debitCode($a));

        $other = $this->registerTenant('t4-other2', 'owner@t4-other2.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $this->assertSame('legacy', Settings::get('sales', 'cash_sale_treasury_policy'), 'الافتراضي لكل مستأجر');
        $otherPartner = Partner::create(['name' => 'ع', 'type' => 'customer'])->id;
        $otherProduct = Product::create(['name' => 'خ', 'type' => 'service', 'track_inventory' => false])->id;
        $svc = app(InvoiceService::class);
        $inv = $svc->post($svc->create(['partner_id' => $otherPartner, 'payment_type' => 'cash'],
            [['product_id' => $otherProduct, 'description' => 'خ', 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]),
            null, User::where('email', 'owner@t4-other2.test')->sole());

        $this->assertSame('1110', $this->debitCode($inv), 'مستأجر على legacy يبقى على 1110 والبوابة مفتوحة');
    }

    // ───────────────────────── الصلاحيات ─────────────────────────

    /** @test */
    public function deposit_authorization_is_checked_on_the_resolved_treasury_and_is_atomic(): void
    {
        $extra = $this->newTreasury();
        $stranger = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'محاسب آخر', 'email' => 'stranger@t4-main.test', 'password' => 'password123', 'role' => 'admin',
        ]);
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['deposit_scope' => 'user', 'deposit_scope_subject' => $stranger->id]);
        $this->makeMain($extra->fresh());
        $this->activate('main');
        $draft = $this->draft();
        $before = ['entries' => $this->entryCount(), 'chain' => DB::table('zatca_chain_entries')->count()];

        // المالك غير مخوَّل على الخزينة المحلولة (1111) رغم أنه مخوَّل على 1110
        $e = $this->failure(fn () => $this->postInv($draft, $this->owner()), TreasurySelectionException::class);
        $this->assertSame('not_permitted', $e->reason);
        $this->assertSame('draft', $draft->fresh()->status);
        $this->assertSame($before, ['entries' => $this->entryCount(), 'chain' => DB::table('zatca_chain_entries')->count()], 'لا قيد ولا ICV');

        // المخوَّل يرحّل على 1111
        $this->assertSame('1111', $this->debitCode($this->postInv($draft, $stranger)));

        // وبلا فاعل: يفشل مغلقاً لنطاق غير all
        $d2 = $this->draft();
        $this->assertReason(TreasurySelectionException::NOT_PERMITTED, fn () => app(InvoiceService::class)->post($d2));
    }

    // ───────────────────────── الإعادة والذرّية والتراجع ─────────────────────────

    /** @test */
    public function reposting_is_rejected_and_a_failed_post_leaves_no_trace(): void
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');

        $posted = $this->postInv($this->draft());
        $this->assertSame(1, JournalEntry::where('source_id', $posted->id)->count());
        $this->failure(fn () => $this->postInv($posted));
        $this->assertSame(1, JournalEntry::where('source_id', $posted->id)->count(), 'لا قيد ثانٍ');

        $icv = DB::table('zatca_chain_entries')->count();
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => false]);
        $draft = $this->draft();
        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->postInv($draft));
        $fresh = $draft->fresh();
        $this->assertSame('draft', $fresh->status);
        $this->assertNull($fresh->journal_entry_id);
        $this->assertNull($fresh->zatca_icv);
        $this->assertNull($fresh->issued_at);
        $this->assertSame($icv, DB::table('zatca_chain_entries')->count(), 'لم يُستهلك ICV');

        // وبعد الإصلاح يُرحَّل مرة واحدة فقط
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => true]);
        $again = $this->postInv($draft->fresh());
        $this->assertSame(1, JournalEntry::where('source_id', $again->id)->count());
        $this->assertSame($icv + 1, DB::table('zatca_chain_entries')->count());
    }

    /** @test */
    public function posted_entries_are_never_rewritten_when_the_main_or_the_policy_changes_later(): void
    {
        $legacy = $this->postInv($this->draft());
        $snapshot = DB::table('journal_lines')->where('journal_entry_id', $legacy->journal_entry_id)->orderBy('id')->get(['id', 'account_id', 'debit', 'credit'])->toArray();

        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');
        $routed = $this->postInv($this->draft());

        $after = DB::table('journal_lines')->where('journal_entry_id', $legacy->journal_entry_id)->orderBy('id')->get(['id', 'account_id', 'debit', 'credit'])->toArray();
        $this->assertEquals($snapshot, $after);
        $this->assertSame('1110', $this->debitCode($legacy->fresh()));
        $this->assertSame('1111', $this->debitCode($routed));
        $this->assertSame($legacy->fresh()->zatca_hash, Invoice::find($legacy->id)->zatca_hash);
    }

    // ───────────────────────── ZATCA ─────────────────────────

    /** @test */
    public function zatca_outputs_do_not_depend_on_the_debited_treasury_and_the_chain_stays_sequential(): void
    {
        $legacy = $this->postInv($this->draft());
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');
        $routed = $this->postInv($this->draft());

        $this->assertSame($legacy->zatca_icv + 1, $routed->zatca_icv, 'سلسلة ICV متتابعة');
        $this->assertSame($legacy->zatca_hash, $routed->zatca_previous_hash, 'PIH = هاش السابقة');
        $this->assertNotEmpty($routed->zatca_xml);
        $this->assertNotEmpty($routed->zatca_qr);
        foreach ([$extra->account_id, $extra->id, '1111'] as $needle) {
            $this->assertStringNotContainsString($needle, (string) $routed->zatca_xml, 'XML لا يذكر الخزينة');
        }
        // مبالغ XML الحاكمة متطابقة مع فاتورة legacy ذات المدخلات نفسها
        preg_match('/<cbc:PayableAmount[^>]*>([^<]+)</', (string) $legacy->zatca_xml, $a);
        preg_match('/<cbc:PayableAmount[^>]*>([^<]+)</', (string) $routed->zatca_xml, $b);
        preg_match('/<cbc:TaxAmount[^>]*>([^<]+)</', (string) $legacy->zatca_xml, $c);
        preg_match('/<cbc:TaxAmount[^>]*>([^<]+)</', (string) $routed->zatca_xml, $d);
        $this->assertSame($a[1] ?? null, $b[1] ?? null);
        $this->assertSame($c[1] ?? null, $d[1] ?? null);
        $this->assertNotNull($a[1] ?? null);
    }

    // ───────────────────────── حماية الردّ النقدي (D-T4b) ─────────────────────────

    private function routedInvoiceTo1111(int $quantity = 1): Invoice
    {
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');

        return $this->postInv($this->draft([], 100000, $quantity));
    }

    private function cashNoteFor(Invoice $invoice, string $refundType = 'cash'): CreditNote
    {
        return app(CreditNoteService::class)->create([
            'partner_id' => $invoice->partner_id, 'original_invoice_id' => $invoice->id, 'refund_type' => $refundType,
        ], [['source_line_id' => $invoice->lines()->first()->id, 'quantity' => 1]]);
    }

    private function returnFor(Invoice $invoice, string $paymentType = 'cash'): ReturnDocument
    {
        return app(ReturnService::class)->create([
            'type' => 'sales', 'partner_id' => $invoice->partner_id, 'payment_type' => $paymentType,
            'original_type' => Invoice::class, 'original_id' => $invoice->id,
        ], [['source_line_id' => $invoice->lines()->first()->id, 'product_id' => $this->productId, 'quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]]);
    }

    /** @test */
    public function a_cash_credit_note_for_an_invoice_collected_outside_1110_is_rejected_without_any_entry(): void
    {
        $routed = $this->routedInvoiceTo1111();
        $note = $this->cashNoteFor($routed);
        $before = $this->entryCount();

        $e = $this->failure(fn () => app(CreditNoteService::class)->post($note));
        $this->assertStringContainsString('1110', $e->getMessage());
        $this->assertSame('draft', $note->fresh()->status);
        $this->assertSame($before, $this->entryCount());
    }

    /** @test */
    public function a_cash_return_for_an_invoice_collected_outside_1110_is_rejected_without_any_entry(): void
    {
        $routed = $this->routedInvoiceTo1111();
        $return = $this->returnFor($routed);
        $before = $this->entryCount();

        $e = $this->failure(fn () => app(ReturnService::class)->post($return));
        $this->assertStringContainsString('1110', $e->getMessage());
        $this->assertSame('draft', $return->fresh()->status);
        $this->assertSame($before, $this->entryCount());
    }

    /** @test */
    public function the_credit_refund_route_stays_available_for_an_invoice_collected_outside_1110(): void
    {
        $routed = $this->routedInvoiceTo1111(2);

        $note = app(CreditNoteService::class)->post($this->cashNoteFor($routed, 'credit'));
        $this->assertSame('posted', $note->status);
        $return = app(ReturnService::class)->post($this->returnFor($routed, 'credit'));
        $this->assertSame('posted', $return->status);
    }

    /** @test */
    public function refunds_of_invoices_posted_before_activation_are_unchanged_even_after_the_main_moves(): void
    {
        $historic = $this->postInv($this->draft([], 100000, 2));       // legacy: Dr 1110
        $extra = $this->newTreasury();
        $this->makeMain($extra);
        $this->activate('main');

        $note = app(CreditNoteService::class)->post($this->cashNoteFor($historic));
        $this->assertSame('posted', $note->status);
        $entry = JournalEntry::with('lines.account')->where('source_id', $note->id)->firstOrFail();
        $this->assertSame(['1110 Cr 115000', '2120 Dr 15000', '4110 Dr 100000'], $this->lines($entry), 'الردّ النقدي على 1110 كما كان');

        $return = app(ReturnService::class)->post($this->returnFor($historic));
        $this->assertSame('posted', $return->status);
        $this->assertSame('1110', $return->journalEntry()->with('lines.account')->first()->lines->first(fn ($l) => $l->credit > 0 && $l->account->code === '1110')?->account->code);
    }

    /** @test */
    public function the_refund_guard_is_a_noop_for_legacy_tenants_with_the_gate_closed(): void
    {
        $posted = $this->postInv($this->draft());
        $note = app(CreditNoteService::class)->post($this->cashNoteFor($posted));
        $this->assertSame('posted', $note->status);
        $this->assertSame(['1110 Cr 115000', '2120 Dr 15000', '4110 Dr 100000'], $this->lines(JournalEntry::with('lines.account')->where('source_id', $note->id)->firstOrFail()));
    }

    // ───────────────────────── حارس ثابت ─────────────────────────

    /** @test */
    public function only_the_invoice_service_wires_the_resolver_and_no_fallback_to_the_hard_coded_account_exists_in_the_routed_branch(): void
    {
        $offenders = [];
        foreach (new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(base_path('app'))) as $file) {
            if (! $file->isFile() || $file->getExtension() !== 'php') {
                continue;
            }
            $path = str_replace('\\', '/', $file->getPathname());
            if (str_ends_with($path, '/Services/Accounting/TreasurySelectionResolver.php')) {
                continue;
            }
            if (preg_match('/TreasurySelectionResolver::class|new\s+TreasurySelectionResolver\b/', (string) file_get_contents($file->getPathname()))) {
                $offenders[] = basename($path);
            }
        }
        $this->assertSame(['InvoiceService.php'], $offenders, 'T4 يربط مسار البيع النقدي وحده؛ بقية المسارات T5+');

        // الفرع الموجَّه لا يستدعي accountId(ACC_CASH) ولا يلتقط استثناء المحلِّل
        $src = (string) file_get_contents(base_path('app/Services/Accounting/InvoiceService.php'));
        $start = strpos($src, 'protected function cashSaleDebitAccountId');
        $end = strpos($src, 'protected function resolveCashSaleTreasury', $start);
        $routed = substr($src, strpos($src, '// التهيئة الكسولة', $start), $end - strpos($src, '// التهيئة الكسولة', $start));
        $this->assertStringNotContainsString('ACC_CASH', $routed);
        $this->assertStringNotContainsString('catch', $routed);
    }
}

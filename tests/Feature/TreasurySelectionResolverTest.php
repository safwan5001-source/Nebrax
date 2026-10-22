<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\PaymentMethod;
use App\Models\User;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\TreasurySelectionResolver;
use App\Support\ResolvedTreasury;
use App\Support\TreasurySelection;
use App\Support\TreasurySelectionException;
use App\Support\TreasurySelectionPolicy;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use InvalidArgumentException;
use Tests\TestCase;

/**
 * TREASURY-T3 — عقد اختيار الخزينة/الحساب البنكي الموحَّد (قراءة فقط، غير مربوط بأي مسار ترحيل بعد).
 * يغطي: الاختيار الصريح (كيان/حساب أستاذ)، الافتراضي، غيابه، الغموض، التعطيل، عزل المستأجرين، سلامة حساب الأستاذ، المستأجر القديم،
 * عدم وجود أي أثر جانبي، وتطابق السلوك القائم لـ`resolveForPayment`.
 */
class TreasurySelectionResolverTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use CapturesThrowable;

    private array $auth;
    private string $tenantId;

    protected function setUp(): void
    {
        parent::setUp();

        $this->auth = $this->registerTenant('t3-main', 'owner@t3-main.test');
        $this->tenantId = $this->auth['tenant_id'];
        app(TenantContext::class)->set($this->tenantId);
    }

    // ───────────────────────── مساعدات ─────────────────────────

    private function resolver(): TreasurySelectionResolver
    {
        return app(TreasurySelectionResolver::class);
    }

    private function entity(string $code): CashBankAccount
    {
        return CashBankAccount::with('account')->whereHas('account', fn ($q) => $q->where('code', $code))->firstOrFail();
    }

    private function newTreasury(string $type, string $name): CashBankAccount
    {
        $payload = ['type' => $type, 'name' => $name, 'currency' => 'SAR', 'deposit_scope' => 'all', 'withdraw_scope' => 'all'];
        if ($type === 'bank') {
            $payload += ['bank_name' => 'بنك تجريبي', 'account_number' => 'SA'.random_int(1000, 9999).'0000'];
        }
        $id = $this->withToken($this->auth['token'])->postJson('/api/cash-bank-accounts', $payload)->assertCreated()->json('data.id');

        return CashBankAccount::with('account')->findOrFail($id);
    }

    private function failure(callable $fn): TreasurySelectionException
    {
        return $this->thrown($fn, 'يجب أن يرمي TreasurySelectionException', TreasurySelectionException::class);
    }

    private function assertReason(string $reason, callable $fn): TreasurySelectionException
    {
        $e = $this->failure($fn);
        $this->assertSame($reason, $e->reason);

        return $e;
    }

    // ───────────────────────── الاختيار الصريح ─────────────────────────

    /** @test */
    public function an_explicit_cash_treasury_is_resolved_by_entity_id_and_by_ledger_account_id(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة إضافية');   // GL 1111

        $byEntity = $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash');
        $byLedger = $this->resolver()->resolve(TreasurySelection::ledgerAccount($extra->account_id), 'cash');

        foreach ([$byEntity, $byLedger] as $resolved) {
            $this->assertInstanceOf(ResolvedTreasury::class, $resolved);
            $this->assertSame($extra->id, $resolved->entityId);
            $this->assertSame($extra->account_id, $resolved->accountId);
            $this->assertSame('1111', $resolved->entity->account->code);
            $this->assertSame('cash', $resolved->type);
            $this->assertSame('خزينة إضافية', $resolved->name);
            $this->assertSame('SAR', $resolved->currency);
            $this->assertFalse($resolved->viaDefault, 'اختيار صريح لا افتراضي');
        }
    }

    /** @test */
    public function an_explicit_bank_account_is_resolved_and_beats_the_main_default(): void
    {
        $bank = $this->newTreasury('bank', 'بنك إضافي');          // GL 1121
        $this->assertTrue((bool) $this->entity('1120')->is_main);

        $resolved = $this->resolver()->resolve(TreasurySelection::entity($bank->id), 'bank');

        $this->assertSame($bank->account_id, $resolved->accountId);
        $this->assertSame('1121', $resolved->entity->account->code);
        $this->assertFalse($resolved->viaDefault);
    }

    /** @test */
    public function an_explicit_selection_of_the_wrong_type_is_rejected_never_swapped(): void
    {
        $bank = $this->newTreasury('bank', 'بنك إضافي');

        $this->assertReason(TreasurySelectionException::WRONG_TYPE, fn () => $this->resolver()->resolve(TreasurySelection::entity($bank->id), 'cash'));
        $this->assertReason(TreasurySelectionException::WRONG_TYPE, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($this->entity('1120')->account_id), 'cash'));
    }

    // ───────────────────────── الافتراضي ─────────────────────────

    /** @test */
    public function omitting_the_selection_resolves_the_main_entity_of_the_requested_type(): void
    {
        $this->newTreasury('cash', 'خزينة إضافية');
        $this->newTreasury('bank', 'بنك إضافي');

        $cash = $this->resolver()->resolve(TreasurySelection::none(), 'cash');
        $bank = $this->resolver()->resolve(TreasurySelection::none(), 'bank');

        $this->assertSame('1110', $cash->entity->account->code);
        $this->assertSame('1120', $bank->entity->account->code);
        $this->assertTrue($cash->viaDefault);
        $this->assertTrue($bank->viaDefault);

        // null يعني «غير مُرسَل» في البنّائين.
        $this->assertTrue($this->resolver()->resolve(TreasurySelection::entity(null), 'cash')->viaDefault);
        $this->assertTrue($this->resolver()->resolve(TreasurySelection::ledgerAccount(null), 'bank')->viaDefault);
    }

    /** @test */
    public function the_default_follows_a_changed_main_entity(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة إضافية');
        $this->withToken($this->auth['token'])->postJson("/api/cash-bank-accounts/{$extra->id}/make-main")->assertOk();

        $this->assertSame($extra->account_id, $this->resolver()->resolve(TreasurySelection::none(), 'cash')->accountId);
    }

    /** @test */
    public function a_missing_default_is_an_explicit_error_not_a_guess(): void
    {
        DB::table('payment_methods')->where('tenant_id', $this->tenantId)->delete();
        DB::table('cash_bank_accounts')->where('tenant_id', $this->tenantId)->where('type', 'cash')->delete();

        $this->assertReason(TreasurySelectionException::NO_DEFAULT, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash'));
        // الحساب الدفتري 1110 قائم، ولا يُستنتج منه كيان.
        $this->assertNotNull(Account::where('code', '1110')->first());
        // النوع الآخر لا يتأثر.
        $this->assertSame('1120', $this->resolver()->resolve(TreasurySelection::none(), 'bank')->entity->account->code);
    }

    /** @test */
    public function several_candidates_without_a_main_are_ambiguous_and_a_single_one_is_not_promoted(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة إضافية');
        $main = $this->entity('1110');
        // بيانات تالفة: لا كيان رئيسي (الفهرس الفريد يمنع التعدّد لا الغياب).
        DB::table('cash_bank_accounts')->where('tenant_id', $this->tenantId)->where('type', 'cash')->update(['is_main' => false]);

        $this->assertReason(TreasurySelectionException::AMBIGUOUS_DEFAULT, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash'));

        // مرشّح نشط واحد فقط بلا رئيسي ⇒ لا يُرقّى تلقائياً.
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['is_active' => false]);
        $this->assertReason(TreasurySelectionException::NO_DEFAULT, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash'));
        $this->assertTrue((bool) $main->fresh()->is_active);
    }

    /** @test */
    public function the_explicit_required_policy_rejects_omission_but_still_accepts_an_explicit_choice(): void
    {
        $policy = TreasurySelectionPolicy::ExplicitRequired;
        $extra = $this->newTreasury('cash', 'خزينة إضافية');

        $this->assertReason(TreasurySelectionException::EXPLICIT_REQUIRED, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash', $policy));
        $this->assertReason(TreasurySelectionException::EXPLICIT_REQUIRED, fn () => $this->resolver()->resolve(TreasurySelection::entity(null), 'bank', $policy));
        $this->assertSame($extra->account_id, $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash', $policy)->accountId);
    }

    // ───────────────────────── التعطيل وعدم الاستبدال ─────────────────────────

    /** @test */
    public function an_inactive_explicit_selection_is_rejected(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة ستُعطَّل');
        $this->withToken($this->auth['token'])->postJson("/api/cash-bank-accounts/{$extra->id}/deactivate")->assertOk();

        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash'));
        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($extra->account_id), 'cash'));
    }

    /** @test */
    public function an_inactive_main_is_never_silently_replaced_by_another_active_entity(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة نشطة');
        // بيانات تالفة: الرئيسي معطَّل (الخدمة تنقل الرئيسي قبل التعطيل، فنكتب مباشرة).
        DB::table('cash_bank_accounts')->where('id', $this->entity('1110')->id)->update(['is_active' => false]);
        $this->assertTrue((bool) $extra->fresh()->is_active);

        $this->assertReason(TreasurySelectionException::INACTIVE, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash'));
    }

    // ───────────────────────── العزل بين المستأجرين ─────────────────────────

    /** @test */
    public function another_tenants_entity_or_ledger_account_is_indistinguishable_from_unknown(): void
    {
        $other = $this->registerTenant('t3-other', 'owner@t3-other.test');
        app(TenantContext::class)->set($other['tenant_id']);
        $theirCash = CashBankAccount::query()->where('type', 'cash')->firstOrFail();
        $theirIds = [$theirCash->id, $theirCash->account_id];
        app(TenantContext::class)->set($this->tenantId);

        $unknown = $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::entity((string) Str::uuid()), 'cash'));
        $byEntity = $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::entity($theirIds[0]), 'cash'));
        $byLedger = $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($theirIds[1]), 'cash'));

        $this->assertSame($unknown->getMessage(), $byEntity->getMessage(), 'لا تسرُّب وجود');
        $this->assertSame($unknown->getMessage(), $byLedger->getMessage());

        // والافتراضي يخص المستأجر الحالي دائماً.
        $this->assertSame($this->entity('1110')->id, $this->resolver()->resolve(TreasurySelection::none(), 'cash')->entityId);
    }

    // ───────────────────────── سلامة حساب الأستاذ ─────────────────────────

    /** @test */
    public function an_entity_linked_to_a_ledger_account_of_another_tenant_is_rejected_as_missing(): void
    {
        $other = $this->registerTenant('t3-link', 'owner@t3-link.test');
        $foreignAccount = (string) DB::table('accounts')->where('tenant_id', $other['tenant_id'])->where('code', '1110')->value('id');
        app(TenantContext::class)->set($this->tenantId);
        $extra = $this->newTreasury('cash', 'خزينة تالفة الربط');
        DB::table('cash_bank_accounts')->where('id', $extra->id)->update(['account_id' => $foreignAccount]);

        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_MISSING, fn () => $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash'));
    }

    /** @test */
    public function an_inactive_group_or_non_asset_ledger_account_is_rejected(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة الاختبار');
        $account = Account::findOrFail($extra->account_id);
        $select = fn () => $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash');

        DB::table('accounts')->where('id', $account->id)->update(['is_active' => false]);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INACTIVE, $select);

        DB::table('accounts')->where('id', $account->id)->update(['is_active' => true, 'is_group' => true]);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INVALID, $select);

        DB::table('accounts')->where('id', $account->id)->update(['is_group' => false, 'type' => 'expense']);
        $this->assertReason(TreasurySelectionException::GL_ACCOUNT_INVALID, $select);

        DB::table('accounts')->where('id', $account->id)->update(['type' => 'asset']);
        $this->assertSame($account->id, $select()->accountId, 'سليم بعد الإصلاح');
    }

    /** @test */
    public function the_resolver_never_guesses_from_gl_code_prefixes(): void
    {
        // حساب أصل بكود 111x غير مربوط بأي كيان، والمجموعة التجميعية 111: لا يُحلّان.
        $stray = Account::create([
            'parent_id' => Account::where('code', '111')->value('id'), 'code' => '1119', 'name' => 'ليس خزينة', 'type' => 'asset',
            'normal_balance' => 'debit', 'is_group' => false, 'is_system' => false, 'currency' => 'SAR', 'is_active' => true,
        ]);

        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($stray->id), 'cash'));
        $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount((string) Account::where('code', '111')->value('id')), 'cash'));
        // نصٌّ فارغ أو رمز حساب أو أي معرّف ليس UUID: اختيارٌ صريح غير صالح ⇒ not_found (لا افتراضي صامت، لا خطأ قاعدة بيانات، لا تخمين من الرمز).
        foreach (['', '   ', '1110', '1120', 'cash', 'not-a-uuid', '0'] as $malformed) {
            $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::entity($malformed), 'cash'));
            $this->assertReason(TreasurySelectionException::NOT_FOUND, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($malformed), 'bank'));
        }
    }

    // ───────────────────────── التفويض (اختياري وصريح) ─────────────────────────

    /** @test */
    public function the_optional_authorization_applies_the_entitys_own_scope_and_fails_closed(): void
    {
        $scoped = $this->newTreasury('cash', 'خزينة بنطاق مستخدم');
        $owner = User::query()->where('email', 'owner@t3-main.test')->firstOrFail();
        $someoneElse = User::create([
            'tenant_id' => $this->tenantId, 'name' => 'آخر', 'email' => 'other@t3-main.test', 'password' => bcrypt('secret1234'), 'role' => 'accountant',
        ]);
        DB::table('cash_bank_accounts')->where('id', $scoped->id)->update(['deposit_scope' => 'user', 'deposit_scope_subject' => $owner->id]);
        $select = fn (?User $actor, string $action = 'deposit') => $this->resolver()->resolve(
            TreasurySelection::entity($scoped->id), 'cash', TreasurySelectionPolicy::MainOfType, $action, $actor,
        );

        $this->assertSame($scoped->account_id, $select($owner)->accountId);
        $this->assertReason(TreasurySelectionException::NOT_PERMITTED, fn () => $select($someoneElse));
        $this->assertReason(TreasurySelectionException::NOT_PERMITTED, fn () => $select(null));
        // السحب نطاقه الافتراضي «الكل».
        $this->assertSame($scoped->account_id, $select($someoneElse, 'withdraw')->accountId);

        // بدون طلب تفويض لا يفحص المحلِّل شيئاً (يبقى على المستدعي كما اليوم).
        $this->assertSame($scoped->account_id, $this->resolver()->resolve(TreasurySelection::entity($scoped->id), 'cash')->accountId);
        $this->expectException(InvalidArgumentException::class);
        $this->resolver()->resolve(TreasurySelection::entity($scoped->id), 'cash', TreasurySelectionPolicy::MainOfType, 'transfer', $owner);
    }

    /** @test */
    public function an_unknown_treasury_type_is_a_programming_error_not_a_domain_fallback(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->resolver()->resolve(TreasurySelection::none(), 'wallet');
    }

    // ───────────────────────── المستأجر القديم ─────────────────────────

    /** @test */
    public function a_registered_legacy_tenant_resolves_to_its_historical_1110_and_1120(): void
    {
        $this->assertSame('1110', $this->resolver()->resolve(TreasurySelection::none(), 'cash')->entity->account->code);
        $this->assertSame('1120', $this->resolver()->resolve(TreasurySelection::none(), 'bank')->entity->account->code);
        $this->assertSame('1110', $this->resolver()->resolve(TreasurySelection::ledgerAccount($this->entity('1110')->account_id), 'cash')->entity->account->code);
    }

    /** @test */
    public function an_unprovisioned_tenant_gets_no_default_until_it_is_provisioned_the_existing_way(): void
    {
        DB::table('payment_methods')->where('tenant_id', $this->tenantId)->delete();
        DB::table('cash_bank_accounts')->where('tenant_id', $this->tenantId)->delete();

        // المحلِّل لا يهيّئ ولا يُنشئ كياناً من رمز 1110.
        $this->assertReason(TreasurySelectionException::NO_DEFAULT, fn () => $this->resolver()->resolve(TreasurySelection::none(), 'cash'));
        $this->assertSame(0, CashBankAccount::query()->count());
        $this->assertSame(0, PaymentMethod::query()->count());

        // التهيئة تبقى مسؤولية المسار القائم (T9 يعيد تصميمها): بعدها يعمل الافتراضي.
        app(CashBankAccountService::class)->bootstrapDefaults();
        $this->assertSame('1110', $this->resolver()->resolve(TreasurySelection::none(), 'cash')->entity->account->code);
    }

    // ───────────────────────── تطابق السلوك القائم ─────────────────────────

    /** @test */
    public function it_matches_the_existing_resolve_for_payment_for_every_compatible_input(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة إضافية');
        $bank = $this->newTreasury('bank', 'بنك إضافي');
        $legacy = app(CashBankAccountService::class);

        $cases = [
            ['cash', null], ['bank', null],
            ['cash', $extra->account_id], ['bank', $bank->account_id],
            ['cash', $this->entity('1110')->account_id], ['bank', $this->entity('1120')->account_id],
        ];
        foreach ($cases as [$type, $ledgerId]) {
            $expected = $legacy->resolveForPayment($ledgerId, $type);
            $actual = $this->resolver()->resolve(TreasurySelection::ledgerAccount($ledgerId), $type);
            $this->assertSame($expected->id, $actual->entityId, "{$type} / ".($ledgerId ?? 'default'));
            $this->assertSame($expected->account_id, $actual->accountId);
        }

        // وحيثما يرفض القائم يرفض العقد الجديد (نوع خاطئ، معطَّل).
        foreach ([['cash', $bank->account_id], ['bank', $extra->account_id]] as [$type, $ledgerId]) {
            $this->thrown(fn () => $legacy->resolveForPayment($ledgerId, $type), 'القائم يرفض أيضاً');
            $this->assertReason(TreasurySelectionException::WRONG_TYPE, fn () => $this->resolver()->resolve(TreasurySelection::ledgerAccount($ledgerId), $type));
        }
    }

    // ───────────────────────── لا أثر جانبي ─────────────────────────

    /** @test */
    public function resolving_writes_nothing_and_creates_no_journal_entry(): void
    {
        $extra = $this->newTreasury('cash', 'خزينة إضافية');
        $counts = fn () => [
            DB::table('journal_entries')->count(), DB::table('journal_lines')->count(), DB::table('account_balances')->count(),
            DB::table('cash_bank_accounts')->count(), DB::table('payment_methods')->count(), DB::table('accounts')->count(),
        ];
        $before = $counts();
        $writes = [];
        DB::listen(function ($query) use (&$writes) {
            if (preg_match('/^\s*(insert|update|delete|truncate)\b/i', $query->sql) || preg_match('/\bfor (no key )?(update|share)\b/i', $query->sql)) {
                $writes[] = $query->sql;
            }
        });

        $this->resolver()->resolve(TreasurySelection::none(), 'cash');
        $this->resolver()->resolve(TreasurySelection::entity($extra->id), 'cash');
        $this->resolver()->resolve(TreasurySelection::ledgerAccount($extra->account_id), 'cash');
        $this->thrown(fn () => $this->resolver()->resolve(TreasurySelection::entity((string) Str::uuid()), 'bank'), 'يجب أن يُرفض', TreasurySelectionException::class);

        $this->assertSame([], $writes, 'لا كتابة ولا قفل صفوف');
        $this->assertSame($before, $counts());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertSame(0, JournalLine::query()->count());
    }

    /** @test */
    public function only_the_resolver_itself_references_the_contract_so_no_posting_path_is_wired_yet(): void
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
            // استعمال فعلي للمحلِّل (استيراد/حقن/نداء) لا مجرد ذكره في تعليق قيمةٍ مساندة.
            $source = (string) file_get_contents($file->getPathname());
            $fqcn = preg_quote('App\\Services\\Accounting\\TreasurySelectionResolver', '/');
            if (preg_match("/use\\s+{$fqcn}\\b|TreasurySelectionResolver::class|new\\s+TreasurySelectionResolver\\b/", $source)) {
                $offenders[] = $path;
            }
        }
        $this->assertSame([], $offenders, 'T3 لا يربط العقد بأي مسار ترحيل (T4 وما بعده)');

        // ولا يعتمد المحلِّل على محرك القيود أو خدمات الترحيل.
        $source = (string) file_get_contents(base_path('app/Services/Accounting/TreasurySelectionResolver.php'));
        foreach (['LedgerService', 'JournalEntry', 'JournalLine', 'InvoiceService', 'PaymentService', 'bootstrapDefaults()'] as $needle) {
            $this->assertStringNotContainsString($needle.'::', $source);
            $this->assertStringNotContainsString('use App\\Services\\Accounting\\'.$needle, $source);
        }
    }
}

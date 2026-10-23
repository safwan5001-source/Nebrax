<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\PaymentMethod;
use App\Services\Accounting\CashBankAccountService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use ReflectionMethod;
use Tests\TestCase;

/**
 * TREASURY-T1 — سلوك `CashBankAccountService::bootstrapDefaults()` على المحرّكين (SQLite وPostgreSQL).
 *
 * العقد: المسار السريع (بلا أقفال) يعود **فقط** حين لا يبقى للمسار البطيء شيء يكتبه، فيبقى سلوك التهيئة كما كان حرفياً —
 * بما فيه سياسة زرع طرق الدفع (تُزرع لمؤسسة بلا أي طريقة ولها رئيسيان، ولا يعاد زرع ما حُذف وبقيت بعده طريقة).
 * التزامن الحقيقي واختبار الجمود في `TreasuryBootstrapDeadlockPostgresTest`.
 */
class CashBankBootstrapIdempotencyTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function tenant(string $slug): string
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);

        return $auth['tenant_id'];
    }

    /** @return array<string, mixed> */
    private function snapshot(string $tenant): array
    {
        return [
            'entities' => DB::table('cash_bank_accounts')->where('tenant_id', $tenant)->orderBy('account_id')
                ->get(['id', 'account_id', 'type', 'name', 'is_main', 'is_active', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
            'methods' => DB::table('payment_methods')->where('tenant_id', $tenant)->orderBy('name')
                ->get(['id', 'name', 'settlement_type', 'cash_bank_account_id', 'is_default', 'updated_at'])->map(fn ($r) => (array) $r)->all(),
        ];
    }

    private function provisioned(): bool
    {
        $method = new ReflectionMethod(CashBankAccountService::class, 'defaultsProvisioned');
        $method->setAccessible(true);

        return $method->invoke(app(CashBankAccountService::class));
    }

    private function unprovision(string $tenant): void
    {
        DB::table('payment_methods')->where('tenant_id', $tenant)->delete();
        DB::table('cash_bank_accounts')->where('tenant_id', $tenant)->delete();
    }

    /** @test */
    public function repeated_bootstrap_is_idempotent_and_keeps_identifiers_stable(): void
    {
        $tenant = $this->tenant('t1-idem');
        $before = $this->snapshot($tenant);
        $this->assertCount(2, $before['entities']);
        $this->assertCount(4, $before['methods']);

        foreach (range(1, 3) as $_) {
            app(CashBankAccountService::class)->bootstrapDefaults();
        }

        $this->assertSame($before, $this->snapshot($tenant), 'لا كتابة ولا تكرار ولا تغيير معرّف أو طابع تحديث');
    }

    /** @test */
    public function provisioning_an_empty_tenant_creates_exactly_two_mains_and_four_methods_once(): void
    {
        $tenant = $this->tenant('t1-empty');
        $this->unprovision($tenant);
        $this->assertFalse($this->provisioned());

        app(CashBankAccountService::class)->bootstrapDefaults();
        app(CashBankAccountService::class)->bootstrapDefaults();

        $entities = CashBankAccount::query()->get();
        $this->assertCount(2, $entities);
        $this->assertSame(['bank', 'cash'], $entities->pluck('type')->sort()->values()->all());
        $this->assertSame(2, $entities->where('is_main', true)->count());
        $this->assertSame(['1110', '1120'], Account::whereIn('id', $entities->pluck('account_id'))->pluck('code')->sort()->values()->all());
        $this->assertSame(['بطاقة ائتمان', 'تحويل بنكي', 'شيك', 'نقدي'], PaymentMethod::query()->pluck('name')->sort()->values()->all());
        $this->assertTrue($this->provisioned());
    }

    /**
     * المسار السريع ⇔ لا شيء يُكتب: لكل حالة يُقاس هل «مهيَّأ» ثم يُنفَّذ الاستدعاء الكامل ويُقارَن الأثر.
     *
     * @test
     * @dataProvider states
     */
    public function the_fast_path_answers_provisioned_exactly_when_the_slow_path_would_write_nothing(string $name, callable $arrange, bool $expectedProvisioned): void
    {
        $tenant = $this->tenant('t1-'.$name);
        $arrange($tenant);

        $provisioned = $this->provisioned();
        $before = $this->snapshot($tenant);
        app(CashBankAccountService::class)->bootstrapDefaults();
        $after = $this->snapshot($tenant);

        $this->assertSame($expectedProvisioned, $provisioned, "حالة {$name}");
        if ($provisioned) {
            $this->assertSame($before, $after, 'مهيَّأ ⇒ لا أثر');
        } else {
            $this->assertNotSame($before, $after, 'غير مهيَّأ ⇒ المسار البطيء يكتب شيئاً');
        }
    }

    /** @return array<string, array{string, callable, bool}> */
    public static function states(): array
    {
        $bank = fn (string $t) => DB::table('accounts')->where('tenant_id', $t)->where('code', '1120')->value('id');
        $cash = fn (string $t) => DB::table('accounts')->where('tenant_id', $t)->where('code', '1110')->value('id');

        return [
            'full' => ['full', fn (string $t) => null, true],
            // بنك مفقود: الطرق مربوطة بالكيان المحذوف، فنفكّ ربطها أولاً.
            'bank-entity-missing' => ['bank-entity-missing', function (string $t) use ($bank) {
                DB::table('payment_methods')->where('tenant_id', $t)->update(['cash_bank_account_id' => null]);
                DB::table('cash_bank_accounts')->where('tenant_id', $t)->where('account_id', $bank($t))->delete();
            }, false],
            'cash-entity-missing' => ['cash-entity-missing', function (string $t) use ($cash) {
                DB::table('payment_methods')->where('tenant_id', $t)->update(['cash_bank_account_id' => null]);
                DB::table('cash_bank_accounts')->where('tenant_id', $t)->where('account_id', $cash($t))->delete();
            }, false],
            // كيانان قائمان وبلا أي طريقة دفع ⇒ تُزرع.
            'no-methods-both-mains' => ['no-methods-both-mains', fn (string $t) => DB::table('payment_methods')->where('tenant_id', $t)->delete(), false],
            // ينقص رئيسي نقد ⇒ لا تُزرع الطرق ولا شيء يُكتب (الحساب النظامي مربوط بكيان غير رئيسي).
            'no-methods-no-cash-main' => ['no-methods-no-cash-main', function (string $t) {
                DB::table('payment_methods')->where('tenant_id', $t)->delete();
                DB::table('cash_bank_accounts')->where('tenant_id', $t)->where('type', 'cash')->update(['is_main' => false]);
            }, true],
            // كل شيء محذوف مع بقاء طريقة غير مربوطة ⇒ الكيانان يُنشآن والطرق لا تُزرع.
            'entities-missing-one-unlinked-method' => ['entities-missing-one-unlinked-method', function (string $t) {
                DB::table('payment_methods')->where('tenant_id', $t)->update(['cash_bank_account_id' => null]);
                DB::table('payment_methods')->where('tenant_id', $t)->where('name', '!=', 'نقدي')->delete();
                DB::table('cash_bank_accounts')->where('tenant_id', $t)->delete();
            }, false],
            // الحسابان النظاميان غائبان: لا شيء ليُربط ولا رئيسيان لزرع الطرق.
            'system-accounts-absent' => ['system-accounts-absent', function (string $t) {
                DB::table('payment_methods')->where('tenant_id', $t)->delete();
                DB::table('cash_bank_accounts')->where('tenant_id', $t)->delete();
                $ids = DB::table('accounts')->where('tenant_id', $t)->whereIn('code', ['1110', '1120'])->pluck('id');
                DB::table('account_balances')->whereIn('account_id', $ids)->delete();
                DB::table('accounts')->whereIn('id', $ids)->delete();
            }, true],
        ];
    }

    /** @test */
    public function the_payment_method_seeding_policy_is_unchanged(): void
    {
        $tenant = $this->tenant('t1-policy');
        $service = app(CashBankAccountService::class);

        // حُذفت الطرق كلها ⇒ تُزرع من جديد (السلوك القائم، قرار D-T4 للمالك).
        DB::table('payment_methods')->where('tenant_id', $tenant)->delete();
        $service->bootstrapDefaults();
        $this->assertSame(4, PaymentMethod::query()->count());

        // بقيت طريقة واحدة ⇒ لا يعاد زرع المحذوف.
        PaymentMethod::query()->where('name', '!=', 'نقدي')->delete();
        $service->bootstrapDefaults();
        $this->assertSame(['نقدي'], PaymentMethod::query()->pluck('name')->all());
    }

    /** @test */
    public function the_fast_path_issues_no_writes(): void
    {
        $this->tenant('t1-nowrite');
        $writes = [];
        DB::listen(function ($query) use (&$writes) {
            if (preg_match('/^\s*(insert|update|delete)\b/i', $query->sql)) {
                $writes[] = $query->sql;
            }
        });

        app(CashBankAccountService::class)->bootstrapDefaults();

        $this->assertSame([], $writes);
    }

    /** @test */
    public function provisioning_one_tenant_never_touches_or_reads_another_tenant(): void
    {
        $a = $this->tenant('t1-iso-a');
        $b = $this->tenant('t1-iso-b');
        $bBefore = $this->snapshot($b);

        $this->unprovision($a);
        app(TenantContext::class)->set($a);
        app(CashBankAccountService::class)->bootstrapDefaults();

        $this->assertSame($bBefore, $this->snapshot($b));
        $this->assertSame(2, DB::table('cash_bank_accounts')->where('tenant_id', $a)->count());
        $this->assertSame(0, DB::table('cash_bank_accounts')->where('tenant_id', $a)->whereIn('account_id', DB::table('accounts')->where('tenant_id', $b)->pluck('id'))->count(), 'كيانات A لا تربط حسابات B');

        // وB المهيَّأ لا يتأثر بحالة A غير المهيَّأة.
        app(TenantContext::class)->set($b);
        $this->assertTrue($this->provisioned());
    }

    /** @test */
    public function resolve_for_payment_still_provisions_on_demand_and_still_fails_closed(): void
    {
        $tenant = $this->tenant('t1-resolve');
        $this->unprovision($tenant);
        $service = app(CashBankAccountService::class);

        $main = $service->resolveForPayment(null, 'cash');
        $this->assertSame('1110', $main->account->code);
        $this->assertSame('1120', $service->resolveForPayment(null, 'bank')->account->code);

        // اختيار حساب بنكي لطريقة نقدية، أو كياناً معطَّلاً، أو معرّفاً مجهولاً ⇒ رفض لا بدل صامت.
        $bankAccountId = $service->resolveForPayment(null, 'bank')->account_id;
        foreach ([
            fn () => $service->resolveForPayment($bankAccountId, 'cash'),
            fn () => $service->resolveForPayment((string) \Illuminate\Support\Str::uuid(), 'cash'),
        ] as $attempt) {
            try {
                $attempt();
                $this->fail('يجب أن يُرفض الاختيار غير الصالح');
            } catch (\RuntimeException $e) {
                $this->assertStringContainsString('غير صالح', $e->getMessage());
            }
        }
        $this->assertCount(2, CashBankAccount::query()->get(), 'الرفض لم يُنشئ كياناً بديلاً');
    }
}

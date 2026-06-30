<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * اختبارات المصروفات: الإجمالي مشتقّ من المبلغ، والترحيل يولّد قيداً متوازناً
 * (مدين حساب المصروف + 1150 المدخلات / دائن 1110 أو 1120 أو 2110).
 * تشغيل: php artisan test --filter=ExpenseTest
 */
class ExpenseTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $l) => $l->account->code === $code);
    }

    /** كود حساب مصروف صالح (الإيجار 5130) من دليل حسابات المستأجر. */
    private function expenseAccountId(string $tenantId, string $code = '5130'): string
    {
        app(TenantContext::class)->set($tenantId);

        return Account::where('code', $code)->firstOrFail()->id;
    }

    /** @test */
    public function creating_an_expense_derives_total_without_a_journal_entry(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $res = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId,
            'amount'     => 100000,
            'tax_rate'   => 15,
        ])->assertCreated();

        $this->assertSame('draft', $res['data']['status']);
        $this->assertSame('1150.00', $res['data']['total']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $this->assertSame(0, JournalEntry::where('source_type', Expense::class)->count());
    }

    /** @test */
    public function posting_a_cash_expense_generates_a_balanced_entry(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $id = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id'     => $accountId,
            'amount'         => 100000,
            'tax_rate'       => 15,
            'payment_method' => 'cash',
        ])['data']['id'];

        $posted = $this->withToken($auth['token'])->postJson("/api/expenses/{$id}/post")->assertOk();
        $this->assertSame('posted', $posted['data']['status']);

        app(TenantContext::class)->set($auth['tenant_id']);
        $entry = JournalEntry::with('lines.account')
            ->where('source_type', Expense::class)->where('source_id', $id)->firstOrFail();

        $this->assertEquals($entry->lines->sum('debit'), $entry->lines->sum('credit'));
        $this->assertEquals(115000, $entry->lines->sum('debit'));
        $this->assertEquals(100000, $this->line($entry, '5130')->debit);  // حساب المصروف
        $this->assertEquals(15000,  $this->line($entry, '1150')->debit);  // ضريبة المدخلات
        $this->assertEquals(115000, $this->line($entry, '1110')->credit); // الصندوق
    }

    /** @test */
    public function bank_and_credit_methods_pick_the_right_credit_account(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $bankId = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId, 'amount' => 100000, 'tax_rate' => 0, 'payment_method' => 'bank',
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/expenses/{$bankId}/post")->assertOk();

        $creditId = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId, 'amount' => 100000, 'tax_rate' => 0, 'payment_method' => 'credit',
        ])['data']['id'];
        $this->withToken($auth['token'])->postJson("/api/expenses/{$creditId}/post")->assertOk();

        app(TenantContext::class)->set($auth['tenant_id']);
        $bank = JournalEntry::with('lines.account')->where('source_id', $bankId)->firstOrFail();
        $this->assertEquals(100000, $this->line($bank, '1120')->credit);  // البنك

        $credit = JournalEntry::with('lines.account')->where('source_id', $creditId)->firstOrFail();
        $this->assertEquals(100000, $this->line($credit, '2110')->credit); // الموردون (آجل)
    }

    /** @test */
    public function an_expense_cannot_post_to_a_non_expense_account(): void
    {
        $auth = $this->registerTenant();
        $cashId = $this->expenseAccountId($auth['tenant_id'], '1110'); // حساب أصل لا مصروف

        $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $cashId, 'amount' => 50000,
        ])->assertStatus(422);
    }

    /** @test */
    public function an_expense_cannot_be_posted_twice(): void
    {
        $auth = $this->registerTenant();
        $accountId = $this->expenseAccountId($auth['tenant_id']);

        $id = $this->withToken($auth['token'])->postJson('/api/expenses', [
            'account_id' => $accountId, 'amount' => 10000,
        ])['data']['id'];

        $this->withToken($auth['token'])->postJson("/api/expenses/{$id}/post")->assertOk();
        $this->withToken($auth['token'])->postJson("/api/expenses/{$id}/post")->assertStatus(422);
    }

    /** @test */
    public function expenses_are_tenant_isolated(): void
    {
        $a = $this->registerTenant('acme', 'owner@acme.test');
        $accountA = $this->expenseAccountId($a['tenant_id']);
        $id = $this->withToken($a['token'])->postJson('/api/expenses', [
            'account_id' => $accountA, 'amount' => 10000,
        ])['data']['id'];

        $b = $this->registerTenant('globex', 'owner@globex.test');
        $this->withToken($b['token'])->getJson("/api/expenses/{$id}")->assertNotFound();
        $this->withToken($b['token'])->getJson('/api/expenses')->assertOk()->assertJsonCount(0, 'data');
    }
}

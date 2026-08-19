<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\CashBankAccount;
use App\Models\JournalEntry;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class CashBankAccountTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function createAccount(string $token, string $type, string $name, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/cash-bank-accounts', array_merge([
            'type' => $type,
            'name' => $name,
            'currency' => 'SAR',
            'deposit_scope' => 'all',
            'withdraw_scope' => 'all',
        ], $extra))->assertCreated()->json('data');
    }

    /** @test */
    public function registration_exposes_legacy_default_cash_and_bank_without_changing_their_accounts(): void
    {
        $auth = $this->registerTenant();

        $items = $this->withToken($auth['token'])->getJson('/api/cash-bank-accounts')
            ->assertOk()->json('data');

        $this->assertCount(2, $items);
        $this->assertSame(['1110', '1120'], collect($items)->pluck('account_code')->sort()->values()->all());
        $this->assertTrue((bool) collect($items)->firstWhere('type', 'cash')['is_main']);
        $this->assertTrue((bool) collect($items)->firstWhere('type', 'bank')['is_main']);
    }

    /** @test */
    public function owner_creates_named_cash_and_bank_accounts_under_their_safe_groups(): void
    {
        $auth = $this->registerTenant();
        $cash = $this->createAccount($auth['token'], 'cash', 'خزينة المعرض');
        $bank = $this->createAccount($auth['token'], 'bank', 'حساب الراجحي', [
            'bank_name' => 'مصرف الراجحي', 'account_number' => 'SA0380000000608010167519',
        ]);

        app(TenantContext::class)->set($auth['tenant_id']);
        $cashAccount = Account::findOrFail($cash['account_id']);
        $bankAccount = Account::findOrFail($bank['account_id']);

        $this->assertSame('111', $cashAccount->parent->code);
        $this->assertSame('112', $bankAccount->parent->code);
        $this->assertFalse($cashAccount->is_group);
        $this->assertFalse($bankAccount->is_group);
        $this->assertFalse((bool) $cash['is_main']);
        $this->assertSame('مصرف الراجحي', $bank['bank_name']);
    }

    /** @test */
    public function only_one_active_main_account_exists_per_type_and_the_only_main_cannot_be_disabled_or_deleted(): void
    {
        $auth = $this->registerTenant();
        $cash = $this->createAccount($auth['token'], 'cash', 'خزينة معرض الدمام');

        $this->withToken($auth['token'])->postJson("/api/cash-bank-accounts/{$cash['id']}/make-main")
            ->assertOk()->assertJsonPath('data.is_main', true);

        $defaults = $this->withToken($auth['token'])->getJson('/api/cash-bank-accounts')->json('data');
        $this->assertCount(1, collect($defaults)->where('type', 'cash')->where('is_main', true));

        $this->withToken($auth['token'])->postJson("/api/cash-bank-accounts/{$cash['id']}/deactivate")
            ->assertOk()->assertJsonPath('data.is_active', false);
        $this->withToken($auth['token'])->deleteJson("/api/cash-bank-accounts/{$cash['id']}")
            ->assertUnprocessable();
    }

    /** @test */
    public function transfer_posts_a_balanced_entry_and_updates_the_two_linked_account_balances(): void
    {
        $auth = $this->registerTenant();
        $bank = $this->createAccount($auth['token'], 'bank', 'حساب الراجحي', [
            'bank_name' => 'مصرف الراجحي', 'account_number' => '123456789',
        ]);
        $cash = $this->withToken($auth['token'])->getJson('/api/cash-bank-accounts')->json('data');
        $source = collect($cash)->firstWhere('type', 'cash');

        $payload = [
            'source_cash_bank_account_id' => $source['id'],
            'destination_cash_bank_account_id' => $bank['id'],
            'amount' => 12500,
            'transfer_date' => '2026-08-19',
        ];
        $this->withToken($auth['token'])->postJson('/api/cash-bank-transfers', $payload)->assertUnprocessable();
        $this->withToken($auth['token'])->putJson('/api/settings/finance', [
            'allow_negative_transfer_balance' => true,
        ])->assertOk();
        $transfer = $this->withToken($auth['token'])->postJson('/api/cash-bank-transfers', $payload)
            ->assertCreated()->json('data');

        $entry = JournalEntry::with('lines')->findOrFail($transfer['journal_entry_id']);
        $this->assertSame(12500, $entry->lines->sum('debit'));
        $this->assertSame(12500, $entry->lines->sum('credit'));
        $this->assertSame($bank['account_id'], $entry->lines->firstWhere('debit', 12500)->account_id);
        $this->assertSame($source['account_id'], $entry->lines->firstWhere('credit', 12500)->account_id);
    }

    /** @test */
    public function cash_bank_entities_remain_tenant_isolated(): void
    {
        $a = $this->registerTenant('cash-a', 'cash-a@example.test');
        $cash = $this->createAccount($a['token'], 'cash', 'خزينة الشركة الأولى');
        $b = $this->registerTenant('cash-b', 'cash-b@example.test');

        $this->withToken($b['token'])->getJson("/api/cash-bank-accounts/{$cash['id']}")->assertNotFound();
        $this->withToken($b['token'])->postJson('/api/cash-bank-transfers', [
            'source_cash_bank_account_id' => $cash['id'],
            'destination_cash_bank_account_id' => CashBankAccount::where('type', 'cash')->firstOrFail()->id,
            'amount' => 100,
        ])->assertNotFound();
    }
}

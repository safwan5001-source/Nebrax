<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Expense;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\ManualJournal;
use App\Models\Partner;
use App\Models\Payment;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class FinancialListsDataExplorerTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private string $token;
    private Account $account;
    private Partner $customer;
    private Partner $supplier;

    protected function setUp(): void
    {
        parent::setUp();
        $auth = $this->registerTenant('financial-explorer', 'financial-explorer@example.test');
        $this->token = $auth['token'];
        app(TenantContext::class)->set($auth['tenant_id']);

        $this->account = Account::create([
            'code' => '5199',
            'name' => 'مصروف اختبار',
            'type' => 'expense',
            'normal_balance' => 'debit',
            'is_group' => false,
            'is_system' => false,
            'currency' => 'SAR',
            'is_active' => true,
        ]);
        $this->customer = Partner::create(['code' => 'C-DE-1', 'type' => 'customer', 'name' => 'عميل المستكشف']);
        $this->supplier = Partner::create(['code' => 'S-DE-1', 'type' => 'supplier', 'name' => 'مورد المستكشف']);
    }

    /** @test */
    public function expenses_keep_legacy_shape_and_support_server_side_search_filters_money_and_pagination(): void
    {
        $older = $this->expense(['number' => 'EXP-DE-001', 'vendor_name' => 'قديم', 'expense_date' => '2026-01-01', 'total' => 10000]);
        $newer = $this->expense(['number' => 'EXP-DE-002', 'vendor_name' => 'مورد خاص', 'expense_date' => '2026-02-15', 'total' => 25050, 'status' => 'posted']);
        $older->forceFill(['created_at' => now()->subDay(), 'updated_at' => now()->subDay()])->saveQuietly();
        $newer->forceFill(['created_at' => now(), 'updated_at' => now()])->saveQuietly();

        $legacy = $this->withToken($this->token)->getJson('/api/expenses?branch=all')->assertOk();
        $legacy->assertJsonMissingPath('meta');
        $this->assertSame(['EXP-DE-002', 'EXP-DE-001'], array_column($legacy['data'], 'number'));

        $filtered = $this->withToken($this->token)->getJson(
            '/api/expenses?branch=all&per_page=10&search='.urlencode('مورد خاص').'&status=posted&date_from=2026-02-01&amount_min=250.50&sort=-total'
        )->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame(['EXP-DE-002'], array_column($filtered['data'], 'number'));

        foreach (range(3, 12) as $index) {
            $this->expense(['number' => sprintf('EXP-DE-%03d', $index), 'expense_date' => '2026-03-01']);
        }
        $this->withToken($this->token)->getJson('/api/expenses?branch=all&per_page=10&page=2')
            ->assertOk()->assertJsonPath('meta.current_page', 2)->assertJsonPath('meta.total', 12);
    }

    /** @test */
    public function payment_explorer_keeps_receipts_and_supplier_payments_isolated_and_filters_partner_and_amount(): void
    {
        $receipt = $this->payment([
            'number' => 'RCPT-DE-001', 'partner_id' => $this->customer->id, 'direction' => 'received',
            'method' => 'bank', 'reference' => 'REF-CUSTOMER', 'payment_date' => '2026-02-10', 'amount' => 50025,
        ]);
        $supplierPayment = $this->payment([
            'number' => 'PAY-DE-001', 'partner_id' => $this->supplier->id, 'direction' => 'paid',
            'method' => 'cash', 'payment_date' => '2026-02-11', 'amount' => 70000, 'status' => 'posted',
        ]);

        $received = $this->withToken($this->token)->getJson(
            '/api/payments?branch=all&direction=received&per_page=10&search=REF-CUSTOMER&partner_name='.urlencode('عميل المستكشف').'&amount_min=500.25'
        )->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame([$receipt->id], array_column($received['data'], 'id'));

        $paid = $this->withToken($this->token)->getJson(
            '/api/payments?branch=all&direction=paid&per_page=10&partner_name='.urlencode('مورد المستكشف').'&status=posted&sort=-amount'
        )->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame([$supplierPayment->id], array_column($paid['data'], 'id'));

        $legacy = $this->withToken($this->token)->getJson('/api/payments?branch=all&direction=received')->assertOk();
        $legacy->assertJsonMissingPath('meta');
    }

    /** @test */
    public function journal_explorer_filters_entry_kind_source_amount_and_paginates_with_the_legacy_shape_intact(): void
    {
        $manual = $this->journal('JE-DE-MANUAL', ManualJournal::class, 12500);
        $automatic = $this->journal('JE-DE-AUTO', Invoice::class, 30000);
        $reversal = $this->journal('JE-DE-REV', Invoice::class, 30000, $automatic->id);

        $legacy = $this->withToken($this->token)->getJson('/api/journal-entries?branch=all')->assertOk();
        $legacy->assertJsonMissingPath('meta');

        $manualResponse = $this->withToken($this->token)->getJson('/api/journal-entries?branch=all&per_page=10&entry_kind=manual&amount_min=125.00')
            ->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame([$manual->id], array_column($manualResponse['data'], 'id'));
        $this->assertSame('manual', $manualResponse['data'][0]['entry_kind']);

        $sourceResponse = $this->withToken($this->token)->getJson('/api/journal-entries?branch=all&per_page=10&source_type=Invoice&entry_kind=automatic&sort=-total')
            ->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame([$automatic->id], array_column($sourceResponse['data'], 'id'));

        $reversalResponse = $this->withToken($this->token)->getJson('/api/journal-entries?branch=all&per_page=10&entry_kind=reversal')
            ->assertOk()->assertJsonPath('meta.total', 1);
        $this->assertSame([$reversal->id], array_column($reversalResponse['data'], 'id'));
    }

    /** @test */
    public function financial_explorer_page_and_per_page_bounds_are_validated(): void
    {
        foreach (['expenses?branch=all', 'payments?branch=all&direction=received', 'journal-entries?branch=all'] as $endpoint) {
            $separator = str_contains($endpoint, '?') ? '&' : '?';
            $this->withToken($this->token)->getJson("/api/{$endpoint}{$separator}per_page=10&page=0")
                ->assertStatus(422)->assertJsonValidationErrors('page');
            $this->withToken($this->token)->getJson("/api/{$endpoint}{$separator}per_page=5")
                ->assertStatus(422)->assertJsonValidationErrors('per_page');
        }
    }

    private function expense(array $attributes): Expense
    {
        return Expense::create(array_merge([
            'number' => 'EXP-'.Str::uuid(),
            'account_id' => $this->account->id,
            'expense_date' => '2026-01-01',
            'payment_method' => 'cash',
            'description' => 'مصروف اختبار',
            'amount' => 10000,
            'tax_rate' => 0,
            'tax_amount' => 0,
            'total' => 10000,
            'status' => 'draft',
        ], $attributes));
    }

    private function payment(array $attributes): Payment
    {
        return Payment::create(array_merge([
            'number' => 'PAY-'.Str::uuid(),
            'partner_id' => $this->customer->id,
            'direction' => 'received',
            'method' => 'cash',
            'payment_date' => '2026-01-01',
            'amount' => 10000,
            'status' => 'draft',
        ], $attributes));
    }

    private function journal(string $number, string $sourceType, int $amount, ?string $reversalOf = null): JournalEntry
    {
        $entry = JournalEntry::create([
            'number' => $number,
            'entry_date' => '2026-04-01',
            'description' => $number,
            'status' => 'posted',
            'source_type' => $sourceType,
            'source_id' => (string) Str::uuid(),
            'reversal_of' => $reversalOf,
            'posted_at' => now(),
        ]);
        $entry->lines()->create([
            'account_id' => $this->account->id,
            'debit' => $amount,
            'credit' => 0,
            'description' => $number,
            'branch_id' => null,
        ]);
        $entry->lines()->create([
            'account_id' => $this->account->id,
            'debit' => 0,
            'credit' => $amount,
            'description' => $number,
            'branch_id' => null,
        ]);

        return $entry;
    }
}

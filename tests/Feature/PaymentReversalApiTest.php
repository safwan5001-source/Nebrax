<?php

namespace Tests\Feature;

use App\Models\CashBankAccount;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Services\Accounting\AccountingPeriodLockService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * تكامل مسار عكس السند: RBAC، عزل المستأجر/الفرع، وعدم إعادة توجيه القيد.
 * تشغيل: php artisan test --filter=PaymentReversalApiTest
 */
class PaymentReversalApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @test */
    public function payments_manage_user_can_reverse_a_posted_payment_and_response_exposes_reversal_metadata(): void
    {
        ['token' => $token, 'payment' => $payment] = $this->postedReceipt();

        $response = $this->withToken($token)
            ->postJson("/api/payments/{$payment['id']}/reverse", [
                'date' => now()->toDateString(),
                'reason' => 'تصحيح سند قبض',
            ])
            ->assertOk()
            ->assertJsonPath('data.id', $payment['id'])
            ->assertJsonPath('data.status', 'reversed')
            ->assertJsonPath('data.journal_entry_id', $payment['journal_entry_id']);

        $this->assertNotNull($response['data']['reversal_entry_id']);
        $this->assertNotNull($response['data']['reversed_at']);
        $this->assertNotSame($response['data']['journal_entry_id'], $response['data']['reversal_entry_id']);
    }

    /** @test */
    public function user_without_payments_manage_receives_403_on_reverse(): void
    {
        ['token' => $owner, 'tenant_id' => $tenantId, 'payment' => $payment] = $this->postedReceipt();
        $staff = $this->tokenForRole($tenantId, 'staff', 'staff-reverse@acme.test');

        $this->withToken($staff)->getJson("/api/payments/{$payment['id']}")->assertOk();
        $this->withToken($staff)->postJson("/api/payments/{$payment['id']}/reverse")->assertForbidden();

        $this->assertSame('posted', Payment::findOrFail($payment['id'])->status);
        $this->assertNull(Payment::findOrFail($payment['id'])->reversal_entry_id);

        $this->withToken($owner)->getJson("/api/payments/{$payment['id']}")
            ->assertOk()
            ->assertJsonPath('data.status', 'posted');
    }

    /** @test */
    public function a_reversed_payment_cannot_be_reversed_twice_and_draft_only_mutations_stay_blocked(): void
    {
        ['token' => $token, 'partner_id' => $partnerId, 'payment' => $payment] = $this->postedReceipt();

        $this->withToken($token)->postJson("/api/payments/{$payment['id']}/reverse")->assertOk();

        $this->withToken($token)
            ->postJson("/api/payments/{$payment['id']}/reverse")
            ->assertStatus(422);

        $this->assertSame(1, JournalEntry::where('reversal_of', $payment['journal_entry_id'])->count());

        $this->withToken($token)->putJson("/api/payments/{$payment['id']}", [
            'partner_id' => $partnerId,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 10000,
        ])->assertStatus(422);

        $this->withToken($token)->postJson("/api/payments/{$payment['id']}/post")->assertStatus(422);
        $this->withToken($token)->deleteJson("/api/payments/{$payment['id']}")->assertStatus(422);

        $fresh = Payment::findOrFail($payment['id']);
        $this->assertTrue($fresh->isReversed());
        $this->assertSame($payment['journal_entry_id'], $fresh->journal_entry_id);
        $this->assertNotNull($fresh->reversal_entry_id);
    }

    /** @test */
    public function cross_tenant_payment_cannot_be_reversed_or_shown(): void
    {
        ['payment' => $payment] = $this->postedReceipt('alpha-rev', 'owner-a@alpha-rev.test');
        $b = $this->registerTenant('beta-rev', 'owner-b@beta-rev.test');

        $this->withToken($b['token'])->getJson("/api/payments/{$payment['id']}")->assertNotFound();
        $this->withToken($b['token'])->postJson("/api/payments/{$payment['id']}/reverse")->assertNotFound();

        $this->assertSame('posted', Payment::findOrFail($payment['id'])->status);
        $this->assertNull(Payment::findOrFail($payment['id'])->reversal_entry_id);
    }

    /** @test */
    public function payment_outside_the_caller_active_branch_cannot_be_reversed(): void
    {
        $auth = $this->registerTenant('branch-rev', 'owner@branch-rev.test');
        $main = $this->withToken($auth['token'])->getJson('/api/branches')['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])
            ->assertCreated()['data']['id'];

        $payment = $this->postedReceiptInBranch($auth['token'], $main);

        $this->withToken($auth['token'])
            ->withHeaders(['X-Branch-Id' => $other])
            ->getJson("/api/payments/{$payment['id']}")
            ->assertNotFound();

        $this->withToken($auth['token'])
            ->withHeaders(['X-Branch-Id' => $other])
            ->postJson("/api/payments/{$payment['id']}/reverse")
            ->assertNotFound();

        $this->assertSame('posted', Payment::findOrFail($payment['id'])->status);

        $this->withToken($auth['token'])
            ->withHeaders(['X-Branch-Id' => $main])
            ->postJson("/api/payments/{$payment['id']}/reverse")
            ->assertOk()
            ->assertJsonPath('data.status', 'reversed');
    }

    /** @test */
    public function reversal_uses_the_original_stored_journal_and_ignores_current_cash_and_method_defaults(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId, 'payment' => $payment] = $this->postedReceipt();
        app(TenantContext::class)->set($tenantId);

        $original = JournalEntry::with('lines')->findOrFail($payment['journal_entry_id']);
        $originalAccounts = $original->lines->pluck('account_id')->sort()->values()->all();
        $originalBranches = $original->lines->pluck('branch_id')->all();
        $snapshotCashAccount = $payment['cash_account_id'];
        $snapshotMethod = $payment['method'];

        $newCash = $this->withToken($token)->postJson('/api/cash-bank-accounts', [
            'type' => 'cash',
            'name' => 'خزينة بديلة بعد الترحيل',
            'currency' => 'SAR',
            'deposit_scope' => 'all',
            'withdraw_scope' => 'all',
        ])->assertCreated()['data'];
        $this->withToken($token)->postJson("/api/cash-bank-accounts/{$newCash['id']}/make-main")->assertOk();

        $this->assertNotSame($snapshotCashAccount, CashBankAccount::findOrFail($newCash['id'])->account_id);

        $reversed = $this->withToken($token)
            ->postJson("/api/payments/{$payment['id']}/reverse", [
                'reason' => 'عكس بدون إعادة توجيه',
            ])
            ->assertOk()
            ->json('data');

        $fresh = Payment::findOrFail($payment['id']);
        $this->assertSame($snapshotCashAccount, $fresh->cash_account_id);
        $this->assertSame($snapshotMethod, $fresh->method);
        $this->assertSame($payment['payment_method_id'], $fresh->payment_method_id);
        $this->assertSame(115000, $fresh->amount);
        $this->assertSame($original->id, $fresh->journal_entry_id);

        $reversal = JournalEntry::with('lines')->findOrFail($reversed['reversal_entry_id']);
        $this->assertSame($original->id, $reversal->reversal_of);
        $this->assertSame($originalAccounts, $reversal->lines->pluck('account_id')->sort()->values()->all());
        $this->assertSame($originalBranches, $reversal->lines->pluck('branch_id')->all());
        $this->assertFalse(
            JournalLine::where('journal_entry_id', $reversal->id)
                ->where('account_id', $newCash['account_id'])
                ->exists()
        );
        $this->assertNotSame($snapshotCashAccount, $newCash['account_id']);
    }

    /** @test */
    public function reversal_dated_inside_a_locked_period_fails_and_leaves_state_unchanged(): void
    {
        ['token' => $token, 'tenant_id' => $tenantId, 'payment' => $payment] = $this->postedReceipt();
        app(TenantContext::class)->set($tenantId);

        $invoicePaid = Invoice::findOrFail(
            Payment::findOrFail($payment['id'])->allocations()->firstOrFail()->allocatable_id
        );
        $paidBefore = $invoicePaid->paid_amount;
        $allocationCount = Payment::findOrFail($payment['id'])->allocations()->count();

        $lockedDate = now()->toDateString();
        app(AccountingPeriodLockService::class)->create(
            now()->startOfMonth()->toDateString(),
            now()->endOfMonth()->toDateString(),
            'إقفال الفترة الحالية',
            null
        );

        $this->withToken($token)
            ->postJson("/api/payments/{$payment['id']}/reverse", [
                'date' => $lockedDate,
                'reason' => 'عكس داخل فترة مقفلة',
            ])
            ->assertStatus(422);

        $fresh = Payment::findOrFail($payment['id']);
        $this->assertSame('posted', $fresh->status);
        $this->assertNull($fresh->reversal_entry_id);
        $this->assertNull($fresh->reversed_at);
        $this->assertSame($payment['journal_entry_id'], $fresh->journal_entry_id);
        $this->assertSame($allocationCount, $fresh->allocations()->count());
        $this->assertSame('posted', JournalEntry::findOrFail($payment['journal_entry_id'])->status);
        $this->assertSame(0, JournalEntry::where('reversal_of', $payment['journal_entry_id'])->count());
        $this->assertSame($paidBefore, $invoicePaid->fresh()->paid_amount);
        $this->assertSame('paid', $invoicePaid->fresh()->payment_status);
    }

    /**
     * @return array{token:string,tenant_id:string,partner_id:string,payment:array}
     */
    private function postedReceipt(string $slug = 'pay-rev-api', string $email = 'owner@pay-rev-api.test'): array
    {
        $auth = $this->registerTenant($slug, $email);
        $payment = $this->postedReceiptInBranch($auth['token'], null);

        return [
            'token' => $auth['token'],
            'tenant_id' => $auth['tenant_id'],
            'partner_id' => $payment['partner_id'],
            'payment' => $payment,
        ];
    }

    private function postedReceiptInBranch(string $token, ?string $branchId): array
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];

        $partnerId = $this->withToken($token)->withHeaders($headers)
            ->postJson('/api/partners', ['name' => 'عميل العكس', 'type' => 'customer'])
            ->assertCreated()['data']['id'];

        $invoice = $this->withToken($token)->withHeaders($headers)->postJson('/api/invoices', [
            'partner_id' => $partnerId,
            'payment_type' => 'credit',
            'items' => [['quantity' => 1, 'unit_price' => 100000, 'tax_rate' => 15]],
        ])->assertCreated()['data'];
        $this->withToken($token)->withHeaders($headers)
            ->postJson("/api/invoices/{$invoice['id']}/post")
            ->assertOk();

        $draft = $this->withToken($token)->withHeaders($headers)->postJson('/api/payments', [
            'partner_id' => $partnerId,
            'direction' => 'received',
            'method' => 'cash',
            'amount' => 115000,
            'invoice_id' => $invoice['id'],
        ])->assertCreated()['data'];

        return $this->withToken($token)->withHeaders($headers)
            ->postJson("/api/payments/{$draft['id']}/post")
            ->assertOk()['data'];
    }
}

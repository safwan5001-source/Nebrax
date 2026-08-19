<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\EmployeeCustodySettlement;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\SettlementType;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\EmployeeCustodyService;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

class EmployeeCustodySettlementTest extends TestCase
{
    use RefreshDatabase;

    private Tenant $tenant;
    private Employee $employee;
    private EmployeeCustodyService $custodies;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس تسويات العهد',
            'slug' => 'nebrax-custody-settlements',
            'vat_number' => '300000000000013',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->employee = Employee::create([
            'employee_no' => Employee::nextDocumentNumber('EMP'),
            'name' => 'موظف التسويات',
            'basic_salary' => 0,
            'is_active' => true,
        ]);
        $this->custodies = app(EmployeeCustodyService::class);
    }

    private function postedCustody(int $amount = 50000): EmployeeCustody
    {
        return $this->custodies->post($this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => $amount,
            'custody_date' => '2026-08-20',
            'method' => 'cash',
        ]));
    }

    private function activeType(): SettlementType
    {
        return SettlementType::create([
            'name' => 'تسوية مصروفات',
            'description' => 'إثبات مصروف من العهدة',
            'is_active' => true,
        ]);
    }

    private function debitAccount(): Account
    {
        return Account::where('code', '5150')->firstOrFail();
    }

    private function line(JournalEntry $entry, string $code): JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    /** التسوية تنشئ سجلاً وقيداً متوازناً، مصدره السجل نفسه لا العهدة الأصلية. */
    /** @test */
    public function it_posts_a_balanced_settlement_entry_and_links_it_to_its_audit_source(): void
    {
        $custody = $this->postedCustody();
        $settlement = $this->custodies->settle($custody, [
            'settlement_type_id' => $this->activeType()->id,
            'debit_account_id' => $this->debitAccount()->id,
            'settlement_date' => '2026-08-20',
            'amount' => 20000,
            'notes' => 'وقود مهمات العمل',
        ]);
        $entry = JournalEntry::with('lines.account')->findOrFail($settlement->journal_entry_id);

        $this->assertStringStartsWith('CSTL-2026-', $settlement->number);
        $this->assertSame(EmployeeCustodySettlement::class, $entry->source_type);
        $this->assertSame($settlement->id, $entry->source_id);
        $this->assertSame(20000, (int) $entry->lines->sum('debit'));
        $this->assertSame(20000, (int) $entry->lines->sum('credit'));
        $this->assertSame(20000, (int) $this->line($entry, '5150')->debit);
        $this->assertSame(20000, (int) $this->line($entry, '1160')->credit);
        $this->assertSame(30000, $custody->fresh()->amount - (int) $custody->fresh()->settlements()->sum('amount'));
    }

    /** القفل ومجموع السجل يمنعان تجاوز الرصيد المتبقي مهما تعددت التسويات. */
    /** @test */
    public function it_refuses_a_settlement_that_exceeds_the_remaining_custody_balance(): void
    {
        $custody = $this->postedCustody(10000);
        $type = $this->activeType();
        $account = $this->debitAccount();
        $this->custodies->settle($custody, [
            'settlement_type_id' => $type->id,
            'debit_account_id' => $account->id,
            'settlement_date' => '2026-08-20',
            'amount' => 6000,
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('يتجاوز الرصيد المتبقي');
        $this->custodies->settle($custody->fresh(), [
            'settlement_type_id' => $type->id,
            'debit_account_id' => $account->id,
            'settlement_date' => '2026-08-20',
            'amount' => 4001,
        ]);
    }

    /** لا تسوية بلا صرف مرحّل سابق؛ المسودة لا تحمل التزاماً محاسبياً بعد. */
    /** @test */
    public function it_refuses_settling_a_draft_custody(): void
    {
        $draft = $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 10000,
            'custody_date' => '2026-08-20',
        ]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير مرحّلة');
        $this->custodies->settle($draft, [
            'settlement_type_id' => $this->activeType()->id,
            'debit_account_id' => $this->debitAccount()->id,
            'settlement_date' => '2026-08-20',
            'amount' => 1000,
        ]);
    }

    /** النوع المعطّل يبقى في السجل التاريخي لكنه لا يقبل تسويات جديدة. */
    /** @test */
    public function it_refuses_an_inactive_settlement_type(): void
    {
        $type = $this->activeType();
        $type->update(['is_active' => false]);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('غير نشط');
        $this->custodies->settle($this->postedCustody(), [
            'settlement_type_id' => $type->id,
            'debit_account_id' => $this->debitAccount()->id,
            'settlement_date' => '2026-08-20',
            'amount' => 1000,
        ]);
    }

    /** النماذج المقيدة بالمستأجر تمنع تسوية عهدة تعود إلى شركة أخرى. */
    /** @test */
    public function settlements_are_isolated_between_tenants(): void
    {
        $custody = $this->postedCustody();
        $other = Tenant::create([
            'name' => 'شركة أخرى للتسويات',
            'slug' => 'other-custody-settlements',
            'vat_number' => '300000000000014',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);

        $this->expectException(ModelNotFoundException::class);
        $this->custodies->settle($custody, [
            'settlement_type_id' => $this->activeType()->id,
            'debit_account_id' => $this->debitAccount()->id,
            'settlement_date' => '2026-08-20',
            'amount' => 1000,
        ]);
    }
}

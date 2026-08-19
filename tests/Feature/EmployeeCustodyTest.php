<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Tenant;
use App\Services\Accounting\ChartOfAccountsSeeder;
use App\Services\Accounting\EmployeeCustodyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * عقد إصدار عُهَد الموظفين الأول:
 * - لا أثر قبل الترحيل.
 * - صرف العهدة: مدين 1160 │ دائن 1110/1120.
 * - القيد متوازن ومربوط بالمصدر، والمرحّل immutable.
 */
class EmployeeCustodyTest extends TestCase
{
    use RefreshDatabase;

    protected Tenant $tenant;
    protected Employee $employee;
    protected EmployeeCustodyService $custodies;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح',
            'slug' => 'nibras-custody',
            'vat_number' => '300000000000003',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($this->tenant->id);
        app(ChartOfAccountsSeeder::class)->seed($this->tenant->id);

        $this->employee = Employee::create([
            'employee_no' => Employee::nextDocumentNumber('EMP'),
            'name' => 'موظف العهدة',
            'basic_salary' => 0,
            'is_active' => true,
        ]);
        $this->custodies = app(EmployeeCustodyService::class);
    }

    private function entryFor(EmployeeCustody $custody): JournalEntry
    {
        return JournalEntry::with('lines.account')
            ->where('source_type', EmployeeCustody::class)
            ->where('source_id', $custody->id)
            ->firstOrFail();
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    /** @test */
    public function it_creates_a_draft_without_financial_effect(): void
    {
        $custody = $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 50000,
            'custody_date' => '2026-08-19',
        ]);

        $this->assertTrue($custody->isDraft());
        $this->assertSame(50000, $custody->amount);
        $this->assertStringStartsWith('CST-2026-', $custody->number);
        $this->assertNull($custody->journal_entry_id);
        $this->assertSame(0, JournalEntry::count());
        $this->assertNull(Account::where('code', '1160')->firstOrFail()->balance);
    }

    /** @test */
    public function posting_a_cash_custody_is_balanced_and_links_1160_to_1110(): void
    {
        $custody = $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 50000,
            'custody_date' => '2026-08-19',
            'method' => 'cash',
        ]);
        $posted = $this->custodies->post($custody);
        $entry = $this->entryFor($posted);

        $this->assertTrue($posted->isPosted());
        $this->assertSame($posted->id, $entry->source_id);
        $this->assertSame(EmployeeCustody::class, $entry->source_type);
        $this->assertSame(50000, $entry->lines->sum('debit'));
        $this->assertSame(50000, $entry->lines->sum('credit'));
        $this->assertSame(50000, (int) $this->line($entry, '1160')->debit);
        $this->assertSame(50000, (int) $this->line($entry, '1110')->credit);
        $this->assertSame(50000, Account::where('code', '1160')->firstOrFail()->balance->balance);
        $this->assertSame(-50000, Account::where('code', '1110')->firstOrFail()->balance->balance);
    }

    /** @test */
    public function posting_a_bank_custody_credits_the_bank_account(): void
    {
        $custody = $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 80000,
            'custody_date' => '2026-08-19',
            'method' => 'bank',
        ]);
        $entry = $this->entryFor($this->custodies->post($custody));

        $this->assertSame(80000, (int) $this->line($entry, '1160')->debit);
        $this->assertSame(80000, (int) $this->line($entry, '1120')->credit);
        $this->assertNull($this->line($entry, '1110'));
    }

    /** @test */
    public function it_rejects_non_positive_amounts_before_creating_a_document(): void
    {
        $this->expectExceptionMessage('موجباً');
        $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 0,
            'custody_date' => '2026-08-19',
        ]);
    }

    /** @test */
    public function a_posted_custody_cannot_be_updated_or_posted_twice(): void
    {
        $custody = $this->custodies->post($this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 25000,
            'custody_date' => '2026-08-19',
        ]));

        try {
            $this->custodies->update($custody, [
                'employee_id' => $this->employee->id,
                'amount' => 30000,
                'custody_date' => '2026-08-20',
                'method' => 'cash',
            ]);
            $this->fail('تعديل العهدة المرحلة يجب أن يُرفض.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('تعديل', $exception->getMessage());
        }

        $this->expectExceptionMessage('غير مسوّدة');
        $this->custodies->post($custody->fresh());
    }

    /** @test */
    public function duplicate_is_a_new_draft_without_a_journal_entry(): void
    {
        $original = $this->custodies->post($this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 70000,
            'custody_date' => '2026-08-19',
        ]));

        $copy = $this->custodies->duplicate($original);

        $this->assertNotSame($original->id, $copy->id);
        $this->assertTrue($copy->isDraft());
        $this->assertSame($original->amount, $copy->amount);
        $this->assertNull($copy->journal_entry_id);
        $this->assertNotSame($original->number, $copy->number);
    }

    /** @test */
    public function custodies_are_isolated_between_tenants(): void
    {
        $first = $this->custodies->create([
            'employee_id' => $this->employee->id,
            'amount' => 10000,
            'custody_date' => '2026-08-19',
        ]);

        $other = Tenant::create([
            'name' => 'شركة أخرى',
            'slug' => 'other-custody',
            'vat_number' => '300000000000004',
            'currency' => 'SAR',
        ]);
        app(TenantContext::class)->set($other->id);
        app(ChartOfAccountsSeeder::class)->seed($other->id);
        $employee = Employee::create([
            'employee_no' => Employee::nextDocumentNumber('EMP'),
            'name' => 'موظف آخر',
            'basic_salary' => 0,
            'is_active' => true,
        ]);
        $second = app(EmployeeCustodyService::class)->create([
            'employee_id' => $employee->id,
            'amount' => 20000,
            'custody_date' => '2026-08-19',
        ]);

        $this->assertNull(EmployeeCustody::find($first->id));
        $this->assertSame($second->id, EmployeeCustody::find($second->id)?->id);
    }
}

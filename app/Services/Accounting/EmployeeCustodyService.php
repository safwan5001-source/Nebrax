<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة الإصدار الأول لعهدة الموظف:
 * - create/update/duplicate: مسودة بلا أثر محاسبي.
 * - post: مدين حساب عهدة الموظف │ دائن الخزينة/البنك، عبر LedgerService.
 *
 * التسويات وإرجاع النقد والإغلاق مؤجلة حتى بناء إعدادات المالية وأنواع التسوية.
 */
class EmployeeCustodyService
{
    private const ACC_CUSTODY = '1160';

    public function __construct(
        protected LedgerService $ledger,
        protected CashBankAccountService $cashBankAccounts,
    ) {}

    public function create(array $data): EmployeeCustody
    {
        $amount = $this->assertAmount($data['amount'] ?? 0);
        $employee = $this->resolveEmployee($data['employee_id'] ?? null);
        $cashAccountId = $this->resolveCashAccount($data['cash_account_id'] ?? null, $data['method'] ?? 'cash');
        $custodyAccountId = $this->resolveCustodyAccount($data['custody_account_id'] ?? null);
        $date = $data['custody_date'] ?? now()->toDateString();

        return DB::transaction(function () use ($data, $amount, $employee, $cashAccountId, $custodyAccountId, $date) {
            // تظل نسخة وثيقة فرعها في نطاق المصدر كي لا تتصادم سلسلة أرقامها عند التبديل بين الفروع.
            $hasExplicitBranch = array_key_exists('branch_id', $data);
            $number = $data['number'] ?? (
                $hasExplicitBranch
                    ? $this->nextNumber($date, $data['branch_id'])
                    : $this->nextNumber($date)
            );

            $attributes = [
                'number' => $number,
                'employee_id' => $employee->id,
                'custody_account_id' => $custodyAccountId,
                'cash_account_id' => $cashAccountId,
                'method' => $data['method'] ?? 'cash',
                'custody_date' => $date,
                'due_date' => $data['due_date'] ?? null,
                'amount' => $amount,
                'status' => 'draft',
                'notes' => $data['notes'] ?? null,
                'created_by' => $data['created_by'] ?? null,
            ];
            if ($hasExplicitBranch) {
                $attributes['branch_id'] = $data['branch_id'];
            }

            return EmployeeCustody::create($attributes);
        });
    }

    public function update(EmployeeCustody $custody, array $data): EmployeeCustody
    {
        if (! $custody->isDraft()) {
            throw new RuntimeException('لا يمكن تعديل عهدة مرحّلة.');
        }

        $amount = $this->assertAmount($data['amount'] ?? 0);
        $employee = $this->resolveEmployee($data['employee_id'] ?? null);
        $cashAccountId = $this->resolveCashAccount($data['cash_account_id'] ?? null, $data['method'] ?? 'cash');
        $custodyAccountId = $this->resolveCustodyAccount($data['custody_account_id'] ?? null);

        return DB::transaction(function () use ($custody, $data, $amount, $employee, $cashAccountId, $custodyAccountId) {
            $custody->update([
                'employee_id' => $employee->id,
                'custody_account_id' => $custodyAccountId,
                'cash_account_id' => $cashAccountId,
                'method' => $data['method'] ?? 'cash',
                'custody_date' => $data['custody_date'] ?? $custody->custody_date->toDateString(),
                'due_date' => $data['due_date'] ?? null,
                'amount' => $amount,
                'notes' => $data['notes'] ?? null,
            ]);

            return $custody->fresh();
        });
    }

    /** النسخة دائماً مسودة ولا ترث أي قيد أو حالة ترحيل. */
    public function duplicate(EmployeeCustody $custody, ?string $createdBy = null): EmployeeCustody
    {
        $date = now()->toDateString();
        $data = [
            'employee_id' => $custody->employee_id,
            'custody_account_id' => $custody->custody_account_id,
            'cash_account_id' => $custody->cash_account_id,
            'method' => $custody->method,
            'custody_date' => $date,
            'due_date' => $custody->due_date?->toDateString(),
            'amount' => $custody->amount,
            'notes' => $custody->notes,
            'created_by' => $createdBy,
        ];

        if ($custody->branch_id !== null) {
            $data['branch_id'] = $custody->branch_id;
        } else {
            $data['number'] = $this->nextNumber($date, null);
        }

        return $this->create($data);
    }

    /** ترحيل صرف واحد: مدين 1160 عُهَد الموظفين، دائن خزينة/بنك. */
    public function post(EmployeeCustody $custody, ?User $actor = null): EmployeeCustody
    {
        if (! $custody->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل عهدة غير مسوّدة (draft).');
        }

        return DB::transaction(function () use ($custody, $actor) {
            $custody = EmployeeCustody::lockForUpdate()->findOrFail($custody->id);
            if (! $custody->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل عهدة غير مسوّدة (draft).');
            }

            $employee = Employee::lockForUpdate()->findOrFail($custody->employee_id);
            if (! $employee->is_active) {
                throw new RuntimeException('لا يمكن ترحيل عهدة لموظف غير نشط.');
            }

            $cashEntity = $this->cashBankAccounts->resolveForPayment($custody->cash_account_id, $custody->method);
            $this->cashBankAccounts->assertAllowed($cashEntity, 'withdraw', $actor);
            $custodyAccountId = $this->resolveCustodyAccount($custody->custody_account_id);

            $entry = $this->ledger->post([
                [
                    'account_id' => $custodyAccountId,
                    'debit' => $custody->amount,
                ],
                [
                    'account_id' => $cashEntity->account_id,
                    'credit' => $custody->amount,
                ],
            ], [
                'entry_date' => $custody->custody_date->toDateString(),
                'description' => "صرف عهدة موظف {$custody->number}",
                'source_type' => EmployeeCustody::class,
                'source_id' => $custody->id,
                'created_by' => $custody->created_by,
            ]);

            $custody->update([
                'status' => 'posted',
                'journal_entry_id' => $entry->id,
            ]);

            return $custody->fresh();
        });
    }

    private function assertAmount(mixed $amount): int
    {
        $value = (int) $amount;
        if ($value <= 0) {
            throw new RuntimeException('مبلغ العهدة يجب أن يكون موجباً.');
        }

        return $value;
    }

    private function resolveEmployee(?string $employeeId): Employee
    {
        $employee = Employee::findOrFail($employeeId);
        if (! $employee->is_active) {
            throw new RuntimeException('لا يمكن إنشاء عهدة لموظف غير نشط.');
        }

        return $employee;
    }

    private function resolveCashAccount(?string $accountId, string $method): string
    {
        return $this->cashBankAccounts->resolveForPayment($accountId, $method)->account_id;
    }

    private function resolveCustodyAccount(?string $accountId): string
    {
        $account = $accountId
            ? Account::findOrFail($accountId)
            : Account::where('code', self::ACC_CUSTODY)->first();

        if (! $account || $account->is_group || $account->type !== 'asset' || ! $account->is_active) {
            throw new RuntimeException('حساب عهدة الموظف غير صالح أو غير نشط.');
        }

        return $account->id;
    }

    private function nextNumber(string $date, string|null|false $branchId = false): string
    {
        return EmployeeCustody::nextDocumentNumber('CST', $date, $branchId);
    }
}

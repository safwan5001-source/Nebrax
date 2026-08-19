<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Employee;
use App\Models\EmployeeCustody;
use App\Models\EmployeeCustodySettlement;
use App\Models\SettlementType;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * دورة الإصدار الأول لعهدة الموظف:
 * - create/update/duplicate: مسودة بلا أثر محاسبي.
 * - post: مدين حساب عهدة الموظف │ دائن الخزينة/البنك، عبر LedgerService.
 *
 * التسوية: مدين الحساب المختار │ دائن حساب العُهَد، بسجل وقيد مترابطين ذرياً.
 * إرجاع النقد والإغلاق الرسمي والدين المعدوم خارج نطاق هذه الدورة.
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

    /**
     * تسوية أحادية السطر لعهدة مرحّلة. تنشأ التسوية أولاً داخل المعاملة لتكون
     * مصدر القيد، ثم تمر سطور القيد عبر LedgerService حصراً، وبعدها يُحفظ الرابط.
     */
    public function settle(EmployeeCustody $custody, array $data): EmployeeCustodySettlement
    {
        $amount = $this->assertSettlementAmount($data['amount'] ?? 0);

        return DB::transaction(function () use ($custody, $data, $amount) {
            // قفل أصل العهدة هو حاجز التزامن: يمنع عمليتي تسوية من تجاوز الرصيد معاً.
            $custody = EmployeeCustody::lockForUpdate()->findOrFail($custody->id);
            if ($custody->status !== 'posted') {
                throw new RuntimeException('لا يمكن تسوية عهدة غير مرحّلة.');
            }

            $settledAmount = (int) EmployeeCustodySettlement::query()
                ->where('employee_custody_id', $custody->id)
                ->sum('amount');
            $remainingAmount = $custody->amount - $settledAmount;
            if ($amount > $remainingAmount) {
                throw new RuntimeException('مبلغ التسوية يتجاوز الرصيد المتبقي للعهدة.');
            }

            $settlementType = SettlementType::findOrFail($data['settlement_type_id']);
            if (! $settlementType->is_active) {
                throw new RuntimeException('لا يمكن استخدام نوع تسوية غير نشط.');
            }

            $custodyAccountId = $this->resolveCustodyAccount($custody->custody_account_id);
            $debitAccount = $this->resolveSettlementDebitAccount($data['debit_account_id']);
            if ($debitAccount->id === $custodyAccountId) {
                throw new RuntimeException('يجب أن يختلف الحساب المدين للتسوية عن حساب عُهَد الموظفين.');
            }

            $settlementDate = $data['settlement_date'] ?? now()->toDateString();
            $settlement = EmployeeCustodySettlement::create([
                'branch_id' => $custody->branch_id,
                'number' => EmployeeCustodySettlement::nextDocumentNumber('CSTL', $settlementDate, $custody->branch_id),
                'employee_custody_id' => $custody->id,
                'settlement_type_id' => $settlementType->id,
                'debit_account_id' => $debitAccount->id,
                'settlement_date' => $settlementDate,
                'amount' => $amount,
                'notes' => $data['notes'] ?? null,
                'created_by' => $data['created_by'] ?? null,
            ]);

            $entry = $this->ledger->post([
                [
                    'account_id' => $debitAccount->id,
                    'debit' => $amount,
                    'description' => "تسوية عهدة {$custody->number}",
                    'partner_type' => Employee::class,
                    'partner_id' => $custody->employee_id,
                    'branch_id' => $custody->branch_id,
                ],
                [
                    'account_id' => $custodyAccountId,
                    'credit' => $amount,
                    'description' => "تسوية عهدة {$custody->number}",
                    'partner_type' => Employee::class,
                    'partner_id' => $custody->employee_id,
                    'branch_id' => $custody->branch_id,
                ],
            ], [
                'entry_date' => $settlementDate,
                'description' => "تسوية عهدة موظف {$custody->number} ({$settlement->number})",
                'source_type' => EmployeeCustodySettlement::class,
                'source_id' => $settlement->id,
                'created_by' => $data['created_by'] ?? null,
                'branch_id' => $custody->branch_id,
            ]);

            $settlement->update(['journal_entry_id' => $entry->id]);

            return $settlement->fresh(['settlementType', 'debitAccount']);
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

    private function assertSettlementAmount(mixed $amount): int
    {
        $value = (int) $amount;
        if ($value <= 0) {
            throw new RuntimeException('مبلغ التسوية يجب أن يكون موجباً.');
        }

        return $value;
    }

    private function resolveSettlementDebitAccount(?string $accountId): Account
    {
        $account = Account::findOrFail($accountId);
        if ($account->is_group || ! $account->is_active) {
            throw new RuntimeException('الحساب المدين للتسوية غير صالح أو غير نشط.');
        }

        return $account;
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

<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Employee;
use App\Models\PayrollItem;
use App\Models\PayrollRun;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PayrollService — وحدة الرواتب (HR)
 * ═══════════════════════════════════════════════════════════════
 *  الدورة:  إنشاء (draft) → ترحيل الاستحقاق (posted) → الصرف (paid).
 *
 *  - create(): يلتقط الموظفين النشطين في مسيّر شهري ويحسب الإجماليات من السطور.
 *  - post():   يولّد قيد الاستحقاق المتوازن عبر LedgerService:
 *                مدين  5120 الرواتب والأجور        (إجمالي الاستحقاق)
 *                دائن  2130 رواتب مستحقة            (الصافي المستحق للموظفين)
 *                دائن  2140 التأمينات مستحقة        (GOSI حصة الموظف، إن وُجدت)
 *                دائن  2150 استقطاعات موظفين مستحقة (سُلف/أخرى، إن وُجدت)
 *  - pay():    يولّد قيد الصرف المتوازن عبر LedgerService:
 *                مدين  2130 رواتب مستحقة
 *                دائن  1110 الصندوق  أو  1120 البنك  (حسب طريقة الدفع)
 *
 *  الصافي = الإجمالي − GOSI − الاستقطاعات الأخرى. الخصوم تبقى مستحقة وتُسوّى
 *  لاحقاً (لا تدخل قيد الصرف). لا كتابة مباشرة في journal_lines — كل قيد يمرّ
 *  عبر المحرك حصراً، ومربوط بمصدره PayrollRun.
 */
class PayrollService
{
    private const ACC_SALARY_EXPENSE = '5120'; // الرواتب والأجور (مصروف)
    private const ACC_SALARY_PAYABLE = '2130'; // رواتب مستحقة (خصم)
    private const ACC_GOSI_PAYABLE   = '2140'; // التأمينات الاجتماعية مستحقة (خصم)
    private const ACC_DEDUCT_PAYABLE = '2150'; // استقطاعات موظفين مستحقة (خصم)
    private const ACC_CASH           = '1110'; // الصندوق
    private const ACC_BANK           = '1120'; // البنك

    public function __construct(
        protected LedgerService $ledger
    ) {}

    /**
     * إنشاء مسيّر رواتب draft لفترة شهرية، ملتقطاً رواتب الموظفين النشطين.
     *
     * @param  array       $data         ['period'=>'YYYY-MM', 'notes'=>?, 'number'=>?, 'created_by'=>?]
     * @param  array|null  $employeeIds  لتقييد المسيّر بموظفين محددين (افتراضياً: كل النشطين)
     */
    public function create(array $data, ?array $employeeIds = null): PayrollRun
    {
        $period = $data['period'] ?? now()->format('Y-m');
        if (! preg_match('/^\d{4}-\d{2}$/', $period)) {
            throw new RuntimeException('الفترة يجب أن تكون بصيغة YYYY-MM.');
        }

        $query = Employee::where('is_active', true);
        if ($employeeIds !== null) {
            $query->whereIn('id', $employeeIds);
        }
        $employees = $query->get();

        if ($employees->isEmpty()) {
            throw new RuntimeException('لا يوجد موظفون نشطون لإنشاء مسيّر الرواتب.');
        }

        return DB::transaction(function () use ($data, $period, $employees) {
            [$start, $end] = $this->periodBounds($period);

            $run = PayrollRun::create([
                'number'       => $data['number'] ?? $this->nextNumber($start),
                'period'       => $period,
                'period_start' => $start,
                'period_end'   => $end,
                'status'       => 'draft',
                'notes'        => $data['notes'] ?? null,
                'created_by'   => $data['created_by'] ?? null,
            ]);

            $totalGross = $totalGosi = $totalOther = $totalNet = 0;

            foreach ($employees as $employee) {
                $gross = (int) $employee->basic_salary + (int) $employee->allowances;
                $gosi  = (int) $employee->gosi;
                $other = (int) $employee->other_deductions;
                $net   = $gross - $gosi - $other;

                if ($net < 0) {
                    throw new RuntimeException("استقطاعات الموظف ({$employee->name}) تتجاوز إجمالي راتبه.");
                }

                PayrollItem::create([
                    'payroll_run_id'   => $run->id,
                    'employee_id'      => $employee->id,
                    'basic_salary'     => (int) $employee->basic_salary,
                    'allowances'       => (int) $employee->allowances,
                    'gosi'             => $gosi,
                    'other_deductions' => $other,
                    'gross'            => $gross,
                    'net'              => $net,
                ]);

                $totalGross += $gross;
                $totalGosi  += $gosi;
                $totalOther += $other;
                $totalNet   += $net;
            }

            $run->update([
                'total_gross'            => $totalGross,
                'total_gosi'             => $totalGosi,
                'total_other_deductions' => $totalOther,
                'total_net'              => $totalNet,
            ]);

            return $run->load('items');
        });
    }

    /**
     * ترحيل الاستحقاق: مدين 5120 (الإجمالي) / دائن 2130 (الصافي).
     */
    public function post(PayrollRun $run): PayrollRun
    {
        if (! $run->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل مسيّر رواتب غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($run) {
            // الإجماليات مشتقة من السطور (مصدر الحقيقة) قبل توليد القيد.
            $run->loadMissing('items');
            $totalGross = (int) $run->items->sum('gross');
            $totalGosi  = (int) $run->items->sum('gosi');
            $totalOther = (int) $run->items->sum('other_deductions');
            $totalNet   = (int) $run->items->sum('net');

            if ($totalGross <= 0) {
                throw new RuntimeException('إجمالي المسيّر يجب أن يكون موجباً.');
            }

            // مدين 5120 بالإجمالي، ودائن الصافي + الاستقطاعات (متوازن: الإجمالي = الصافي + الخصوم).
            $lines = [
                ['account_id' => $this->accountId(self::ACC_SALARY_EXPENSE), 'debit' => $totalGross],
                ['account_id' => $this->accountId(self::ACC_SALARY_PAYABLE), 'credit' => $totalNet],
            ];
            if ($totalGosi > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_GOSI_PAYABLE), 'credit' => $totalGosi];
            }
            if ($totalOther > 0) {
                $lines[] = ['account_id' => $this->accountId(self::ACC_DEDUCT_PAYABLE), 'credit' => $totalOther];
            }

            $entry = $this->ledger->post($lines, [
                'entry_date'  => $run->period_end->toDateString(),
                'description' => "استحقاق رواتب {$run->number} ({$run->period})",
                'source_type' => PayrollRun::class,
                'source_id'   => $run->id,
                'created_by'  => $run->created_by,
            ]);

            $run->update([
                'status'                 => 'posted',
                'total_gross'            => $totalGross,
                'total_gosi'             => $totalGosi,
                'total_other_deductions' => $totalOther,
                'total_net'              => $totalNet,
                'journal_entry_id'       => $entry->id,
                'posted_at'              => now(),
            ]);

            return $run->fresh('items');
        });
    }

    /**
     * صرف الرواتب: مدين 2130 / دائن 1110 (نقدي) أو 1120 (بنكي).
     */
    public function pay(PayrollRun $run, string $method = 'bank'): PayrollRun
    {
        if (! $run->isPosted()) {
            throw new RuntimeException('لا يمكن صرف مسيّر لم يُرحَّل استحقاقه (posted).');
        }
        if (! in_array($method, ['cash', 'bank'], true)) {
            throw new RuntimeException('طريقة الدفع يجب أن تكون cash أو bank.');
        }

        return DB::transaction(function () use ($run, $method) {
            $run->loadMissing('items');
            $totalNet = (int) $run->items->sum('net');

            $cashAccount = $method === 'cash' ? self::ACC_CASH : self::ACC_BANK;

            $entry = $this->ledger->post([
                ['account_id' => $this->accountId(self::ACC_SALARY_PAYABLE), 'debit' => $totalNet],
                ['account_id' => $this->accountId($cashAccount), 'credit' => $totalNet],
            ], [
                'entry_date'  => now()->toDateString(),
                'description' => "صرف رواتب {$run->number} ({$run->period})",
                'source_type' => PayrollRun::class,
                'source_id'   => $run->id,
                'created_by'  => $run->created_by,
            ]);

            $run->update([
                'status'                   => 'paid',
                'pay_method'               => $method,
                'payment_journal_entry_id' => $entry->id,
                'paid_at'                  => now(),
            ]);

            return $run->fresh('items');
        });
    }

    /**
     * حدود الشهر [أول يوم, آخر يوم] من فترة YYYY-MM.
     *
     * @return array{0:string,1:string}
     */
    protected function periodBounds(string $period): array
    {
        [$year, $month] = explode('-', $period);
        $start = sprintf('%s-%s-01', $year, $month);
        $end   = date('Y-m-t', strtotime($start));

        return [$start, $end];
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();

        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /**
     * توليد رقم مسيّر تسلسلي: PR-2025-00001
     */
    protected function nextNumber(string $date): string
    {
        $year  = substr($date, 0, 4);
        $count = PayrollRun::whereYear('period_start', $year)->count() + 1;

        return sprintf('PR-%s-%05d', $year, $count);
    }
}

<?php

namespace App\Services\Reporting;

use App\Models\Account;
use App\Models\JournalLine;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ReportService — التقارير المالية
 * ═══════════════════════════════════════════════════════════════
 *  يُحسب من القيود المرحّلة مباشرةً (مصدر الحقيقة)، لا من اللقطات.
 *  كل المبالغ بالـ minor units (هللات) كأعداد صحيحة.
 *
 *  ميزان المراجعة (Trial Balance): لكل حساب صافي الحركة في عمود
 *  مدين أو دائن. مجموع المدين = مجموع الدائن دائماً (تحقّق التماسك).
 */
class ReportService
{
    /**
     * ميزان المراجعة ضمن المستأجر الحالي.
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     * @return array{rows: array<int, array>, total_debit: int, total_credit: int, balanced: bool}
     */
    public function trialBalance(array $filters = []): array
    {
        $from = $filters['from'] ?? null;
        $to   = $filters['to'] ?? null;

        // تجميع الحركة لكل حساب من السطور المرحّلة فقط
        $movements = JournalLine::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->whereHas('entry', function ($q) use ($from, $to) {
                $q->where('status', 'posted');
                if ($from) {
                    $q->whereDate('entry_date', '>=', $from);
                }
                if ($to) {
                    $q->whereDate('entry_date', '<=', $to);
                }
            })
            ->groupBy('account_id')
            ->get()
            ->keyBy('account_id');

        if ($movements->isEmpty()) {
            return ['rows' => [], 'total_debit' => 0, 'total_credit' => 0, 'balanced' => true];
        }

        $accounts = Account::whereIn('id', $movements->keys())
            ->get()
            ->keyBy('id');

        $rows = [];
        $totalDebit = $totalCredit = 0;

        foreach ($movements as $accountId => $m) {
            $net = (int) $m->total_debit - (int) $m->total_credit;

            // حساب متوازن الحركة (صافيه صفر) لا يظهر في الميزان
            if ($net === 0) {
                continue;
            }

            $debit  = $net > 0 ? $net : 0;
            $credit = $net < 0 ? -$net : 0;

            $account = $accounts->get($accountId);

            $rows[] = [
                'account_id' => $accountId,
                'code'       => $account?->code,
                'name'       => $account?->name,
                'type'       => $account?->type,
                'debit'      => $debit,
                'credit'     => $credit,
            ];

            $totalDebit  += $debit;
            $totalCredit += $credit;
        }

        // ترتيب حسب كود الحساب
        usort($rows, fn ($a, $b) => strcmp((string) $a['code'], (string) $b['code']));

        return [
            'rows'         => $rows,
            'total_debit'  => $totalDebit,
            'total_credit' => $totalCredit,
            'balanced'     => $totalDebit === $totalCredit,
        ];
    }
}

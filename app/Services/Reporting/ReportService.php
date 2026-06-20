<?php

namespace App\Services\Reporting;

use App\Models\Account;
use App\Models\JournalLine;
use Illuminate\Support\Collection;

/**
 * ═══════════════════════════════════════════════════════════════
 *  ReportService — التقارير المالية
 * ═══════════════════════════════════════════════════════════════
 *  يُحسب من القيود المرحّلة مباشرةً (مصدر الحقيقة)، لا من اللقطات.
 *  كل المبالغ بالـ minor units (هللات) كأعداد صحيحة.
 *
 *  • trialBalance   — ميزان المراجعة (Σ مدين = Σ دائن).
 *  • incomeStatement — قائمة الدخل (إيرادات − مصروفات = صافي الدخل).
 *  • balanceSheet   — الميزانية العمومية (أصول = خصوم + حقوق ملكية + صافي الدخل).
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
        $rows = [];
        $totalDebit = $totalCredit = 0;

        foreach ($this->movementsByAccount($filters) as $m) {
            $net = $m['net'];
            if ($net === 0) {
                continue; // حساب متوازن الحركة لا يظهر
            }

            $debit  = $net > 0 ? $net : 0;
            $credit = $net < 0 ? -$net : 0;

            $rows[] = [
                'account_id' => $m['account']->id,
                'code'       => $m['account']->code,
                'name'       => $m['account']->name,
                'type'       => $m['account']->type,
                'debit'      => $debit,
                'credit'     => $credit,
            ];

            $totalDebit  += $debit;
            $totalCredit += $credit;
        }

        usort($rows, fn ($a, $b) => strcmp((string) $a['code'], (string) $b['code']));

        return [
            'rows'         => $rows,
            'total_debit'  => $totalDebit,
            'total_credit' => $totalCredit,
            'balanced'     => $totalDebit === $totalCredit,
        ];
    }

    /**
     * قائمة الدخل: الإيرادات والمصروفات خلال فترة، وصافي الدخل.
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     * @return array{revenues: array, expenses: array, total_revenue: int, total_expense: int, net_income: int}
     */
    public function incomeStatement(array $filters = []): array
    {
        $movements = $this->movementsByAccount($filters);

        // الإيرادات طبيعتها دائنة: المبلغ = دائن − مدين (−net)
        $revenues = $this->rowsForType($movements, 'revenue', fn ($net) => -$net);
        // المصروفات طبيعتها مدينة: المبلغ = مدين − دائن (net)
        $expenses = $this->rowsForType($movements, 'expense', fn ($net) => $net);

        $totalRevenue = array_sum(array_column($revenues, 'amount'));
        $totalExpense = array_sum(array_column($expenses, 'amount'));

        return [
            'revenues'      => $revenues,
            'expenses'      => $expenses,
            'total_revenue' => $totalRevenue,
            'total_expense' => $totalExpense,
            'net_income'    => $totalRevenue - $totalExpense,
        ];
    }

    /**
     * الميزانية العمومية حتى تاريخ: أصول = خصوم + حقوق ملكية + صافي الدخل.
     * (صافي الدخل غير المُقفل يُضاف لحقوق الملكية ليتوازن الميزان.)
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     */
    public function balanceSheet(array $filters = []): array
    {
        $movements = $this->movementsByAccount($filters);

        // الأصول طبيعتها مدينة (net)؛ الخصوم وحقوق الملكية دائنة (−net)
        $assets      = $this->rowsForType($movements, 'asset', fn ($net) => $net);
        $liabilities = $this->rowsForType($movements, 'liability', fn ($net) => -$net);
        $equity      = $this->rowsForType($movements, 'equity', fn ($net) => -$net);

        $totalAssets      = array_sum(array_column($assets, 'amount'));
        $totalLiabilities = array_sum(array_column($liabilities, 'amount'));
        $totalEquity      = array_sum(array_column($equity, 'amount'));

        $netIncome        = $this->incomeStatement($filters)['net_income'];
        $equityWithIncome = $totalEquity + $netIncome;

        return [
            'assets'              => $assets,
            'liabilities'         => $liabilities,
            'equity'              => $equity,
            'total_assets'        => $totalAssets,
            'total_liabilities'   => $totalLiabilities,
            'total_equity'        => $totalEquity,
            'net_income'          => $netIncome,
            'total_equity_and_income' => $equityWithIncome,
            'balanced'            => $totalAssets === ($totalLiabilities + $equityWithIncome),
        ];
    }

    /**
     * تجميع صافي حركة كل حساب من السطور المرحّلة ضمن المستأجر الحالي.
     *
     * @return Collection<int, array{account: Account, debit: int, credit: int, net: int}>
     */
    protected function movementsByAccount(array $filters): Collection
    {
        $from = $filters['from'] ?? null;
        $to   = $filters['to'] ?? null;

        $sums = JournalLine::query()
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
            ->get();

        if ($sums->isEmpty()) {
            return collect();
        }

        $accounts = Account::whereIn('id', $sums->pluck('account_id'))->get()->keyBy('id');

        return $sums->map(function ($s) use ($accounts) {
            $debit  = (int) $s->total_debit;
            $credit = (int) $s->total_credit;

            return [
                'account' => $accounts->get($s->account_id),
                'debit'   => $debit,
                'credit'  => $credit,
                'net'     => $debit - $credit,
            ];
        })->filter(fn ($m) => $m['account'] !== null);
    }

    /**
     * بناء صفوف تقرير لنوع حساب معيّن، مع دالة تحويل الصافي إلى مبلغ موجب.
     */
    protected function rowsForType(Collection $movements, string $type, callable $amountFn): array
    {
        $rows = $movements
            ->filter(fn ($m) => $m['account']->type === $type)
            ->map(fn ($m) => [
                'account_id' => $m['account']->id,
                'code'       => $m['account']->code,
                'name'       => $m['account']->name,
                'amount'     => (int) $amountFn($m['net']),
            ])
            ->filter(fn ($r) => $r['amount'] !== 0)
            ->values()
            ->all();

        usort($rows, fn ($a, $b) => strcmp((string) $a['code'], (string) $b['code']));

        return $rows;
    }
}

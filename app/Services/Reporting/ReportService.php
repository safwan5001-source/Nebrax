<?php

namespace App\Services\Reporting;

use App\Models\Account;
use App\Models\CostCenter;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Purchase;
use App\Tenancy\BranchScope;
use Illuminate\Support\Carbon;
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
     * الربحية بمركز التكلفة: لكل مركز، صافي الإيراد − صافي المصروف = الربح.
     * يُحسب من سطور القيود الموسومة بمركز التكلفة (حسابات الإيراد والمصروف فقط).
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     * @return array{rows: array<int, array>, total_revenue: int, total_expense: int, total_profit: int}
     */
    public function costCenterProfitability(array $filters = []): array
    {
        $from = $filters['from'] ?? null;
        $to   = $filters['to'] ?? null;

        $sums = JournalLine::query()
            ->selectRaw('cost_center_id, account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->whereNotNull('cost_center_id')
            ->when($this->branchIds($filters), fn ($q, $ids) => $q->whereIn('journal_lines.branch_id', $ids))
            ->whereHas('entry', function ($q) use ($from, $to) {
                $q->whereIn('status', ['posted', 'reversed']); // المعكوس يبقى في الدفاتر (الأصل + العاكس = صفر)
                if ($from) {
                    $q->whereDate('entry_date', '>=', $from);
                }
                if ($to) {
                    $q->whereDate('entry_date', '<=', $to);
                }
            })
            ->groupBy('cost_center_id', 'account_id')
            ->get();

        $accounts = Account::whereIn('id', $sums->pluck('account_id')->unique())->get()->keyBy('id');

        // تجميع لكل مركز: الإيراد (دائن − مدين على حسابات الإيراد)، المصروف (مدين − دائن على المصروف).
        $agg = [];
        foreach ($sums as $s) {
            $account = $accounts->get($s->account_id);
            if ($account === null) {
                continue;
            }
            $debit  = (int) $s->total_debit;
            $credit = (int) $s->total_credit;
            $ccId   = $s->cost_center_id;
            $agg[$ccId] ??= ['revenue' => 0, 'expense' => 0];

            if ($account->type === 'revenue') {
                $agg[$ccId]['revenue'] += $credit - $debit;
            } elseif ($account->type === 'expense') {
                $agg[$ccId]['expense'] += $debit - $credit;
            }
        }

        $rows = [];
        $totalRevenue = $totalExpense = 0;

        // خارج عزل الفرع: التقرير يجمّع قيوداً مرحَّلة، فمركزٌ له قيود لا يجوز
        // أن يختفي صفّه لأن مفتاح المشاركة مطفأ — لغابت أرقامه بلا أثر.
        foreach (BranchScope::reference(CostCenter::class)->orderBy('code')->get() as $cc) {
            $revenue = $agg[$cc->id]['revenue'] ?? 0;
            $expense = $agg[$cc->id]['expense'] ?? 0;

            $rows[] = [
                'cost_center_id' => $cc->id,
                'code'           => $cc->code,
                'name'           => $cc->name,
                'revenue'        => $revenue,
                'expense'        => $expense,
                'profit'         => $revenue - $expense,
            ];

            $totalRevenue += $revenue;
            $totalExpense += $expense;
        }

        return [
            'rows'          => $rows,
            'total_revenue' => $totalRevenue,
            'total_expense' => $totalExpense,
            'total_profit'  => $totalRevenue - $totalExpense,
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
        // الميزانية أرصدة تراكمية «حتى تاريخ» — فلتر from يبتر رأس المال والأرصدة
        // الافتتاحية فيُخِلّ بالمعادلة. يُتجاهَل هنا (يبقى سارياً في قائمة الدخل المستقلة).
        unset($filters['from']);

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
        $from   = $filters['from'] ?? null;
        $to     = $filters['to'] ?? null;
        $branch = $this->branchIds($filters);

        $sums = JournalLine::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            // بُعد الفرع: تصفية صريحة واختيارية — بلا مرشّح تبقى الأرقام مجمّعة لكل الفروع.
            ->when($branch, fn ($q) => $q->whereIn('journal_lines.branch_id', $branch))
            ->whereHas('entry', function ($q) use ($from, $to) {
                $q->whereIn('status', ['posted', 'reversed']); // المعكوس يبقى في الدفاتر (الأصل + العاكس = صفر)
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

    /**
     * كشف حساب (دفتر الأستاذ) لحساب معيّن: الحركات برصيد جارٍ حسب طبيعة الحساب.
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     */
    public function accountLedger(string $accountId, array $filters = []): array
    {
        $account = Account::findOrFail($accountId);
        $from = $filters['from'] ?? null;
        $to   = $filters['to'] ?? null;

        $lines = $this->postedLines(fn ($q) => $q->where('journal_lines.account_id', $accountId), $this->branchIds($filters));

        $signed = fn (int $d, int $c) => $account->normal_balance === 'debit' ? $d - $c : $c - $d;

        $opening = 0;
        $rows = [];
        foreach ($lines as $line) {
            $date = $line->entry->entry_date->toDateString();
            if ($from && $date < $from) {
                $opening += $signed((int) $line->debit, (int) $line->credit);
                continue;
            }
            if ($to && $date > $to) {
                continue;
            }
            $rows[] = $line;
        }

        $running = $opening;
        $mapped = [];
        foreach ($rows as $line) {
            $running += $signed((int) $line->debit, (int) $line->credit);
            $mapped[] = [
                'date'        => $line->entry->entry_date->toDateString(),
                'number'      => $line->entry->number,
                'description' => $line->entry->description,
                'debit'       => (int) $line->debit,
                'credit'      => (int) $line->credit,
                'balance'     => $running,
            ];
        }

        return [
            'account'         => ['id' => $account->id, 'code' => $account->code, 'name' => $account->name, 'type' => $account->type],
            'opening_balance' => $opening,
            'rows'            => $mapped,
            'closing_balance' => $running,
        ];
    }

    /**
     * كشف حساب طرف (عميل/مورد): حركاته برصيد جارٍ (موجب = الطرف مدين لنا).
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?]
     */
    public function partnerStatement(string $partnerId, array $filters = []): array
    {
        // كشف حساب طرفٍ له قيود يجب أن يُفتح من أي فرع — القيود نفسها تُصفّى بالمرشّح.
        $partner = BranchScope::reference(Partner::class)->findOrFail($partnerId);
        $from = $filters['from'] ?? null;
        $to   = $filters['to'] ?? null;

        $lines = $this->postedLines(fn ($q) => $q
            ->where('journal_lines.partner_type', Partner::class)
            ->where('journal_lines.partner_id', $partnerId), $this->branchIds($filters));

        $opening = 0;
        $rows = [];
        foreach ($lines as $line) {
            $date = $line->entry->entry_date->toDateString();
            if ($from && $date < $from) {
                $opening += (int) $line->debit - (int) $line->credit;
                continue;
            }
            if ($to && $date > $to) {
                continue;
            }
            $rows[] = $line;
        }

        $running = $opening;
        $mapped = [];
        foreach ($rows as $line) {
            $running += (int) $line->debit - (int) $line->credit;
            $mapped[] = [
                'date'        => $line->entry->entry_date->toDateString(),
                'number'      => $line->entry->number,
                'description' => $line->entry->description,
                'debit'       => (int) $line->debit,
                'credit'      => (int) $line->credit,
                'balance'     => $running,
            ];
        }

        return [
            'partner'         => ['id' => $partner->id, 'name' => $partner->name, 'type' => $partner->type],
            'opening_balance' => $opening,
            'rows'            => $mapped,
            'closing_balance' => $running,
        ];
    }

    /**
     * أعمار الديون: المتبقي على المستندات غير المسدّدة موزّعاً على فترات عمرية لكل طرف.
     *
     * @param  string  $type  'receivable' (من الفواتير) | 'payable' (من المشتريات)
     * @param  array   $filters  ['as_of'=>'Y-m-d'?]
     */
    public function aging(string $type, array $filters = []): array
    {
        $asOf = Carbon::parse($filters['as_of'] ?? now()->toDateString());

        $branchIds = $this->branchIds($filters);
        $documents = ($type === 'payable'
            ? Purchase::where('status', 'posted')->where('payment_status', '!=', 'paid')
            : Invoice::where('status', 'posted')->where('payment_status', '!=', 'paid'))
            ->when($branchIds, fn ($q, $ids) => $q->whereIn('branch_id', $ids))
            ->get();

        $dateField = $type === 'payable' ? 'purchase_date' : 'invoice_date';

        // أسماء أطراف مستندات قائمة — مرجع لا تصفّح، وإلا ظهرت أعمار ديون بلا أسماء.
        $partners = BranchScope::reference(Partner::class)
            ->whereIn('id', $documents->pluck('partner_id')->unique())->get()->keyBy('id');

        $byPartner = [];
        $totals = ['b0_30' => 0, 'b31_60' => 0, 'b61_90' => 0, 'b90_plus' => 0, 'total' => 0];

        foreach ($documents as $doc) {
            $remaining = $doc->total - $doc->paid_amount;
            if ($remaining <= 0) {
                continue;
            }

            $ref = $doc->due_date ?? $doc->{$dateField};
            $days = Carbon::parse($ref)->diffInDays($asOf, false); // موجب = متأخّر

            $bucket = match (true) {
                $days <= 30 => 'b0_30',
                $days <= 60 => 'b31_60',
                $days <= 90 => 'b61_90',
                default     => 'b90_plus',
            };

            $pid = $doc->partner_id;
            $byPartner[$pid] ??= [
                'partner_id' => $pid,
                'name'       => $partners->get($pid)?->name,
                'b0_30' => 0, 'b31_60' => 0, 'b61_90' => 0, 'b90_plus' => 0, 'total' => 0,
            ];

            $byPartner[$pid][$bucket] += $remaining;
            $byPartner[$pid]['total'] += $remaining;
            $totals[$bucket] += $remaining;
            $totals['total'] += $remaining;
        }

        $rows = array_values($byPartner);
        usort($rows, fn ($a, $b) => strcmp((string) $a['name'], (string) $b['name']));

        return ['type' => $type, 'as_of' => $asOf->toDateString(), 'rows' => $rows, 'totals' => $totals];
    }

    /**
     * سطور القيد المرحّلة (مرتّبة بتاريخ القيد) مع تطبيق شرط إضافي — مُعزَلة بالمستأجر.
     *
     * @return Collection<int, JournalLine>
     */
    /**
     * يطبّع مرشّح الفرع: قيمة مفردة أو مصفوفة أو غياب.
     * `null` = كل الفروع (مجمّع) — السلوك الافتراضي.
     *
     * @return array<int,string>|null
     */
    protected function branchIds(array $filters): ?array
    {
        $raw = $filters['branch_id'] ?? null;
        if ($raw === null || $raw === '' || $raw === []) {
            return null;
        }
        $ids = array_values(array_filter(is_array($raw) ? $raw : [$raw]));

        return $ids === [] ? null : $ids;
    }

    protected function postedLines(callable $where, ?array $branchIds = null): Collection
    {
        $query = JournalLine::query()
            ->select('journal_lines.*')
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->when($branchIds, fn ($q) => $q->whereIn('journal_lines.branch_id', $branchIds))
            ->whereIn('e.status', ['posted', 'reversed']) // المعكوس يبقى في الدفاتر (الأصل + العاكس = صفر)
            ->orderBy('e.entry_date')
            ->orderBy('e.created_at')
            ->with('entry');

        $where($query);

        return $query->get();
    }
}

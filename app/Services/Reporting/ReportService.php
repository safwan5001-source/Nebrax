<?php

namespace App\Services\Reporting;

use App\Models\Account;
use App\Models\Asset;
use App\Models\CostCenter;
use App\Models\CreditNote;
use App\Models\Invoice;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Purchase;
use App\Models\ReturnDocument;
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

        $result = [
            'revenues'      => $revenues,
            'expenses'      => $expenses,
            'total_revenue' => $totalRevenue,
            'total_expense' => $totalExpense,
            'net_income'    => $totalRevenue - $totalExpense,
        ];

        // عند التصفية بفرع: كشف صريح لما هو **غير موزَّع** على أي فرع (الرواتب
        // المركزية والقيود السابقة للفروع). بدونه تبدو قائمة دخل الفرع ناقصةً
        // بلا تفسير — والمستخدم لا يعرف أين ذهبت المصروفات.
        // في العرض المجمّع لا يُحسب: غير الموزَّع داخل الإجماليات أصلاً.
        if ($this->branchIds($filters) !== null) {
            $un        = $this->movementsByAccount($filters, true);
            $unRevenue = array_sum(array_column($this->rowsForType($un, 'revenue', fn ($net) => -$net), 'amount'));
            $unExpense = array_sum(array_column($this->rowsForType($un, 'expense', fn ($net) => $net), 'amount'));

            $result['unallocated'] = [
                'total_revenue' => $unRevenue,
                'total_expense' => $unExpense,
                'net_income'    => $unRevenue - $unExpense,
            ];
        }

        return $result;
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
    /**
     * @param  bool  $unallocatedOnly  يقصر النتيجة على السطور **بلا فرع** — المصروفات
     *                                 المركزية (كالرواتب) والقيود السابقة للفروع.
     */
    protected function movementsByAccount(array $filters, bool $unallocatedOnly = false): Collection
    {
        $from   = $filters['from'] ?? null;
        $to     = $filters['to'] ?? null;
        $branch = $this->branchIds($filters);

        $sums = JournalLine::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            // بُعد الفرع: تصفية صريحة واختيارية — بلا مرشّح تبقى الأرقام مجمّعة لكل الفروع.
            ->when(
                $unallocatedOnly,
                fn ($q) => $q->whereNull('journal_lines.branch_id'),
                fn ($q) => $q->when($branch, fn ($inner) => $inner->whereIn('journal_lines.branch_id', $branch)),
            )
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
     * القيود اليومية المرحّلة: كل قيد يُعرض مع سطوره المتوازنة ومصدره المحاسبي.
     * لا تُستبدل القيود المعكوسة ولا تُخفى: الأصل والعاكس معاً مصدر الحقيقة.
     *
     * @param  array  $filters  ['from'=>'Y-m-d'?, 'to'=>'Y-m-d'?, 'branch_id'=>array?, 'account_id'=>uuid?]
     */
    public function journalEntries(array $filters = []): array
    {
        // نحمّل سطور القيد كاملةً أولاً. مرشح الحساب يختار القيد الذي يظهر، لكنه
        // لا يبتّر سطوره الأخرى؛ وإلا بدا القيد غير متوازن في التقرير.
        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;
        $allLines = $this->postedLines(fn ($query) => $query, $this->branchIds($filters))
            ->filter(function (JournalLine $line) use ($from, $to) {
                $date = $line->entry->entry_date->toDateString();
                return (! $from || $date >= $from) && (! $to || $date <= $to);
            })
            ->values();
        $entries = $allLines->groupBy('journal_entry_id');

        if (! empty($filters['account_id'])) {
            $entries = $entries->filter(fn (Collection $lines) => $lines->contains('account_id', $filters['account_id']));
        }
        if ($entries->isEmpty()) {
            return ['rows' => [], 'total_debit' => 0, 'total_credit' => 0];
        }

        $accountIds = $entries->flatten(1)->pluck('account_id')->unique();
        $accounts = Account::whereIn('id', $accountIds)->get()->keyBy('id');
        $rows = [];
        $totalDebit = $totalCredit = 0;

        foreach ($entries as $lines) {
            $entry = $lines->first()->entry;
            $debit = $credit = 0;
            $mappedLines = [];
            foreach ($lines as $line) {
                $lineDebit = (int) $line->debit;
                $lineCredit = (int) $line->credit;
                $debit += $lineDebit;
                $credit += $lineCredit;
                $account = $accounts->get($line->account_id);
                $mappedLines[] = [
                    'account_id'   => $line->account_id,
                    'account_code' => $account?->code,
                    'account_name' => $account?->name,
                    'description'  => $line->description,
                    'debit'        => $lineDebit,
                    'credit'       => $lineCredit,
                ];
            }

            $rows[] = [
                'entry_id'     => $entry->id,
                'date'         => $entry->entry_date->toDateString(),
                'number'       => $entry->number,
                'description'  => $entry->description,
                'source_type'  => $entry->source_type,
                'source_id'    => $entry->source_id,
                'debit'        => $debit,
                'credit'       => $credit,
                'lines'        => $mappedLines,
            ];
            $totalDebit += $debit;
            $totalCredit += $credit;
        }

        return ['rows' => $rows, 'total_debit' => $totalDebit, 'total_credit' => $totalCredit];
    }

    /**
     * تقرير الضريبة من الحسابين النظاميين فقط: 1150 ضريبة المدخلات و2120 ضريبة
     * المخرجات. صافي موجب = مستحق للهيئة، وسالب = رصيد قابل للاسترداد/الترحيل.
     */
    public function taxReport(array $filters = []): array
    {
        $movements = $this->movementsByAccount($filters)->keyBy(fn ($m) => $m['account']->code);
        $input = (int) ($movements->get('1150')['net'] ?? 0);       // مدين − دائن
        $output = -(int) ($movements->get('2120')['net'] ?? 0);    // دائن − مدين

        return [
            'input_vat'  => $input,
            'output_vat' => $output,
            'net_vat'    => $output - $input,
            'status'     => $output - $input >= 0 ? 'payable' : 'recoverable',
        ];
    }

    /**
     * تدفقات نقدية بالطريقة المباشرة: يُجمع أثر النقد والبنك الفعلي لكل قيد
     * مرحّل، فتُلغى التحويلات الداخلية بين الصندوق والبنك تلقائياً لأن صافيها صفر.
     * التصنيف شفاف ومحدود: أصل ثابت = استثماري، مقابل حقوق ملكية = تمويلي، وما
     * عداه تشغيلي. لا تُشتق حركة نقدية من تغيّر الذمم أو اللقطات.
     */
    public function cashFlow(array $filters = []): array
    {
        $cashAccounts = Account::whereIn('code', ['1110', '1120'])->pluck('id');
        if ($cashAccounts->isEmpty()) {
            return $this->emptyCashFlow();
        }

        $cashLines = $this->postedLines(
            fn ($query) => $query->whereIn('journal_lines.account_id', $cashAccounts),
            $this->branchIds($filters),
        );
        // نحمل السطور المقابلة دفعة واحدة: التصنيف لا يقرأ وصفاً حراً ولا ينفذ N+1.
        $cashLines->load('entry.lines');
        $equityAccountIds = Account::where('type', 'equity')->pluck('id')->all();

        $from = $filters['from'] ?? null;
        $to = $filters['to'] ?? null;
        $cashLines = $cashLines->filter(function (JournalLine $line) use ($from, $to) {
            $date = $line->entry->entry_date->toDateString();
            return (! $from || $date >= $from) && (! $to || $date <= $to);
        })->groupBy('journal_entry_id');

        $results = [
            'operating'  => ['inflows' => 0, 'outflows' => 0, 'net' => 0, 'entries' => []],
            'investing'  => ['inflows' => 0, 'outflows' => 0, 'net' => 0, 'entries' => []],
            'financing'  => ['inflows' => 0, 'outflows' => 0, 'net' => 0, 'entries' => []],
        ];

        foreach ($cashLines as $lines) {
            $entry = $lines->first()->entry;
            $net = $lines->sum(fn (JournalLine $line) => (int) $line->debit - (int) $line->credit);
            if ($net === 0) {
                continue; // تحويل داخلي بين نقد وبنك، لا تدفق للمنشأة.
            }

            $category = $this->cashFlowCategory($entry, $cashAccounts->all(), $equityAccountIds);
            $inflow = $net > 0 ? $net : 0;
            $outflow = $net < 0 ? -$net : 0;
            $results[$category]['inflows'] += $inflow;
            $results[$category]['outflows'] += $outflow;
            $results[$category]['net'] += $net;
            $results[$category]['entries'][] = [
                'date'        => $entry->entry_date->toDateString(),
                'number'      => $entry->number,
                'description' => $entry->description,
                'inflow'      => $inflow,
                'outflow'     => $outflow,
                'net'         => $net,
            ];
        }

        $netCashFlow = array_sum(array_column($results, 'net'));
        return [
            ...$results,
            'net_cash_flow' => $netCashFlow,
        ];
    }

    /** @return array{operating:array, investing:array, financing:array, net_cash_flow:int} */
    protected function emptyCashFlow(): array
    {
        $empty = ['inflows' => 0, 'outflows' => 0, 'net' => 0, 'entries' => []];
        return ['operating' => $empty, 'investing' => $empty, 'financing' => $empty, 'net_cash_flow' => 0];
    }

    /**
     * التصنيف لا يعتمد على نصّ الوصف: الأصل الثابت مصدر استثماري صريح، وتمويل
     * رأس المال يُعرَف من الطرف المقابل في حقوق الملكية. الباقي نشاط يومي.
     */
    protected function cashFlowCategory($entry, array $cashAccountIds, array $equityAccountIds): string
    {
        if ($entry->source_type === Asset::class) {
            return 'investing';
        }

        $counterpartIds = $entry->lines
            ->whereNotIn('account_id', $cashAccountIds)
            ->pluck('account_id');
        $hasEquity = $counterpartIds->intersect($equityAccountIds)->isNotEmpty();

        return $hasEquity ? 'financing' : 'operating';
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

        $role = $filters['partner_role'] ?? null;
        if (in_array($role, ['customer', 'supplier'], true)) {
            $sourceRoles = $this->partnerStatementSourceRoles($lines);
            $lines = $lines->filter(function (JournalLine $line) use ($sourceRoles, $role) {
                $key = ($line->entry->source_type ?? '') . '#' . ($line->entry->source_id ?? '');
                // الرصيد الافتتاحي للطرف يُفصل بطبيعة السطر: مدين للعميل، دائن للمورد.
                if ($line->entry->source_type === Partner::class) {
                    return $role === 'supplier' ? $line->credit > $line->debit : $line->debit >= $line->credit;
                }
                return ($sourceRoles[$key] ?? null) === $role;
            })->values();
        }

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

        // التخصيصات هي مصدر الحقيقة لعلاقة سند القبض/الصرف بالمستندات التي سُدّدت.
        // نحمّلها دفعة واحدة لتبقى شاشة حركة الحساب بلا N+1 عند كثرة الحركات.
        $paymentIds = collect($rows)
            ->filter(fn (JournalLine $line) => $line->entry->source_type === Payment::class)
            ->map(fn (JournalLine $line) => $line->entry->source_id)
            ->filter()
            ->unique()
            ->values();
        $payments = $paymentIds->isEmpty()
            ? collect()
            : Payment::with('allocations.allocatable')->whereIn('id', $paymentIds)->get()->keyBy('id');

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
                'source'      => $this->partnerStatementSource($line, $payments),
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
     * يعين كل مستند محاسبي إلى دور طرف واحد. لا تُستخدم الخريطة إلا عندما تطلب
     * الشاشة كشف المورد أو العميل صراحةً لطرف ذي صفتين؛ التقرير العام لا يتغيّر.
     *
     * @return array<string, 'customer'|'supplier'>
     */
    protected function partnerStatementSourceRoles(Collection $lines): array
    {
        $idsFor = fn (string $type) => $lines
            ->filter(fn (JournalLine $line) => $line->entry->source_type === $type)
            ->map(fn (JournalLine $line) => $line->entry->source_id)
            ->filter()
            ->unique()
            ->values();

        $roles = [];
        foreach ($idsFor(Invoice::class) as $id) {
            $roles[Invoice::class . '#' . $id] = 'customer';
        }
        foreach ($idsFor(Purchase::class) as $id) {
            $roles[Purchase::class . '#' . $id] = 'supplier';
        }
        foreach (Payment::whereIn('id', $idsFor(Payment::class))->get(['id', 'direction']) as $payment) {
            $roles[Payment::class . '#' . $payment->id] = $payment->direction === 'paid' ? 'supplier' : 'customer';
        }
        foreach (CreditNote::whereIn('id', $idsFor(CreditNote::class))->get(['id', 'type']) as $note) {
            $roles[CreditNote::class . '#' . $note->id] = $note->type === 'purchase' ? 'supplier' : 'customer';
        }
        foreach (ReturnDocument::whereIn('id', $idsFor(ReturnDocument::class))->get(['id', 'type']) as $return) {
            $roles[ReturnDocument::class . '#' . $return->id] = $return->type === 'purchase' ? 'supplier' : 'customer';
        }

        return $roles;
    }

    /**
     * يطبع مصدر السطر إلى نوع واجهة ثابت، ويعرض تسويات سندات الدفع بلا افتراضات
     * عن وجود فاتورة واحدة فقط لكل سند.
     */
    protected function partnerStatementSource(JournalLine $line, Collection $payments): ?array
    {
        $entry = $line->entry;
        if (!$entry->source_type || !$entry->source_id) {
            return null;
        }

        $kind = match ($entry->source_type) {
            Invoice::class => 'invoice',
            Payment::class => 'payment',
            Purchase::class => 'purchase',
            Partner::class => 'opening',
            \App\Models\CreditNote::class => 'credit_note',
            \App\Models\ReturnDocument::class => 'return',
            default => 'journal',
        };

        $allocations = [];
        if ($kind === 'payment' && ($payment = $payments->get($entry->source_id))) {
            $allocations = $payment->allocations->map(fn ($allocation) => [
                'kind'   => match ($allocation->allocatable_type) {
                    Invoice::class => 'invoice',
                    Purchase::class => 'purchase',
                    default => 'document',
                },
                'id'     => (string) $allocation->allocatable_id,
                'number' => $allocation->allocatable?->number,
                'amount' => (int) $allocation->amount,
            ])->values()->all();
        }

        return [
            'kind'        => $kind,
            'id'          => (string) $entry->source_id,
            'label'       => $entry->description,
            'allocations' => $allocations,
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
     * نطاق الفروع الفعلي للتقرير أو لأي قراءة محاسبية مجمعة. يبقى تقرير
     * ReportService مصدر الحقيقة لقاعدة تقاطع طلب المستخدم مع صلاحياته.
     *
     * @return array<int,string>|null
     */
    public function resolvedBranchIds(array $filters): ?array
    {
        return $this->branchIds($filters);
    }

    protected function branchIds(array $filters): ?array
    {
        $raw = $filters['branch_id'] ?? null;
        $ids = $raw === null || $raw === '' || $raw === []
            ? []
            : array_values(array_filter(is_array($raw) ? $raw : [$raw]));

        // ═══════════════════════════════════════════════════════════
        //  نطاق المستخدم يحدّ المطلوب — لا العكس
        // ═══════════════════════════════════════════════════════════
        //  التقرير المجمّع يكشف أرقام كل الفروع، فمستخدمٌ مقيَّد بفرعٍ لا يجوز
        //  أن يراها بمجرّد إغفال المرشّح. فإن كان مقيَّداً: يُقاطَع المطلوب مع
        //  فروعه، وإن لم يطلب شيئاً فُرِضت فروعه كلها.
        //
        //  والمقاطعة تُفرَّغ عمداً حين يطلب فرعاً ليس له: تُعاد فروعه هو، فلا
        //  يتسرّب رقمٌ من خارج نطاقه ولا يُعاد تقريرٌ فارغٌ يُوهم بأن لا بيانات.
        $allowed = auth()->user()?->allowedBranchIds();

        if ($allowed !== null) {
            $ids = $ids === [] ? $allowed : array_values(array_intersect($ids, $allowed));

            return $ids === [] ? $allowed : $ids;
        }

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

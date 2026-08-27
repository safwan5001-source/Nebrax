<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\JournalLine;
use App\Services\Reporting\ReportService;
use Illuminate\Support\Collection;

/**
 * يجهز بيانات دليل الحسابات لواجهة العمل دون المساس بعقد GET /accounts القائم.
 *
 * البنية نفسها CompanyWide، أما الرصيد المعروض فيقرأ من journal_lines المرحّلة
 * وفق نطاق الفروع نفسه المستعمل في التقارير. لا تُجمع الأرصدة في الواجهة ولا
 * تُستخدم لقطة AccountBalance عندما يكون المستخدم قد اختار فرعاً محدداً.
 */
class AccountWorkspaceService
{
    public function __construct(
        private readonly ReportService $reports,
    ) {}

    /**
     * @return Collection<int, Account>
     */
    public function accounts(?string $branchId = null): Collection
    {
        $accounts = Account::query()
            ->orderBy('code')
            ->get();

        if ($accounts->isEmpty()) {
            return $accounts;
        }

        // يحصر ReportService النطاق بفروع المستخدم الفعلية. null يعني العرض
        // المجمع لكل الفروع المتاحة له، لا تجاوز قيود الوصول عبر الواجهة.
        $branchIds = $this->reports->resolvedBranchIds(['branch_id' => $branchId]);
        $byId = $accounts->keyBy('id');
        $directBalances = $this->directBalances($branchIds, $byId);
        $childrenByParent = $accounts->groupBy(fn (Account $account) => $account->parent_id ?? '__root__');
        $aggregateBalances = [];
        $states = [];

        foreach ($accounts as $account) {
            $this->aggregateBalance($account->id, $childrenByParent, $directBalances, $aggregateBalances, $states);
        }

        foreach ($accounts as $account) {
            $direct = $directBalances[$account->id] ?? 0;
            $aggregate = $aggregateBalances[$account->id] ?? $direct;

            // المجموعة تعرض مجموع ذريتها، بينما الحساب الحركي يعرض رصيده المباشر.
            $account->setAttribute('workspace_direct_balance', $direct);
            $account->setAttribute('workspace_aggregated_balance', $aggregate);
            $account->setAttribute('workspace_balance', $account->is_group ? $aggregate : $direct);
            $account->setAttribute('workspace_children_count', $childrenByParent->get($account->id, collect())->count());
            $account->setAttribute('workspace_has_entries', array_key_exists($account->id, $directBalances));
            $account->setAttribute('workspace_path', $this->pathFor($account, $byId));
        }

        return $accounts;
    }

    /**
     * @param array<int, string>|null $branchIds
     * @param Collection<string, Account> $accounts
     * @return array<string, int>
     */
    private function directBalances(?array $branchIds, Collection $accounts): array
    {
        return JournalLine::query()
            ->selectRaw('account_id, SUM(debit) as total_debit, SUM(credit) as total_credit')
            ->when($branchIds, fn ($query) => $query->whereIn('journal_lines.branch_id', $branchIds))
            ->whereHas('entry', fn ($query) => $query->whereIn('status', ['posted', 'reversed']))
            ->groupBy('account_id')
            ->get()
            ->mapWithKeys(function (JournalLine $line) use ($accounts): array {
                $debit = (int) $line->total_debit;
                $credit = (int) $line->total_credit;
                $account = $accounts->get($line->account_id);
                $balance = $account?->normal_balance === 'credit'
                    ? $credit - $debit
                    : $debit - $credit;

                return [$line->account_id => $balance];
            })
            ->all();
    }

    /**
     * @param Collection<string, Collection<int, Account>> $childrenByParent
     * @param array<string, int> $directBalances
     * @param array<string, int> $aggregateBalances
     * @param array<string, 'visiting'|'done'> $states
     */
    private function aggregateBalance(
        string $accountId,
        Collection $childrenByParent,
        array $directBalances,
        array &$aggregateBalances,
        array &$states,
    ): int {
        if (($states[$accountId] ?? null) === 'done') {
            return $aggregateBalances[$accountId];
        }

        // لا ينبغي أن تصل دورة بسبب حارس AccountManagementService. يبقى هذا
        // الحارس دفاعاً عن بيانات قديمة تالفة: لا ينهار الاستعلام ولا يكرر الرصيد.
        if (($states[$accountId] ?? null) === 'visiting') {
            return 0;
        }

        $states[$accountId] = 'visiting';
        $balance = $directBalances[$accountId] ?? 0;

        foreach ($childrenByParent->get($accountId, collect()) as $child) {
            $balance += $this->aggregateBalance($child->id, $childrenByParent, $directBalances, $aggregateBalances, $states);
        }

        $aggregateBalances[$accountId] = $balance;
        $states[$accountId] = 'done';

        return $balance;
    }

    /**
     * @param Collection<string, Account> $byId
     * @return array<int, array{id:string, code:string, name:string}>
     */
    private function pathFor(Account $account, Collection $byId): array
    {
        $path = [];
        $current = $account;
        $seen = [];

        while ($current !== null && ! isset($seen[$current->id])) {
            $seen[$current->id] = true;
            array_unshift($path, [
                'id' => $current->id,
                'code' => $current->code,
                'name' => $current->name,
            ]);
            $current = $current->parent_id ? $byId->get($current->parent_id) : null;
        }

        return $path;
    }
}

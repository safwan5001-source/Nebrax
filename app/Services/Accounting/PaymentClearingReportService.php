<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\Branch;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\PaymentGateway;
use App\Models\PaymentGatewaySettlement;
use App\Models\PaymentGatewaySettlementLine;
use App\Models\PaymentRefund;
use App\Services\Reporting\ReportService;
use App\Support\AccountingRoles;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PaymentClearingReportService — مطابقة حساب المقاصة وفروقات التسويات وأعمار الأرصدة (PAY-H3-03، الحد الأساسي)
 * ═══════════════════════════════════════════════════════════════
 *  قراءة فقط: لا قيد ولا حفظ ولا قفل. أرقام بالهللات (bigint) بلا أي float.
 *
 *  ═══ المطابقة ═══
 *  رصيد دور `gateway_clearing` في الأستاذ (التعيين الحالي ∪ الحساب النظامي 1170 ∪ سجلّ التعيينات، قيود posted+reversed، كل الفروع)
 *  يُقارَن بما تقوله **المستندات**:
 *      المتوقَّع = (التحصيلات المرحَّلة − المسوّى منها) − (الاستردادات المرحَّلة − المخصوم منها)
 *  وتُفصَّل الحركة حسب مصدر القيد (سند القبض / الاسترداد / التسوية / غيرها) لتُقابَل كل جهة بمستندها. العكس المحاسبي
 *  يُنسب إلى مصدر القيد الأصلي (`reversal_of`). أي حركة من مصدر آخر (قيد يدوي مثلاً) تظهر في `other` وتمنع الحكم «مطابق»؛
 *  لا تُخفى ولا تُصنَّف.
 *
 *  ═══ لماذا المطابقة على مستوى المؤسسة فقط؟ ═══
 *  قيد الالتقاط يحمل فرع سند القبض، أما قيد التسوية فيحمل الفرع النشط لمن رحّل التسوية — فمقارنة الأستاذ لكل فرع تُنتج فروقاً
 *  وهمية (التحصيل في فرع والتسوية في آخر). لذا تُحجب المطابقة عن المستخدم المقيَّد بفروع، ويُعرض الأرصدة لكل فرع من **المستندات** (الأعمار).
 *
 *  ═══ الحدود المعلنة ═══
 *   • لا «كما في تاريخ»: المركز الحالي فقط. • لا تنبيهات آلية ولا مطابقة مع كشف المزوّد (يحتاج fetchSettlements).
 *   • الأعمار بتاريخ السند/الاسترداد المحاسبي لا بتاريخ الاستحقاق من المزوّد.
 */
class PaymentClearingReportService
{
    public const SOURCE_CAPTURES = 'captures';
    public const SOURCE_REFUNDS = 'refunds';
    public const SOURCE_SETTLEMENTS = 'settlements';
    public const SOURCE_OTHER = 'other';

    /** حدود الأعمار بالأيام (أعلى كل شريحة): ≤7، 8–30، 31–60، أكثر. */
    public const BUCKET_DAYS = [7, 30, 60];

    public function __construct(private readonly ReportService $reports)
    {
    }

    // ───────────────────────── المطابقة ─────────────────────────

    /** @return array<string, mixed> */
    public function reconcile(): array
    {
        $tenantId = $this->tenantId();
        if (auth()->user()?->allowedBranchIds() !== null) {
            throw new DomainException('branch_scope_forbidden: clearing reconciliation is company-wide and unavailable to branch-restricted users.');
        }

        $accounts = $this->clearingAccounts();
        $bySource = $this->ledgerBySource(array_keys($accounts));
        foreach ($accounts as $id => &$account) {
            $account['balance'] = (int) array_sum(array_map(fn (array $s) => $s['debit'] - $s['credit'], $bySource['by_account'][$id] ?? []));
        }
        unset($account);

        $documents = $this->documentTotals($tenantId);
        $net = fn (string $source): int => ($bySource['totals'][$source]['debit'] ?? 0) - ($bySource['totals'][$source]['credit'] ?? 0);

        $checks = [
            $this->check(self::SOURCE_CAPTURES, $documents['captures'], $net(self::SOURCE_CAPTURES)),
            $this->check(self::SOURCE_REFUNDS, $documents['refunds'], -$net(self::SOURCE_REFUNDS)),
            $this->check(self::SOURCE_SETTLEMENTS, $documents['settled_gross'] - $documents['deducted_refunds'], -$net(self::SOURCE_SETTLEMENTS)),
            // أي حركة على حساب المقاصة من مصدر غير هذه المستندات: المتوقَّع صفر.
            $this->check(self::SOURCE_OTHER, 0, $net(self::SOURCE_OTHER)),
        ];

        $ledgerBalance = (int) array_sum(array_column($accounts, 'balance'));
        $expected = ($documents['captures'] - $documents['settled_gross']) - ($documents['refunds'] - $documents['deducted_refunds']);
        $difference = $ledgerBalance - $expected;
        $mapped = AccountRoleMapping::query()->where('role_key', 'gateway_clearing')->exists();
        $anyCheckOff = collect($checks)->contains(fn (array $c) => $c['difference'] !== 0);

        return [
            'status' => $accounts === [] ? 'unresolved' : ($difference === 0 && ! $anyCheckOff ? 'reconciled' : 'difference'),
            'mapping_state' => $mapped ? 'mapped' : 'unmapped',
            'ledger_balance' => $ledgerBalance,
            'expected_balance' => $expected,
            'difference' => $difference,
            'accounts' => array_values($accounts),
            'documents' => $documents + ['unsettled_captures' => $documents['captures'] - $documents['settled_gross'], 'unsettled_refunds' => $documents['refunds'] - $documents['deducted_refunds']],
            'checks' => $checks,
            'other_sources' => $bySource['other_labels'],
            'per_gateway' => $this->perGateway($tenantId),
            'not_checked' => ['per_branch_ledger', 'as_of_date', 'provider_statement', 'adjustment_reserve_accounts'],
        ];
    }

    // ───────────────────────── فروقات التسويات ─────────────────────────

    /** @return array<string, mixed> */
    public function differences(?string $gatewayId = null, int $limit = 200): array
    {
        $limit = max(1, min(500, $limit));
        $query = PaymentGatewaySettlement::query()
            ->where('status', PaymentGatewaySettlement::STATUS_UNRECONCILED)
            ->when($gatewayId, fn ($q, $id) => $q->where('payment_gateway_id', $id));

        $totals = (clone $query)->selectRaw('COUNT(*) as n, COALESCE(SUM(unreconciled_minor),0) as net, COALESCE(SUM(CASE WHEN unreconciled_minor > 0 THEN unreconciled_minor ELSE 0 END),0) as pos, COALESCE(SUM(CASE WHEN unreconciled_minor < 0 THEN unreconciled_minor ELSE 0 END),0) as neg, MIN(settlement_date) as oldest')->first();
        $rows = (clone $query)->orderBy('settlement_date')->orderBy('id')->limit($limit + 1)->get();
        $today = Carbon::today();

        return [
            'rows' => $rows->take($limit)->map(fn (PaymentGatewaySettlement $s) => [
                'id' => $s->id,
                'payment_gateway_id' => $s->payment_gateway_id,
                'gateway_name' => $s->gateway_name,
                'provider_settlement_ref' => $s->provider_settlement_ref,
                'settlement_date' => $s->settlement_date?->toDateString(),
                'age_days' => $s->settlement_date === null ? null : max(0, (int) $s->settlement_date->copy()->startOfDay()->diffInDays($today)),
                'currency' => $s->currency,
                'gross_amount' => (int) $s->gross_amount,
                'net_bank_amount' => (int) $s->net_bank_amount,
                'unreconciled_minor' => (int) $s->unreconciled_minor,
            ])->values()->all(),
            'has_more' => $rows->count() > $limit,
            'totals' => [
                'count' => (int) ($totals->n ?? 0),
                'net_minor' => (int) ($totals->net ?? 0),
                'positive_minor' => (int) ($totals->pos ?? 0),
                'negative_minor' => (int) ($totals->neg ?? 0),
                'oldest_settlement_date' => $totals->oldest === null ? null : Carbon::parse($totals->oldest)->toDateString(),
            ],
        ];
    }

    // ───────────────────────── الأعمار حسب الفرع ─────────────────────────

    /**
     * @param  array<string, mixed>  $filters  ['branch_id' => string|array]
     * @return array<string, mixed>
     */
    public function aging(array $filters = []): array
    {
        $this->tenantId();
        $branchIds = $this->reports->resolvedBranchIds($filters);
        $today = Carbon::today();
        $cutoffs = array_map(fn (int $days) => $today->copy()->subDays($days)->toDateString(), self::BUCKET_DAYS);

        $captures = $this->bucketed($this->unsettledCapturesQuery($branchIds), 'payment_date', $cutoffs);
        $refunds = $this->bucketed($this->unsettledRefundsQuery($branchIds), 'accounting_date', $cutoffs);

        $keys = array_values(array_unique([...array_keys($captures), ...array_keys($refunds)]));
        $names = Branch::query()->whereIn('id', array_filter($keys, fn ($k) => $k !== ''))->pluck('name', 'id');

        $empty = ['count' => 0, 'total' => 0, 'buckets' => [0, 0, 0, 0]];
        $rows = [];
        foreach ($keys as $key) {
            $c = $captures[$key] ?? $empty;
            $r = $refunds[$key] ?? $empty;
            $rows[] = [
                'branch_id' => $key === '' ? null : $key,
                'branch_name' => $key === '' ? null : ($names[$key] ?? null),
                'captures' => $c,
                'refunds' => $r,
                'net' => ['total' => $c['total'] - $r['total'], 'buckets' => array_map(fn ($i) => $c['buckets'][$i] - $r['buckets'][$i], [0, 1, 2, 3])],
            ];
        }
        usort($rows, fn (array $a, array $b) => [$a['branch_id'] === null ? 1 : 0, (string) $a['branch_name']] <=> [$b['branch_id'] === null ? 1 : 0, (string) $b['branch_name']]);

        $sum = fn (string $side, ?int $i = null) => (int) array_sum(array_map(fn (array $row) => $i === null ? $row[$side]['total'] : $row[$side]['buckets'][$i], $rows));

        return [
            'as_of' => $today->toDateString(),
            'bucket_days' => self::BUCKET_DAYS,
            'rows' => $rows,
            'totals' => [
                'captures' => ['total' => $sum('captures'), 'buckets' => array_map(fn ($i) => $sum('captures', $i), [0, 1, 2, 3])],
                'refunds' => ['total' => $sum('refunds'), 'buckets' => array_map(fn ($i) => $sum('refunds', $i), [0, 1, 2, 3])],
                'net' => ['total' => $sum('net'), 'buckets' => array_map(fn ($i) => $sum('net', $i), [0, 1, 2, 3])],
            ],
            'scope' => $branchIds === null ? 'company' : 'branches',
        ];
    }

    // ───────────────────────── الداخل ─────────────────────────

    private function tenantId(): string
    {
        $id = app(TenantContext::class)->id();
        if ($id === null) {
            throw new DomainException('Tenant context is required.');
        }

        return (string) $id;
    }

    /** @return array<string, array{account_id: string, code: string, name: string, is_active: bool, sources: list<string>, balance: int}> */
    private function clearingAccounts(): array
    {
        $sets = [];
        $add = function (?string $id, string $source) use (&$sets): void {
            if ($id !== null && ! in_array($source, $sets[$id] ?? [], true)) {
                $sets[$id][] = $source;
            }
        };
        $add(AccountRoleMapping::query()->where('role_key', 'gateway_clearing')->value('account_id'), 'current');
        $add(Account::query()->where('code', AccountingRoles::legacyCodeFor('gateway_clearing'))->value('id'), 'system_default');
        foreach (AccountRoleMappingEvent::query()->where('role_key', 'gateway_clearing')->get(['previous_account_id', 'new_account_id']) as $event) {
            $add($event->previous_account_id, 'history');
            $add($event->new_account_id, 'history');
        }

        $out = [];
        foreach (Account::query()->whereIn('id', array_keys($sets))->get() as $account) {
            $out[(string) $account->id] = [
                'account_id' => (string) $account->id, 'code' => (string) $account->code, 'name' => (string) $account->name,
                'is_active' => (bool) $account->is_active, 'sources' => $sets[(string) $account->id], 'balance' => 0,
            ];
        }
        ksort($out);

        return $out;
    }

    /**
     * حركة حسابات المقاصة مجمَّعة بمصدر القيد (العكس ينسب إلى أصله).
     *
     * @param  list<string>  $accountIds
     * @return array{by_account: array<string, array<string, array{debit: int, credit: int}>>, totals: array<string, array{debit: int, credit: int}>, other_labels: list<array{source_type: ?string, debit: int, credit: int}>}
     */
    private function ledgerBySource(array $accountIds): array
    {
        $result = ['by_account' => [], 'totals' => [], 'other_labels' => []];
        if ($accountIds === []) {
            return $result;
        }

        $rows = JournalLine::query()
            ->join('journal_entries as e', 'e.id', '=', 'journal_lines.journal_entry_id')
            ->leftJoin('journal_entries as o', 'o.id', '=', 'e.reversal_of')
            ->whereIn('journal_lines.account_id', $accountIds)
            ->whereIn('e.status', ['posted', 'reversed'])
            ->selectRaw('journal_lines.account_id as account_id, COALESCE(e.source_type, o.source_type) as src, SUM(journal_lines.debit) as d, SUM(journal_lines.credit) as c')
            ->groupBy('journal_lines.account_id')
            ->groupByRaw('COALESCE(e.source_type, o.source_type)')
            ->get();

        $map = [Payment::class => self::SOURCE_CAPTURES, PaymentRefund::class => self::SOURCE_REFUNDS, PaymentGatewaySettlement::class => self::SOURCE_SETTLEMENTS];
        foreach ($rows as $row) {
            $source = $map[(string) $row->src] ?? self::SOURCE_OTHER;
            $debit = (int) $row->d;
            $credit = (int) $row->c;
            $accountId = (string) $row->account_id;
            $result['by_account'][$accountId][$source] = [
                'debit' => ($result['by_account'][$accountId][$source]['debit'] ?? 0) + $debit,
                'credit' => ($result['by_account'][$accountId][$source]['credit'] ?? 0) + $credit,
            ];
            $result['totals'][$source] = [
                'debit' => ($result['totals'][$source]['debit'] ?? 0) + $debit,
                'credit' => ($result['totals'][$source]['credit'] ?? 0) + $credit,
            ];
            if ($source === self::SOURCE_OTHER) {
                $result['other_labels'][] = ['source_type' => $row->src === null ? null : (string) $row->src, 'debit' => $debit, 'credit' => $credit];
            }
        }

        return $result;
    }

    /** @return array{captures: int, settled_gross: int, refunds: int, deducted_refunds: int, capture_count: int, refund_count: int} */
    private function documentTotals(string $tenantId): array
    {
        $captures = BranchScope::reference(Payment::class)->where('direction', 'received')->whereNotNull('payment_gateway_id')->where('status', 'posted')
            ->selectRaw('COUNT(*) as n, COALESCE(SUM(amount),0) as t')->first();
        $refunds = BranchScope::reference(PaymentRefund::class)->where('status', PaymentRefund::CONFIRMED)->where('posting_status', PaymentRefund::POSTING_POSTED)->whereNotNull('payment_gateway_id')
            ->selectRaw('COUNT(*) as n, COALESCE(SUM(amount_minor),0) as t')->first();
        $settledGross = (int) DB::table('payment_gateway_settlement_items as i')
            ->join('payment_gateway_settlements as s', 's.id', '=', 'i.settlement_id')
            ->where('s.tenant_id', $tenantId)->where('s.status', PaymentGatewaySettlement::STATUS_POSTED)->sum('i.gross_amount');
        $deducted = (int) DB::table('payment_gateway_settlement_lines as l')
            ->join('payment_gateway_settlements as s', 's.id', '=', 'l.settlement_id')
            ->where('s.tenant_id', $tenantId)->where('s.status', PaymentGatewaySettlement::STATUS_POSTED)
            ->where('l.line_type', PaymentGatewaySettlementLine::TYPE_REFUND)->sum('l.amount_minor');

        return [
            'captures' => (int) $captures->t, 'settled_gross' => $settledGross, 'refunds' => (int) $refunds->t, 'deducted_refunds' => $deducted,
            'capture_count' => (int) $captures->n, 'refund_count' => (int) $refunds->n,
        ];
    }

    /** @return list<array<string, mixed>> */
    private function perGateway(string $tenantId): array
    {
        $gateways = PaymentGateway::query()->get(['id', 'name'])->keyBy('id');
        $capturesByGateway = BranchScope::reference(Payment::class)->where('direction', 'received')->whereNotNull('payment_gateway_id')->where('status', 'posted')
            ->groupBy('payment_gateway_id')->selectRaw('payment_gateway_id as gid, SUM(amount) as t')->pluck('t', 'gid');
        $refundsByGateway = BranchScope::reference(PaymentRefund::class)->where('status', PaymentRefund::CONFIRMED)->where('posting_status', PaymentRefund::POSTING_POSTED)->whereNotNull('payment_gateway_id')
            ->groupBy('payment_gateway_id')->selectRaw('payment_gateway_id as gid, SUM(amount_minor) as t')->pluck('t', 'gid');
        $settledByGateway = DB::table('payment_gateway_settlement_items as i')
            ->join('payment_gateway_settlements as s', 's.id', '=', 'i.settlement_id')
            ->where('s.tenant_id', $tenantId)->where('s.status', PaymentGatewaySettlement::STATUS_POSTED)
            ->groupBy('s.payment_gateway_id')->selectRaw('s.payment_gateway_id as gid, SUM(i.gross_amount) as t')->pluck('t', 'gid');
        $deductedByGateway = DB::table('payment_gateway_settlement_lines as l')
            ->join('payment_gateway_settlements as s', 's.id', '=', 'l.settlement_id')
            ->where('s.tenant_id', $tenantId)->where('s.status', PaymentGatewaySettlement::STATUS_POSTED)->where('l.line_type', PaymentGatewaySettlementLine::TYPE_REFUND)
            ->groupBy('s.payment_gateway_id')->selectRaw('s.payment_gateway_id as gid, SUM(l.amount_minor) as t')->pluck('t', 'gid');

        $ids = collect([$capturesByGateway, $refundsByGateway, $settledByGateway, $deductedByGateway])->flatMap(fn ($c) => $c->keys())->unique()->values();
        $rows = [];
        foreach ($ids as $id) {
            $unsettledCaptures = (int) ($capturesByGateway[$id] ?? 0) - (int) ($settledByGateway[$id] ?? 0);
            $unsettledRefunds = (int) ($refundsByGateway[$id] ?? 0) - (int) ($deductedByGateway[$id] ?? 0);
            $rows[] = [
                'payment_gateway_id' => (string) $id,
                'gateway_name' => $gateways[$id]->name ?? null,
                'unsettled_captures' => $unsettledCaptures,
                'unsettled_refunds' => $unsettledRefunds,
                'expected_balance' => $unsettledCaptures - $unsettledRefunds,
            ];
        }
        usort($rows, fn (array $a, array $b) => strcmp((string) $a['gateway_name'], (string) $b['gateway_name']));

        return $rows;
    }

    /** @return array{key: string, document: int, ledger: int, difference: int} */
    private function check(string $key, int $document, int $ledger): array
    {
        return ['key' => $key, 'document' => $document, 'ledger' => $ledger, 'difference' => $ledger - $document];
    }

    /** @param  array<int,string>|null  $branchIds */
    private function unsettledCapturesQuery(?array $branchIds): \Illuminate\Database\Eloquent\Builder
    {
        $settled = '(SELECT COALESCE(SUM(i.gross_amount), 0) FROM payment_gateway_settlement_items i '
            .'JOIN payment_gateway_settlements s ON s.id = i.settlement_id '
            ."WHERE i.payment_id = payments.id AND s.status = 'posted')";

        return BranchScope::reference(Payment::class)
            ->select('payments.branch_id', 'payments.payment_date')
            ->selectRaw("payments.amount - {$settled} AS remaining")
            ->where('direction', 'received')->whereNotNull('payment_gateway_id')->where('status', 'posted')
            ->when($branchIds, fn ($q, $ids) => $q->whereIn('payments.branch_id', $ids));
    }

    /** @param  array<int,string>|null  $branchIds */
    private function unsettledRefundsQuery(?array $branchIds): \Illuminate\Database\Eloquent\Builder
    {
        $deducted = '(SELECT COALESCE(SUM(l.amount_minor), 0) FROM payment_gateway_settlement_lines l '
            .'JOIN payment_gateway_settlements s ON s.id = l.settlement_id '
            ."WHERE l.payment_refund_id = payment_refunds.id AND s.status = 'posted')";

        return BranchScope::reference(PaymentRefund::class)
            ->select('payment_refunds.branch_id', 'payment_refunds.accounting_date')
            ->selectRaw("payment_refunds.amount_minor - {$deducted} AS remaining")
            ->where('status', PaymentRefund::CONFIRMED)->where('posting_status', PaymentRefund::POSTING_POSTED)->whereNotNull('payment_gateway_id')
            ->when($branchIds, fn ($q, $ids) => $q->whereIn('payment_refunds.branch_id', $ids));
    }

    /**
     * يجمّع المتبقّي لكل فرع في أربع شرائح عمرية (حدود التاريخ محسوبة في PHP فتبقى المقارنة نصاً متوافقاً بين PostgreSQL وSQLite).
     *
     * @param  list<string>  $cutoffs  [اليوم−7، اليوم−30، اليوم−60]
     * @return array<string, array{count: int, total: int, buckets: list<int>}>
     */
    private function bucketed(\Illuminate\Database\Eloquent\Builder $source, string $dateColumn, array $cutoffs): array
    {
        [$c7, $c30, $c60] = $cutoffs;
        $rows = DB::query()->fromSub($source->toBase(), 'x')->where('remaining', '>', 0)
            ->selectRaw(
                "COALESCE(CAST(branch_id AS VARCHAR(36)), '') as bid, COUNT(*) as n, SUM(remaining) as total, "
                ."SUM(CASE WHEN {$dateColumn} >= ? THEN remaining ELSE 0 END) as b0, "
                ."SUM(CASE WHEN {$dateColumn} < ? AND {$dateColumn} >= ? THEN remaining ELSE 0 END) as b1, "
                ."SUM(CASE WHEN {$dateColumn} < ? AND {$dateColumn} >= ? THEN remaining ELSE 0 END) as b2, "
                ."SUM(CASE WHEN {$dateColumn} < ? THEN remaining ELSE 0 END) as b3",
                [$c7, $c7, $c30, $c30, $c60, $c60]
            )
            ->groupByRaw("COALESCE(CAST(branch_id AS VARCHAR(36)), '')")
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row->bid] = ['count' => (int) $row->n, 'total' => (int) $row->total, 'buckets' => [(int) $row->b0, (int) $row->b1, (int) $row->b2, (int) $row->b3]];
        }

        return $out;
    }
}

<?php

namespace App\Services;

use App\Models\Account;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Models\Product;
use App\Models\User;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * TANKER-PR6B-6 — تقارير الرقابة والمطابقة المحاسبية لسندات تعبئة الصهاريج. **قراءة فقط بالكامل** (لا قفل ولا قيد ولا حركة ولا تسوية ولا تعديل لأي سند) على بيانات أَوْج الأصلية:
 * سندات التعبئة، حركات المخزون الرسمية، مجمّع تكلفة الوقود، الدفتر التشغيلي، قيود اليومية وسطورها. ولا تنسخ منطق `FuelInventoryLedgerReconciliation` بل تستدعيه لمستوى المجمّع.
 *
 * أربعة تقارير: ① `fills` سندات التعبئة وحركاتها · ② `inventory-reconciliation` مطابقة الكمية المسحوبة مع حركة المخزون والمجمّع والدفتر التشغيلي والعكس (+ مطابقة المجمّع مع الأستاذ) ·
 * ③ `clearing-account` الحساب الوسيط (افتتاحي/مدين/دائن/ختامي والرصيد المدعوم بالحركات والفروقات غير المفسَّرة) · ④ `accounting-control` سلسلة الرقابة سند ← حركة مخزون ← حركة تكلفة ← قيد ← دفتر الأستاذ ← نتيجة المطابقة.
 *
 * ## التصنيف في النتائج (ثلاثة مستويات لا تُخلط)
 * `error` فرق **مؤكَّد** (مخالفة بيانات: سند مرحَّل بلا قيد، اختلاف كمية/قيمة، عكس ناقص/مكرر، حساب وسيط غير صالح، رصيد الوسيط يخالف الحركات) · `warning` تنبيه لا يثبت خللاً
 * (قيود أخرى على الحساب الوسيط، حساب وسيط تغيّر بعد الترحيل) · `incomplete` عملية **لم تكتمل دورتها** بعد (سند بانتظار الترحيل أو محاولته الأخيرة مرفوضة/فاشلة) — ليست خطأً ولا تُحسب فرقاً.
 *
 * ## الحجب والعزل
 * المبالغ ومعرّفات القيود والحركات لـ`products.view_cost` فقط، ومعرّفات الحسابات واسمها لـ`accounts.view` فقط (مستقلان)؛ تقرير الحساب الوسيط ماليٌّ بالكامل فيتطلب الاثنين. النطاق (محطات/فرع/مستأجر) يُحدَّد خارج الخدمة (المتحكّم)،
 * والقيود تُحدَّد بفروع المراجع المرئية. الحد الأقصى {@see self::SCAN_LIMIT} سنداً للتقرير الواحد (`truncated` إن زادت) فلا مسح غير محدود.
 */
class FuelTankerFillAccountingReportService
{
    public const SCAN_LIMIT = 2000;
    public const KEYS = ['fills', 'inventory-reconciliation', 'clearing-account', 'accounting-control'];

    private const CHUNK = 400;

    public function __construct(
        private TenantContext $tenant,
        private FuelInventoryLedgerReconciliation $reconciliation,
        private FuelTankerClearingAccountGuard $clearingGuard,
        private FuelStationSettingsService $settings,
        private FuelTankerFillInventoryActivityReader $activity,
    ) {}

    // ───────────────────────── ① سندات التعبئة ─────────────────────────

    /**
     * @param  Builder<FuelTankerFill>  $query  مقيَّد مسبقاً بنطاق المستخدم والمرشّحات
     * @return array<string, mixed>
     */
    public function fills(Builder $query, User $actor, int $page, int $perPage): array
    {
        $canSeeCost = $actor->hasPermission('products.view_cost');
        $canSeeAccounts = $actor->hasPermission('accounts.view');
        $summaryRows = (clone $query)->reorder()->selectRaw('status, inventory_status, COUNT(*) as c, SUM(quantity_milliliters) as q')->groupBy('status', 'inventory_status')->get();
        $paginator = (clone $query)->with(['owner', 'tanker'])->orderByDesc('recorded_at')->orderByDesc('id')->paginate($perPage, ['*'], 'page', $page);
        /** @var Collection<int, FuelTankerFill> $fills */
        $fills = collect($paginator->items());

        $links = $this->links($fills);
        $names = $this->names($fills);
        $rows = $fills->map(function (FuelTankerFill $fill) use ($links, $names, $canSeeCost, $canSeeAccounts) {
            $l = $links[$fill->id] ?? null;
            $row = [
                'id' => $fill->id, 'number' => $fill->number, 'voucher_number' => $fill->voucher_number, 'recorded_at' => $fill->recorded_at?->toIso8601String(),
                'status' => $fill->status, 'inventory_status' => $fill->inventory_status,
                'station' => ['id' => $fill->fuel_station_id, 'name' => $names['stations'][$fill->fuel_station_id] ?? null],
                'owner' => ['id' => $fill->fuel_tanker_owner_id, 'name' => $fill->owner?->name],
                'tanker' => $fill->tanker === null ? null : ['id' => $fill->tanker->id, 'plate_number' => $fill->tanker->plate_number],
                'fuel_product' => ['id' => $fill->fuel_product_id, 'name' => $names['products'][$fill->fuel_product_id] ?? null],
                'quantity_milliliters' => (int) $fill->quantity_milliliters,
                'posting_status' => $l['posting']->status ?? null,
                'posted_at' => $l === null ? null : $this->iso($l['posting']->posted_at),
                'reversed_at' => $l === null || $l['posting']->reversed_at === null ? null : $this->iso($l['posting']->reversed_at),
            ];
            if ($canSeeCost && $l !== null) {
                $row += [
                    'posted_cost_minor' => (int) $l['posting']->posted_cost_minor,
                    'stock_movement_id' => $l['posting']->stock_movement_id, 'cost_movement_id' => $l['posting']->cost_movement_id,
                    'reversal_stock_movement_id' => $l['posting']->reversal_stock_movement_id, 'reversal_cost_movement_id' => $l['posting']->reversal_cost_movement_id,
                    'journal_entry' => $l['entry'], 'reversal_journal_entry' => $l['reversal_entry'],
                ];
            }

            return $row;
        })->values()->all();

        $byState = [];
        $totalMl = 0;
        foreach ($summaryRows as $r) {
            $byState[] = ['status' => $r->status, 'inventory_status' => $r->inventory_status, 'count' => (int) $r->c, 'quantity_milliliters' => (int) $r->q];
            $totalMl += (int) $r->q;
        }

        return [
            'rows' => $rows,
            'summary' => ['total_count' => $paginator->total(), 'total_quantity_milliliters' => $totalMl, 'by_state' => $byState],
            'pagination' => ['page' => $paginator->currentPage(), 'per_page' => $paginator->perPage(), 'total' => $paginator->total(), 'last_page' => $paginator->lastPage()],
            'masking' => ['costs' => ! $canSeeCost, 'accounts' => ! $canSeeAccounts],
        ];
    }

    // ───────────────────────── ② مطابقة المخزون ─────────────────────────

    /**
     * @param  Builder<FuelTankerFill>  $query
     * @param  list<string>|null  $visibleWarehouseIds
     * @param  list<string>|null  $visibleBranchIds
     * @return array<string, mixed>
     */
    public function inventoryReconciliation(Builder $query, User $actor, ?array $visibleWarehouseIds, ?array $visibleBranchIds, bool $fullScope): array
    {
        $chain = $this->chain($query, $actor);
        $codes = ['stock_movement_missing', 'stock_quantity_mismatch', 'stock_value_mismatch', 'cost_movement_missing', 'cost_quantity_mismatch', 'cost_value_mismatch', 'ledger_missing', 'ledger_quantity_mismatch', 'ledger_value_mismatch',
            'reversal_incomplete', 'reversal_duplicate', 'reversal_quantity_mismatch', 'reversal_value_mismatch', 'status_without_posting', 'posting_quantity_differs_from_fill'];
        $rows = $chain['rows']->map(function (array $row) use ($codes) {
            $findings = array_values(array_filter($row['findings'], fn (array $f) => in_array($f['code'], $codes, true) || $f['severity'] === 'info'));
            $result = $this->result($findings, $row);

            return ['fill_id' => $row['fill_id'], 'number' => $row['number'], 'voucher_number' => $row['voucher_number'], 'station_id' => $row['station_id'], 'inventory_status' => $row['inventory_status'], 'posting_status' => $row['posting_status'],
                'quantities' => $row['quantities'], 'values' => $row['values'], 'findings' => $findings, 'result' => $result];
        });

        $net = $chain['rows']->where('posting_status', 'posted');
        $summary = $this->summarize($rows) + ['quantity_totals' => [
            'fills_posted_milliliters' => (int) $net->sum('quantities.fill'),
            'stock_out_milliliters' => (int) $net->sum(fn ($r) => (int) ($r['quantities']['stock_out'] ?? 0)),
            'cost_issue_milliliters' => (int) $net->sum(fn ($r) => (int) ($r['quantities']['cost_issue'] ?? 0)),
            'ledger_milliliters' => (int) $net->sum(fn ($r) => -(int) ($r['quantities']['ledger'] ?? 0)),
            'reversed_milliliters' => (int) $chain['rows']->where('posting_status', 'reversed')->sum('quantities.fill'),
        ]];

        // مطابقة مستوى المجمّع (كمية/قيمة/تاريخ التكلفة المفتوح) بالمحرك القائم نفسه — لا نسخ لمنطقه.
        $pool = $this->reconciliation->reconcile($visibleWarehouseIds, $visibleBranchIds, $actor->hasPermission('products.view_cost') && $fullScope, $fullScope);

        return [
            'rows' => $rows->values()->all(), 'summary' => $summary, 'pool' => $pool,
            'truncated' => $chain['truncated'], 'masking' => ['costs' => ! $actor->hasPermission('products.view_cost')],
        ];
    }

    // ───────────────────────── ④ الرقابة المحاسبية ─────────────────────────

    /**
     * @param  Builder<FuelTankerFill>  $query
     * @param  array{from?: ?string, to?: ?string}  $period
     * @param  list<string>|null  $visibleBranchIds
     * @return array<string, mixed>
     */
    public function accountingControl(Builder $query, User $actor, ?array $visibleBranchIds, array $period): array
    {
        $chain = $this->chain($query, $actor);
        $rows = $chain['rows']->map(fn (array $row) => $row + ['result' => $this->result($row['findings'], $row)]);
        $byCode = [];
        foreach ($rows as $row) {
            foreach ($row['findings'] as $f) {
                $byCode[$f['code']] = ['code' => $f['code'], 'severity' => $f['severity'], 'count' => ($byCode[$f['code']]['count'] ?? 0) + 1];
            }
        }

        // اختلاف رصيد الحساب الوسيط عن الرصيد المدعوم بالحركات (كل الحسابات الوسيطة المعنية) — مستوى التقرير.
        $clearing = $actor->hasPermission('products.view_cost') && $actor->hasPermission('accounts.view') ? $this->clearingAccount($actor, $visibleBranchIds, $period) : null;

        return [
            'rows' => $rows->values()->all(),
            'summary' => $this->summarize($rows) + ['findings_by_code' => array_values($byCode)],
            'clearing' => $clearing === null ? null : ['accounts' => array_map(fn (array $a) => ['account' => $a['account'], 'closing_balance_minor' => $a['closing_balance_minor'], 'supported_balance_minor' => $a['supported_balance_minor'], 'unexplained_difference_minor' => $a['unexplained_difference_minor'], 'findings' => $a['findings']], $clearing['accounts'])],
            'truncated' => $chain['truncated'], 'masking' => ['costs' => ! $actor->hasPermission('products.view_cost'), 'accounts' => ! $actor->hasPermission('accounts.view')],
        ];
    }

    // ───────────────────────── ③ الحساب الوسيط ─────────────────────────

    /**
     * المرجع المالي: يتطلب `products.view_cost` و`accounts.view` معاً (المتحكّم يفرضه). الأرصدة على مستوى **الحساب** (بفروع المراجع المرئية فقط) لا على مرشّحات المحطة/الصاحب.
     *
     * @param  list<string>|null  $visibleBranchIds
     * @param  array{from?: ?string, to?: ?string}  $period
     * @return array<string, mixed>
     */
    public function clearingAccount(User $actor, ?array $visibleBranchIds, array $period): array
    {
        $tenantId = (string) $this->tenant->id();
        $to = $period['to'] ?? now()->toDateString();
        $from = $period['from'] ?? \Carbon\CarbonImmutable::parse($to)->startOfMonth()->toDateString();

        // الحسابات الوسيطة المعنية: المعيَّن حالياً + كل حساب مدين في قيود ترحيل السندات تاريخياً.
        $current = $this->settings->tankerInventoryPostingConfig(null)['clearing_account']['account_id'] ?? null;
        $postingEntryIds = DB::table('journal_entries')->where('tenant_id', $tenantId)->where('source_type', FuelTankerFill::class)->whereNull('reversal_of')->select('id');
        $historical = DB::table('journal_lines')->where('tenant_id', $tenantId)->whereIn('journal_entry_id', $postingEntryIds)->where('debit', '>', 0)->distinct()->pluck('account_id')->all();
        $accountIds = array_values(array_unique(array_filter([...$historical, $current])));
        $accounts = Account::query()->whereIn('id', $accountIds)->orderBy('code')->get(['id', 'code', 'name']);

        $result = [];
        foreach ($accounts as $account) {
            $lines = fn () => DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
                ->where('l.tenant_id', $tenantId)->where('l.account_id', $account->id)->whereIn('e.status', ['posted', 'reversed'])
                ->when($visibleBranchIds !== null, fn ($q) => $visibleBranchIds === [] ? $q->whereRaw('1 = 0') : $q->whereIn('l.branch_id', $visibleBranchIds));
            $net = fn ($q) => (int) $q->selectRaw('COALESCE(SUM(l.debit), 0) - COALESCE(SUM(l.credit), 0) as n')->value('n');
            $tanker = fn ($q) => $q->where('e.source_type', FuelTankerFill::class);
            $other = fn ($q) => $q->where(fn ($w) => $w->whereNull('e.source_type')->orWhere('e.source_type', '<>', FuelTankerFill::class));

            $opening = $net($lines()->whereDate('e.entry_date', '<', $from));
            $sum = fn ($q, string $col) => (int) $q->sum('l.' . $col);
            $inPeriod = fn () => $lines()->whereDate('e.entry_date', '>=', $from)->whereDate('e.entry_date', '<=', $to);
            $tankerDebits = $sum($tanker($inPeriod()), 'debit');
            $tankerCredits = $sum($tanker($inPeriod()), 'credit');
            $otherDebits = $sum($other($inPeriod()), 'debit');
            $otherCredits = $sum($other($inPeriod()), 'credit');
            $closing = $net($lines()->whereDate('e.entry_date', '<=', $to));
            $tankerNetAll = $net($tanker($lines()->whereDate('e.entry_date', '<=', $to)));
            $otherNetAll = $net($other($lines()->whereDate('e.entry_date', '<=', $to)));

            // الرصيد المدعوم بالحركات المثبَّتة: Σ تكلفة السندات المرحَّلة غير المعكوسة على هذا الحساب (من صف الترحيل لا من الأستاذ).
            $supported = $this->supportedBalance($tenantId, (string) $account->id, $to, $visibleBranchIds);
            $findings = [];
            if ($tankerNetAll !== $supported) {
                $findings[] = ['code' => 'clearing_balance_differs_from_postings', 'severity' => 'error', 'difference_minor' => $tankerNetAll - $supported];
            }
            if ($otherNetAll !== 0 || $otherDebits !== 0 || $otherCredits !== 0) {
                $findings[] = ['code' => 'other_entries_on_clearing_account', 'severity' => 'warning', 'net_minor' => $otherNetAll];
            }
            if ($this->clearingGuard->violation((string) $account->id) !== null) {
                $findings[] = ['code' => 'clearing_account_invalid', 'severity' => 'error'];
            }
            if ($current !== null && $current !== $account->id) {
                $findings[] = ['code' => 'clearing_account_differs_from_current', 'severity' => 'warning'];
            }

            $result[] = [
                'account' => ['id' => $account->id, 'code' => $account->code, 'name' => $account->name, 'is_current' => $current === $account->id],
                'opening_balance_minor' => $opening, 'period_debits_minor' => $tankerDebits + $otherDebits, 'period_credits_minor' => $tankerCredits + $otherCredits, 'closing_balance_minor' => $closing,
                'tanker' => ['debits_minor' => $tankerDebits, 'credits_minor' => $tankerCredits, 'net_all_time_minor' => $tankerNetAll],
                'other' => ['debits_minor' => $otherDebits, 'credits_minor' => $otherCredits, 'net_all_time_minor' => $otherNetAll],
                'supported_balance_minor' => $supported, 'unexplained_difference_minor' => $tankerNetAll - $supported,
                'other_entries' => $other($lines()->whereDate('e.entry_date', '>=', $from)->whereDate('e.entry_date', '<=', $to))->orderByDesc('e.entry_date')->orderByDesc('e.number')->limit(25)
                    ->get(['e.id as entry_id', 'e.number', 'e.entry_date', 'e.description', 'e.source_type', 'l.debit', 'l.credit'])
                    ->map(fn ($r) => ['entry_id' => $r->entry_id, 'number' => $r->number, 'entry_date' => substr((string) $r->entry_date, 0, 10), 'description' => $r->description, 'source' => $r->source_type === null ? null : class_basename((string) $r->source_type), 'debit_minor' => (int) $r->debit, 'credit_minor' => (int) $r->credit])->all(),
                'findings' => $findings,
            ];
        }

        return [
            'period' => ['from' => $from, 'to' => $to], 'accounts' => $result,
            'scope' => ['branch_restricted' => $visibleBranchIds !== null, 'filters_applied' => ['period', 'branch']],
        ];
    }

    // ───────────────────────── السلسلة (مشتركة بين ② و④) ─────────────────────────

    /**
     * @param  Builder<FuelTankerFill>  $query
     * @return array{rows: Collection<int, array<string, mixed>>, truncated: bool}
     */
    private function chain(Builder $query, User $actor): array
    {
        $tenantId = (string) $this->tenant->id();
        $canSeeCost = $actor->hasPermission('products.view_cost');
        $canSeeAccounts = $actor->hasPermission('accounts.view');
        $fills = (clone $query)->with('owner')->orderByDesc('recorded_at')->orderByDesc('id')->limit(self::SCAN_LIMIT + 1)->get();
        $truncated = $fills->count() > self::SCAN_LIMIT;
        $fills = $fills->take(self::SCAN_LIMIT);

        $data = $this->evidence($tenantId, $fills);
        $stationBranch = FuelStation::query()->whereIn('id', $fills->pluck('fuel_station_id')->unique()->all())->pluck('branch_id', 'id');
        $currentClearing = $this->settings->tankerInventoryPostingConfig(null)['clearing_account']['account_id'] ?? null;

        $rows = $fills->map(function (FuelTankerFill $fill) use ($data, $stationBranch, $currentClearing, $canSeeCost, $canSeeAccounts) {
            $d = $data[$fill->id];
            $posting = $d['posting'];
            $findings = [];
            $add = function (string $code, string $severity = 'error') use (&$findings): void {
                $findings[] = ['code' => $code, 'severity' => $severity];
            };
            $q = (int) $fill->quantity_milliliters;

            if ($posting === null) {
                if (in_array($fill->inventory_status, [FuelTankerFill::INVENTORY_POSTED, FuelTankerFill::INVENTORY_REVERSED], true)) {
                    $add('status_without_posting');
                }
                if ($d['entries'] !== []) {
                    $add('entry_without_posting');
                }
                if ($d['last_attempt_failed']) {
                    $add('last_attempt_failed', 'info');
                } elseif ($fill->status === FuelTankerFill::STATUS_RECORDED && $fill->inventory_status === FuelTankerFill::INVENTORY_PENDING_INTEGRATION) {
                    $add('not_posted_yet', 'info');
                }
            } else {
                $cost = (int) $posting->posted_cost_minor;
                if ((int) $posting->quantity_milliliters !== $q) {
                    $add('posting_quantity_differs_from_fill');
                }
                // — الصرف —
                $stock = $d['stock'];
                if ($stock === null) {
                    $add('stock_movement_missing');
                } else {
                    if ((int) $stock->quantity !== $q || $stock->type !== 'out') {
                        $add('stock_quantity_mismatch');
                    }
                    if ((int) $stock->total_cost !== $cost) {
                        $add('stock_value_mismatch');
                    }
                }
                $costMovement = $d['cost'];
                if ($costMovement === null) {
                    $add('cost_movement_missing');
                } else {
                    if ((int) $costMovement->quantity_milliliters !== $q) {
                        $add('cost_quantity_mismatch');
                    }
                    if ((int) $costMovement->posted_cost_minor !== $cost) {
                        $add('cost_value_mismatch');
                    }
                }
                $entry = $d['entry'];
                if ($costMovement !== null && ($costMovement->journal_entry_id === null || $entry === null || ! in_array($entry['status'], ['posted', 'reversed'], true))) {
                    $add('posted_without_entry');
                } elseif ($entry !== null) {
                    if ($entry['lines'] !== 2 || $entry['debit'] !== $entry['credit'] || $entry['debit'] !== $cost) {
                        $add('entry_amount_mismatch');
                    }
                    if ($entry['clearing_account_id'] !== null && $this->clearingGuard->violation((string) $entry['clearing_account_id']) !== null) {
                        $add('clearing_account_invalid');
                    } elseif ($currentClearing !== null && $entry['clearing_account_id'] !== null && $entry['clearing_account_id'] !== $currentClearing) {
                        $add('clearing_account_differs_from_current', 'warning');
                    }
                    if (($stationBranch[$fill->fuel_station_id] ?? null) !== null && $entry['branch_ids'] !== [] && $entry['branch_ids'] !== [$stationBranch[$fill->fuel_station_id]]) {
                        $add('entry_branch_mismatch', 'warning');
                    }
                    if ($posting->status === 'reversed' && $entry['status'] !== 'reversed') {
                        $add('original_entry_not_reversed');
                    }
                }
                $ledger = $d['ledger'];
                if ($ledger === null) {
                    $add('ledger_missing');
                } else {
                    if ((int) $ledger->quantity_milliliters !== -$q) {
                        $add('ledger_quantity_mismatch');
                    }
                    if ((int) $ledger->value_minor !== -$cost) {
                        $add('ledger_value_mismatch');
                    }
                }
                // — العكس —
                if ($posting->status === 'reversed') {
                    $rs = $d['reversal_stock'];
                    $rc = $d['reversal_cost'];
                    $re = $d['reversal_entry'];
                    $rl = $d['reversal_ledger'];
                    if ($rs === null || $rc === null || $re === null || $rl === null) {
                        $add('reversal_incomplete');
                    } else {
                        if ((int) $rs->quantity !== $q || $rs->type !== 'in' || (int) $rs->total_cost !== $cost || (int) $rc->quantity_milliliters !== $q || (int) $rc->posted_cost_minor !== $cost
                            || $re['debit'] !== $cost || $re['credit'] !== $cost || (int) $rl->quantity_milliliters !== $q || (int) $rl->value_minor !== $cost) {
                            $add('reversal_quantity_mismatch');
                        }
                        if ($re['reversal_of'] !== ($entry['id'] ?? null)) {
                            $add('reversal_entry_not_linked');
                        }
                    }
                    if ($d['reversal_entry_count'] > 1 || $d['reversal_ledger_count'] > 1) {
                        $add('reversal_duplicate');
                    }
                } elseif ($d['reversal_entry_count'] > 0 || $d['reversal_ledger_count'] > 0) {
                    $add('reversal_incomplete'); // عكس مسجَّل في الأستاذ/الدفتر بلا ترحيل معكوس
                }
            }

            $row = [
                'fill_id' => $fill->id, 'number' => $fill->number, 'voucher_number' => $fill->voucher_number, 'recorded_at' => $fill->recorded_at?->toIso8601String(),
                'station_id' => $fill->fuel_station_id, 'owner_name' => $fill->owner?->name, 'fuel_product_id' => $fill->fuel_product_id, 'quantity_milliliters' => $q,
                'status' => $fill->status, 'inventory_status' => $fill->inventory_status, 'posting_status' => $posting?->status,
                'quantities' => [
                    'fill' => $q, 'stock_out' => $d['stock'] === null ? null : (int) $d['stock']->quantity, 'cost_issue' => $d['cost'] === null ? null : (int) $d['cost']->quantity_milliliters,
                    'ledger' => $d['ledger'] === null ? null : (int) $d['ledger']->quantity_milliliters,
                    'stock_reversal_in' => $d['reversal_stock'] === null ? null : (int) $d['reversal_stock']->quantity, 'cost_reversal' => $d['reversal_cost'] === null ? null : (int) $d['reversal_cost']->quantity_milliliters,
                    'ledger_reversal' => $d['reversal_ledger'] === null ? null : (int) $d['reversal_ledger']->quantity_milliliters,
                ],
                'values' => $canSeeCost ? [
                    'posting_cost_minor' => $posting === null ? null : (int) $posting->posted_cost_minor,
                    'stock_total_cost_minor' => $d['stock'] === null ? null : (int) $d['stock']->total_cost, 'cost_movement_minor' => $d['cost'] === null ? null : (int) $d['cost']->posted_cost_minor,
                    'entry_debit_minor' => $d['entry']['debit'] ?? null, 'entry_credit_minor' => $d['entry']['credit'] ?? null,
                    'ledger_value_minor' => $d['ledger'] === null ? null : (int) $d['ledger']->value_minor,
                    'reversal_entry_debit_minor' => $d['reversal_entry']['debit'] ?? null, 'reversal_entry_credit_minor' => $d['reversal_entry']['credit'] ?? null,
                ] : null,
                'chain' => $canSeeCost && $posting !== null ? [
                    'stock_movement_id' => $posting->stock_movement_id, 'cost_movement_id' => $posting->cost_movement_id,
                    'journal_entry' => $d['entry'] === null ? null : ['id' => $d['entry']['id'], 'number' => $d['entry']['number'], 'status' => $d['entry']['status']],
                    'reversal_stock_movement_id' => $posting->reversal_stock_movement_id, 'reversal_cost_movement_id' => $posting->reversal_cost_movement_id,
                    'reversal_journal_entry' => $d['reversal_entry'] === null ? null : ['id' => $d['reversal_entry']['id'], 'number' => $d['reversal_entry']['number']],
                ] : null,
                'accounts' => $canSeeAccounts && ($d['entry']['clearing_account_id'] ?? null) !== null ? ['clearing_account_id' => $d['entry']['clearing_account_id'], 'inventory_account_id' => $d['entry']['inventory_account_id']] : null,
                'findings' => $findings,
            ];

            return $row;
        })->values();

        return ['rows' => $rows, 'truncated' => $truncated];
    }

    /**
     * يجمع أدلة السلسلة لمجموعة سندات بعدد ثابت من الاستعلامات لكل دفعة (لا N+1).
     *
     * @param  Collection<int, FuelTankerFill>  $fills
     * @return array<string, array<string, mixed>>
     */
    private function evidence(string $tenantId, Collection $fills): array
    {
        $out = [];
        foreach ($fills->pluck('id')->chunk(self::CHUNK) as $chunk) {
            $ids = $chunk->values()->all();
            $postings = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $tenantId)->whereIn('fuel_tanker_fill_id', $ids)->get()->keyBy('fuel_tanker_fill_id');
            $stockIds = $postings->flatMap(fn ($p) => [$p->stock_movement_id, $p->reversal_stock_movement_id])->filter()->unique()->values()->all();
            $costIds = $postings->flatMap(fn ($p) => [$p->cost_movement_id, $p->reversal_cost_movement_id])->filter()->unique()->values()->all();
            $stocks = $stockIds === [] ? collect() : DB::table('stock_movements')->where('tenant_id', $tenantId)->whereIn('id', $stockIds)->get()->keyBy('id');
            $costs = $costIds === [] ? collect() : DB::table('fuel_inventory_cost_movements')->where('tenant_id', $tenantId)->whereIn('id', $costIds)->get()->keyBy('id');
            $ledgers = DB::table('fuel_operational_ledgers')->where('tenant_id', $tenantId)->whereIn('source_id', $ids)->whereIn('movement_type', [FuelOperationalLedger::TYPE_TANKER_FILL, FuelOperationalLedger::TYPE_TANKER_FILL_REVERSAL])->get()->groupBy('source_id');
            $entries = DB::table('journal_entries')->where('tenant_id', $tenantId)->where('source_type', FuelTankerFill::class)->whereIn('source_id', $ids)->get()->groupBy('source_id');
            $entryIds = $entries->flatten(1)->pluck('id')->all();
            $reversalsByOriginal = $entryIds === [] ? collect() : DB::table('journal_entries')->where('tenant_id', $tenantId)->whereIn('reversal_of', $entryIds)->get()->groupBy('reversal_of');
            $allEntryIds = array_values(array_unique([...$entryIds, ...$reversalsByOriginal->flatten(1)->pluck('id')->all()]));
            $lines = $allEntryIds === [] ? collect() : DB::table('journal_lines')->where('tenant_id', $tenantId)->whereIn('journal_entry_id', $allEntryIds)->get()->groupBy('journal_entry_id');
            $attempts = DB::table('fuel_tanker_fill_inventory_posting_attempts')->where('tenant_id', $tenantId)->whereIn('fuel_tanker_fill_id', $ids)->orderBy('attempted_at')->orderBy('created_at')->orderBy('operation_type')->get()->groupBy('fuel_tanker_fill_id');

            $shape = function (?object $entry) use ($lines): ?array {
                if ($entry === null) {
                    return null;
                }
                $ls = $lines->get($entry->id, collect());
                $debitLine = $ls->first(fn ($l) => (int) $l->debit > 0);
                $creditLine = $ls->first(fn ($l) => (int) $l->credit > 0);

                return [
                    'id' => $entry->id, 'number' => $entry->number, 'status' => $entry->status, 'reversal_of' => $entry->reversal_of, 'lines' => $ls->count(),
                    'debit' => (int) $ls->sum('debit'), 'credit' => (int) $ls->sum('credit'),
                    'clearing_account_id' => $debitLine?->account_id, 'inventory_account_id' => $creditLine?->account_id,
                    'branch_ids' => $ls->pluck('branch_id')->unique()->sort()->values()->all(),
                ];
            };

            foreach ($ids as $id) {
                $posting = $postings->get($id);
                $fillEntries = $entries->get($id, collect());
                $original = $posting === null ? null : $fillEntries->first(fn ($e) => $e->reversal_of === null);
                $originalCostEntryId = $posting === null ? null : ($costs->get($posting->cost_movement_id)->journal_entry_id ?? null);
                $original = $originalCostEntryId === null ? $original : ($fillEntries->firstWhere('id', $originalCostEntryId) ?? DB::table('journal_entries')->where('id', $originalCostEntryId)->first());
                $reversalRows = $original === null ? collect() : $reversalsByOriginal->get($original->id, collect());
                $reversalCost = $posting?->reversal_cost_movement_id === null ? null : $costs->get($posting->reversal_cost_movement_id);
                $reversalEntry = $reversalCost?->journal_entry_id !== null ? ($reversalRows->firstWhere('id', $reversalCost->journal_entry_id) ?? DB::table('journal_entries')->where('id', $reversalCost->journal_entry_id)->first()) : $reversalRows->first();
                $ledgerRows = $ledgers->get($id, collect());
                $last = $attempts->get($id)?->last();
                $out[$id] = [
                    'posting' => $posting,
                    'stock' => $posting === null ? null : $stocks->get($posting->stock_movement_id),
                    'cost' => $posting === null ? null : $costs->get($posting->cost_movement_id),
                    'entry' => $shape($original),
                    'entries' => $fillEntries->where('reversal_of', null)->values()->all(),
                    'ledger' => $ledgerRows->firstWhere('movement_type', FuelOperationalLedger::TYPE_TANKER_FILL),
                    'reversal_stock' => $posting?->reversal_stock_movement_id === null ? null : $stocks->get($posting->reversal_stock_movement_id),
                    'reversal_cost' => $reversalCost,
                    'reversal_entry' => $shape($reversalEntry),
                    'reversal_entry_count' => $reversalRows->count(),
                    'reversal_ledger' => $ledgerRows->firstWhere('movement_type', FuelOperationalLedger::TYPE_TANKER_FILL_REVERSAL),
                    'reversal_ledger_count' => $ledgerRows->where('movement_type', FuelOperationalLedger::TYPE_TANKER_FILL_REVERSAL)->count(),
                    'last_attempt_failed' => $last !== null && in_array($last->outcome, ['rejected', 'failed'], true),
                ];
            }
        }

        return $out;
    }

    /** @param Collection<int, FuelTankerFill> $fills @return array<string, array{posting: object, entry: ?array, reversal_entry: ?array}> */
    private function links(Collection $fills): array
    {
        if ($fills->isEmpty()) {
            return [];
        }
        $tenantId = (string) $this->tenant->id();
        $postings = DB::table('fuel_tanker_fill_inventory_postings')->where('tenant_id', $tenantId)->whereIn('fuel_tanker_fill_id', $fills->pluck('id')->all())->get()->keyBy('fuel_tanker_fill_id');
        $costIds = $postings->flatMap(fn ($p) => [$p->cost_movement_id, $p->reversal_cost_movement_id])->filter()->all();
        $journalByCost = $costIds === [] ? collect() : DB::table('fuel_inventory_cost_movements')->whereIn('id', $costIds)->pluck('journal_entry_id', 'id');
        $entryNumbers = DB::table('journal_entries')->whereIn('id', $journalByCost->filter()->values()->all())->pluck('number', 'id');
        $out = [];
        foreach ($postings as $fillId => $p) {
            $e = $journalByCost->get($p->cost_movement_id);
            $r = $p->reversal_cost_movement_id === null ? null : $journalByCost->get($p->reversal_cost_movement_id);
            $out[$fillId] = [
                'posting' => $p,
                'entry' => $e === null ? null : ['id' => $e, 'number' => $entryNumbers->get($e)],
                'reversal_entry' => $r === null ? null : ['id' => $r, 'number' => $entryNumbers->get($r)],
            ];
        }

        return $out;
    }

    /** @param Collection<int, FuelTankerFill> $fills @return array{stations: array<string,string>, products: array<string,string>} */
    private function names(Collection $fills): array
    {
        $stations = FuelStation::query()->whereIn('id', $fills->pluck('fuel_station_id')->unique()->all())->pluck('name', 'id')->all();
        $fuelProducts = FuelProduct::query()->whereIn('id', $fills->pluck('fuel_product_id')->unique()->all())->get(['id', 'product_id']);
        $productNames = BranchScope::reference(Product::class)->whereIn('id', $fuelProducts->pluck('product_id')->all())->pluck('name', 'id');
        $products = [];
        foreach ($fuelProducts as $fp) {
            $products[$fp->id] = $productNames->get($fp->product_id);
        }

        return ['stations' => $stations, 'products' => $products];
    }

    /**
     * الرصيد المدعوم بالحركات: Σ تكلفة الترحيلات **غير المعكوسة** التي قيدها الأصلي مدين لهذا الحساب بتاريخ ≤ `$to` (الأصل والعكس معاً لما عُكس يصافران صفراً فيُستثنيان).
     *
     * @param  list<string>|null  $visibleBranchIds
     */
    private function supportedBalance(string $tenantId, string $accountId, string $to, ?array $visibleBranchIds): int
    {
        $query = DB::table('fuel_tanker_fill_inventory_postings as p')
            ->join('fuel_inventory_cost_movements as m', 'm.id', '=', 'p.cost_movement_id')
            ->join('journal_lines as l', fn ($j) => $j->on('l.journal_entry_id', '=', 'm.journal_entry_id')->where('l.account_id', '=', $accountId)->where('l.debit', '>', 0))
            ->join('journal_entries as e', 'e.id', '=', 'm.journal_entry_id')
            ->where('p.tenant_id', $tenantId)->whereDate('e.entry_date', '<=', $to)->whereIn('e.status', ['posted', 'reversed'])
            ->when($visibleBranchIds !== null, fn ($q) => $visibleBranchIds === [] ? $q->whereRaw('1 = 0') : $q->whereIn('l.branch_id', $visibleBranchIds));

        // سند عُكس بتاريخ لاحق لـ`$to` ما زال مرحَّلاً عند ذلك التاريخ: القيد العكسي بتاريخ بعد `$to` لا يدخل الأستاذ حتى `$to` فيجب أن يبقى في المدعوم.
        $postedNet = (int) (clone $query)->sum('p.posted_cost_minor');
        $reversedBeforeTo = (int) DB::table('fuel_tanker_fill_inventory_postings as p')
            ->join('fuel_inventory_cost_movements as rm', 'rm.id', '=', 'p.reversal_cost_movement_id')
            ->join('journal_entries as re', 're.id', '=', 'rm.journal_entry_id')
            ->join('fuel_inventory_cost_movements as m', 'm.id', '=', 'p.cost_movement_id')
            ->join('journal_lines as l', fn ($j) => $j->on('l.journal_entry_id', '=', 'm.journal_entry_id')->where('l.account_id', '=', $accountId)->where('l.debit', '>', 0))
            ->where('p.tenant_id', $tenantId)->where('p.status', 'reversed')->whereDate('re.entry_date', '<=', $to)
            ->when($visibleBranchIds !== null, fn ($q) => $visibleBranchIds === [] ? $q->whereRaw('1 = 0') : $q->whereIn('l.branch_id', $visibleBranchIds))
            ->sum('p.posted_cost_minor');

        return $postedNet - $reversedBeforeTo;
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $rows
     * @return array<string, mixed>
     */
    private function summarize(Collection $rows): array
    {
        $counts = ['matched' => 0, 'mismatch' => 0, 'warning' => 0, 'incomplete' => 0];
        foreach ($rows as $row) {
            $counts[$row['result']]++;
        }

        return ['total' => $rows->count(), 'matched' => $counts['matched'], 'confirmed_differences' => $counts['mismatch'], 'warnings' => $counts['warning'], 'incomplete' => $counts['incomplete']];
    }

    /**
     * @param  list<array{code: string, severity: string}>  $findings
     * @param  array<string, mixed>  $row
     */
    private function result(array $findings, array $row): string
    {
        $severities = array_column($findings, 'severity');
        if (in_array('error', $severities, true)) {
            return 'mismatch';
        }
        if (in_array('warning', $severities, true)) {
            return 'warning';
        }
        if ($row['posting_status'] === null) {
            return 'incomplete';
        }

        return 'matched';
    }

    private function iso(mixed $value): string
    {
        return \Carbon\CarbonImmutable::parse((string) $value, 'UTC')->toIso8601String();
    }

}

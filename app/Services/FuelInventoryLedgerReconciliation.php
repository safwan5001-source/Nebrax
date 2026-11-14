<?php

namespace App\Services;

use App\Models\Account;
use App\Models\AccountRoleMapping;
use App\Models\AccountRoleMappingEvent;
use App\Models\Branch;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\Warehouse;
use App\Support\AccountingRoles;
use App\Tenancy\TenantContext;
use Illuminate\Database\Query\Builder;
use Illuminate\Support\Facades\DB;

/**
 * TANKER-PR6B-0 — مطابقة **قراءة فقط** بين مجمّع تكلفة الوقود (`fuel_inventory_cost_states` + سجل حركاته) وكلٍّ من رصيد المخزون الرسمي (`product_warehouse_stock`) والأستاذ العام.
 * لا قفل ولا كتابة ولا تسوية ولا قيد ولا حركة مخزون؛ لا تعتمد على أي مسار ترحيل (يحرسها `FuelInventoryLedgerReconciliationTest` بحارس ساكن).
 *
 * ## المستوى ١ — الكمية (لكل مجمّع = مخزن × منتج وقود)
 * كمية المجمّع = رصيد المخزن الرسمي (الثابت المعتمد FS-03/FS-04). يُكشف أيضاً: مخزون بلا مجمّع، مجمّع بلا سجل رصيد، وانحراف الحالة عن **مجموع حركاتها** (قد تكون الحالة سبقت سجل الحركات).
 *
 * ## المستوى ٢ — القيمة مقابل الأستاذ (لكل فرع، لا لكل منتج)
 * الحساب 1140 يضم أصنافاً غير وقودية فلا يُقارَن رصيده كاملاً. **حصة الوقود** = Σ (مدين − دائن) على سطور حسابات المخزون في **القيود المميّزة (DISTINCT) المرتبطة بحركات التكلفة** (`journal_entry_id`)
 * + سطور القيود العكسية (`reversal_of`) لتلك القيود (أثرها الفعلي في الأستاذ)، بحالتَي `posted` و`reversed`. الربط عبر `IN (subquery)` فلا يُحسب قيدٌ مرتبط بعدة حركات إلا مرة واحدة.
 * لا لكل منتج لأن قيد الرصيد الافتتاحي قد يضم منتجات وفروعاً. الفرع = وسم السطر (`journal_lines.branch_id`) مقابل فرع مخزن المجمّع.
 *
 * ### تفسير الفرق بمتطابقة حسابية دقيقة (لا تقدير)
 * D = ledger − pool = E + Rv − Δunl − B حيث:
 *  - E: فرق مبلغ القيد عن مجموع حركاته المرتبطة (قيد لا يطابق ما سُجِّل في المجمّع)؛
 *  - Rv: أثر القيود العكسية (عُكس القيد في الأستاذ ولم يُعكس المجمّع)؛
 *  - Δunl: تغيّر قيمة المجمّع بحركات **بلا قيد** (صرف/إضافة لم تمرّ بالأستاذ)؛
 *  - B: انحراف قيمة الحالة عن مجموع حركاتها (رصيد حالة سبق السجل أو عُدِّل خارجه).
 * المكوّنات الأربعة تُحسب من السجلات مباشرةً، فالمتبقي غير المفسَّر = 0 بالتعريف؛ المعنى أنّ كل فرق يُنسب إلى سبب **مُثبَت**، لا أنّ الأسعار صحيحة.
 *
 * ## حساب المخزون بين الاستلام والبيع والتسوية (C-2)
 * الاستلام يستعمل دور `inventory_asset` فقط، بينما البيع والتسوية يستعملان `default_inventory_account_id` للمحطة ثم الدور. تعرض الخدمة: (أ) المحطات ذات التجاوز المختلف عن الدور، (ب) الحسابات التي
 * مسّتها فعلاً قيود كل نوع حركة. تجميع المطابقة يغطي **مجموعة** الحسابات (التعيين الحالي ∪ النظامي ∪ سجلّ التعيينات ∪ تجاوزات المحطات).
 *
 * ## حدود الدقة (تُعلن في `data_quality.not_checked`)
 * لا تثبت صحة الأسعار أو المتوسطات التاريخية؛ لا تكشف قيداً يدوياً على 1140 غير مرتبط بحركة وقود (خارج التعريف عمداً)؛ لا تفصل أسطراً غير وقودية داخل قيد مرتبط (قيود الوقود تحمل أسطر مخزون وقود فقط
 * في الكود الحالي)؛ فرع السطر مقابل فرع المخزن قد يختلف (يظهر في E)؛ وللمستخدم المقيَّد بمخزن/محطة لا تُعرض القيمة (الفرع يضم مخازن لا يراها) — الكمية فقط.
 */
class FuelInventoryLedgerReconciliation
{
    public const STATUS_CONSISTENT = 'consistent';
    public const STATUS_DIFFERENCES = 'differences';

    // رموز النتائج (findings).
    public const F_QUANTITY_MISMATCH = 'pool_quantity_mismatch';
    public const F_STOCK_WITHOUT_POOL = 'stock_without_cost_pool';
    public const F_POOL_WITHOUT_STOCK = 'cost_pool_without_stock_record';
    public const F_STATE_NOT_FROM_MOVEMENTS = 'state_not_derived_from_movements';
    public const F_OPEN_COST_HISTORY = 'open_cost_history';
    public const F_VALUE_DIFFERENCE = 'value_difference';
    public const F_ENTRY_AMOUNT_DIFFERS = 'entry_amount_differs_from_movements';
    public const F_MOVEMENTS_WITHOUT_JOURNAL = 'movements_without_journal';
    public const F_ACCOUNT_SPLIT_CONFIGURED = 'inventory_account_split_configured';
    public const F_ACCOUNT_SPLIT_IN_LEDGER = 'inventory_account_split_in_ledger';

    public const ENTRY_SAMPLE_LIMIT = 20;

    public function __construct(private TenantContext $tenant) {}

    /**
     * @param  list<string>|null  $visibleWarehouseIds  مخازن المراجع (null = غير مقيَّد)؛ الكمية تقتصر عليها
     * @param  list<string>|null  $visibleBranchIds  فروع المراجع (null = غير مقيَّد)؛ القيمة تقتصر عليها
     * @param  bool  $includeValues  صلاحية `products.view_cost`: بدونها لا تدخل أي قيمة مالية في الحمولة
     * @param  bool  $fullScope  المراجع غير مقيَّد بمخزن/محطة: شرط عرض القيمة (فرع كامل)
     * @return array<string, mixed>
     */
    public function reconcile(?array $visibleWarehouseIds = null, ?array $visibleBranchIds = null, bool $includeValues = false, bool $fullScope = true): array
    {
        $tenantId = (string) $this->tenant->id();
        $quantity = $this->quantityLevel($tenantId, $visibleWarehouseIds, $includeValues);
        $findings = $quantity['findings'];

        $value = null;
        $valueScope = 'hidden_no_cost_permission';
        $accountUsage = null;
        if ($includeValues && $fullScope) {
            $valueScope = 'tenant_by_branch';
            $set = $this->inventoryAccountSet($tenantId);
            $value = $this->valueLevel($tenantId, array_keys($set['accounts']), $visibleBranchIds);
            $accountUsage = $this->accountUsage($tenantId, $set, $visibleWarehouseIds);
            foreach ($value['findings'] as $finding) {
                $findings[] = $finding;
            }
            foreach ($accountUsage['findings'] as $finding) {
                $findings[] = $finding;
            }
            unset($value['findings'], $accountUsage['findings']);
        } elseif ($includeValues) {
            $valueScope = 'restricted_warehouse_scope';
        }

        $errors = count(array_filter($findings, fn (array $f) => $f['severity'] === 'error'));

        return [
            'read_only' => true,
            'status' => $errors === 0 && $findings === [] ? self::STATUS_CONSISTENT : self::STATUS_DIFFERENCES,
            'quantity' => ['pools' => $quantity['pools'], 'summary' => $quantity['summary']],
            'value_scope' => $valueScope,
            'value' => $value,
            'inventory_accounts' => $accountUsage,
            'findings' => $findings,
            'data_quality' => [
                'complete' => $valueScope === 'tenant_by_branch',
                'not_checked' => [
                    'price_and_average_correctness',
                    'manual_inventory_entries_not_linked_to_fuel_movements',
                    'non_fuel_lines_inside_linked_entries',
                    'tank_level_vs_book_stock',
                ],
            ],
        ];
    }

    // ───────────────────────── الكمية ─────────────────────────

    /** @return array{pools: list<array<string,mixed>>, summary: array<string,int>, findings: list<array<string,mixed>>} */
    private function quantityLevel(string $tenantId, ?array $visibleWarehouseIds, bool $includeValues): array
    {
        $states = DB::table('fuel_inventory_cost_states')->where('tenant_id', $tenantId)
            ->when($visibleWarehouseIds !== null, fn (Builder $q) => $q->whereIn('warehouse_id', $visibleWarehouseIds))
            ->get(['warehouse_id', 'fuel_product_id', 'quantity_milliliters', 'cost_pool_minor'])
            ->keyBy(fn ($r) => $r->warehouse_id . '|' . $r->fuel_product_id);

        $stationWarehouses = FuelStation::query()->whereNotNull('warehouse_id')
            ->when($visibleWarehouseIds !== null, fn ($q) => $q->whereIn('warehouse_id', $visibleWarehouseIds))->pluck('warehouse_id')->unique()->values()->all();
        $products = FuelProduct::query()->whereNotNull('product_id')->get(['id', 'product_id', 'name']);
        $productByCatalog = $products->keyBy('product_id');
        $stockRows = $stationWarehouses === [] || $products->isEmpty() ? collect() : DB::table('product_warehouse_stock')
            ->where('tenant_id', $tenantId)->whereIn('warehouse_id', $stationWarehouses)->whereIn('product_id', $products->pluck('product_id'))->whereNull('product_variant_id')
            ->get(['warehouse_id', 'product_id', 'quantity']);
        $stock = [];
        foreach ($stockRows as $row) {
            $fuelProduct = $productByCatalog->get($row->product_id);
            if ($fuelProduct !== null) {
                $stock[$row->warehouse_id . '|' . $fuelProduct->id] = (int) $row->quantity;
            }
        }

        $movementSums = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $tenantId)
            ->when($visibleWarehouseIds !== null, fn (Builder $q) => $q->whereIn('warehouse_id', $visibleWarehouseIds))
            ->groupBy('warehouse_id', 'fuel_product_id')
            ->selectRaw('warehouse_id, fuel_product_id, SUM(quantity_milliliters_after - quantity_milliliters_before) as qty_delta, SUM(cost_pool_minor_after - cost_pool_minor_before) as value_delta, COUNT(*) as movements')
            ->get()->keyBy(fn ($r) => $r->warehouse_id . '|' . $r->fuel_product_id);

        $openHistories = DB::table('fuel_cost_pool_open_histories')->where('tenant_id', $tenantId)->whereNull('resolved_at')
            ->when($visibleWarehouseIds !== null, fn (Builder $q) => $q->whereIn('warehouse_id', $visibleWarehouseIds))
            ->get(['warehouse_id', 'fuel_product_id'])->mapWithKeys(fn ($r) => [$r->warehouse_id . '|' . $r->fuel_product_id => true]);

        $keys = collect(array_keys($stock))->merge($states->keys())->unique()->sort()->values();
        $warehouses = Warehouse::query()->whereIn('id', $keys->map(fn ($k) => explode('|', $k)[0])->unique())->get()->keyBy('id');
        $productNames = $products->keyBy('id');

        $pools = [];
        $findings = [];
        $summary = ['pools' => 0, 'in_sync' => 0, 'mismatched' => 0, 'missing_pool' => 0, 'missing_stock_record' => 0, 'state_not_from_movements' => 0, 'open_cost_history' => 0];
        foreach ($keys as $key) {
            [$warehouseId, $productId] = explode('|', $key);
            $state = $states->get($key);
            $stockQty = $stock[$key] ?? null;
            $poolQty = $state === null ? null : (int) $state->quantity_milliliters;
            $sums = $movementSums->get($key);
            $poolFindings = [];

            if ($state === null && $stockQty !== null && $stockQty > 0) {
                $poolFindings[] = self::F_STOCK_WITHOUT_POOL;
                $summary['missing_pool']++;
            } elseif ($state !== null && $stockQty === null) {
                $poolFindings[] = self::F_POOL_WITHOUT_STOCK;
                $summary['missing_stock_record']++;
            } elseif ($state !== null && $poolQty !== $stockQty) {
                $poolFindings[] = self::F_QUANTITY_MISMATCH;
                $summary['mismatched']++;
            }
            $qtyDrift = $state === null ? 0 : $poolQty - (int) ($sums->qty_delta ?? 0);
            $valueDrift = $state === null ? 0 : (int) $state->cost_pool_minor - (int) ($sums->value_delta ?? 0);
            if ($state !== null && ($qtyDrift !== 0 || $valueDrift !== 0)) {
                $poolFindings[] = self::F_STATE_NOT_FROM_MOVEMENTS;
                $summary['state_not_from_movements']++;
            }
            if ($openHistories->has($key)) {
                $poolFindings[] = self::F_OPEN_COST_HISTORY;
                $summary['open_cost_history']++;
            }
            $summary['pools']++;
            if ($poolFindings === []) {
                $summary['in_sync']++;
            }

            $pool = [
                'warehouse_id' => $warehouseId,
                'warehouse_name' => $warehouses->get($warehouseId)?->name,
                'branch_id' => $warehouses->get($warehouseId)?->branch_id,
                'fuel_product_id' => $productId,
                'fuel_product_name' => $productNames->get($productId)?->name,
                'stock_milliliters' => $stockQty,
                'cost_pool_milliliters' => $poolQty,
                'quantity_difference_milliliters' => $poolQty === null || $stockQty === null ? null : $poolQty - $stockQty,
                'movements' => (int) ($sums->movements ?? 0),
                'state_vs_movements_quantity_milliliters' => $state === null ? null : $qtyDrift,
                'findings' => $poolFindings,
            ];
            if ($includeValues) {
                $pool['cost_pool_value_minor'] = $state === null ? null : (int) $state->cost_pool_minor;
                $pool['state_vs_movements_value_minor'] = $state === null ? null : $valueDrift;
            }
            $pools[] = $pool;
            foreach ($poolFindings as $code) {
                $findings[] = ['code' => $code, 'severity' => in_array($code, [self::F_QUANTITY_MISMATCH, self::F_STOCK_WITHOUT_POOL, self::F_POOL_WITHOUT_STOCK], true) ? 'error' : 'warning',
                    'warehouse_id' => $warehouseId, 'fuel_product_id' => $productId];
            }
        }

        return ['pools' => $pools, 'summary' => $summary, 'findings' => $findings];
    }

    // ───────────────────────── القيمة مقابل الأستاذ ─────────────────────────

    /**
     * مجموعة حسابات مخزون الوقود: دور `inventory_asset` (التعيين الحالي ∪ الحساب النظامي 1140 ∪ سجلّ التعيينات) ∪ تجاوزات المحطات.
     *
     * @return array{accounts: array<string, list<string>>, role_current: ?string}
     */
    public function inventoryAccountSet(?string $tenantId = null): array
    {
        $role = 'inventory_asset';
        $accounts = [];
        $add = function (?string $id, string $source) use (&$accounts): void {
            if ($id !== null && ! in_array($source, $accounts[$id] ?? [], true)) {
                $accounts[$id][] = $source;
            }
        };
        $current = AccountRoleMapping::query()->where('role_key', $role)->value('account_id');
        $add($current, 'role_current');
        $legacy = AccountingRoles::legacyCodeFor($role);
        $add($legacy === null ? null : Account::query()->where('code', $legacy)->value('id'), 'system_default');
        foreach (AccountRoleMappingEvent::query()->where('role_key', $role)->get(['previous_account_id', 'new_account_id']) as $event) {
            $add($event->previous_account_id, 'history');
            $add($event->new_account_id, 'history');
        }
        foreach (FuelStation::query()->whereNotNull('default_inventory_account_id')->pluck('default_inventory_account_id') as $id) {
            $add($id, 'station_override');
        }
        $existing = Account::query()->whereIn('id', array_keys($accounts))->pluck('id')->all();

        return ['accounts' => array_intersect_key($accounts, array_flip($existing)), 'role_current' => $current];
    }

    /**
     * @param  list<string>  $accountIds
     * @param  list<string>|null  $visibleBranchIds
     * @return array<string, mixed>
     */
    private function valueLevel(string $tenantId, array $accountIds, ?array $visibleBranchIds): array
    {
        $none = '∅';
        // قيود وقود مرتبطة بحركات التكلفة (IN على استعلام فرعي ⇒ كل قيد مرة واحدة مهما تعدّدت حركاته) وقيودها العكسية.
        $linked = fn () => DB::table('fuel_inventory_cost_movements')->where('tenant_id', $tenantId)->whereNotNull('journal_entry_id')->select('journal_entry_id');
        $reversals = fn () => DB::table('journal_entries as r')->where('r.tenant_id', $tenantId)->whereIn('r.reversal_of', $linked())->select('r.id');

        $lines = function (callable $entries) use ($tenantId, $accountIds) {
            return DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
                ->where('e.tenant_id', $tenantId)->whereIn('e.status', ['posted', 'reversed'])
                ->whereIn('l.account_id', $accountIds === [] ? [''] : $accountIds)
                ->whereIn('e.id', $entries());
        };
        $byBranch = fn (Builder $q) => $q->groupBy('l.branch_id')->selectRaw('l.branch_id as branch_id, SUM(l.debit) as d, SUM(l.credit) as c')->get()
            ->mapWithKeys(fn ($r) => [$r->branch_id ?? $none => (int) $r->d - (int) $r->c])->all();

        $linkedNet = $byBranch($lines($linked));
        $reversalNet = $byBranch($lines($reversals));

        // حركات التكلفة والحالات لكل فرع مخزن.
        $movementRows = DB::table('fuel_inventory_cost_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->where('m.tenant_id', $tenantId)
            ->groupBy('w.branch_id')
            ->selectRaw('w.branch_id as branch_id,
                SUM(CASE WHEN m.journal_entry_id IS NULL THEN 0 ELSE m.cost_pool_minor_after - m.cost_pool_minor_before END) as linked_delta,
                SUM(CASE WHEN m.journal_entry_id IS NULL THEN m.cost_pool_minor_after - m.cost_pool_minor_before ELSE 0 END) as unlinked_delta,
                SUM(CASE WHEN m.journal_entry_id IS NULL THEN 1 ELSE 0 END) as unlinked_count')->get();
        $linkedDelta = $unlinkedDelta = $unlinkedCount = [];
        foreach ($movementRows as $row) {
            $key = $row->branch_id ?? $none;
            $linkedDelta[$key] = (int) $row->linked_delta;
            $unlinkedDelta[$key] = (int) $row->unlinked_delta;
            $unlinkedCount[$key] = (int) $row->unlinked_count;
        }
        $poolValue = DB::table('fuel_inventory_cost_states as s')->join('warehouses as w', 'w.id', '=', 's.warehouse_id')->where('s.tenant_id', $tenantId)
            ->groupBy('w.branch_id')->selectRaw('w.branch_id as branch_id, SUM(s.cost_pool_minor) as pool')->get()
            ->mapWithKeys(fn ($r) => [$r->branch_id ?? $none => (int) $r->pool])->all();
        $deltaAll = DB::table('fuel_inventory_cost_movements as m')->join('warehouses as w', 'w.id', '=', 'm.warehouse_id')->where('m.tenant_id', $tenantId)
            ->groupBy('w.branch_id')->selectRaw('w.branch_id as branch_id, SUM(m.cost_pool_minor_after - m.cost_pool_minor_before) as delta')->get()
            ->mapWithKeys(fn ($r) => [$r->branch_id ?? $none => (int) $r->delta])->all();

        $keys = collect([...array_keys($linkedNet), ...array_keys($reversalNet), ...array_keys($poolValue), ...array_keys($deltaAll)])->unique()->values();
        $branchNames = Branch::query()->whereIn('id', $keys->reject(fn ($k) => $k === $none))->pluck('name', 'id');

        $branches = [];
        $findings = [];
        $total = ['pool_value_minor' => 0, 'ledger_share_minor' => 0, 'difference_minor' => 0];
        foreach ($keys as $key) {
            if ($visibleBranchIds !== null && ($key === $none || ! in_array($key, $visibleBranchIds, true))) {
                continue;
            }
            $pool = $poolValue[$key] ?? 0;
            $ledger = ($linkedNet[$key] ?? 0) + ($reversalNet[$key] ?? 0);
            $difference = $ledger - $pool;
            $e = ($linkedNet[$key] ?? 0) - ($linkedDelta[$key] ?? 0);
            $rv = $reversalNet[$key] ?? 0;
            $unl = $unlinkedDelta[$key] ?? 0;
            $drift = $pool - ($deltaAll[$key] ?? 0);
            $row = [
                'branch_id' => $key === $none ? null : $key,
                'branch_name' => $key === $none ? null : ($branchNames[$key] ?? null),
                'pool_value_minor' => $pool,
                'ledger_share_minor' => $ledger,
                'difference_minor' => $difference,
                'in_sync' => $difference === 0,
                // D = E + Rv − Δunl − B (متطابقة دقيقة: المتبقي صفر بالتعريف).
                'causes' => [
                    'entry_amount_differs_minor' => $e,
                    'reversed_entries_minor' => $rv,
                    'movements_without_journal_minor' => -$unl,
                    'state_vs_movements_minor' => -$drift,
                ],
                'unexplained_minor' => $difference - ($e + $rv - $unl - $drift),
                'movements_without_journal_count' => $unlinkedCount[$key] ?? 0,
            ];
            $branches[] = $row;
            $total['pool_value_minor'] += $pool;
            $total['ledger_share_minor'] += $ledger;
            $total['difference_minor'] += $difference;
            if ($difference !== 0) {
                $findings[] = ['code' => self::F_VALUE_DIFFERENCE, 'severity' => 'error', 'branch_id' => $row['branch_id'], 'difference_minor' => $difference];
            }
            if (($unlinkedCount[$key] ?? 0) > 0) {
                $findings[] = ['code' => self::F_MOVEMENTS_WITHOUT_JOURNAL, 'severity' => 'warning', 'branch_id' => $row['branch_id'], 'count' => $unlinkedCount[$key]];
            }
        }

        $entries = $this->entriesWithAmountDifference($tenantId, $accountIds);
        if ($entries['total'] > 0) {
            $findings[] = ['code' => self::F_ENTRY_AMOUNT_DIFFERS, 'severity' => 'error', 'count' => $entries['total']];
        }

        return [
            'branches' => $branches,
            'total' => $total,
            'entries_with_amount_difference' => $entries,
            'findings' => $findings,
        ];
    }

    /**
     * قيود مرتبطة بحركات تكلفة لا يطابق صافي أسطر المخزون فيها مجموع تغيّرات قيمة حركاتها (عيّنة محدودة + العدد الكلي).
     *
     * @param  list<string>  $accountIds
     * @return array{total: int, sample: list<array<string,mixed>>}
     */
    private function entriesWithAmountDifference(string $tenantId, array $accountIds): array
    {
        $movements = DB::table('fuel_inventory_cost_movements')->where('tenant_id', $tenantId)->whereNotNull('journal_entry_id')->groupBy('journal_entry_id')
            ->selectRaw('journal_entry_id as entry_id, SUM(cost_pool_minor_after - cost_pool_minor_before) as movement_delta, COUNT(*) as movements');
        $net = DB::table('journal_lines as l')->where('l.tenant_id', $tenantId)->whereIn('l.account_id', $accountIds === [] ? [''] : $accountIds)->groupBy('l.journal_entry_id')
            ->selectRaw('l.journal_entry_id as entry_id, SUM(l.debit - l.credit) as ledger_net');
        $query = fn () => DB::query()->fromSub($movements, 'm')->leftJoinSub($net, 'n', 'n.entry_id', '=', 'm.entry_id')
            ->join('journal_entries as e', 'e.id', '=', 'm.entry_id')->whereIn('e.status', ['posted', 'reversed'])
            ->whereRaw('m.movement_delta <> COALESCE(n.ledger_net, 0)');

        $total = (int) $query()->count();
        $sample = $query()->orderBy('e.entry_date')->orderBy('e.number')->limit(self::ENTRY_SAMPLE_LIMIT)
            ->get(['m.entry_id', 'e.number', 'e.entry_date', 'e.source_type', 'm.movements', 'm.movement_delta', 'n.ledger_net'])
            ->map(fn ($r) => [
                'journal_entry_id' => $r->entry_id, 'number' => $r->number, 'entry_date' => (string) $r->entry_date, 'source' => class_basename((string) $r->source_type),
                'movements' => (int) $r->movements, 'movement_delta_minor' => (int) $r->movement_delta, 'ledger_net_minor' => (int) ($r->ledger_net ?? 0),
                'difference_minor' => (int) ($r->ledger_net ?? 0) - (int) $r->movement_delta,
            ])->all();

        return ['total' => $total, 'sample' => $sample];
    }

    // ───────────────────────── C-2: حساب المخزون ─────────────────────────

    /**
     * @param  array{accounts: array<string, list<string>>, role_current: ?string}  $set
     * @return array<string, mixed>
     */
    private function accountUsage(string $tenantId, array $set, ?array $visibleWarehouseIds): array
    {
        $accountIds = array_keys($set['accounts']);
        $names = Account::query()->whereIn('id', $accountIds)->get(['id', 'code', 'name'])->keyBy('id');
        $findings = [];

        $overrides = FuelStation::query()->whereNotNull('default_inventory_account_id')
            ->when($visibleWarehouseIds !== null, fn ($q) => $q->whereIn('warehouse_id', $visibleWarehouseIds))->get(['id', 'name', 'default_inventory_account_id'])
            ->filter(fn (FuelStation $s) => $set['role_current'] === null || $s->default_inventory_account_id !== $set['role_current'])
            ->map(fn (FuelStation $s) => ['station_id' => $s->id, 'station_name' => $s->name, 'account_id' => $s->default_inventory_account_id,
                'account_code' => $names->get($s->default_inventory_account_id)?->code])->values()->all();
        if ($overrides !== []) {
            $findings[] = ['code' => self::F_ACCOUNT_SPLIT_CONFIGURED, 'severity' => 'warning', 'stations' => count($overrides)];
        }

        // الحسابات التي مسّتها فعلاً قيود كل نوع حركة (عدد القيود المميّزة لكل (نوع، حساب) — لا مبالغ لأن القيد قد يرتبط بعدة حركات).
        $rows = $accountIds === [] ? collect() : DB::table('journal_lines as l')->join('journal_entries as e', 'e.id', '=', 'l.journal_entry_id')
            ->join('fuel_inventory_cost_movements as m', 'm.journal_entry_id', '=', 'e.id')
            ->where('e.tenant_id', $tenantId)->whereIn('e.status', ['posted', 'reversed'])->whereIn('l.account_id', $accountIds)
            ->groupBy('m.movement_type', 'l.account_id')->selectRaw('m.movement_type as movement_type, l.account_id as account_id, COUNT(DISTINCT e.id) as entries')->get();
        $byType = [];
        foreach ($rows as $row) {
            $byType[$row->movement_type][$row->account_id] = (int) $row->entries;
        }
        $receiptAccounts = array_keys($byType['receipt'] ?? []);
        $otherAccounts = array_values(array_unique([...array_keys($byType['issue'] ?? []), ...array_keys($byType['adjustment'] ?? [])]));
        sort($receiptAccounts);
        sort($otherAccounts);
        $splitInLedger = $receiptAccounts !== [] && $otherAccounts !== [] && $receiptAccounts !== $otherAccounts;
        if ($splitInLedger) {
            $findings[] = ['code' => self::F_ACCOUNT_SPLIT_IN_LEDGER, 'severity' => 'warning'];
        }

        return [
            'accounts' => collect($set['accounts'])->map(fn (array $sources, string $id) => ['account_id' => $id, 'code' => $names->get($id)?->code, 'name' => $names->get($id)?->name, 'sources' => $sources])->values()->all(),
            'station_overrides' => $overrides,
            'entries_by_movement_type' => collect($byType)->map(fn (array $accounts) => collect($accounts)->map(fn (int $entries, string $id) => ['account_id' => $id, 'code' => $names->get($id)?->code, 'entries' => $entries])->values()->all())->all(),
            'split_in_ledger' => $splitInLedger,
            'findings' => $findings,
        ];
    }
}

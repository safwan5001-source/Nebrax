<?php

namespace App\Services;

use App\Models\AccountingPeriodLock;
use App\Models\FiscalYear;
use App\Models\FuelInventoryCostState;
use App\Models\FuelProduct;
use App\Models\FuelStation;
use App\Models\FuelTankerFill;
use App\Models\ProductWarehouseStock;
use App\Models\Warehouse;
use Carbon\CarbonInterface;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * TANKER-PR6A — تقييم **جاهزية** السندات المعلّقة (`pending_integration`) للدمج المخزني المستقبلي. **قراءة فقط بالكامل** (لا قفل، لا إنشاء حالة تكلفة، لا كتابة، لا حركة، لا قيد).
 *
 * الترحيل نفسه غير مبني (توجيه مرحلي لا قرار محاسبي نهائي: «لا خصم الآن»؛ PR-6B بعد اعتماد المعالجة المحاسبية) ⇒ `POSTING_ENABLED = false` ثابتاً لا إعداداً. هذه الخدمة تجيب فقط:
 * «لو فُعِّل الترحيل اليوم، هل تتوفر شروطه، وما الذي يمنعه أو يحتاج مراجعة بشرية؟» دون أن تدّعي أن السند صُرف.
 *
 * التصنيف (`readiness`): `blocked` (مانع صريح بكود ثابت) ‹ `needs_review` (سبب مراجعة: تجاوز سعة مؤكَّد، رصيد غير كافٍ بسياسة `hold_for_review`، أو سند متأخر) ‹ `ready`؛
 * و`not_applicable` للسند الملغى. مصدر الحقيقة للرصيد: `product_warehouse_stock` (مخزن المحطة × منتج الوقود) — الرصيد الرسمي نفسه الذي يخصمه بيع الوقود المباشر.
 *
 * الرصيد غير الكافي تراكمي: السندات المعلّقة في المجمّع نفسه (مخزن × منتج) تُرتَّب بوقت التسجيل ويُقارَن مجموعها التراكمي (حتى السند نفسه) بالرصيد الحالي، فلا يظهر سندان
 * «جاهزين» وكلاهما معاً يتجاوز الرصيد. لا يُعدَّل رصيد ولا يُسوّى فرق صامتاً.
 *
 * متطلبات المطابقة (تُعرض ولا تُنفَّذ): كمية مجمّع التكلفة = رصيد المخزن؛ قيمة المجمّع = حصة الوقود في حساب 1140 (لا تُحسب هنا لأن 1140 يضم مخزوناً غير وقودي — `ledger_1140: not_checked`).
 */
class FuelTankerFillInventoryReadiness
{
    /** الترحيل المخزني غير مفعَّل في هذه الشريحة (ثابت لا إعداد): يتغيّر فقط بشريحة PR-6B بعد الاعتماد. */
    public const POSTING_ENABLED = false;

    public const READY = 'ready';
    public const NEEDS_REVIEW = 'needs_review';
    public const BLOCKED = 'blocked';
    public const NOT_APPLICABLE = 'not_applicable';

    // موانع (تمنع الترحيل المستقبلي حتى تُعالَج).
    public const B_STATION_NOT_ACTIVE = 'station_not_active';
    public const B_WAREHOUSE_REQUIRED = 'station_warehouse_required';
    public const B_WAREHOUSE_UNAVAILABLE = 'warehouse_unavailable';
    public const B_WAREHOUSE_BRANCH_MISMATCH = 'warehouse_branch_mismatch';
    public const B_PRODUCT_UNAVAILABLE = 'fuel_product_unavailable';
    public const B_STOCK_RECORD_MISSING = 'stock_record_missing';
    public const B_COST_BASELINE_REQUIRED = 'cost_baseline_required';
    public const B_COST_HISTORY_OPEN = 'cost_history_open';
    public const B_COST_POOL_MISMATCH = 'cost_pool_quantity_mismatch';
    public const B_INSUFFICIENT_BALANCE = 'insufficient_balance';
    // TANKER-PR6B-0: موانع إضافية (قراءة فقط، تُحسب بلا أي قفل مِرساة).
    public const B_PERIOD_LOCKED = 'period_locked';
    public const B_SETTLEMENT_MODE_CONFLICT = 'settlement_mode_conflict';
    public const B_CLEARING_ACCOUNT_MISSING = 'clearing_account_missing';
    // TANKER-PR6B-1: الحساب الوسيط معيَّن لكن لم يعد صالحاً (معطَّل/تجميعي/صار حساب مخزون أو نقد أو ضريبة أو دوراً آخر…).
    public const B_CLEARING_ACCOUNT_INVALID = 'clearing_account_invalid';

    // أسباب مراجعة (لا تمنع، تحتاج نظرة بشرية).
    public const R_CAPACITY_OVERRUN = 'capacity_overrun';
    public const R_INSUFFICIENT_BALANCE = 'insufficient_balance';
    public const R_OVERDUE = 'overdue';

    /** @var list<string> متطلبات المطابقة المعلنة للمشغّل (لا تُنفَّذ هنا). */
    public const RECONCILIATION_REQUIREMENTS = ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140'];

    public function __construct(private FuelStationSettingsService $settings) {}

    /**
     * @param  Collection<int, FuelTankerFill>  $fills
     * @param  list<string>|null  $visibleStationIds  محطات المراجع (null = غير مقيَّد). **التصنيف** يعدّ كل سندات المخزن المشترك (الرصيد واحد)، أما **ما يُعرض**
     *                                                  (التراكمي والمجاميع والعجز) فيقتصر على محطاته فلا يكشف نشاط محطة أخرى تشاركه المخزن؛ ويُعلَن فقط أن الرصيد مشترك.
     * @return array{items: array<string, array<string, mixed>>, pools: list<array<string, mixed>>}
     */
    public function evaluate(Collection $fills, bool $includeCost = false, ?CarbonInterface $now = null, ?array $visibleStationIds = null): array
    {
        $now ??= now();
        $items = [];
        $active = $fills->filter(fn (FuelTankerFill $fill) => $fill->status === FuelTankerFill::STATUS_RECORDED && $fill->inventory_status === FuelTankerFill::INVENTORY_PENDING_INTEGRATION);
        foreach ($fills->diff($active) as $fill) {
            $items[$fill->id] = $this->item(self::NOT_APPLICABLE, [], [], false, 0, null);
        }
        if ($active->isEmpty()) {
            return ['items' => $items, 'pools' => []];
        }

        $stations = FuelStation::query()->whereIn('id', $active->pluck('fuel_station_id')->unique())->get()->keyBy('id');
        $products = FuelProduct::query()->whereIn('id', $active->pluck('fuel_product_id')->unique())->get()->keyBy('id');
        $warehouseIds = $stations->pluck('warehouse_id')->filter()->unique()->values();
        $warehouses = Warehouse::query()->whereIn('id', $warehouseIds)->get()->keyBy('id');

        // رصيد المخزن الرسمي (بلا متغيّر) + حالة التكلفة + التاريخ المفتوح، دفعة واحدة لكل المجمّعات.
        $productIds = $products->pluck('product_id')->filter()->unique()->values();
        $stock = ProductWarehouseStock::query()->whereIn('warehouse_id', $warehouseIds)->whereIn('product_id', $productIds)->whereNull('product_variant_id')->get()
            ->keyBy(fn (ProductWarehouseStock $row) => $row->warehouse_id . '|' . $row->product_id);
        $costStates = FuelInventoryCostState::query()->whereIn('warehouse_id', $warehouseIds)->whereIn('fuel_product_id', $products->keys())->get()
            ->keyBy(fn (FuelInventoryCostState $row) => $row->warehouse_id . '|' . $row->fuel_product_id);
        $tenantId = (string) $active->first()->tenant_id;
        $openHistories = DB::table('fuel_cost_pool_open_histories')->where('tenant_id', $tenantId)->whereIn('warehouse_id', $warehouseIds)->whereNull('resolved_at')
            ->get(['warehouse_id', 'fuel_product_id'])->mapWithKeys(fn ($row) => [$row->warehouse_id . '|' . $row->fuel_product_id => true]);

        // التراكمي والمجاميع تُحسب في قاعدة البيانات (نافذة `SUM … OVER` وتجميع) لا بتحميل كل السندات المعلّقة إلى الذاكرة: الأرشيف المعلّق ينمو بلا سقف في هذه المرحلة
        // (لا ترحيل)، فلا يتناسب استهلاك الذاكرة مع حجمه. يُرجَع فقط تراكمي السندات المُقيَّمة (≤ سقف المتحكّم) ومجموع كل مجمّع.
        $cumulative = $this->cumulativeByFill($tenantId, $active->pluck('id')->all(), $warehouseIds->all());
        $poolTotalsAll = $this->poolTotals($tenantId, $warehouseIds->all());
        // المعروض: محطات المراجع وحدها (يطابق الكل حين لا قيد).
        $visibleCumulative = $visibleStationIds === null ? $cumulative : $this->cumulativeByFill($tenantId, $active->pluck('id')->all(), $warehouseIds->all(), $visibleStationIds);
        $poolTotals = $visibleStationIds === null ? $poolTotalsAll : $this->poolTotals($tenantId, $warehouseIds->all(), $visibleStationIds);

        $policies = [];
        $stationModes = [];
        $postingConfigs = [];
        $closedPeriods = null;
        $pools = [];
        foreach ($active as $fill) {
            /** @var FuelStation|null $station */
            $station = $stations->get($fill->fuel_station_id);
            $product = $products->get($fill->fuel_product_id);
            $warehouse = $station?->warehouse_id === null ? null : $warehouses->get($station->warehouse_id);
            $policy = $station === null ? ['insufficient_policy' => 'block', 'review_after_hours' => 24] : ($policies[$station->id] ??= $this->settings->tankerInventoryPolicy($station));

            $blockers = [];
            $reasons = [];
            $poolInfo = null;

            if ($station === null || $station->status !== FuelStation::STATUS_ACTIVE) {
                $blockers[] = self::B_STATION_NOT_ACTIVE;
            }
            if ($station !== null && $station->warehouse_id === null) {
                $blockers[] = self::B_WAREHOUSE_REQUIRED;
            } elseif ($station !== null && ($warehouse === null || ! $warehouse->is_active)) {
                $blockers[] = self::B_WAREHOUSE_UNAVAILABLE;
            } elseif ($station !== null && $warehouse !== null && $warehouse->branch_id !== $station->branch_id) {
                $blockers[] = self::B_WAREHOUSE_BRANCH_MISMATCH;
            }
            if ($product === null || ! $product->is_active || $product->product_id === null) {
                $blockers[] = self::B_PRODUCT_UNAVAILABLE;
            }

            if ($warehouse !== null && $product !== null && $product->product_id !== null) {
                $key = $warehouse->id . '|' . $product->product_id;
                $costKey = $warehouse->id . '|' . $product->id;
                $row = $stock->get($key);
                $state = $costStates->get($costKey);
                $available = $row === null ? 0 : (int) $row->quantity;
                $cumulativeQuantity = (int) ($cumulative[$fill->id] ?? $fill->quantity_milliliters);

                if ($row === null) {
                    $blockers[] = self::B_STOCK_RECORD_MISSING;
                } elseif ($state === null && $available > 0) {
                    $blockers[] = self::B_COST_BASELINE_REQUIRED;
                } elseif ($state !== null && (int) $state->quantity_milliliters !== $available) {
                    $blockers[] = self::B_COST_POOL_MISMATCH;
                }
                if ($openHistories->has($costKey)) {
                    $blockers[] = self::B_COST_HISTORY_OPEN;
                }
                if ($row !== null && $cumulativeQuantity > $available) {
                    $policy['insufficient_policy'] === 'hold_for_review' ? $reasons[] = self::R_INSUFFICIENT_BALANCE : $blockers[] = self::B_INSUFFICIENT_BALANCE;
                }

                $poolInfo = ['warehouse_id' => $warehouse->id, 'fuel_product_id' => $product->id, 'available_milliliters' => $available, 'cumulative_milliliters' => (int) ($visibleCumulative[$fill->id] ?? $fill->quantity_milliliters)];
                $pools[$key] ??= $this->poolSummary($warehouse, $product, $row, $state, $poolTotals[$key] ?? ['count' => 0, 'total' => 0], ($poolTotalsAll[$key]['count'] ?? 0) > ($poolTotals[$key]['count'] ?? 0), $includeCost);
            }

            // PR-6B-0 — C-1: تسوية الوردية من العدادات (`post_on_close`) تصرف كل لترات الفوهة ومنها تعبئات الصهاريج؛ ترحيل التعبئة معها يخصم مرتين.
            // **فشل مغلق**: الوضع المخزَّن وحده كافٍ (حتى لو أُغلقت بوابات التسوية لاحقاً) — لا يُفترض أنها لن تعمل.
            if ($station !== null && ($stationModes[$station->id] ??= $this->settings->get($station, 'shift_settlement_mode')) === FuelShiftSettlementReadiness::MODE_POST_ON_CLOSE) {
                $blockers[] = self::B_SETTLEMENT_MODE_CONFLICT;
            }
            // الحساب الوسيط (PR-6B-1): بلا بديل ولا تعيين تلقائي ولا إنشاء — غيابه مانع `clearing_account_missing`، وتعيين لم يعد صالحاً مانع `clearing_account_invalid`.
            // بدء الترحيل (`tanker_inventory_posting_start_at`): فارغ أو لاحق لتسجيل السند ⇒ سند **تاريخي** (وسم عرض فقط؛ لا يمنع ولا يرحّل، والترحيل المنفرد للتاريخي بصلاحيته لاحقاً).
            $config = $station === null ? null : ($postingConfigs[$station->id] ??= $this->settings->tankerInventoryPostingConfig($station));
            if ($config !== null && ! $config['clearing_account']['configured']) {
                $blockers[] = self::B_CLEARING_ACCOUNT_MISSING;
            } elseif ($config !== null && ! $config['clearing_account']['valid']) {
                $blockers[] = self::B_CLEARING_ACCOUNT_INVALID;
            }
            $historical = $config === null || $config['posting_start_at'] === null || $fill->recorded_at === null || $fill->recorded_at->lt(\Carbon\CarbonImmutable::parse($config['posting_start_at']));
            // الفترة المحاسبية/السنة المالية المقفلة لتاريخ التعبئة بتوقيت المحطة: يُرفض الترحيل لاحقاً ولا يُنقل صامتاً إلى اليوم (D-6B-8).
            if ($station !== null && $fill->recorded_at !== null && $this->periodLockedFor($closedPeriods ??= $this->closedPeriods($tenantId), $this->settings->businessDate($station, $fill->recorded_at))) {
                $blockers[] = self::B_PERIOD_LOCKED;
            }

            if ($fill->capacity_overrun_milliliters !== null) {
                $reasons[] = self::R_CAPACITY_OVERRUN;
            }
            $ageHours = (int) max(0, $fill->recorded_at?->diffInHours($now, true) ?? 0);
            $overdue = $ageHours >= $policy['review_after_hours'];
            if ($overdue) {
                $reasons[] = self::R_OVERDUE;
            }

            $items[$fill->id] = $this->item(
                $blockers !== [] ? self::BLOCKED : ($reasons !== [] ? self::NEEDS_REVIEW : self::READY),
                array_values(array_unique($blockers)),
                array_values(array_unique($reasons)),
                $overdue,
                $ageHours,
                $poolInfo,
                $historical,
            );
        }

        return ['items' => $items, 'pools' => array_values($pools)];
    }

    /**
     * الأقفال النشطة والسنوات المقفلة للمستأجر **قراءة عادية بلا قفل مِرساة** (قراءة `AccountingDateGuard::activeLockFor` تقفل صف المستأجر فلا تصلح لمسار قراءة).
     * المحمولان نفسهما: قفل فترة `active` وسنة `closed` تشمل التاريخ (حدّان شاملان). يُحمَّلان مرة واحدة لكل تقييم.
     *
     * @return array{locks: list<array{0:string,1:string}>, years: list<array{0:string,1:string}>}
     */
    private function closedPeriods(string $tenantId): array
    {
        $range = fn ($row) => [$row->start_date->toDateString(), $row->end_date->toDateString()];

        return [
            'locks' => AccountingPeriodLock::query()->where('tenant_id', $tenantId)->where('status', 'active')->get(['start_date', 'end_date'])->map($range)->all(),
            'years' => FiscalYear::query()->where('tenant_id', $tenantId)->where('status', FiscalYear::STATUS_CLOSED)->get(['start_date', 'end_date'])->map($range)->all(),
        ];
    }

    /** @param array{locks: list<array{0:string,1:string}>, years: list<array{0:string,1:string}>} $periods */
    private function periodLockedFor(array $periods, string $date): bool
    {
        foreach ([...$periods['locks'], ...$periods['years']] as [$from, $to]) {
            if ($date >= $from && $date <= $to) {
                return true;
            }
        }

        return false;
    }

    /**
     * ملخص الجاهزية للمحطات المتاحة (قراءة خفيفة للوحة): أعداد التصنيفات فقط.
     *
     * @param  array<string, array<string, mixed>>  $items
     * @return array{total: int, ready: int, needs_review: int, blocked: int, overdue: int}
     */
    public static function summarize(array $items): array
    {
        $counts = ['total' => 0, self::READY => 0, self::NEEDS_REVIEW => 0, self::BLOCKED => 0, 'overdue' => 0];
        foreach ($items as $item) {
            if ($item['readiness'] === self::NOT_APPLICABLE) {
                continue;
            }
            $counts['total']++;
            $counts[$item['readiness']]++;
            $counts['overdue'] += $item['overdue'] ? 1 : 0;
        }

        return $counts;
    }

    /**
     * @param  list<string>  $blockers
     * @param  list<string>  $reasons
     * @param  array<string, mixed>|null  $pool
     * @return array<string, mixed>
     */
    private function item(string $readiness, array $blockers, array $reasons, bool $overdue, int $ageHours, ?array $pool, bool $historical = true): array
    {
        return ['readiness' => $readiness, 'blockers' => $blockers, 'review_reasons' => $reasons, 'overdue' => $overdue, 'age_hours' => $ageHours, 'pool' => $pool, 'historical' => $historical];
    }

    /**
     * @param  array{count: int, total: int}  $pending  عدد ومجموع السندات المعلّقة في المجمّع لمحطات المراجع (مجمَّعة في القاعدة)
     * @param  bool  $shared  توجد سندات معلّقة لمحطات أخرى في المخزن نفسه (يُعلَن وجودها فقط، لا كمياتها)
     * @return array<string, mixed>
     */
    private function poolSummary(Warehouse $warehouse, FuelProduct $product, ?ProductWarehouseStock $stock, ?FuelInventoryCostState $state, array $pending, bool $shared, bool $includeCost): array
    {
        $available = $stock === null ? null : (int) $stock->quantity;
        $pendingTotal = $pending['total'];
        $summary = [
            'warehouse_id' => $warehouse->id,
            'warehouse_name' => $warehouse->name,
            'fuel_product_id' => $product->id,
            'fuel_product_name' => $product->name,
            'stock_milliliters' => $available,
            'cost_pool_milliliters' => $state === null ? null : (int) $state->quantity_milliliters,
            'quantity_in_sync' => $state === null || $available === null ? null : (int) $state->quantity_milliliters === $available,
            'pending_count' => $pending['count'],
            'pending_total_milliliters' => $pendingTotal,
            'shortfall_milliliters' => $available === null ? null : max(0, $pendingTotal - $available),
            'shared_with_other_stations' => $shared,
            'ledger_1140' => 'not_checked',
        ];
        if ($includeCost) {
            $summary['cost_pool_value_minor'] = $state === null ? null : (int) $state->cost_pool_minor;
        }

        return $summary;
    }

    /**
     * التراكمي لكل سند مُقيَّم داخل مجمّعه (مخزن × منتج) بترتيب (وقت التسجيل، المعرّف) — نافذة SQL واحدة، لا تحميل للأرشيف المعلّق.
     *
     * @param  list<string>  $fillIds
     * @param  list<string>  $warehouseIds
     * @param  list<string>|null  $onlyStations  يقصر العدّ على هذه المحطات (للعرض المقيَّد)؛ null = كل محطات المخزن (للتصنيف)
     * @return array<string, int>
     */
    private function cumulativeByFill(string $tenantId, array $fillIds, array $warehouseIds, ?array $onlyStations = null): array
    {
        if ($fillIds === [] || $warehouseIds === []) {
            return [];
        }
        $windowed = DB::table('fuel_tanker_fills as f')
            ->join('fuel_stations as s', 's.id', '=', 'f.fuel_station_id')
            ->join('fuel_products as p', 'p.id', '=', 'f.fuel_product_id')
            ->where('f.tenant_id', $tenantId)
            ->where('f.status', FuelTankerFill::STATUS_RECORDED)->where('f.inventory_status', FuelTankerFill::INVENTORY_PENDING_INTEGRATION)
            ->whereIn('s.warehouse_id', $warehouseIds)
            ->when($onlyStations !== null, fn ($q) => $q->whereIn('f.fuel_station_id', $onlyStations))
            ->selectRaw('f.id as id, SUM(f.quantity_milliliters) OVER (PARTITION BY s.warehouse_id, p.product_id ORDER BY f.recorded_at, f.id) as cumulative');

        $rows = [];
        foreach (array_chunk($fillIds, 400) as $chunk) {
            foreach (DB::query()->fromSub($windowed, 't')->whereIn('t.id', $chunk)->get(['t.id', 't.cumulative']) as $row) {
                $rows[(string) $row->id] = (int) $row->cumulative;
            }
        }

        return $rows;
    }

    /**
     * عدد ومجموع السندات المعلّقة لكل مجمّع (مفتاح `warehouse|product`) — تجميع في القاعدة.
     *
     * @param  list<string>  $warehouseIds
     * @param  list<string>|null  $onlyStations
     * @return array<string, array{count: int, total: int}>
     */
    private function poolTotals(string $tenantId, array $warehouseIds, ?array $onlyStations = null): array
    {
        if ($warehouseIds === []) {
            return [];
        }
        $totals = [];
        $rows = DB::table('fuel_tanker_fills as f')
            ->join('fuel_stations as s', 's.id', '=', 'f.fuel_station_id')
            ->join('fuel_products as p', 'p.id', '=', 'f.fuel_product_id')
            ->where('f.tenant_id', $tenantId)
            ->where('f.status', FuelTankerFill::STATUS_RECORDED)->where('f.inventory_status', FuelTankerFill::INVENTORY_PENDING_INTEGRATION)
            ->whereIn('s.warehouse_id', $warehouseIds)
            ->when($onlyStations !== null, fn ($q) => $q->whereIn('f.fuel_station_id', $onlyStations))
            ->groupBy('s.warehouse_id', 'p.product_id')
            ->selectRaw('s.warehouse_id as warehouse_id, p.product_id as product_id, COUNT(*) as pending_count, SUM(f.quantity_milliliters) as pending_total')
            ->get();
        foreach ($rows as $row) {
            $totals[$row->warehouse_id . '|' . $row->product_id] = ['count' => (int) $row->pending_count, 'total' => (int) $row->pending_total];
        }

        return $totals;
    }
}

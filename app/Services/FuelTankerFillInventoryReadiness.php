<?php

namespace App\Services;

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
 * الترحيل نفسه غير مبني (قرار المالك: «لا خصم الآن»؛ PR-6B بعد اعتماد المعالجة المحاسبية) ⇒ `POSTING_ENABLED = false` ثابتاً لا إعداداً. هذه الخدمة تجيب فقط:
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

    // أسباب مراجعة (لا تمنع، تحتاج نظرة بشرية).
    public const R_CAPACITY_OVERRUN = 'capacity_overrun';
    public const R_INSUFFICIENT_BALANCE = 'insufficient_balance';
    public const R_OVERDUE = 'overdue';

    /** @var list<string> متطلبات المطابقة المعلنة للمشغّل (لا تُنفَّذ هنا). */
    public const RECONCILIATION_REQUIREMENTS = ['pool_quantity_equals_warehouse_stock', 'pool_value_equals_fuel_share_of_ledger_1140'];

    public function __construct(private FuelStationSettingsService $settings) {}

    /**
     * @param  Collection<int, FuelTankerFill>  $fills
     * @return array{items: array<string, array<string, mixed>>, pools: list<array<string, mixed>>}
     */
    public function evaluate(Collection $fills, bool $includeCost = false, ?CarbonInterface $now = null): array
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

        // السندات المعلّقة كلها في كل مجمّع معني (لا الصفحة الحالية وحدها) لحساب التراكمي بترتيب التسجيل.
        $pending = $this->pendingByPool($stations, $products, $warehouseIds->all());

        $policies = [];
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
                $poolFills = $pending[$key] ?? collect();
                $cumulative = 0;
                foreach ($poolFills as $candidate) {
                    $cumulative += (int) $candidate->quantity_milliliters;
                    if ($candidate->id === $fill->id) {
                        break;
                    }
                }

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
                if ($row !== null && $cumulative > $available) {
                    $policy['insufficient_policy'] === 'hold_for_review' ? $reasons[] = self::R_INSUFFICIENT_BALANCE : $blockers[] = self::B_INSUFFICIENT_BALANCE;
                }

                $poolInfo = ['warehouse_id' => $warehouse->id, 'fuel_product_id' => $product->id, 'available_milliliters' => $available, 'cumulative_milliliters' => $cumulative];
                $pools[$key] ??= $this->poolSummary($warehouse, $product, $row, $state, $poolFills, $includeCost);
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
            );
        }

        return ['items' => $items, 'pools' => array_values($pools)];
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
    private function item(string $readiness, array $blockers, array $reasons, bool $overdue, int $ageHours, ?array $pool): array
    {
        return ['readiness' => $readiness, 'blockers' => $blockers, 'review_reasons' => $reasons, 'overdue' => $overdue, 'age_hours' => $ageHours, 'pool' => $pool];
    }

    /**
     * @param  Collection<int, FuelTankerFill>  $poolFills  السندات المعلّقة في المجمّع بترتيب التسجيل
     * @return array<string, mixed>
     */
    private function poolSummary(Warehouse $warehouse, FuelProduct $product, ?ProductWarehouseStock $stock, ?FuelInventoryCostState $state, Collection $poolFills, bool $includeCost): array
    {
        $available = $stock === null ? null : (int) $stock->quantity;
        $pendingTotal = (int) $poolFills->sum('quantity_milliliters');
        $summary = [
            'warehouse_id' => $warehouse->id,
            'fuel_product_id' => $product->id,
            'stock_milliliters' => $available,
            'cost_pool_milliliters' => $state === null ? null : (int) $state->quantity_milliliters,
            'quantity_in_sync' => $state === null || $available === null ? null : (int) $state->quantity_milliliters === $available,
            'pending_count' => $poolFills->count(),
            'pending_total_milliliters' => $pendingTotal,
            'shortfall_milliliters' => $available === null ? null : max(0, $pendingTotal - $available),
            'ledger_1140' => 'not_checked',
        ];
        if ($includeCost) {
            $summary['cost_pool_value_minor'] = $state === null ? null : (int) $state->cost_pool_minor;
        }

        return $summary;
    }

    /**
     * كل السندات المعلّقة (لا الصفحة وحدها) في المجمّعات المعنية، مرتّبة بوقت التسجيل فالمعرّف، مفهرسة بمفتاح `warehouse|product`.
     *
     * @param  Collection<string, FuelStation>  $stations
     * @param  Collection<string, FuelProduct>  $products
     * @param  list<string>  $warehouseIds
     * @return array<string, Collection<int, FuelTankerFill>>
     */
    private function pendingByPool(Collection $stations, Collection $products, array $warehouseIds): array
    {
        if ($warehouseIds === []) {
            return [];
        }
        $stationIds = FuelStation::query()->whereIn('warehouse_id', $warehouseIds)->pluck('warehouse_id', 'id');
        $all = FuelTankerFill::query()
            ->where('status', FuelTankerFill::STATUS_RECORDED)->where('inventory_status', FuelTankerFill::INVENTORY_PENDING_INTEGRATION)
            ->whereIn('fuel_station_id', $stationIds->keys())->whereIn('fuel_product_id', $products->keys())
            ->orderBy('recorded_at')->orderBy('id')
            ->get(['id', 'fuel_station_id', 'fuel_product_id', 'quantity_milliliters', 'recorded_at']);

        $byPool = [];
        foreach ($all as $fill) {
            $warehouseId = $stationIds->get($fill->fuel_station_id);
            $productId = $products->get($fill->fuel_product_id)?->product_id;
            if ($warehouseId === null || $productId === null) {
                continue;
            }
            $byPool[$warehouseId . '|' . $productId] ??= collect();
            $byPool[$warehouseId . '|' . $productId]->push($fill);
        }

        return $byPool;
    }
}

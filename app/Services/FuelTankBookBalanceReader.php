<?php

namespace App\Services;

use App\Models\FuelTank;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Tenancy\BranchScope;
use App\Tenancy\TenantContext;
use Illuminate\Database\Eloquent\Collection as EloquentCollection;

/**
 * الرصيد الدفتري الرسمي للخزان — **قراءة فقط**، بلا كتابة ولا قفل ولا حساب مخزون جديد.
 *
 * المصدر الوحيد `product_warehouse_stock` (الرصيد الرسمي بمستوى «مخزن × منتج»). هو لا يعرف الخزانات، لذلك يُنسَب إلى خزان
 * **فقط عندما يكون ذلك الخزان الوحيد الذي يغذّي ذلك المجمّع** — نفس افتراض المطابقة الرسمية (`FUEL_RECONCILIATION_MULTI_TANK_UNSUPPORTED`)
 * لكن بتشدّد أكبر: يُحصى كل خزان بغضّ النظر عن حالته (ومنه المعطَّل) وعبر **كل** محطات المؤسسة التي تتشارك المخزن والمنتج، لا ما يصله
 * المستخدم وحده. عدم الحصر بنطاق المستخدم مقصود: العدّ قرار «هل يمكن النسب»، ولا يخرج منه إلا رمز السبب، أمّا الرصيد المجمَّع فلا يُعاد
 * إلا لخزان وحيد ظاهر للمستخدم أصلاً (المتحكّم يقيّد القائمة بنطاق المحطة/الفرع/المخزن قبل استدعاء هذه الخدمة).
 *
 * قواعد الصدق (لا تخمين):
 *  - غياب سجل الرصيد ≠ صفر ⇒ `no_stock_record`. أكثر من سجل لزوج واحد (متغيّرات) ⇒ `ambiguous_stock_record`. رصيد سالب ⇒ `invalid_stock_record`.
 *  - `as_of` دائماً `null`: لا دلالة مثبتة لأي عمود زمني على «آخر حركة» (`updated_at` يتغير بتعديلات لا تخص الحركات)، فلا يُستنتج منه وقت.
 *  - لا تحويل وحدات: غير mL/L ⇒ `unit_mismatch`.
 *  - لا استنتاج من الدفتر التشغيلي ولا من المبيعات/الاستلامات (انظر تقرير Discovery).
 *
 * عدد الاستعلامات ثابت بالنسبة إلى عدد الخزانات: عدّ الخزانات المشتركة (1) + سجلات الرصيد (1) + وحدة المنتج (1) — وأقل حين لا حاجة.
 */
class FuelTankBookBalanceReader
{
    public const BASIS = 'warehouse_book';

    public const REASON_MULTI_TANK = 'multi_tank';
    public const REASON_NO_STOCK_RECORD = 'no_stock_record';
    public const REASON_AMBIGUOUS_STOCK_RECORD = 'ambiguous_stock_record';
    public const REASON_INVALID_STOCK_RECORD = 'invalid_stock_record';
    public const REASON_NO_WAREHOUSE = 'no_warehouse';
    public const REASON_TANK_INACTIVE = 'tank_inactive';
    public const REASON_UNIT_MISMATCH = 'unit_mismatch';
    public const REASON_INVALID_CONFIGURATION = 'invalid_configuration';

    public const REASONS = [
        self::REASON_MULTI_TANK, self::REASON_NO_STOCK_RECORD, self::REASON_AMBIGUOUS_STOCK_RECORD, self::REASON_INVALID_STOCK_RECORD,
        self::REASON_NO_WAREHOUSE, self::REASON_TANK_INACTIVE, self::REASON_UNIT_MISMATCH, self::REASON_INVALID_CONFIGURATION,
    ];

    public function __construct(private TenantContext $tenant) {}

    /**
     * @param  iterable<FuelTank>  $tanks  خزانات ظاهرة للمستخدم أصلاً (يقيّدها المتحكّم بنطاقه).
     * @return array<string, array{book_level: array{milliliters:int,basis:string,as_of:null}|null, book_level_unavailable_reason: string|null}>
     */
    public function forTanks(iterable $tanks): array
    {
        $collection = new EloquentCollection(is_array($tanks) ? $tanks : iterator_to_array($tanks, false));
        if ($collection->isEmpty()) {
            return [];
        }
        $collection->loadMissing(['station', 'fuelProduct']);
        $tenantId = $this->tenant->id();

        // 1) تصنيف أولي لكل خزان من علاقاته المحمَّلة (بلا استعلام).
        $result = [];
        $pairs = []; // key => [warehouseId, productId]
        foreach ($collection as $tank) {
            $warehouseId = $tank->station?->warehouse_id;
            $fuelProduct = $tank->fuelProduct;
            $reason = match (true) {
                $tenantId === null, $tank->station === null, $fuelProduct === null, $fuelProduct->product_id === null => self::REASON_INVALID_CONFIGURATION,
                $tank->status === FuelTank::STATUS_INACTIVE => self::REASON_TANK_INACTIVE,
                $warehouseId === null => self::REASON_NO_WAREHOUSE,
                $fuelProduct->inventory_base_unit !== 'mL' || $fuelProduct->display_unit !== 'L' => self::REASON_UNIT_MISMATCH,
                default => null,
            };
            if ($reason !== null) {
                $result[$tank->id] = $this->unavailable($reason);

                continue;
            }
            $pairs[$tank->id] = [$warehouseId, $fuelProduct->product_id];
        }
        if ($pairs === []) {
            return $result;
        }

        $warehouseIds = array_values(array_unique(array_column($pairs, 0)));
        $productIds = array_values(array_unique(array_column($pairs, 1)));

        // 2) كل خزان (أي حالة) في أي محطة من المؤسسة يغذّي كل زوج (مخزن، منتج) — الأزواج الزائدة عن المطلوب (حاصل ضرب) لا تضرّ.
        $tankCounts = [];
        $counted = FuelTank::query()
            ->join('fuel_stations', 'fuel_stations.id', '=', 'fuel_tanks.fuel_station_id')
            ->join('fuel_products', 'fuel_products.id', '=', 'fuel_tanks.fuel_product_id')
            ->where('fuel_stations.tenant_id', $tenantId)
            ->where('fuel_products.tenant_id', $tenantId)
            ->whereIn('fuel_stations.warehouse_id', $warehouseIds)
            ->whereIn('fuel_products.product_id', $productIds)
            ->groupBy('fuel_stations.warehouse_id', 'fuel_products.product_id')
            ->selectRaw('fuel_stations.warehouse_id as warehouse_id, fuel_products.product_id as product_id, count(*) as tanks')
            ->get();
        foreach ($counted as $row) {
            $tankCounts[$this->key($row->warehouse_id, $row->product_id)] = (int) $row->tanks;
        }

        $sole = []; // أزواج بخزان وحيد فقط تحتاج رصيداً
        foreach ($pairs as $tankId => [$warehouseId, $productId]) {
            $key = $this->key($warehouseId, $productId);
            if (($tankCounts[$key] ?? 0) !== 1) {
                // 0 غير ممكن عملياً (الخزان نفسه يُحصى)، فنعامله كتكوين غير صالح بدل التخمين.
                $result[$tankId] = $this->unavailable(($tankCounts[$key] ?? 0) > 1 ? self::REASON_MULTI_TANK : self::REASON_INVALID_CONFIGURATION);
                unset($pairs[$tankId]);

                continue;
            }
            $sole[$key] = [$warehouseId, $productId];
        }
        if ($sole === []) {
            return $result;
        }

        // 3) وحدة منتج المخزون يجب أن تكون mL (الرصيد بوحدة المنتج الأساسية). المرجع بلا نطاق الفرع (يبقى نطاق المستأجر) كحال خدمات الوقود.
        $soleProductIds = array_values(array_unique(array_column($sole, 1)));
        $units = BranchScope::reference(Product::class)->whereIn('id', $soleProductIds)->pluck('unit', 'id')->all();

        // 4) الرصيد الرسمي. نطاق المستأجر من BaseModel؛ لا نطاق فرع (CompanyWide).
        $stock = [];
        ProductWarehouseStock::query()
            ->whereIn('warehouse_id', array_values(array_unique(array_column($sole, 0))))
            ->whereIn('product_id', $soleProductIds)
            ->get(['warehouse_id', 'product_id', 'product_variant_id', 'quantity'])
            ->each(function (ProductWarehouseStock $row) use (&$stock): void {
                $stock[$this->key($row->warehouse_id, $row->product_id)][] = $row;
            });

        foreach ($pairs as $tankId => [$warehouseId, $productId]) {
            $key = $this->key($warehouseId, $productId);
            if (! array_key_exists($productId, $units)) {
                // منتج المخزون غير موجود/محذوف ناعماً: لا وحدة نعتمد عليها ⇒ تكوين غير صالح (لا ادّعاء عدم تطابق وحدة).
                $result[$tankId] = $this->unavailable(self::REASON_INVALID_CONFIGURATION);

                continue;
            }
            if ($units[$productId] !== 'mL') {
                $result[$tankId] = $this->unavailable(self::REASON_UNIT_MISMATCH);

                continue;
            }
            $rows = $stock[$key] ?? [];
            if ($rows === []) {
                $result[$tankId] = $this->unavailable(self::REASON_NO_STOCK_RECORD); // غياب السجل ≠ صفر

                continue;
            }
            if (count($rows) > 1 || $rows[0]->product_variant_id !== null) {
                $result[$tankId] = $this->unavailable(self::REASON_AMBIGUOUS_STOCK_RECORD);

                continue;
            }
            $quantity = $rows[0]->quantity;
            if (! is_int($quantity) || $quantity < 0) {
                $result[$tankId] = $this->unavailable(self::REASON_INVALID_STOCK_RECORD);

                continue;
            }
            $result[$tankId] = ['book_level' => ['milliliters' => $quantity, 'basis' => self::BASIS, 'as_of' => null], 'book_level_unavailable_reason' => null];
        }

        return $result;
    }

    /** @return array{book_level: null, book_level_unavailable_reason: string} */
    private function unavailable(string $reason): array
    {
        return ['book_level' => null, 'book_level_unavailable_reason' => $reason];
    }

    private function key(string $warehouseId, string $productId): string
    {
        return $warehouseId . '|' . $productId;
    }
}

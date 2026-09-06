<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Support\Settings;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  InventoryService — المخزون الدائم (Perpetual) بتكلفة متوسط متحرك
 * ═══════════════════════════════════════════════════════════════
 *  - receiveStock(): استلام بضاعة، يحدّث الكمية والمتوسط ويولّد قيداً
 *      (مدين 1140 المخزون / دائن الحساب المقابل، افتراضياً 2110 الموردون).
 *  - recordSaleCogs(): عند بيع منتج track_inventory، يخفّض المخزون ويولّد
 *      قيد تكلفة البضاعة المباعة (مدين 5110 / دائن 1140).
 *
 *  التكاليف بالـ minor units (هللات) كأعداد صحيحة. القيود عبر LedgerService حصراً.
 */
class InventoryService
{
    private const ACC_INVENTORY = '1140'; // المخزون
    private const ACC_COGS       = '5110'; // تكلفة البضاعة المباعة
    private const ACC_OPENING    = '3130'; // الأرصدة الافتتاحية (حقوق ملكية)
    private const ACC_PAYABLE    = '2110'; // الموردون (الحساب المقابل الافتراضي للاستلام)

    public function __construct(
        protected LedgerService $ledger
    ) {}

    /**
     * استلام بضاعة في المخزون بتكلفة محددة + توليد قيد محاسبي.
     *
     * @param  array  $meta  ['offset_account'=>code?, 'partner_id'=>?, 'date'=>?, 'notes'=>?]
     */
    public function receiveStock(Product $product, int $quantity, int $unitCost, array $meta = []): StockMovement
    {
        return DB::transaction(function () use ($product, $quantity, $unitCost, $meta) {
            $movement = $this->applyReceipt($product, $quantity, $unitCost, $meta);

            // قيد: مدين المخزون / دائن الحساب المقابل
            $offset = $meta['offset_account'] ?? self::ACC_PAYABLE;
            $this->ledger->post([
                [
                    'account_id' => $this->accountId(self::ACC_INVENTORY),
                    'debit'      => $movement->total_cost,
                ],
                [
                    'account_id'   => $this->accountId($offset),
                    'credit'       => $movement->total_cost,
                    'partner_type' => isset($meta['partner_id']) ? Partner::class : null,
                    'partner_id'   => $meta['partner_id'] ?? null,
                ],
            ], [
                'entry_date'  => $movement->movement_date->toDateString(),
                'description' => "استلام مخزون: {$product->name}",
                'source_type' => StockMovement::class,
                'source_id'   => $movement->id,
            ]);

            return $movement;
        });
    }

    /**
     * إدخال بضاعة للمخزون (كمية + متوسط متحرك) **دون** توليد قيد محاسبي.
     * يُستخدم عندما يكون القيد جزءاً من عملية أكبر (مثل فاتورة المشتريات)
     * حتى لا يتكرّر الترحيل. يجب استدعاؤه ضمن معاملة الطرف المستدعي.
     *
     * `$totalCost` (اختياري): القيمة الصافية الدقيقة للوارد. حين تُمرَّر تُستخدم
     * كما هي (فيتطابق المخزون مع حساب الأستاذ 1140 بلا انحراف تقريب) — لازمٌ
     * للمشتريات المتضمَّنة الضريبة حيث الصافي = الإجمالي − الضريبة المستخرَجة.
     * حين تُحذَف يبقى السلوك السابق تماماً: القيمة = الكمية × تكلفة الوحدة.
     */
    public function applyReceipt(Product $product, int $quantity, int $unitCost, array $meta = [], ?int $totalCost = null): StockMovement
    {
        if ($quantity <= 0 || $unitCost < 0) {
            throw new RuntimeException('كمية الاستلام يجب أن تكون موجبة والتكلفة غير سالبة.');
        }

        $date        = $meta['date'] ?? now()->toDateString();
        $warehouseId = $this->resolveWarehouseId($meta);

        // قيمة الوارد: الصافي الدقيق إن مُرِّر، وإلا الكمية × تكلفة الوحدة (كالسابق).
        $lineValue = $totalCost ?? ($quantity * $unitCost);
        if ($lineValue < 0) {
            throw new RuntimeException('قيمة الوارد لا تكون سالبة.');
        }
        $recordedUnit = $totalCost !== null ? intdiv($totalCost, $quantity) : $unitCost;

        // متوسط متحرك: المتوسط الجديد = (قيمة المخزون القديمة + قيمة الوارد) ÷ الكمية الكلية
        $oldQty   = $product->quantity_on_hand;
        $oldValue = $oldQty * $product->avg_cost;
        $newQty   = $oldQty + $quantity;
        $newValue = $oldValue + $lineValue;
        $newAvg   = $newQty > 0 ? intdiv($newValue, $newQty) : 0;

        $movement = StockMovement::create([
            'product_id'       => $product->id,
            'warehouse_id'     => $warehouseId,
            'branch_id'        => $this->branchOfWarehouse($warehouseId), // الحركة تتبع فرع المخزن
            'type'             => 'in',
            'quantity'         => $quantity,
            'unit_cost'        => $recordedUnit,
            'total_cost'       => $lineValue,
            'balance_quantity' => $newQty,
            'source_type'      => $meta['source_type'] ?? null,
            'source_id'        => $meta['source_id'] ?? null,
            'movement_date'    => $date,
            'notes'            => $meta['notes'] ?? 'استلام بضاعة',
        ]);

        $product->update(['quantity_on_hand' => $newQty, 'avg_cost' => $newAvg]);
        $this->adjustWarehouseStock($warehouseId, $product->id, $quantity);
        app(InventoryAlertService::class)->queueEvaluation($product->id);

        return $movement;
    }

    /**
     * إخراج بضاعة من المخزون (تخفيض الكمية) **دون** توليد قيد محاسبي.
     * يُستخدم عندما يكون القيد جزءاً من عملية أكبر (مثل مرتجع المشتريات).
     * المتوسط لا يتغيّر عند الإخراج. يجب استدعاؤه ضمن معاملة الطرف المستدعي.
     */
    public function applyIssue(Product $product, int $quantity, int $unitCost, array $meta = [], ?int $totalCost = null): StockMovement
    {
        if ($quantity <= 0 || $unitCost < 0) {
            throw new RuntimeException('كمية الإخراج يجب أن تكون موجبة والتكلفة غير سالبة.');
        }
        $lineValue = $totalCost ?? ($quantity * $unitCost);
        if ($lineValue < 0) {
            throw new RuntimeException('قيمة الإخراج لا تكون سالبة.');
        }
        $recordedUnit = $totalCost !== null ? intdiv($totalCost, $quantity) : $unitCost;

        $newQty      = $product->quantity_on_hand - $quantity;
        $warehouseId = $this->resolveWarehouseId($meta);

        // يمرّ المسار التشغيلي الصريح بهذا المفتاح؛ أما الجرد والتصحيح فيظلان
        // قادرين على تسجيل فرق فعلي من دون أن يحظره حارس البيع.
        if (($meta['enforce_stock'] ?? false) === true) {
            $this->assertStockAvailable($product, $quantity, $warehouseId);
        }

        $movement = StockMovement::create([
            'product_id'       => $product->id,
            'warehouse_id'     => $warehouseId,
            'branch_id'        => $this->branchOfWarehouse($warehouseId), // الحركة تتبع فرع المخزن
            'type'             => 'out',
            'quantity'         => $quantity,
            'unit_cost'        => $recordedUnit,
            'total_cost'       => $lineValue,
            'balance_quantity' => $newQty,
            'source_type'      => $meta['source_type'] ?? null,
            'source_id'        => $meta['source_id'] ?? null,
            'movement_date'    => $meta['date'] ?? now()->toDateString(),
            'notes'            => $meta['notes'] ?? 'إخراج بضاعة',
        ]);

        $product->update(['quantity_on_hand' => $newQty]);
        $this->adjustWarehouseStock($warehouseId, $product->id, -$quantity);
        app(InventoryAlertService::class)->queueEvaluation($product->id);

        return $movement;
    }

    /**
     * توليد قيد تكلفة البضاعة المباعة لفاتورة، وخفض المخزون للمنتجات المتابَعة.
     * يُستدعى من InvoiceService عند الترحيل. يُعيد قيد التكلفة أو null.
     */
    /**
     * رصيد افتتاحي للمنتج عند إنشائه: مدين 1140 المخزون / دائن 3130 الأرصدة الافتتاحية،
     * بقيمة الكمية × سعر الشراء. يضبط الرصيد ومتوسط التكلفة عبر receiveStock.
     * يتطلّب منتجاً متتبَّعاً بكمية موجبة وسعر شراء موجب (لتقييم المخزون).
     */
    public function recordOpeningStock(Product $product, int $quantity): ?StockMovement
    {
        $unitCost = (int) $product->purchase_price;
        if (! $product->track_inventory || $quantity <= 0 || $unitCost <= 0) {
            return null;
        }

        return $this->receiveStock($product, $quantity, $unitCost, [
            'offset_account' => self::ACC_OPENING,
            'notes'          => 'رصيد افتتاحي',
        ]);
    }

    public function recordSaleCogs(Invoice $invoice): ?\App\Models\JournalEntry
    {
        $invoice->loadMissing('lines.product', 'lines.costCenterAllocations');

        $totalCogs = 0;
        $cogsByAccountAndCenter = []; // account_id|cost_center_id => amount
        $defaultCogs = $this->accountId(self::ACC_COGS);

        // مخزن الإخراج المثبت على الفاتورة يعلو على بديل الفرع؛ المستند القديم
        // بلا مخزن يستمر عبر مخزن فرعه ثم الافتراضي لتبقى البيانات التاريخية قابلة للترحيل.
        $warehouseId = $this->resolveWarehouseId([
            'warehouse_id' => $invoice->warehouse_id,
            'branch_id' => $invoice->branch_id,
        ]);

        foreach ($invoice->lines as $line) {
            $product = $line->product;

            if (! $product || ! $product->track_inventory || $line->quantity <= 0) {
                continue;
            }

            // الكمية بوحدة المخزون: السطر قد يكون بوحدة أكبر (طبلية = ٥٠ كيساً).
            // المعامل ١ لكل سطر لا يحدّد وحدة، فالسلوك القائم لا يتغيّر.
            $quantity = $line->baseQuantity();

            // الحارس قبل أي حركة: الرفض هنا يُبطل المعاملة كلها، فلا فاتورة
            // نصفها مرحَّل ونصفها لا. ويقارن بوحدة المخزون لا بوحدة السطر —
            // «طبليتان» و«رصيد ٦٠ كيساً» لا يُقارَنان قبل التحويل.
            $this->assertStockAvailable($product, $quantity, $warehouseId);

            $unitCost = $product->avg_cost;
            $cost     = $quantity * $unitCost;
            $newQty   = $product->quantity_on_hand - $quantity;

            StockMovement::create([
                'product_id'       => $product->id,
                'warehouse_id'     => $warehouseId,
                'branch_id'        => $this->branchOfWarehouse($warehouseId), // الحركة تتبع فرع المخزن
                'type'             => 'out',
                'quantity'         => $quantity,   // دفتر المخزون بوحدة الأساس دائماً
                'unit_cost'        => $unitCost,
                'total_cost'       => $cost,
                'balance_quantity' => $newQty,
                'source_type'      => Invoice::class,
                'source_id'        => $invoice->id,
                'movement_date'    => $invoice->invoice_date->toDateString(),
                'notes'            => "بيع عبر الفاتورة {$invoice->number}",
            ]);

            $product->update(['quantity_on_hand' => $newQty]);
            $this->adjustWarehouseStock($warehouseId, $product->id, -$quantity);
            app(InventoryAlertService::class)->queueEvaluation($product->id);
            $totalCogs += $cost;
            $cogsAcct = $product->cogs_account_id ?: $defaultCogs;
            foreach ($this->splitAllocatedAmount($cost, $line->costCenterAllocations, $invoice->cost_center_id) as $allocation) {
                $costCenterId = $allocation['cost_center_id'];
                $amount = $allocation['amount'];
                if ($amount === 0) {
                    continue;
                }
                $key = $cogsAcct.'|'.($costCenterId ?? 'none');
                $cogsByAccountAndCenter[$key] = [
                    'account_id' => $cogsAcct,
                    'cost_center_id' => $costCenterId,
                    'amount' => ($cogsByAccountAndCenter[$key]['amount'] ?? 0) + $amount,
                ];
            }
        }

        if ($totalCogs <= 0) {
            return null;
        }

        // قيد: مدين تكلفة البضاعة المباعة (لكل حساب منتج) / دائن المخزون
        $lines = [];
        foreach ($cogsByAccountAndCenter as $row) {
            $lines[] = [
                'account_id' => $row['account_id'],
                'debit' => $row['amount'],
                'cost_center_id' => $row['cost_center_id'],
            ];
        }
        $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'credit' => $totalCogs];

        return $this->ledger->post($lines, [
            'entry_date'  => $invoice->invoice_date->toDateString(),
            'description' => "تكلفة بضاعة مباعة {$invoice->number}",
            'source_type' => Invoice::class,
            'source_id'   => $invoice->id,
        ]);
    }

    /**
     * يوزع تكلفة السطر من لقطة تخصيصاته. غيابها يحافظ على وسم الرأس التاريخي.
     * آخر تخصيص يأخذ بواقي القسمة الصحيحة؛ لذلك مجموع المدين يساوي التكلفة دائماً.
     *
     * @return array<int, array{cost_center_id: ?string, amount: int}>
     */
    private function splitAllocatedAmount(int $amount, $allocations, ?string $fallbackCostCenterId): array
    {
        if ($allocations->isEmpty()) {
            return [['cost_center_id' => $fallbackCostCenterId, 'amount' => $amount]];
        }
        $allocationTotal = (int) $allocations->sum('amount');
        if ($allocationTotal <= 0) {
            throw new RuntimeException('تخصيصات مركز التكلفة يجب أن تملك مبلغاً موجباً.');
        }
        $result = [];
        $allocated = 0;
        foreach ($allocations->sortBy('position')->values() as $position => $allocation) {
            $part = $position === $allocations->count() - 1
                ? $amount - $allocated
                : intdiv($amount * (int) $allocation->amount, $allocationTotal);
            $result[] = ['cost_center_id' => $allocation->cost_center_id, 'amount' => $part];
            $allocated += $part;
        }

        return $result;
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  حارس البيع بلا رصيد — بسياسة المستأجر
     * ═══════════════════════════════════════════════════════════════
     *  `inventory.allow_negative_stock`: مفعّلاً يمرّ كما كان، ومطفأً يُرفض
     *  الإخراج الذي يُنزل الكمية تحت الصفر.
     *
     *  **لماذا الرفض هو الافتراض:** الكمية السالبة أثرها مزدوج — حساب المراقبة
     *  1140 يصير برصيد دائن (ميزانية بمخزون سالب)، **والمتوسط المتحرك يُفسَد
     *  بعده**: أي شراء لاحق يقسم الوارد على قاعدة سالبة فيخرج متوسطٌ مضخّم،
     *  وكل قيد تكلفة بضاعة مباعة بعده خاطئ. (قياس: −٧ ثم شراء ١٠ بـ٢٠٠ ريال
     *  أعطى متوسطاً ٤٣٣٫٣٣.)
     *
     *  **ولماذا هنا لا في `applyIssue`:** الجرد يستدعي `applyIssue` لتسجيل
     *  عجز، وحظرٌ أعمى في البدائية كان سيمنع **مسار التصحيح نفسه**. الحارس
     *  يُستدعى صراحةً من مسارات البيع والمرتجع، ويبقى التصحيح حرّاً.
     */
    public function assertStockAvailable(Product $product, int $quantity, ?string $warehouseId = null): void
    {
        if (Settings::get('inventory', 'allow_negative_stock')) {
            return;
        }

        // إن عُرف المخزن فالرصيد المطلوب هو رصيده هو، لا إجمالي المنشأة.
        // أما المستندات السابقة على المخازن فتستمر بفحص الإجمالي كي لا تعيد
        // الترقية تفسير حركة تاريخية بلا موقع كمية.
        $available = $warehouseId === null
            ? (int) $product->quantity_on_hand
            : (int) (ProductWarehouseStock::where('product_id', $product->id)
                ->where('warehouse_id', $warehouseId)
                ->value('quantity') ?? 0);

        if ($available >= $quantity) {
            return;
        }

        $location = $warehouseId === null ? 'من المنتج' : 'من المخزن المحدد';
        throw new RuntimeException(sprintf(
            'الكمية المتاحة %s لـ«%s» (%d) أقل من المطلوب (%d). لا يمكن البيع أو الإرجاع بأكثر من الرصيد — '
            . 'يمكن تغيير ذلك من إعدادات المخزون.',
            $location,
            $product->name,
            $available,
            $quantity
        ));
    }

    /**
     * يحلّ المخزن المستهدَف للحركة: الصريح في meta، ثم مخزن الفرع، ثم الافتراضي.
     * `null` = لا مخازن معرّفة بعد ⇒ تُسجَّل الحركة بلا مخزن (سلوك ما قبل B4).
     */
    protected function resolveWarehouseId(array $meta): ?string
    {
        if (($meta['warehouse_id'] ?? null) !== null) {
            $warehouse = Warehouse::whereKey($meta['warehouse_id'])->where('is_active', true)->first();
            if (! $warehouse) {
                throw new RuntimeException('المستودع المحدد غير موجود أو غير نشط.');
            }

            return $warehouse->id;
        }

        return $this->warehouseForBranch($meta['branch_id'] ?? null);
    }

    /**
     * فرع المخزن — مصدر وسم حركة المخزون. الحركة تخصّ المكان الذي دخلت منه
     * البضاعة أو خرجت، لا الفرع الذي كان مفتوحاً أمام من ضغط الزرّ.
     * `null` (بلا مخزن أو مخزن بلا فرع) يترك الوسم لـ `BelongsToBranch`.
     */
    protected function branchOfWarehouse(?string $warehouseId): ?string
    {
        return $warehouseId === null ? null : Warehouse::whereKey($warehouseId)->value('branch_id');
    }

    /**
     * مخزن الفرع: أول مخزن نشط تابع للفرع، وإلا المخزن الافتراضي للمنشأة.
     */
    protected function warehouseForBranch(?string $branchId): ?string
    {
        if ($branchId !== null) {
            $byBranch = Warehouse::where('branch_id', $branchId)->where('is_active', true)
                ->orderByDesc('is_default')->orderBy('code')->first();
            if ($byBranch) {
                return $byBranch->id;
            }
        }

        return Warehouse::default()?->id;
    }

    /**
     * يعدّل رصيد المنتج في مخزن بمقدار موجب/سالب. لا يمسّ القيمة —
     * التقييم عالمي على المنتج (products.avg_cost).
     *
     * **المسار الوحيد** الذي يكتب `product_warehouse_stock` — فيزيد
     * `revision` هنا حصراً بالضبط ١ عند كل حركةٍ فعلية. هذا العدّاد الرتيب
     * هو مرجع الجرد (`StocktakeService`) لكشف الحركة المتزامنة منذ لحظة
     * الفتح (PR-INV-4)، لا مقارنة الكمية النهائية وحدها التي تعمى عن حركة
     * ذهاب-وعودة (ABA) صافيها صفر.
     */
    protected function adjustWarehouseStock(?string $warehouseId, string $productId, int $delta): void
    {
        if ($warehouseId === null || $delta === 0) {
            return;
        }

        $row = ProductWarehouseStock::firstOrCreate(
            ['product_id' => $productId, 'warehouse_id' => $warehouseId],
            ['quantity' => 0, 'revision' => 0]
        );
        $row->increment('quantity', $delta);
        $row->increment('revision');
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();

        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }
}

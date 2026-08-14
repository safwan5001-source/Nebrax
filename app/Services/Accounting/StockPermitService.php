<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\StockPermit;
use App\Models\StockPermitLine;
use App\Models\Warehouse;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  StockPermitService — الأذون المخزنية (إضافة · صرف · تحويل)
 * ═══════════════════════════════════════════════════════════════
 *  أول وحدة تحرّك حساب المراقبة **1140** بلا فاتورة شراء ولا بيع.
 *
 *  إذن إضافة (بضاعة وُجدت/تبرّع/تصحيح زيادة):
 *    مدين  1140 المخزون                 (بالتكلفة المُدخَلة)
 *    دائن  5180 فروق الجرد والتلف
 *
 *  إذن صرف (تلف · استهلاك داخلي · عيّنات):
 *    مدين  5180 فروق الجرد والتلف
 *    دائن  1140 المخزون                 (بمتوسط التكلفة، لا بسعرٍ يختاره المستخدم)
 *
 *  إذن تحويل بين مخزنين:
 *    داخل الفرع الواحد   → **لا قيد إطلاقاً** (لم يتغيّر شيء في الدفتر العام)
 *    بين فرعين مختلفين   → مدين 1140 (فرع الوجهة) / دائن 1140 (فرع المصدر)
 *      حسابٌ واحد على الطرفين بوسمَي فرع مختلفين: صافيه صفرٌ على مستوى
 *      الشركة، فلا يتضخّم المخزون؛ ويصحّح ميزان كل فرع على حدة — ولولاه
 *      لبقيت قيمة البضاعة مسجَّلة على الفرع الذي غادرته.
 *
 *  **الثابت المحروس:** بعد كل ترحيل يبقى رصيد 1140 = Σ(كمية × متوسط تكلفة).
 *  الحركة والقيد يقعان في معاملة واحدة، فلا ينفصل الدفتران أبداً.
 */
class StockPermitService
{
    private const ACC_INVENTORY  = '1140';
    private const ACC_ADJUSTMENT = '5180';

    private const PREFIX = ['receipt' => 'SR', 'issue' => 'SI', 'transfer' => 'ST'];

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory
    ) {}

    /**
     * @param  array  $data   ['type'=>string, 'warehouse_id'=>uuid, 'target_warehouse_id'=>?uuid,
     *                         'permit_date'=>?, 'reason'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $items  [['product_id'=>uuid, 'quantity'=>int, 'unit_cost'=>?int], ...]
     */
    public function create(array $data, array $items): StockPermit
    {
        $type = $data['type'] ?? 'issue';
        if (! in_array($type, StockPermit::TYPES, true)) {
            throw new RuntimeException("نوع إذن مخزني غير معروف: {$type}");
        }
        if (empty($items)) {
            throw new RuntimeException('الإذن يجب أن يحتوي على سطر واحد على الأقل.');
        }

        $this->assertWarehouses($type, $data);

        return DB::transaction(function () use ($data, $items, $type) {
            $date = $data['permit_date'] ?? now()->toDateString();

            $permit = StockPermit::create([
                'type'                => $type,
                'number'              => $data['number'] ?? $this->nextNumber($type, $date),
                'warehouse_id'        => $data['warehouse_id'],
                'target_warehouse_id' => $type === 'transfer' ? $data['target_warehouse_id'] : null,
                'permit_date'         => $date,
                'status'              => 'draft',
                'reason'              => $data['reason'] ?? null,
                'notes'               => $data['notes'] ?? null,
                'created_by'          => $data['created_by'] ?? null,
            ]);

            foreach ($items as $item) {
                $product  = Product::findOrFail($item['product_id']);
                $quantity = (int) ($item['quantity'] ?? 0);

                if ($quantity <= 0) {
                    throw new RuntimeException('الكمية يجب أن تكون موجبة.');
                }
                if (! $product->track_inventory) {
                    throw new RuntimeException("المنتج «{$product->name}» غير متابَع مخزنياً.");
                }

                // الإضافة وحدها تقبل تكلفة مُدخَلة؛ الصرف والتحويل يأخذان
                // متوسط التكلفة عند الترحيل، فلا يُسعّر المستخدم ما يُخرِجه.
                $unitCost = $type === 'receipt' ? max(0, (int) ($item['unit_cost'] ?? 0)) : 0;

                StockPermitLine::create([
                    'stock_permit_id' => $permit->id,
                    'product_id'      => $product->id,
                    'quantity'        => $quantity,
                    'unit_cost'       => $unitCost,
                    'line_cost'       => $quantity * $unitCost,
                ]);
            }

            return $permit->load('lines');
        });
    }

    /**
     * الترحيل: يحرّك المخزون ويولّد القيد المقابل في **معاملة واحدة**.
     * الفصل بينهما هو ما يجعل حساب المراقبة ينحرف عن دفتر المخزون صامتاً.
     */
    public function post(StockPermit $permit): StockPermit
    {
        if (! $permit->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل إذن غير مسوّد (draft).');
        }

        return DB::transaction(function () use ($permit) {
            $permit = StockPermit::lockForUpdate()->findOrFail($permit->id);
            if (! $permit->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل إذن غير مسوّد (draft).');
            }

            $permit->loadMissing('lines.product');

            $total = match ($permit->type) {
                'receipt'  => $this->applyReceipt($permit),
                'issue'    => $this->applyIssue($permit),
                'transfer' => $this->applyTransfer($permit),
            };

            $entry = $this->buildEntry($permit, $total);

            $permit->update([
                'status'           => 'posted',
                'total_cost'       => $total,
                'journal_entry_id' => $entry?->id,
            ]);

            return $permit->fresh('lines');
        });
    }

    /** إضافة: الكمية تدخل بالتكلفة المُدخَلة، فيتحرّك المتوسط معها. */
    protected function applyReceipt(StockPermit $permit): int
    {
        $total = 0;

        foreach ($permit->lines as $line) {
            $this->inventory->applyReceipt($line->product, $line->quantity, $line->unit_cost, [
                'warehouse_id' => $permit->warehouse_id,
                'date'         => $permit->permit_date->toDateString(),
                'source_type'  => StockPermit::class,
                'source_id'    => $permit->id,
                'notes'        => "إذن إضافة {$permit->number}",
            ]);
            $total += $line->line_cost;
        }

        return $total;
    }

    /** صرف: بمتوسط التكلفة وقت الترحيل — تُثبَّت في السطر ليبقى أثرٌ رجعي. */
    protected function applyIssue(StockPermit $permit): int
    {
        $total = 0;

        foreach ($permit->lines as $line) {
            $product  = $line->product;
            $unitCost = (int) $product->avg_cost;

            $this->assertAvailable($product, $line->quantity, $permit->warehouse_id);

            $this->inventory->applyIssue($product, $line->quantity, $unitCost, [
                'warehouse_id' => $permit->warehouse_id,
                'date'         => $permit->permit_date->toDateString(),
                'source_type'  => StockPermit::class,
                'source_id'    => $permit->id,
                'notes'        => "إذن صرف {$permit->number}",
            ]);

            $line->update(['unit_cost' => $unitCost, 'line_cost' => $line->quantity * $unitCost]);
            $total += $line->quantity * $unitCost;
        }

        return $total;
    }

    /**
     * تحويل: إخراج من المصدر وإدخال إلى الوجهة **بنفس متوسط التكلفة**، فلا
     * يتغيّر المتوسط ولا إجمالي قيمة المخزون — تتحرّك الكمية بين المخزنين فقط.
     */
    protected function applyTransfer(StockPermit $permit): int
    {
        $total = 0;

        foreach ($permit->lines as $line) {
            $product  = $line->product;
            $unitCost = (int) $product->avg_cost;

            $this->assertAvailable($product, $line->quantity, $permit->warehouse_id);

            $meta = [
                'date'        => $permit->permit_date->toDateString(),
                'source_type' => StockPermit::class,
                'source_id'   => $permit->id,
                'notes'       => "إذن تحويل {$permit->number}",
            ];

            $this->inventory->applyIssue($product, $line->quantity, $unitCost,
                $meta + ['warehouse_id' => $permit->warehouse_id]);
            $this->inventory->applyReceipt($product->fresh(), $line->quantity, $unitCost,
                $meta + ['warehouse_id' => $permit->target_warehouse_id]);

            $line->update(['unit_cost' => $unitCost, 'line_cost' => $line->quantity * $unitCost]);
            $total += $line->quantity * $unitCost;
        }

        return $total;
    }

    /**
     * القيد المقابل. التحويل داخل الفرع الواحد **لا قيد له**: لم يتغيّر شيء
     * في الدفتر العام، وقيدٌ بلا تغيير ضجيجٌ يُفسد كشف الأستاذ.
     */
    protected function buildEntry(StockPermit $permit, int $total): ?\App\Models\JournalEntry
    {
        if ($total <= 0) {
            return null;
        }

        if ($permit->isTransfer()) {
            $from = $this->branchOf($permit->warehouse_id);
            $to   = $this->branchOf($permit->target_warehouse_id);

            if ($from === $to) {
                return null; // تحويل داخلي — لا أثر على الدفتر العام
            }

            $inventory = $this->accountId(self::ACC_INVENTORY);

            return $this->ledger->post([
                ['account_id' => $inventory, 'debit'  => $total, 'branch_id' => $to],
                ['account_id' => $inventory, 'credit' => $total, 'branch_id' => $from],
            ], $this->entryMeta($permit, "تحويل مخزني {$permit->number}"));
        }

        $inventory  = $this->accountId(self::ACC_INVENTORY);
        $adjustment = $this->accountId(self::ACC_ADJUSTMENT);

        $lines = $permit->type === 'receipt'
            ? [['account_id' => $inventory, 'debit' => $total], ['account_id' => $adjustment, 'credit' => $total]]
            : [['account_id' => $adjustment, 'debit' => $total], ['account_id' => $inventory, 'credit' => $total]];

        $label = $permit->type === 'receipt' ? 'إذن إضافة' : 'إذن صرف';

        return $this->ledger->post($lines, $this->entryMeta($permit, "{$label} {$permit->number}"));
    }

    protected function entryMeta(StockPermit $permit, string $description): array
    {
        return [
            'entry_date'  => $permit->permit_date->toDateString(),
            'description' => $description,
            'source_type' => StockPermit::class,
            'source_id'   => $permit->id,
            'created_by'  => $permit->created_by,
        ];
    }

    /**
     * ═══════════════════════════════════════════════════════════════
     *  لا يُصرَف ما ليس موجوداً — **في المخزن المقصود**، لا في الشركة
     * ═══════════════════════════════════════════════════════════════
     *  فحصُ الإجمالي وحده يمرّر صرفَ ٢٠ من مخزنٍ فيه ٥ لأن الشركة تملك ١٠٠،
     *  فيهبط رصيد المخزن إلى سالب: الثابت المحاسبي يبقى صحيحاً (القيمة
     *  الكلّية سليمة) لكن تقرير أرصدة المخازن يكذب. والأذون هي الموضع الذي
     *  **يختار فيه المستخدم المخزن صراحةً**، فالفحص هنا ملزِم.
     *
     *  تسامحٌ مقصود مع ما قبل المخازن: منتجٌ لا صفّ له في `ProductWarehouseStock`
     *  إطلاقاً كان مخزونُه قائماً قبل إضافة المخازن، فيُفحَص بالإجمالي — وإلا
     *  رُفض كل صرفٍ لبضاعةٍ موجودة فعلاً. نفس مبدأ `branch_id IS NULL`.
     */
    protected function assertAvailable(Product $product, int $quantity, ?string $warehouseId = null): void
    {
        if ($product->quantity_on_hand < $quantity) {
            throw new RuntimeException(
                "الكمية المتاحة من «{$product->name}» ({$product->quantity_on_hand}) أقل من المطلوب ({$quantity})."
            );
        }

        if ($warehouseId === null) {
            return;
        }

        $row = ProductWarehouseStock::where('product_id', $product->id)
            ->where('warehouse_id', $warehouseId)->first();

        if ($row === null) {
            return; // بضاعة ما قبل المخازن — الإجمالي هو المرجع
        }

        if ($row->quantity < $quantity) {
            $warehouse = BranchScope::reference(Warehouse::class)->whereKey($warehouseId)->value('name');
            throw new RuntimeException(
                "الكمية المتاحة من «{$product->name}» في «{$warehouse}» ({$row->quantity}) أقل من المطلوب ({$quantity})."
            );
        }
    }

    protected function assertWarehouses(string $type, array $data): void
    {
        if (empty($data['warehouse_id'])) {
            throw new RuntimeException('الإذن يلزمه مخزن.');
        }

        if ($type !== 'transfer') {
            return;
        }

        if (empty($data['target_warehouse_id'])) {
            throw new RuntimeException('إذن التحويل يلزمه مخزن وجهة.');
        }
        if ($data['warehouse_id'] === $data['target_warehouse_id']) {
            throw new RuntimeException('لا يُحوَّل المخزن إلى نفسه.');
        }
    }

    protected function branchOf(?string $warehouseId): ?string
    {
        return $warehouseId
            ? BranchScope::reference(Warehouse::class)->whereKey($warehouseId)->value('branch_id')
            : null;
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** تسلسل مستقلّ لكل نوع ولكل فرع: SR · SI · ST. */
    protected function nextNumber(string $type, string $date): string
    {
        return StockPermit::nextDocumentNumber(self::PREFIX[$type], $date);
    }
}

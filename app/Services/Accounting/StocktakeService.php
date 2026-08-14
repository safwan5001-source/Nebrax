<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Stocktake;
use App\Models\StocktakeLine;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  StocktakeService — الجرد: التقاط · عدّ · ترحيل الفرق
 * ═══════════════════════════════════════════════════════════════
 *  المخزون الدائم يفترض أن الدفتر يعرف كل حركة؛ والجرد هو اللحظة التي
 *  يُسأل فيها الواقعُ نفسه.
 *
 *  قيد العجز (المعدود أقلّ):
 *    مدين  5180 فروق الجرد والتلف
 *    دائن  1140 المخزون
 *
 *  قيد الزيادة (المعدود أكثر):
 *    مدين  1140 المخزون
 *    دائن  5180 فروق الجرد والتلف
 *
 *  **قيدٌ واحد للجرد كلّه** لا قيدٌ لكل صنف: الجرد حدثٌ واحد، وتفتيتُه إلى
 *  عشرات القيود يُغرق كشف الأستاذ بلا فائدة — والتفصيل محفوظ في سطوره.
 *
 *  الفرق يُقيَّم بمتوسط التكلفة **لحظة الترحيل**، والكمية والقيد يتحرّكان في
 *  معاملة واحدة فلا ينفصل 1140 عن دفتر المخزون.
 */
class StocktakeService
{
    private const ACC_INVENTORY  = '1140';
    private const ACC_ADJUSTMENT = '5180';

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory
    ) {}

    /**
     * فتح جرد: يلتقط أرصدة المخزن **لحظة الفتح** في سطوره.
     * الالتقاط لا الاشتقاق: لو حُسب الفرق وقت الترحيل لاختلف عمّا رآه العادّ
     * إن تحرّك المخزون بينهما — فتصير ورقة العدّ متّهمةً بما لم تفعله.
     *
     * @param  array  $data       ['warehouse_id'=>uuid, 'stocktake_date'=>?, 'notes'=>?, 'number'=>?]
     * @param  array  $productIds  أصنافٌ محدّدة، أو فارغة = كل ما في المخزن
     */
    public function open(array $data, array $productIds = []): Stocktake
    {
        if (empty($data['warehouse_id'])) {
            throw new RuntimeException('الجرد يلزمه مخزن.');
        }

        return DB::transaction(function () use ($data, $productIds) {
            $date = $data['stocktake_date'] ?? now()->toDateString();

            $stocktake = Stocktake::create([
                'number'         => $data['number'] ?? $this->nextNumber($date),
                'warehouse_id'   => $data['warehouse_id'],
                'stocktake_date' => $date,
                'status'         => 'draft',
                'notes'          => $data['notes'] ?? null,
                'created_by'     => $data['created_by'] ?? null,
            ]);

            foreach ($this->snapshot($data['warehouse_id'], $productIds) as $productId => $quantity) {
                StocktakeLine::create([
                    'stocktake_id'     => $stocktake->id,
                    'product_id'       => $productId,
                    'system_quantity'  => $quantity,
                    'counted_quantity' => null,   // لم يُعدّ بعد — وهو غير الصفر
                ]);
            }

            if ($stocktake->lines()->count() === 0) {
                throw new RuntimeException('لا أصناف مخزنية في هذا المخزن لجردها.');
            }

            return $stocktake->load('lines');
        });
    }

    /**
     * تسجيل العدّ. المفتاح معرّف المنتج والقيمة الكمية المعدودة؛ ما لا يُذكر
     * يبقى `null` (لم يُعدّ) ولا يُرحَّل — فبندٌ منسيّ لا يصير عجزاً كاملاً.
     *
     * @param  array<string,int|null>  $counts
     */
    public function count(Stocktake $stocktake, array $counts): Stocktake
    {
        if (! $stocktake->isDraft()) {
            throw new RuntimeException('لا يُعدَّل جردٌ مرحَّل.');
        }

        return DB::transaction(function () use ($stocktake, $counts) {
            foreach ($counts as $productId => $quantity) {
                $line = $stocktake->lines()->where('product_id', $productId)->first();
                if (! $line) {
                    throw new RuntimeException('صنف خارج ورقة الجرد.');
                }
                if ($quantity !== null && (int) $quantity < 0) {
                    throw new RuntimeException('الكمية المعدودة لا تكون سالبة.');
                }

                $line->update(['counted_quantity' => $quantity === null ? null : (int) $quantity]);
            }

            return $stocktake->fresh('lines');
        });
    }

    /**
     * ترحيل الفرق: يصحّح الكميات ويولّد قيداً واحداً للفروق كلّها.
     * السطور غير المعدودة تُتجاهَل تماماً — لا حركة ولا قيد.
     */
    public function post(Stocktake $stocktake): Stocktake
    {
        if (! $stocktake->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل جرد مرحَّل.');
        }

        return DB::transaction(function () use ($stocktake) {
            $stocktake = Stocktake::lockForUpdate()->findOrFail($stocktake->id);
            if (! $stocktake->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل جرد مرحَّل.');
            }

            $stocktake->loadMissing('lines.product');
            $net = 0;

            foreach ($stocktake->lines as $line) {
                $diff = $line->quantityDifference();
                if ($diff === null || $diff === 0) {
                    continue;
                }

                $product  = $line->product;
                $unitCost = (int) $product->avg_cost;

                $meta = [
                    'warehouse_id' => $stocktake->warehouse_id,
                    'date'         => $stocktake->stocktake_date->toDateString(),
                    'source_type'  => Stocktake::class,
                    'source_id'    => $stocktake->id,
                    'notes'        => "جرد {$stocktake->number}",
                ];

                if ($diff > 0) {
                    $this->inventory->applyReceipt($product, $diff, $unitCost, $meta);
                } else {
                    $this->inventory->applyIssue($product, -$diff, $unitCost, $meta);
                }

                $value = $diff * $unitCost;
                $line->update(['unit_cost' => $unitCost, 'difference_value' => $value]);
                $net += $value;
            }

            $entry = $this->buildEntry($stocktake, $net);

            $stocktake->update([
                'status'           => 'posted',
                'difference_value' => $net,
                'journal_entry_id' => $entry?->id,
            ]);

            return $stocktake->fresh('lines');
        });
    }

    /** قيدٌ واحد بصافي الفرق. جردٌ مطابقٌ تماماً لا قيد له — ولا يجب. */
    protected function buildEntry(Stocktake $stocktake, int $net): ?\App\Models\JournalEntry
    {
        if ($net === 0) {
            return null;
        }

        $inventory  = $this->accountId(self::ACC_INVENTORY);
        $adjustment = $this->accountId(self::ACC_ADJUSTMENT);
        $amount     = abs($net);

        $lines = $net > 0
            ? [['account_id' => $inventory, 'debit' => $amount], ['account_id' => $adjustment, 'credit' => $amount]]
            : [['account_id' => $adjustment, 'debit' => $amount], ['account_id' => $inventory, 'credit' => $amount]];

        $label = $net > 0 ? 'زيادة جرد' : 'عجز جرد';

        return $this->ledger->post($lines, [
            'entry_date'  => $stocktake->stocktake_date->toDateString(),
            'description' => "{$label} {$stocktake->number}",
            'source_type' => Stocktake::class,
            'source_id'   => $stocktake->id,
            'created_by'  => $stocktake->created_by,
        ]);
    }

    /**
     * أرصدة المخزن لحظة الفتح. المنتجات المتابَعة وحدها — والخدمات لا تُجرَد.
     *
     * @return array<string,int>
     */
    protected function snapshot(string $warehouseId, array $productIds): array
    {
        $rows = ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->when($productIds !== [], fn ($q) => $q->whereIn('product_id', $productIds))
            ->pluck('quantity', 'product_id')->all();

        // أصنافٌ طُلبت صراحةً ولا صفّ لها في هذا المخزن تُدرَج بصفر — فيمكن
        // تسجيل وجودها فعلياً (زيادة) بدل أن تسقط من الورقة صامتةً.
        foreach ($productIds as $id) {
            $rows[$id] ??= 0;
        }

        $tracked = Product::whereIn('id', array_keys($rows))
            ->where('track_inventory', true)->pluck('id')->all();

        return array_intersect_key($rows, array_flip($tracked));
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** توليد رقم تسلسلي: STK-2026-00001 — تسلسل مستقلّ لكل فرع. */
    protected function nextNumber(string $date): string
    {
        return Stocktake::nextDocumentNumber('STK', $date);
    }
}

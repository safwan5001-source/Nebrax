<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Models\Stocktake;
use App\Models\StocktakeLine;
use Illuminate\Support\Collection;
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
 *
 *  ═══════════════════════════════════════════════════════════════
 *  PR-INV-4 — لقطة الفتح مقابل الحركة المتزامنة
 *  ═══════════════════════════════════════════════════════════════
 *  اللقطة تُلتقَط عند `open()`، والعدّ قد يقع بعدها بساعات، والترحيل بعد
 *  العدّ بأخرى. أي حركة مخزنية حقيقية (بيع، استلام شراء، إذن صرف/إضافة/
 *  تحويل، أو جردٌ آخر) على نفس الصنف في نفس المخزن خلال هذه النافذة تجعل
 *  تطبيق الفرق المحسوب وقت الفتح (`counted - system_quantity`) خاطئاً
 *  رياضياً على الرصيد الحالي — رغم أن الجرد نفسه محميٌّ من الترحيل المزدوج.
 *
 *  **السياسة اليقظة (Option B — الافتراض الأقلّ تعطيلاً تشغيلياً):** `post()`
 *  يقفل صفّ `ProductWarehouseStock` لكل صنفٍ معدود (بترتيب `product_id`
 *  الثابت — يمنع تعارض القفل الدائري) ويقارنه بلقطة الفتح **قبل** أي حركة
 *  أو قيد. أي تعارض يُسقط الترحيل كلّه بلا أثر جزئي، ويُلزم استدعاء صريحاً
 *  لـ`reconcile()` يُحدِّث اللقطة إلى الرصيد الحالي **ويمسح عدّ الصنف
 *  المتأثر** — فلا يُخمَّن أيّ جزءٍ من الفرق يخصّ الحركة الفعلية وأيّه يخصّ
 *  عجزاً حقيقياً؛ يُعاد عدّ الصنف من جديد على أساسٍ صحيح. تجميدٌ عامٌّ
 *  للمخزن (Option A) لم يُختَر: يوقف كل حركة تشغيلية أخرى في المخزن طوال
 *  نافذة الجرد كاملةً، بينما اليقظة تحصر التعطّل في الأصناف التي تحرّكت
 *  فعلاً — ولا حاجة لإطارٍ عامٍّ جديد للقفل تفرضه هذه السياسة.
 *
 *  **تصحيحٌ بعد المراجعة المستقلة — الهوية مرجعها `revision` لا الكمية:**
 *  مقارنة `ProductWarehouseStock.quantity` النهائية وحدها عمياء عن حركة
 *  ذهاب-وعودة (ABA): ١٠٠ → صرف ١٠ → ٩٠ → استلام ١٠ → ١٠٠. الكمية تعود كما
 *  كانت فتمرّ المقارنة رغم وقوع حركتين حقيقيتين. المرجع الرسمي الآن
 *  `ProductWarehouseStock.revision` — عدّاد رتيب يزيده `InventoryService::
 *  adjustWarehouseStock()` بالضبط ١ عند كل حركةٍ فعلية على الصفّ (المسار
 *  الوحيد الذي يكتب هذا الجدول)، وتحفظه `StocktakeLine.system_revision`
 *  عند الفتح. لا طابع زمني: التوقيت لا يضمن ترتيباً رتيباً بدقّة قاعدة
 *  بيانات محدودة، والعدّاد لا يحتاج توقيتاً أصلاً.
 */
class StocktakeService
{
    public const INVENTORY_ACCOUNT_CODE = '1140';
    public const VARIANCE_ACCOUNT_CODE = '5180';

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

            foreach ($this->snapshot($data['warehouse_id'], $productIds) as $productId => $snap) {
                StocktakeLine::create([
                    'stocktake_id'     => $stocktake->id,
                    'product_id'       => $productId,
                    'system_quantity'  => $snap['quantity'],
                    'system_revision'  => $snap['revision'],
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
     *
     * **يرفض الترحيل بالكامل** إن تحرّك رصيد أيّ صنفٍ معدود في هذا المخزن
     * منذ لحظة الفتح — قبل أي حركة أو قيد، فلا أثر جزئي عند الرفض.
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

            // ترتيبٌ ثابتٌ بمعرّف المنتج قبل القفل: جردان متزامنان يتقاطعان
            // في صنفَين يُقفلان بنفس الترتيب دائماً فلا ينتظر كلٌّ الآخر دائرياً.
            $countedLines = $stocktake->lines
                ->filter(fn (StocktakeLine $l) => $l->counted_quantity !== null)
                ->sortBy('product_id')
                ->values();

            $this->assertSnapshotStillValid($stocktake, $countedLines);

            $net = 0;

            foreach ($countedLines as $line) {
                $diff = $line->quantityDifference();
                if ($diff === 0) {
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

    /**
     * ═══════════════════════════════════════════════════════════════
     *  الحارس: لا ترحيل على حالةٍ لم تعد قائمة — Product×Warehouse فقط
     * ═══════════════════════════════════════════════════════════════
     *  يقفل صفّ `ProductWarehouseStock` لكل صنفٍ **معدود** في هذا الجرد
     *  (غير المعدود لا يُطبَّق له فرقٌ أصلاً فلا داعي لقفله أو فحصه — حركةٌ
     *  على صنفٍ آخر في نفس المخزن لا تُعطِّل عدّاً لا يخصّه) ويقارن **الـ
     *  revision الحالي** بلقطة الفتح — لا الكمية وحدها: حركة ذهاب-وعودة
     *  (ABA) تُعيد الكمية إلى قيمتها الأصلية فتُفلت من مقارنة كميةٍ نهائية،
     *  لكن الـrevision يزيد مع كل حركة فعلية فيكشفها دائماً. أي اختلاف واحد
     *  يرفض الترحيل **كلّه**: لا ترحيلٌ جزئيٌّ لأصنافٍ سليمة بينما أخرى
     *  متعارضة في نفس المستند.
     */
    protected function assertSnapshotStillValid(Stocktake $stocktake, Collection $countedLines): void
    {
        $conflicts = [];

        foreach ($countedLines as $line) {
            $row = ProductWarehouseStock::where('warehouse_id', $stocktake->warehouse_id)
                ->where('product_id', $line->product_id)
                ->lockForUpdate()
                ->first();

            $currentQuantity = (int) ($row->quantity ?? 0);
            $currentRevision = (int) ($row->revision ?? 0);

            if ($currentRevision !== (int) $line->system_revision) {
                $conflicts[] = $currentQuantity === (int) $line->system_quantity
                    ? sprintf('«%s» (تحرّك رصيده ثم عاد إلى %d — لقطة الفتح لم تعد صالحة)', $line->product->name, $currentQuantity)
                    : sprintf('«%s» (وقت الفتح %d، الآن %d)', $line->product->name, $line->system_quantity, $currentQuantity);
            }
        }

        if ($conflicts !== []) {
            throw new RuntimeException(
                'تحرّك رصيد أصنافٍ في هذا الجرد بحركةٍ مخزنية أخرى منذ فتحه: '
                .implode('، ', $conflicts)
                .'. أعد مطابقة الجرد أولاً قبل الترحيل.'
            );
        }
    }

    /**
     * مطابقة صريحة: تُحدِّث لقطة الفتح (الكمية **والـrevision** معاً) إلى
     * الحالة الحالية لكل صنفٍ تحرّك فعلاً (بمقارنة الـrevision لا الكمية
     * وحدها)، وتمسح عدّه القائم (إن وُجد) — العدّ السابق قِيسَ على حالةٍ لم
     * تعد قائمة فلا يصحّ تطبيقه، ولا تُخمَّن حصّة الحركة الفعلية من حصّة
     * عجزٍ حقيقي. الأصناف التي لم تتحرّك تبقى بلا أي تغيير.
     *
     * @return array{stocktake: Stocktake, reconciled_product_ids: array<int, string>}
     */
    public function reconcile(Stocktake $stocktake): array
    {
        if (! $stocktake->isDraft()) {
            throw new RuntimeException('لا يُطابَق جردٌ مرحَّل.');
        }

        return DB::transaction(function () use ($stocktake) {
            $stocktake = Stocktake::lockForUpdate()->findOrFail($stocktake->id);
            if (! $stocktake->isDraft()) {
                throw new RuntimeException('لا يُطابَق جردٌ مرحَّل.');
            }

            $stocktake->loadMissing('lines');
            $reconciled = [];

            foreach ($stocktake->lines->sortBy('product_id') as $line) {
                $row = ProductWarehouseStock::where('warehouse_id', $stocktake->warehouse_id)
                    ->where('product_id', $line->product_id)
                    ->lockForUpdate()
                    ->first();

                $currentQuantity = (int) ($row->quantity ?? 0);
                $currentRevision = (int) ($row->revision ?? 0);

                if ($currentRevision !== (int) $line->system_revision) {
                    $line->update([
                        'system_quantity'  => $currentQuantity,
                        'system_revision'  => $currentRevision,
                        'counted_quantity' => null,
                    ]);
                    $reconciled[] = $line->product_id;
                }
            }

            return ['stocktake' => $stocktake->fresh('lines'), 'reconciled_product_ids' => $reconciled];
        });
    }

    /** قيدٌ واحد بصافي الفرق. جردٌ مطابقٌ تماماً لا قيد له — ولا يجب. */
    protected function buildEntry(Stocktake $stocktake, int $net): ?\App\Models\JournalEntry
    {
        if ($net === 0) {
            return null;
        }

        $inventory  = $this->accountId(self::INVENTORY_ACCOUNT_CODE);
        $adjustment = $this->accountId(self::VARIANCE_ACCOUNT_CODE);
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
     * أرصدة المخزن **وrevision كل صفّ** لحظة الفتح. المنتجات المتابَعة
     * وحدها — والخدمات لا تُجرَد.
     *
     * @return array<string, array{quantity: int, revision: int}>
     */
    protected function snapshot(string $warehouseId, array $productIds): array
    {
        $rows = ProductWarehouseStock::where('warehouse_id', $warehouseId)
            ->when($productIds !== [], fn ($q) => $q->whereIn('product_id', $productIds))
            ->get(['product_id', 'quantity', 'revision'])
            ->mapWithKeys(fn (ProductWarehouseStock $row) => [
                $row->product_id => ['quantity' => (int) $row->quantity, 'revision' => (int) $row->revision],
            ])->all();

        // أصنافٌ طُلبت صراحةً ولا صفّ لها في هذا المخزن تُدرَج بصفر — فيمكن
        // تسجيل وجودها فعلياً (زيادة) بدل أن تسقط من الورقة صامتةً.
        // revision صفرٍ هنا أيضاً: أول حركة فعلية على هذا الصفّ تُنشئه
        // بـrevision ١ (`InventoryService::adjustWarehouseStock`)، فتُكتشف
        // كتعارضٍ عادي بنفس آلية أي صفٍّ آخر.
        foreach ($productIds as $id) {
            $rows[$id] ??= ['quantity' => 0, 'revision' => 0];
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

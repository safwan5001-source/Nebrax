<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\InventoryOpening;
use App\Models\InventoryOpeningLine;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Warehouse;
use App\Tenancy\BranchScope;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  InventoryOpeningService — الأرصدة الافتتاحية: مسودة ثم ترحيل
 * ═══════════════════════════════════════════════════════════════
 *  الرصيد الافتتاحي **نقطة الصفر** التي يبدأ منها المخزون الدائم، لا تسويةَ
 *  جرد. ولذلك يُسجَّل مرّةً واحدة للصنف — قبل أن تكون له أي حركة — ويُرحَّل
 *  مستنداً واحداً قابلاً للتدقيق بعده.
 *
 *  القيد:
 *    مدين  1140 المخزون
 *    دائن  3130 الأرصدة الافتتاحية
 *
 *  **قيدٌ واحد للمستند كلّه** كنمط `StocktakeService` و`StockPermitService`.
 *  ولذلك لا يُستدعى `receiveStock()` ولا `recordOpeningStock()` هنا: كلاهما
 *  يفتح معاملته الخاصة ويولّد قيداً **لكل صنف**، فملفٌ بمئة سطر كان يُغرق
 *  كشف الأستاذ بمئة قيد. الطبقة المستعملة هي `applyReceipt()` — أوّليّةٌ
 *  مخزنية غير محاسبية تعمل داخل معاملة المستدعي.
 *
 *  ═══ الفرع ═══
 *  المستند يضمّ مخازن من فروع مختلفة. بُعد الفرع يُشتقّ من **مخزن السطر**:
 *   • حركة المخزون توسَم بفرع مخزنها (سلوك `applyReceipt` القائم).
 *   • سطور القيد تُجمَّع بفرع المخزن، فيحمل القيدُ الواحد بُعداً صحيحاً لكل
 *     فرع، ويظلّ Σ مدين = Σ دائن.
 *   • مخزنٌ مركزي بلا فرع يمرّر `branch_id => null` **صراحةً**: غيابُ المفتاح
 *     كان يعني «الفرع النشط» في `LedgerService`، فتُنسب أرصدةٌ مركزية إلى
 *     أيّ فرعٍ كان مفتوحاً أمام المشغّل.
 *
 *  ═══ دقّة الهللة ═══
 *  قيمة السطر تُمرَّر إلى `applyReceipt` صراحةً (`$totalCost`)، والقيد يُبنى من
 *  **مجموع `total_cost` للحركات المُنشأة فعلاً** لا من رقمٍ يُعاد اشتقاقه.
 *  فيتطابق 1140 مع دفتر المخزون هللةً بهللة بلا انحراف تقريب.
 */
class InventoryOpeningService
{
    public const INVENTORY_ACCOUNT_CODE = '1140';
    public const OPENING_ACCOUNT_CODE = '3130';

    public function __construct(
        protected LedgerService $ledger,
        protected InventoryService $inventory
    ) {}

    /**
     * إنشاء مسودة من سطور تحقّقت مسبقاً في طبقة الاستيراد.
     *
     * @param  array{opening_date?: string, notes?: string, source_filename?: string, created_by?: string, number?: string}  $data
     * @param  array<int, array{product_id: string, warehouse_id: string, quantity: int, unit_cost: int, notes?: string|null}>  $lines
     */
    public function createDraft(array $data, array $lines): InventoryOpening
    {
        if ($lines === []) {
            throw new RuntimeException('لا يمكن إنشاء رصيد افتتاحي بلا سطور.');
        }

        return DB::transaction(function () use ($data, $lines) {
            $date = $data['opening_date'] ?? now()->toDateString();

            $opening = InventoryOpening::create([
                'number'          => $data['number'] ?? $this->nextNumber($date),
                'opening_date'    => $date,
                'status'          => 'draft',
                'notes'           => $data['notes'] ?? null,
                'source_filename' => $data['source_filename'] ?? null,
                'created_by'      => $data['created_by'] ?? null,
            ]);

            $quantity = 0;
            $value = 0;

            foreach (array_values($lines) as $position => $line) {
                $lineQuantity = (int) $line['quantity'];
                $lineUnitCost = (int) $line['unit_cost'];
                // القيمة تُحسب هنا مرّةً واحدة وتُخزَّن، ثم تُمرَّر بعينها إلى
                // المخزون وتُجمع للقيد. حسابُها ثلاث مرات في ثلاثة مواضع هو
                // بالضبط ما ينتج انحراف الهللة.
                $lineValue = $lineQuantity * $lineUnitCost;

                InventoryOpeningLine::create([
                    'inventory_opening_id' => $opening->id,
                    'product_id'           => $line['product_id'],
                    'warehouse_id'         => $line['warehouse_id'],
                    'quantity'             => $lineQuantity,
                    'unit_cost'            => $lineUnitCost,
                    'total_cost'           => $lineValue,
                    'notes'                => $line['notes'] ?? null,
                    'position'             => $position + 1,
                ]);

                $quantity += $lineQuantity;
                $value += $lineValue;
            }

            // إجماليات المسودة تقديرٌ للمراجعة؛ إجماليات الترحيل تُعاد من الحركات.
            $opening->update(['total_quantity' => $quantity, 'total_value' => $value]);

            return $opening->fresh('lines');
        });
    }

    /**
     * ترحيل المستند: حركات مخزون + متوسط متحرك + أرصدة مخازن + قيدٌ واحد،
     * كلّه في معاملة واحدة. الكل أو لا شيء.
     */
    public function post(InventoryOpening $opening, ?string $userId = null): InventoryOpening
    {
        if (! $opening->isDraft()) {
            throw new RuntimeException('لا يمكن ترحيل رصيد افتتاحي مرحَّل بالفعل.');
        }

        return DB::transaction(function () use ($opening, $userId) {
            // قفل المستند وإعادة فحص حالته داخل المعاملة: طلبان متزامنان على
            // المسودة نفسها كانا سيرحّلانها مرّتين — حركتان وقيدان لرصيد واحد.
            $opening = InventoryOpening::lockForUpdate()->findOrFail($opening->id);
            if (! $opening->isDraft()) {
                throw new RuntimeException('لا يمكن ترحيل رصيد افتتاحي مرحَّل بالفعل.');
            }

            $opening->loadMissing('lines');
            if ($opening->lines->isEmpty()) {
                throw new RuntimeException('لا يمكن ترحيل رصيد افتتاحي بلا سطور.');
            }

            $products = $this->lockProducts($opening);
            $warehouses = $this->loadWarehouses($opening);

            $this->assertNoPriorMovements($opening, $products);

            $valueByBranch = [];
            $totalValue = 0;
            $totalQuantity = 0;

            foreach ($opening->lines as $line) {
                $product = $products[$line->product_id] ?? null;
                $warehouse = $warehouses[$line->warehouse_id] ?? null;

                $this->assertLinePostable($line, $product, $warehouse);

                $movement = $this->inventory->applyReceipt(
                    $product,
                    $line->quantity,
                    $line->unit_cost,
                    [
                        'warehouse_id' => $line->warehouse_id,
                        'date'         => $opening->opening_date->toDateString(),
                        // المصدر هو **المستند** لا السطر — نفس اصطلاح الأذون
                        // والجرد، فيقرأ كشفُ الحركة مستنداً واحداً قابلاً للفتح.
                        'source_type'  => InventoryOpening::class,
                        'source_id'    => $opening->id,
                        'notes'        => "رصيد افتتاحي {$opening->number}",
                    ],
                    $line->total_cost
                );

                // المفتاح `''` يمثّل «بلا فرع» لأن مفاتيح المصفوفات لا تقبل null.
                $branchKey = (string) ($warehouse->branch_id ?? '');
                $valueByBranch[$branchKey] = ($valueByBranch[$branchKey] ?? 0) + $movement->total_cost;

                $totalValue += $movement->total_cost;
                $totalQuantity += $movement->quantity;
            }

            $entry = $this->buildEntry($opening, $valueByBranch, $totalValue);

            $opening->update([
                'status'           => 'posted',
                'total_quantity'   => $totalQuantity,
                'total_value'      => $totalValue,
                'journal_entry_id' => $entry?->id,
                'posted_by'        => $userId,
                'posted_at'        => now(),
            ]);

            return $opening->fresh('lines');
        });
    }

    /** حذف مسودة. المرحَّل حجّة: يُعكس قيده ولا يُحذف. */
    public function deleteDraft(InventoryOpening $opening): void
    {
        if (! $opening->isDraft()) {
            throw new RuntimeException('لا يُحذف رصيد افتتاحي مرحَّل. صحّحه بقيد عكسي.');
        }

        DB::transaction(function () use ($opening) {
            $opening->lines()->delete();
            $opening->delete();
        });
    }

    /**
     * قفل صفوف المنتجات المتأثرة **قبل** أي حساب متوسط.
     *
     * المتوسط المتحرك قراءةٌ ثم تعديل ثم كتابة على `products`. بلا قفل، ترحيلان
     * متزامنان يقرآن المتوسط نفسه ويكتب أحدهما فوق الآخر — فتضيع كميةٌ كاملة
     * من دون أن يفشل شيء. والقفل يتجاوز عزل الفرع عمداً: السطر مرجعٌ مخزَّن في
     * مستند، فإخفاؤه لا يحمي أحداً بل يُفشل الترحيل بلا سبب مفهوم.
     *
     * @return array<string, Product>
     */
    protected function lockProducts(InventoryOpening $opening): array
    {
        $ids = $opening->lines->pluck('product_id')->unique()->values()->all();

        return BranchScope::reference(Product::class)
            ->whereIn('id', $ids)
            ->lockForUpdate()
            ->get()
            ->keyBy('id')
            ->all();
    }

    /** @return array<string, Warehouse> */
    protected function loadWarehouses(InventoryOpening $opening): array
    {
        $ids = $opening->lines->pluck('warehouse_id')->unique()->values()->all();

        return Warehouse::whereIn('id', $ids)->get()->keyBy('id')->all();
    }

    /**
     * **الرصيد الافتتاحي ليس تسوية.** صنفٌ تحرّك مخزونه من قبل له تاريخٌ لا
     * يجوز أن يُعاد تأسيسه: فتحُ رصيدٍ له يضيف كميةً فوق كميته ويزيح متوسطه.
     * الفحص على مستوى **المنتج** لا المنتج+المخزن، لأن المتوسط عالميّ عليه.
     *
     * @param  array<string, Product>  $products
     */
    protected function assertNoPriorMovements(InventoryOpening $opening, array $products): void
    {
        $moved = StockMovement::whereIn('product_id', array_keys($products))
            // حركاتُ هذا المستند نفسه ليست «سابقة». الفحص يسبق إنشاءها اليوم،
            // والاستثناء يبقى صريحاً كي لا ينقلب إلى حجب ذاتيّ بأي إعادة ترتيب.
            ->where(function ($query) use ($opening) {
                $query->where('source_type', '!=', InventoryOpening::class)
                    ->orWhereNull('source_type')
                    ->orWhere('source_id', '!=', $opening->id);
            })
            ->pluck('product_id')
            ->unique();

        if ($moved->isEmpty()) {
            return;
        }

        $names = $moved->map(fn (string $id): string => $products[$id]?->name ?? $id)->take(5)->implode('، ');

        throw new RuntimeException(
            "هذه الأصناف لديها حركة مخزون سابقة فلا تقبل رصيداً افتتاحياً: {$names}. "
            . 'استخدم الجرد أو الإذن المخزني لتسوية الرصيد بدل الرصيد الافتتاحي.'
        );
    }

    /** إعادة تحقّق حيّة داخل المعاملة: ما صحّ وقت المسودة قد يكون تغيّر. */
    protected function assertLinePostable(InventoryOpeningLine $line, ?Product $product, ?Warehouse $warehouse): void
    {
        if ($product === null) {
            throw new RuntimeException("الصنف في السطر {$line->position} لم يعد موجوداً في نطاق المؤسسة.");
        }
        if ($warehouse === null) {
            throw new RuntimeException("المخزن في السطر {$line->position} لم يعد موجوداً في نطاق المؤسسة.");
        }
        if (! $warehouse->is_active) {
            throw new RuntimeException("المخزن «{$warehouse->name}» في السطر {$line->position} صار غير نشط.");
        }
        if (! $product->track_inventory) {
            throw new RuntimeException("الصنف «{$product->name}» في السطر {$line->position} لا يتتبّع مخزوناً.");
        }
        if ($line->quantity <= 0) {
            throw new RuntimeException("الكمية في السطر {$line->position} يجب أن تكون موجبة.");
        }
        if ($line->unit_cost < 0) {
            throw new RuntimeException("تكلفة الوحدة في السطر {$line->position} لا تكون سالبة.");
        }
        // تكلفة الصفر لا تُفحص هنا: هي قرار مُعلَن قبله في طبقة الاستيراد
        // (`allow_zero_cost`)، وإعادة حجبها عند الترحيل كانت ستُبطل قراراً
        // اتخذه المستخدم صراحةً ووافق عليه في المعاينة.
    }

    /**
     * قيدٌ واحد للمستند، بسطرَين لكل فرع: مدين 1140 ودائن 3130 بقيمة الفرع.
     * فيبقى التوازن الكلي محفوظاً وتبقى أبعاد الفروع صحيحة معاً.
     *
     * @param  array<string, int>  $valueByBranch
     */
    protected function buildEntry(InventoryOpening $opening, array $valueByBranch, int $totalValue): ?JournalEntry
    {
        if ($totalValue === 0) {
            // مستندٌ كلّه بتكلفة صفر يحرّك الكميات ولا قيمة له. قيدٌ بصفرين ضجيج
            // في كشف الأستاذ، والحركات نفسها هي أثره الصحيح.
            return null;
        }

        $inventory = $this->accountId(self::INVENTORY_ACCOUNT_CODE);
        $opening_ = $this->accountId(self::OPENING_ACCOUNT_CODE);

        $lines = [];
        // ترتيب ثابت للمفاتيح: القيد نفسه يخرج بالسطور نفسها في كل تشغيل،
        // فيمكن مقارنته في الاختبارات وفي المراجعة بلا اعتماد على ترتيب عابر.
        ksort($valueByBranch);

        foreach ($valueByBranch as $branchKey => $value) {
            if ($value === 0) {
                continue;
            }
            $branchId = $branchKey === '' ? null : $branchKey;

            $lines[] = ['account_id' => $inventory, 'debit' => $value, 'branch_id' => $branchId];
            $lines[] = ['account_id' => $opening_, 'credit' => $value, 'branch_id' => $branchId];
        }

        return $this->ledger->post($lines, [
            'entry_date'  => $opening->opening_date->toDateString(),
            'description' => "رصيد افتتاحي للمخزون {$opening->number}",
            'source_type' => InventoryOpening::class,
            'source_id'   => $opening->id,
            'created_by'  => $opening->created_by,
            // صريحاً `null`: لا يوجد فرعٌ واحد لهذا المستند، وكل سطر يحمل فرعه.
            // غيابُ المفتاح كان يعني «الفرع النشط» فيلوّث ما لم يُوسم.
            'branch_id'   => null,
        ]);
    }

    protected function accountId(string $code): string
    {
        $account = Account::where('code', $code)->first();
        if (! $account) {
            throw new RuntimeException("الحساب بالكود {$code} غير موجود في دليل الحسابات.");
        }

        return $account->id;
    }

    /** توليد رقم تسلسلي: OPN-2026-00001 — مؤسسيّ لأن المستند `CompanyWide`. */
    protected function nextNumber(string $date): string
    {
        return InventoryOpening::nextDocumentNumber('OPN', $date);
    }
}

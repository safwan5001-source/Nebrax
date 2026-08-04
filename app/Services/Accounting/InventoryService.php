<?php

namespace App\Services\Accounting;

use App\Models\Account;
use App\Models\Invoice;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
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

        $date = $meta['date'] ?? now()->toDateString();

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

        return $movement;
    }

    /**
     * إخراج بضاعة من المخزون (تخفيض الكمية) **دون** توليد قيد محاسبي.
     * يُستخدم عندما يكون القيد جزءاً من عملية أكبر (مثل مرتجع المشتريات).
     * المتوسط لا يتغيّر عند الإخراج. يجب استدعاؤه ضمن معاملة الطرف المستدعي.
     */
    public function applyIssue(Product $product, int $quantity, int $unitCost, array $meta = []): StockMovement
    {
        if ($quantity <= 0 || $unitCost < 0) {
            throw new RuntimeException('كمية الإخراج يجب أن تكون موجبة والتكلفة غير سالبة.');
        }

        $newQty = $product->quantity_on_hand - $quantity;

        $movement = StockMovement::create([
            'product_id'       => $product->id,
            'type'             => 'out',
            'quantity'         => $quantity,
            'unit_cost'        => $unitCost,
            'total_cost'       => $quantity * $unitCost,
            'balance_quantity' => $newQty,
            'source_type'      => $meta['source_type'] ?? null,
            'source_id'        => $meta['source_id'] ?? null,
            'movement_date'    => $meta['date'] ?? now()->toDateString(),
            'notes'            => $meta['notes'] ?? 'إخراج بضاعة',
        ]);

        $product->update(['quantity_on_hand' => $newQty]);

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
        $invoice->loadMissing('lines.product');

        $totalCogs = 0;
        $cogsByAccount = []; // account_id => amount (تجاوز حساب التكلفة لكل منتج)
        $defaultCogs = $this->accountId(self::ACC_COGS);

        foreach ($invoice->lines as $line) {
            $product = $line->product;

            if (! $product || ! $product->track_inventory || $line->quantity <= 0) {
                continue;
            }

            $unitCost = $product->avg_cost;
            $cost     = $line->quantity * $unitCost;
            $newQty   = $product->quantity_on_hand - $line->quantity;

            StockMovement::create([
                'product_id'       => $product->id,
                'type'             => 'out',
                'quantity'         => $line->quantity,
                'unit_cost'        => $unitCost,
                'total_cost'       => $cost,
                'balance_quantity' => $newQty,
                'source_type'      => Invoice::class,
                'source_id'        => $invoice->id,
                'movement_date'    => $invoice->invoice_date->toDateString(),
                'notes'            => "بيع عبر الفاتورة {$invoice->number}",
            ]);

            $product->update(['quantity_on_hand' => $newQty]);
            $totalCogs += $cost;
            $cogsAcct = $product->cogs_account_id ?: $defaultCogs;
            $cogsByAccount[$cogsAcct] = ($cogsByAccount[$cogsAcct] ?? 0) + $cost;
        }

        if ($totalCogs <= 0) {
            return null;
        }

        // قيد: مدين تكلفة البضاعة المباعة (لكل حساب منتج) / دائن المخزون
        $lines = [];
        foreach ($cogsByAccount as $acct => $amount) {
            $lines[] = ['account_id' => $acct, 'debit' => $amount];
        }
        $lines[] = ['account_id' => $this->accountId(self::ACC_INVENTORY), 'credit' => $totalCogs];

        return $this->ledger->post($lines, [
            'entry_date'  => $invoice->invoice_date->toDateString(),
            'description' => "تكلفة بضاعة مباعة {$invoice->number}",
            'source_type' => Invoice::class,
            'source_id'   => $invoice->id,
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
}

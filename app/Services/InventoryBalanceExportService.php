<?php

namespace App\Services;

use App\Models\Product;
use App\Models\ProductWarehouseStock;
use App\Support\Money;
use App\Support\SpreadsheetWriter;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\Response;
use RuntimeException;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * ═══════════════════════════════════════════════════════════════
 *  تصدير أرصدة المخزون — من الخادم لا من صفوف الجدول المحمَّلة
 * ═══════════════════════════════════════════════════════════════
 *  **قراءةٌ محضة.** لا كتابة في `products` ولا في `product_warehouse_stock`
 *  ولا `stock_movements`، ولا قيد محاسبي. يبني الاستعلام نفسه الذي تبنيه
 *  الشاشة (`InventoryBalanceFilters`) ثم يتجاهل التقسيم — فتتطابق دلالة
 *  «النتائج الحالية» مع ما تعرضه الشاشة حرفياً، لا مع صفحتها المرئية.
 *
 *  المصدر منتجٌ عالميّ: `avg_cost` حقلٌ على `products` يبقى متوسطاً واحداً
 *  للمنشأة بلا تغيير — PR-ACL-INVENTORY-CATALOG-EXPORT-SCOPE لا يخترع تكلفة
 *  لكل مخزن (انظر AWJ_INVENTORY_VALUATION_SEMANTICS.md). **الكمية وحدها**
 *  تصبح نطاق المخزن الفعّال للمستخدم المقيَّد: مجموع `product_warehouse_stock`
 *  ضمن مخازنه المسموحة، بدل `products.quantity_on_hand` العالمي. غير المقيَّد
 *  (`allowedWarehouseIds() === null`) يستمر بالعمود العالمي حرفياً — لا خسارة
 *  لكمية مرحلة ما قبل المخازن (حركات بلا `warehouse_id`، انظر §10 من مستند
 *  الدلالات) لأن التوافق الرجعي الكامل يبقيها في `quantity_on_hand` وحده.
 */
class InventoryBalanceExportService
{
    public const SCOPE_FILTERED = 'filtered';
    public const SCOPE_ALL = 'all';

    public const FORMAT_CSV = 'csv';
    public const FORMAT_XLSX = 'xlsx';

    /**
     * سقف صفوف التصدير في طلب متزامن — كتصدير المنتجات. لا عامل خلفية في
     * الإنتاج، فالسقف صريح بدل مهلة طلب مقطوعة على ملف نصف مكتوب. CSV يُبثّ
     * على دفعات، وXLSX يُبنى في ملف مؤقت ثم يُبثّ ويُحذف.
     */
    public const MAX_ROWS = 50000;

    /** حجم الدفعة في المرور بالإزاحة — يوازن بين عدد الاستعلامات والذاكرة. */
    private const CHUNK = 500;

    /**
     * أعمدة الملف بترتيبها ونوعها.
     *  - المعرّفات (الرمز، الباركود) نصّاً: تحفظ الأصفار البادئة ولا تتحوّل
     *    إلى صيغة علمية في Excel.
     *  - الكمية ومتوسط التكلفة وقيمة المخزون أرقاماً: تُجمَع وتُفرَز كأرقام.
     *
     * @return array<string, array{ar: string, en: string, type: string}>
     */
    private const COLUMNS = [
        'sku'         => ['ar' => 'رمز الصنف', 'en' => 'SKU', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'barcode'     => ['ar' => 'الباركود', 'en' => 'Barcode', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'name'        => ['ar' => 'اسم الصنف', 'en' => 'Product name', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'unit'        => ['ar' => 'الوحدة', 'en' => 'Unit', 'type' => SpreadsheetWriter::TYPE_TEXT],
        'quantity'    => ['ar' => 'الكمية', 'en' => 'Quantity', 'type' => SpreadsheetWriter::TYPE_NUMBER],
        'avg_cost'    => ['ar' => 'متوسط التكلفة', 'en' => 'Average cost', 'type' => SpreadsheetWriter::TYPE_NUMBER],
        'stock_value' => ['ar' => 'قيمة المخزون', 'en' => 'Inventory value', 'type' => SpreadsheetWriter::TYPE_NUMBER],
    ];

    /** @return array<int, string> */
    public function headers(string $locale): array
    {
        $key = str_starts_with($locale, 'en') ? 'en' : 'ar';

        return array_map(static fn (array $column): string => $column[$key], array_values(self::COLUMNS));
    }

    /** @return array<int, string> */
    public function columnTypes(): array
    {
        return array_map(static fn (array $column): string => $column['type'], array_values(self::COLUMNS));
    }

    /**
     * يبني استجابة تنزيل من استعلام مُعدّ مسبقاً (مصفّى ومُرتَّب في المتحكّم).
     *
     * `$includeZero=false` يُسقط الأصناف ذات الرصيد صفر — خيار **تصدير** لا
     * يمسّ الشاشة. يُطبَّق هنا لا في المتحكّم كي يشمل عدّ الصفوف نفسه فلا
     * يتجاوز ملفٌ مصفّى السقفَ بأصفارٍ لن تُكتب.
     */
    /**
     * `$costAuthorized=false` يفرغ `avg_cost`/`stock_value` دون حذف عمودَيهما —
     * PR-INV-1: تصدير آمن لمن لا يملك `products.view_cost` بدل حجب التقرير كله.
     *
     * `$warehouseIds` نطاق المخزن الفعّال (`ReportWarehouseScope::resolve()`):
     * `null` = غير مقيَّد، الكمية تبقى `products.quantity_on_hand` كما كانت.
     * مصفوفة = مقيَّد؛ الكمية تُعاد حسابها لكل دفعة من `product_warehouse_stock`
     * ضمن هذه المخازن وحدها (`rows()`).
     */
    public function download(Builder $query, string $format, string $filename, string $locale, bool $includeZero, bool $costAuthorized = true, ?array $warehouseIds = null): StreamedResponse|Response
    {
        // فلترة SQL على `quantity_on_hand` العالمي صحيحة لغير المقيَّد فقط —
        // الكمية المعروضة له هي العمود نفسه. المقيَّد يُستبعد صفره أثناء البث
        // في rows() على الكمية المحدودة النطاق الفعلية، لا هذا العمود.
        if (! $includeZero && $warehouseIds === null) {
            $query->where('quantity_on_hand', '!=', 0);
        }

        // السقف يبقى على العدّ العالمي حتى للمقيَّد: تصفية أدق حسب المخزن كانت
        // تحتاج استعلام تجميع إضافي هنا، والعدّ العالمي حدٌّ أعلى آمن — لا يقل
        // أبداً عمّا سيُصدَّر فعلاً، فلا يفلت تصديرٌ كان يجب حجبه.
        $total = (clone $query)->toBase()->getCountForPagination();
        if ($total > self::MAX_ROWS) {
            throw new RuntimeException(
                'عدد الأصناف المطلوب تصديره ('.$total.') يتجاوز الحد الأقصى البالغ '.self::MAX_ROWS
                .' صفاً في طلب واحد. ضيّق الفلاتر ثم أعد التصدير.'
            );
        }

        $headers = $this->headers($locale);

        return $format === self::FORMAT_XLSX
            ? $this->xlsxResponse($query, $headers, $filename, $costAuthorized, $warehouseIds, $includeZero)
            : $this->csvResponse($query, $headers, $filename, $costAuthorized, $warehouseIds, $includeZero);
    }

    /** @param array<int, string> $headers */
    private function csvResponse(Builder $query, array $headers, string $filename, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): StreamedResponse
    {
        return response()->streamDownload(function () use ($query, $headers, $costAuthorized, $warehouseIds, $includeZero): void {
            SpreadsheetWriter::streamCsv($headers, $this->rows($query, $costAuthorized, $warehouseIds, $includeZero));
        }, "{$filename}.csv", [
            'Content-Type' => 'text/csv; charset=UTF-8',
        ]);
    }

    /** @param array<int, string> $headers */
    private function xlsxResponse(Builder $query, array $headers, string $filename, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): Response
    {
        $path = tempnam(sys_get_temp_dir(), 'nebrax-inventory-');
        if ($path === false) {
            throw new RuntimeException('تعذر تجهيز ملف التصدير المؤقت.');
        }

        try {
            SpreadsheetWriter::xlsx($path, $headers, $this->rows($query, $costAuthorized, $warehouseIds, $includeZero), $this->columnTypes(), 'Inventory');
            $contents = file_get_contents($path);
            if ($contents === false) {
                throw new RuntimeException('تعذر قراءة ملف التصدير بعد بنائه.');
            }

            return response($contents, 200, [
                'Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition' => 'attachment; filename="'.$filename.'.xlsx"',
                'Content-Length' => (string) strlen($contents),
            ]);
        } finally {
            @unlink($path);
        }
    }

    /**
     * مرور على دفعات يحترم ترتيب الشاشة. لا `lazyById` (تفرض ترتيباً بالمفتاح
     * فتُسقط الفرزَ المطلوب صامتةً)؛ المتحكّم يضمن ترتيباً حتمياً (عمود الفرز
     * ثم `id`) فالتقسيم بالإزاحة مستقرّ.
     *
     * لكل دفعة، إن كان المستخدم مقيَّداً بمخازن: استعلام تجميع واحد إضافي على
     * `product_warehouse_stock` لمنتجات الدفعة نفسها فقط — يحافظ على نمط
     * الذاكرة المحدودة (لا تحميل الكتالوج كله لحساب خريطة عالمية).
     *
     * @return \Generator<int, array<int, string|null>>
     */
    private function rows(Builder $query, bool $costAuthorized, ?array $warehouseIds, bool $includeZero): \Generator
    {
        $page = 1;

        do {
            $batch = (clone $query)->forPage($page, self::CHUNK)->get();

            $scopedQuantities = $warehouseIds === null ? null : ProductWarehouseStock::query()
                ->whereIn('product_id', $batch->pluck('id'))
                ->whereIn('warehouse_id', $warehouseIds)
                ->selectRaw('product_id, SUM(quantity) as qty')
                ->groupBy('product_id')
                ->pluck('qty', 'product_id');

            foreach ($batch as $product) {
                $quantity = $warehouseIds === null
                    ? (int) $product->quantity_on_hand
                    : (int) ($scopedQuantities[$product->id] ?? 0);

                // استبعاد الصفر هنا لا في WHERE: الكمية المرجعية للمقيَّد هي
                // المجموع المحدود النطاق، لا `quantity_on_hand` العالمي.
                if (! $includeZero && $warehouseIds !== null && $quantity === 0) {
                    continue;
                }

                yield $this->row($product, $costAuthorized, $quantity);
            }

            $page++;
        } while ($batch->count() === self::CHUNK);
    }

    /**
     * صفٌّ واحد. `$quantity` مُحسَبة مسبقاً في rows() — العمود العالمي مباشرة
     * لغير المقيَّد، أو مجموع نطاق المخزن الفعّال للمقيَّد. القيمة تُشتقّ من
     * نفس `$quantity × avg_cost` بالهللات ثم تُعرَض ريالاً — فما يجده المستخدم
     * في الملف هو ما يراه في الجدول، ضمن نطاقه.
     *
     * @return array<int, string|null>
     */
    private function row(Product $product, bool $costAuthorized, int $quantity): array
    {
        return [
            $product->sku,
            $product->barcode,
            $product->name,
            $product->unit,
            (string) $quantity,
            $costAuthorized ? Money::toRiyal($product->avg_cost) : null,
            $costAuthorized ? Money::toRiyal($quantity * $product->avg_cost) : null,
        ];
    }
}
